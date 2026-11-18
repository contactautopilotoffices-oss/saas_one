import {
    AccessToken, AudioCodec, EgressClient, EncodedFileOutput, EncodedFileType, EncodingOptions, RoomConfiguration,
    RoomServiceClient, S3Upload, type EgressInfo,
} from 'livekit-server-sdk';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { closeRoom, liveKitConfig } from '@/backend/lib/meetings/livekit';
import { TaskDatabaseService } from '../TaskDatabaseService';
import { isMissingSchema } from '../TaskLinks';
import { isUuid } from '../WorkspaceService';
import { MEETING_BUCKET, MeetingError } from './MeetingService';
import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import {
    MAX_WAITING, audioPathFor, canJoin, cleanGuestName, decideGuest, egressState, guestIdentity, guestPathFor, guestsForStaff,
    isGuestToken, liveOutcome, onlineSetupGaps, recordingStorage, roomNameFor, type EgressEntry, type GuestEntry, type OnlineState,
} from './online';
import type { MeetingSpace } from './visibility';

/**
 * Meeting Assistant — online meetings (owner 2026-11-18, stage 1): the LiveKit and database side. Rules: ./online.ts.
 *
 *   create (MeetingService.create, kind 'online') → status 'scheduled', link /meet/<id>
 *   someone joins → `token` (only after agreeing to the recording) → connects → `joined`: status 'live', the sound
 *   recording starts (LiveKit egress, saved straight into our private 'meeting-audio' bucket)
 *   the host ends it, or everyone leaves → the recording stops → `check` (cron and the review screen's polling) moves
 *   the meeting to 'uploaded', and the usual steps write the notes and delete the sound.
 * The video is never recorded (owner 2026-11-18: it would take up too much space).
 *
 * The meeting agent (Ira) is NOT sent into these rooms: their tokens dispatch no agent.
 * Plan: docs/MEETING_TASKS_SPEC.md
 */

interface OnlineRow {
    id: string; title: string; created_by: string; attendee_ids: string[]; extra_names: string[]; confidential: boolean; status: string;
    workspace?: MeetingSpace | null; kind?: string | null; scheduled_for?: string | null; online?: OnlineState | null;
    lease_until: string | null;
}

/** A short lock on the row while the call's state is changed (two people joining at once must not lose a write). */
const LOCK_MS = 60_000;
/** Join tokens: only for connecting; someone already in the call stays connected. */
const TOKEN_TTL = '15m';
/** The call's sound for the notes: Opus at 32 kbps, about 15 MB an hour (deleted once it is text). */
const AUDIO_OPTIONS = { audioCodec: AudioCodec.OPUS, audioBitrate: 32, audioFrequency: 48000 };

const NOT_FOUND = () => new MeetingError(404, 'This meeting does not exist, or you are not invited to it.', 'NOT_FOUND');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function httpUrl(): string | null {
    const cfg = liveKitConfig();
    return cfg ? cfg.url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:') : null;
}
function egressClient(): EgressClient | null {
    const cfg = liveKitConfig(), url = httpUrl();
    return cfg && url ? new EgressClient(url, cfg.apiKey, cfg.apiSecret) : null;
}
function roomClient(): RoomServiceClient | null {
    const cfg = liveKitConfig(), url = httpUrl();
    return cfg && url ? new RoomServiceClient(url, cfg.apiKey, cfg.apiSecret) : null;
}
/** A LiveKit error as a short line for the log and the `problem` field (never a key or a URL with a token). */
const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, '[url]').slice(0, 160);

export class OnlineMeetingService {
    private static async row(id: string): Promise<OnlineRow> {
        if (!isUuid(id)) throw NOT_FOUND();
        const { data, error } = await supabaseAdmin.from('meeting_notes').select('*').eq('id', id).maybeSingle();
        if (error) {
            if (isMissingSchema(error)) throw new MeetingError(503, 'Online meetings are not set up yet. Please ask the admin to apply the latest database update.', 'NOT_READY');
            throw new MeetingError(500, 'Could not load the meeting');
        }
        if (!data || data.status === 'discarded' || data.kind !== 'online') throw NOT_FOUND();
        return data as OnlineRow;
    }

    /** The row, if this person may join it (else "does not exist", so a link reveals nothing to others). */
    private static async joinable(userId: string, id: string, spaces: ReadonlySet<MeetingSpace>): Promise<OnlineRow> {
        const m = await this.row(id);
        if (!canJoin(m, userId, spaces)) throw NOT_FOUND();
        return m;
    }

    private static isOpen(m: OnlineRow): boolean {
        return (m.status === 'scheduled' || m.status === 'live') && !m.online?.endedAt;
    }

    /** Runs `fn` on the freshest row while holding the row's short lock. Waits briefly if someone else holds it. */
    private static async locked<T>(id: string, fn: (m: OnlineRow) => Promise<{ online?: OnlineState; patch?: Record<string, unknown>; result: T }>): Promise<T | null> {
        for (let attempt = 0; attempt < 6; attempt++) {
            const now = new Date().toISOString();
            const lease = new Date(Date.now() + LOCK_MS).toISOString();
            const { data } = await supabaseAdmin.from('meeting_notes').update({ lease_until: lease })
                .eq('id', id).in('status', ['scheduled', 'live']).or(`lease_until.is.null,lease_until.lt.${now}`).select('*');
            const m = (data?.[0] ?? null) as OnlineRow | null;
            if (!m) { await sleep(700); continue; }
            try {
                const out = await fn(m);
                await supabaseAdmin.from('meeting_notes')
                    .update({ ...(out.patch ?? {}), ...(out.online ? { online: out.online } : {}), lease_until: null, updated_at: new Date().toISOString() })
                    .eq('id', id).eq('lease_until', lease);
                return out.result;
            } catch (err) {
                await supabaseAdmin.from('meeting_notes').update({ lease_until: null }).eq('id', id).eq('lease_until', lease);
                throw err;
            }
        }
        return null;
    }

    // ── joining ───────────────────────────────────────────────────────────────

    /** What the join page shows before anyone connects. */
    static async joinInfo(userId: string, id: string, spaces: ReadonlySet<MeetingSpace>) {
        const m = await this.joinable(userId, id, spaces);
        const { data: host } = await supabaseAdmin.from('users').select('full_name').eq('id', m.created_by).maybeSingle();
        return {
            meeting: {
                id: m.id, title: m.title, status: m.status, scheduledFor: m.scheduled_for ?? null, confidential: m.confidential,
                hostName: (host?.full_name as string | undefined) || 'Someone', isHost: m.created_by === userId,
                open: this.isOpen(m), startedAt: m.online?.startedAt ?? null, problem: m.online?.problem ?? null,
            },
            setup: onlineSetupGaps(),
            // Stage 2: the guest link (if the host turned it on) and who asked to join through it
            guests: this.guestsView(m, userId),
        };
    }

    /** A LiveKit token to join, only after the person agreed to the recording. No agent is sent into the room. */
    static async token(userId: string, id: string, spaces: ReadonlySet<MeetingSpace>, input: { consent?: unknown }) {
        const m = await this.joinable(userId, id, spaces);
        if (!this.isOpen(m)) throw new MeetingError(409, 'This meeting has ended.', 'ENDED');
        if (input.consent !== true) throw new MeetingError(400, 'Please agree to the recording before joining.', 'CONSENT');
        const cfg = liveKitConfig();
        const gaps = onlineSetupGaps();
        if (!cfg || gaps.length) throw new MeetingError(503, `Video calls are not set up yet. ${gaps.join(' ')}`, 'NOT_READY');

        const { data: me } = await supabaseAdmin.from('users').select('full_name, email').eq('id', userId).maybeSingle();
        const name = (me?.full_name as string | undefined) || (me?.email as string | undefined) || 'Guest';
        const at = new AccessToken(cfg.apiKey, cfg.apiSecret, { identity: userId, name, ttl: TOKEN_TTL });
        at.addGrant({ roomJoin: true, room: m.online?.room || roomNameFor(id), canPublish: true, canSubscribe: true, canPublishData: true });
        // A room nobody entered closes after 10 minutes; once the last person leaves it waits 2 minutes for a reconnect.
        at.roomConfig = new RoomConfiguration({ emptyTimeout: 600, departureTimeout: 120 });
        await TaskDatabaseService.logAudit({ eventType: 'meeting_online_join', actorId: userId, details: { meetingId: id, consent: true } });
        return { url: cfg.url, token: await at.toJwt(), identity: userId };
    }

    /**
     * Called by the call screen once it is connected (the room exists now): marks the meeting live, notes who joined,
     * and starts the sound recording if it is not running. Recording problems never stop the call; they are reported.
     */
    static async joined(userId: string, id: string, spaces: ReadonlySet<MeetingSpace>) {
        const m0 = await this.joinable(userId, id, spaces);
        if (!this.isOpen(m0)) throw new MeetingError(409, 'This meeting has ended.', 'ENDED');
        const emp = await TaskDatabaseService.getEmployeeById(userId).catch(() => null);
        return this.goLive(id, { userId, addAttendee: !!emp?.active });
    }

    /**
     * Someone is connected (staff, or since stage 2 an admitted guest): the meeting is live and the sound recording runs.
     * `userId` (staff only) is noted as joined, and added to "who was present" when they are in the Task Manager.
     */
    private static async goLive(id: string, who: { userId?: string; addAttendee?: boolean }) {
        const result = await this.locked(id, async m => {
            const online: OnlineState = { room: roomNameFor(id), ...(m.online ?? {}) };
            online.startedAt = online.startedAt ?? new Date().toISOString();
            if (who.userId) online.joined = [...new Set([...(online.joined ?? []), who.userId])];
            // Someone in the Task Manager who joined counts as present (the notes and the speech service use the names)
            const attendees = who.userId && who.addAttendee && !m.attendee_ids.includes(who.userId) ? [...m.attendee_ids, who.userId] : m.attendee_ids;
            const problem = await this.ensureRecording(id, online);
            online.problem = problem;
            return { online, patch: { status: 'live', attendee_ids: attendees }, result: { recording: !problem, problem } };
        });
        if (!result) throw new MeetingError(503, 'The meeting is busy. Please try again in a moment.');
        return result;
    }

    /** Starts the sound recording if it is not already running. Returns a plain problem, or null. */
    private static async ensureRecording(id: string, online: OnlineState): Promise<string | null> {
        const client = egressClient();
        const store = recordingStorage();
        if (!client || !store) return 'Recording is not set up on this server, so this call is not being recorded.';
        // Never start a recording on a guess: if LiveKit cannot say what is running, a second copy could be started
        let all: EgressInfo[];
        try { all = await client.listEgress({ roomName: online.room }); } catch (e) {
            console.warn('[OnlineMeeting] listEgress:', short(e));
            return 'Could not check the recording. Press "Try again" in the call.';
        }
        // Starting, recording or ending all count as running
        const running = new Set(all.filter(e => egressState(Number(e.status)) === 'active').map(e => e.egressId));
        if ((online.audio ?? []).some(e => running.has(e.egressId))) return null;

        const path = audioPathFor(id, (online.audio ?? []).length);
        const s3 = new S3Upload({ accessKey: store.accessKey, secret: store.secret, region: store.region, endpoint: store.endpoint, bucket: MEETING_BUCKET, forcePathStyle: true });
        try {
            const info = await client.startRoomCompositeEgress(online.room,
                { file: new EncodedFileOutput({ fileType: EncodedFileType.OGG, filepath: path, disableManifest: true, output: { case: 's3', value: s3 } }) },
                { audioOnly: true, encodingOptions: new EncodingOptions(AUDIO_OPTIONS) });
            online.audio = [...(online.audio ?? []), { egressId: info.egressId, path, startedAt: new Date().toISOString(), state: 'active' }];
            return null;
        } catch (e) {
            console.error('[OnlineMeeting] sound recording did not start:', id, short(e));
            return 'Recording of the sound (needed for the notes) could not start. Press "Try again" in the call.';
        }
    }

    /** The host ends the call for everyone: recordings stop, the room closes. The notes follow by themselves. */
    static async end(userId: string, id: string, spaces: ReadonlySet<MeetingSpace>) {
        const m = await this.joinable(userId, id, spaces);
        if (m.created_by !== userId) throw new MeetingError(403, 'Only the person who set up this meeting can end it for everyone.');
        if (!this.isOpen(m)) return { ok: true };
        await this.stopAndClose(m.online?.room || roomNameFor(id));
        await this.locked(id, async row => ({
            online: { room: roomNameFor(id), ...(row.online ?? {}), endedAt: new Date().toISOString(), endedBy: userId },
            // A meeting nobody ever joined has nothing to process: it is simply closed
            patch: row.status === 'scheduled' ? { status: 'failed', error: 'The meeting was ended before anyone joined.' } : {},
            result: true,
        }));
        await TaskDatabaseService.logAudit({ eventType: 'meeting_online_ended', actorId: userId, details: { meetingId: id } });
        await this.check(id);
        return { ok: true };
    }

    private static async stopAndClose(room: string) {
        const client = egressClient();
        if (client) {
            const all = await client.listEgress({ roomName: room }).catch(() => [] as EgressInfo[]);
            for (const e of all.filter(x => egressState(Number(x.status)) === 'active')) await client.stopEgress(e.egressId).catch(err => console.warn('[OnlineMeeting] stopEgress:', short(err)));
        }
        await closeRoom(room).catch(err => console.warn('[OnlineMeeting] closeRoom:', short(err)));
    }

    // ── guests without a login (stage 2, owner 2026-11-18) ──────────────────────
    //
    // The host turns on a guest link (/guest/<secret>). A guest types their name and agrees to the recording, then waits;
    // anyone who may join the meeting can let them in or refuse them, and remove someone already let in. A guest's own
    // secret `key` (in their browser) is the only way to see their answer and get a call token.

    /** What staff see: the guest link (if on) and the requests, never a guest's key. Only the creator turns the link on or off. */
    static guestsView(m: { created_by: string; online?: OnlineState | null }, userId: string) {
        const token = m.online?.guestToken;
        return { path: token ? guestPathFor(token) : null, list: guestsForStaff(m.online?.guests), canManageLink: m.created_by === userId };
    }

    /** The host turns the guest link on (a new secret if there was none) or off (waiting guests are refused). */
    static async setGuestLink(userId: string, id: string, spaces: ReadonlySet<MeetingSpace>, on: boolean) {
        const m = await this.joinable(userId, id, spaces);
        if (m.created_by !== userId) throw new MeetingError(403, 'Only the person who set up this meeting can turn the guest link on or off.');
        if (!this.isOpen(m)) throw new MeetingError(409, 'This meeting has ended.', 'ENDED');
        const out = await this.locked(id, async row => {
            const online: OnlineState = { room: roomNameFor(id), ...(row.online ?? {}) };
            const now = new Date().toISOString();
            if (on) online.guestToken = online.guestToken || randomBytes(24).toString('base64url');
            else {
                online.guestToken = null;
                online.guests = (online.guests ?? []).map(g => (g.state === 'waiting' ? { ...g, state: 'denied' as const, decidedAt: now, decidedBy: userId } : g));
            }
            return { online, result: { path: online.guestToken ? guestPathFor(online.guestToken) : null } };
        });
        if (!out) throw new MeetingError(503, 'The meeting is busy. Please try again in a moment.');
        await TaskDatabaseService.logAudit({ eventType: 'meeting_guest_link', actorId: userId, details: { meetingId: id, on } });
        return { guestPath: out.path };
    }

    /** Let a waiting guest in, refuse them, or remove one already let in. Anyone who may join the meeting can. */
    static async decideGuestRequest(userId: string, id: string, spaces: ReadonlySet<MeetingSpace>, guestId: unknown, decision: unknown) {
        if (decision !== 'admit' && decision !== 'deny' && decision !== 'remove') throw new MeetingError(400, 'Unknown choice.');
        if (typeof guestId !== 'string' || !isUuid(guestId)) throw new MeetingError(400, 'Unknown guest.');
        const m = await this.joinable(userId, id, spaces);
        if (!this.isOpen(m)) throw new MeetingError(409, 'This meeting has ended.', 'ENDED');
        const out = await this.locked(id, async row => {
            const online: OnlineState = { room: roomNameFor(id), ...(row.online ?? {}) };
            const guest = (online.guests ?? []).find(g => g.id === guestId);
            if (!guest) return { result: 'missing' as const };
            const next = decideGuest(guest, decision, userId, new Date().toISOString());
            if (!next) return { result: 'answered' as const };
            online.guests = (online.guests ?? []).map(g => (g.id === guestId ? next : g));
            // A guest let in is named in the notes like a typed-in name (the speech service and the notes use the names)
            const names = row.extra_names ?? [];
            const patch = decision === 'admit' && !names.includes(next.name) && names.length < 30 ? { extra_names: [...names, next.name] } : undefined;
            return { online, patch, result: next };
        });
        if (out === null) throw new MeetingError(503, 'The meeting is busy. Please try again in a moment.');
        if (out === 'missing') throw new MeetingError(404, 'That guest is no longer on the list.');
        if (out === 'answered') throw new MeetingError(409, 'Someone has already answered that request.');
        if (decision === 'remove') {
            const rooms = roomClient();
            await rooms?.removeParticipant(m.online?.room || roomNameFor(id), guestIdentity(out.id)).catch(err => console.warn('[OnlineMeeting] removeParticipant:', short(err)));
        }
        await TaskDatabaseService.logAudit({ eventType: 'meeting_guest_decided', actorId: userId, details: { meetingId: id, guestId: out.id, decision } });
        return { ok: true };
    }

    // The guest's side (public: the link's secret is the only key, plus each guest's own key)

    private static async byGuestToken(token: unknown): Promise<OnlineRow> {
        const gone = () => new MeetingError(404, 'This guest link is not valid, or the host has turned it off.', 'LINK_OFF');
        if (!isGuestToken(token)) throw gone();
        const { data, error } = await supabaseAdmin.from('meeting_notes').select('*')
            .eq('kind', 'online').eq('online->>guestToken', token).neq('status', 'discarded').limit(1);
        if (error) {
            if (isMissingSchema(error)) throw gone();
            throw new MeetingError(500, 'Could not load the meeting');
        }
        const m = (data?.[0] ?? null) as OnlineRow | null;
        if (!m) throw gone();
        return m;
    }

    /** The guest's own request, checked against their key (compared in constant time). */
    private static guestOf(m: OnlineRow, guestId: unknown, key: unknown): GuestEntry {
        const g = (m.online?.guests ?? []).find(x => x.id === guestId);
        const given = Buffer.from(typeof key === 'string' ? key : '');
        const real = Buffer.from(g?.key ?? '');
        if (!g || given.length !== real.length || !timingSafeEqual(given, real)) throw new MeetingError(404, 'We could not find your request. Please ask to join again.', 'NO_REQUEST');
        return g;
    }

    /** What the guest page shows first. Says nothing about the server's setup beyond "not ready". */
    static async guestInfo(token: unknown) {
        const m = await this.byGuestToken(token);
        const { data: host } = await supabaseAdmin.from('users').select('full_name').eq('id', m.created_by).maybeSingle();
        return {
            meeting: { title: m.title, hostName: (host?.full_name as string | undefined) || 'Someone', scheduledFor: m.scheduled_for ?? null, open: this.isOpen(m) },
            ready: onlineSetupGaps().length === 0,
        };
    }

    /** A guest asks to join: their name, and their agreement to the recording. Returns their own id and key. */
    static async guestAsk(token: unknown, input: { name?: unknown; consent?: unknown }) {
        const m = await this.byGuestToken(token);
        if (!this.isOpen(m)) throw new MeetingError(409, 'This meeting has ended.', 'ENDED');
        if (input.consent !== true) throw new MeetingError(400, 'Please agree to the recording before asking to join.', 'CONSENT');
        let name: string;
        try { name = cleanGuestName(input.name); } catch (e) { throw new MeetingError(400, e instanceof Error ? e.message : 'Please type your name.'); }
        const now = new Date().toISOString();
        const entry: GuestEntry = { id: randomUUID(), name, key: randomBytes(24).toString('base64url'), state: 'waiting', askedAt: now, consentAt: now };
        const out = await this.locked(m.id, async row => {
            const online: OnlineState = { room: roomNameFor(m.id), ...(row.online ?? {}) };
            // The link may have been turned off a moment ago
            if (online.guestToken !== token) return { result: 'off' as const };
            if ((online.guests ?? []).filter(g => g.state === 'waiting').length >= MAX_WAITING) return { result: 'full' as const };
            online.guests = [...(online.guests ?? []), entry];
            return { online, result: 'ok' as const };
        });
        if (out === null) throw new MeetingError(503, 'The meeting is busy. Please try again in a moment.');
        if (out === 'off') throw new MeetingError(404, 'This guest link is not valid, or the host has turned it off.', 'LINK_OFF');
        if (out === 'full') throw new MeetingError(429, 'Too many people are waiting to join. Please try again in a few minutes.');
        await TaskDatabaseService.logAudit({ eventType: 'meeting_guest_asked', details: { meetingId: m.id, guestId: entry.id, consent: true } });
        return { guestId: entry.id, key: entry.key };
    }

    /** The guest page polls this while waiting: their answer, and whether the meeting is still open. */
    static async guestStatus(token: unknown, guestId: unknown, key: unknown) {
        const m = await this.byGuestToken(token);
        const g = this.guestOf(m, guestId, key);
        return { state: g.state, open: this.isOpen(m) };
    }

    /** A call token for a guest who was let in. Their name is shown with "(guest)"; no agent is sent into the room. */
    static async guestCallToken(token: unknown, guestId: unknown, key: unknown) {
        const m = await this.byGuestToken(token);
        const g = this.guestOf(m, guestId, key);
        if (!this.isOpen(m)) throw new MeetingError(409, 'This meeting has ended.', 'ENDED');
        if (g.state !== 'admitted') throw new MeetingError(403, g.state === 'waiting' ? 'Please wait until someone lets you in.' : 'You cannot join this meeting.', 'NOT_ADMITTED');
        const cfg = liveKitConfig();
        if (!cfg || onlineSetupGaps().length) throw new MeetingError(503, 'Video calls are not ready yet. Please tell the host.', 'NOT_READY');
        const at = new AccessToken(cfg.apiKey, cfg.apiSecret, { identity: guestIdentity(g.id), name: `${g.name} (guest)`, ttl: TOKEN_TTL });
        at.addGrant({ roomJoin: true, room: m.online?.room || roomNameFor(m.id), canPublish: true, canSubscribe: true, canPublishData: false });
        at.roomConfig = new RoomConfiguration({ emptyTimeout: 600, departureTimeout: 120 });
        return { url: cfg.url, token: await at.toJwt() };
    }

    /** A guest who was let in is connected: if nobody from the team is in yet, the meeting goes live and recording starts. */
    static async guestConnected(token: unknown, guestId: unknown, key: unknown) {
        const m = await this.byGuestToken(token);
        const g = this.guestOf(m, guestId, key);
        if (g.state !== 'admitted' || !this.isOpen(m)) throw new MeetingError(409, 'You cannot join this meeting.', 'NOT_ADMITTED');
        const r = await this.goLive(m.id, {});
        // A guest is only told whether it is recorded, not the reason (that is for the team)
        return { recording: r.recording };
    }

    // ── after the call ────────────────────────────────────────────────────────

    /**
     * A live meeting: brings the sound recordings' state up to date and, once the call is over and every recording has
     * stopped, hands the meeting to the usual steps ('uploaded'). Called by the cron and by the review screen's polling.
     * Never throws.
     */
    static async check(id: string): Promise<void> {
        try {
            const client = egressClient(), rooms = roomClient();
            if (!client || !rooms) return;
            await this.locked(id, async m => {
                if (m.status !== 'live') return { result: null };
                const online: OnlineState = { room: roomNameFor(id), ...(m.online ?? {}) };
                const infos = await client.listEgress({ roomName: online.room });
                const byId = new Map(infos.map(e => [e.egressId, e]));
                const refresh = (list: EgressEntry[] | undefined) => (list ?? []).map(entry => {
                    const info = byId.get(entry.egressId);
                    if (!info) return entry;
                    const file = info.fileResults?.[0];
                    return {
                        ...entry, state: egressState(Number(info.status)), error: info.error || null,
                        ...(file ? { bytes: Number(file.size), durationSeconds: Math.round(Number(file.duration) / 1e9) } : {}),
                    };
                });
                online.audio = refresh(online.audio);
                const roomOpen = await rooms.listRooms([online.room]).then(r => r.length > 0).catch(() => null);
                const states = online.audio.map(e => e.state ?? 'active');
                const outcome = liveOutcome({ states, roomOpen, endedAt: online.endedAt, startedAt: online.startedAt, now: Date.now() });

                if (outcome === 'stop') {
                    await this.stopAndClose(online.room);
                    return { online: { ...online, endedAt: online.endedAt ?? new Date().toISOString(), problem: 'The call ran for more than 12 hours, so it was stopped.' }, result: null };
                }
                if (outcome === 'wait') return { online, result: null };

                online.endedAt = online.endedAt ?? new Date().toISOString();
                const hasAudio = online.audio.some(a => a.state === 'done') && await this.audioStored(id);
                await TaskDatabaseService.logAudit({ eventType: 'meeting_online_finished', details: { meetingId: id, audio: online.audio.length, hasAudio } });
                if (hasAudio) return { online, patch: { status: 'uploaded', error: null, attempts: 0 }, result: null };
                // Say why when LiveKit said why (e.g. it could not save into storage)
                const why = online.audio.find(a => a.error)?.error;
                const error = why ? `The call's sound could not be saved (${why.slice(0, 120)}), so there are no notes.` : online.problem || 'The call was not recorded, so there are no notes.';
                return { online, patch: { status: 'failed', error }, result: null };
            });
        } catch (err) {
            console.error('[OnlineMeeting] check failed:', id, short(err));
        }
    }

    private static async audioStored(id: string): Promise<boolean> {
        const { data } = await supabaseAdmin.storage.from(MEETING_BUCKET).list(id, { limit: 100 });
        return (data ?? []).some(f => /^s\d{2}$/.test(f.name));
    }

    /** The cron's share: a few live meetings get a check each; late sound files of deleted online meetings are removed. */
    static async tickLive(limit = 5): Promise<string[]> {
        if (!liveKitConfig()) return [];
        const { data, error } = await supabaseAdmin.from('meeting_notes').select('id').eq('status', 'live')
            .order('updated_at', { ascending: true }).limit(limit);
        if (error) return [];
        const ids = (data ?? []).map(r => (r as { id: string }).id);
        for (const id of ids) await this.check(id);
        // A sound file that was still being saved when its meeting was deleted can arrive afterwards: remove it for a day
        const { data: gone } = await supabaseAdmin.from('meeting_notes').select('id').eq('status', 'discarded').eq('kind', 'online')
            .gt('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).limit(10);
        for (const r of (gone ?? []) as Array<{ id: string }>) await this.removeLateAudio(r.id).catch(() => undefined);
        return ids;
    }

    /** Deleting an online meeting: stop the call and its recording. (MeetingService.discard then deletes the sound.) */
    static async cleanup(m: { id: string; online?: OnlineState | null }) {
        await this.stopAndClose(m.online?.room || roomNameFor(m.id)).catch(() => undefined);
    }

    /** Removes any sound file of a deleted meeting that arrived after the delete. */
    private static async removeLateAudio(id: string) {
        const { data: folders, error } = await supabaseAdmin.storage.from(MEETING_BUCKET).list(id, { limit: 100 });
        if (error) throw error;
        const paths: string[] = [];
        for (const seg of (folders ?? []).map(f => f.name).filter(n => /^s\d{2}$/.test(n))) {
            const { data: files } = await supabaseAdmin.storage.from(MEETING_BUCKET).list(`${id}/${seg}`, { limit: 100 });
            for (const f of files ?? []) paths.push(`${id}/${seg}/${f.name}`);
        }
        if (paths.length) {
            const { error: rmError } = await supabaseAdmin.storage.from(MEETING_BUCKET).remove(paths);
            if (rmError) throw rmError;
        }
    }
}
