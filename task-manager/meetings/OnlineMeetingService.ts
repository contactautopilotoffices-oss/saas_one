import { AccessToken, RoomConfiguration, RoomServiceClient } from 'livekit-server-sdk';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { closeRoom, liveKitConfig } from '@/backend/lib/meetings/livekit';
import { TaskDatabaseService } from '../TaskDatabaseService';
import { isMissingSchema } from '../TaskLinks';
import { isUuid } from '../WorkspaceService';
import { MEETING_BUCKET, MeetingError, MeetingService } from './MeetingService';
import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import {
    MAX_WAITING, RECORDER_LEASE_MS, callOutcome, canJoin, cleanGuestName, decideGuest, guestIdentity, guestPathFor, guestsForStaff,
    isGuestToken, leaseAlive, missingCallPieces, onlineSetupGaps, recorderDecision, roomNameFor, type GuestEntry, type OnlineState,
} from './online';
import type { MeetingSpace } from './visibility';

/**
 * Meeting Assistant — online meetings (owner 2026-11-18, stage 1): the LiveKit and database side. Rules: ./online.ts.
 *
 *   create (MeetingService.create, kind 'online') → status 'scheduled', one link /guest/<secret> for everyone
 *   someone joins → `token` (after the "This call will be recorded" notice) → connects → `joined`: status 'live'
 *   owner 2026-11-19 (free LiveKit plan): the sound is recorded in ONE team member's browser, not by LiveKit. Every
 *   team member's call page checks in (`recorderBeat`); the server gives the job to one of them; that browser uploads
 *   15-second pieces into our private 'meeting-audio' bucket exactly like the phone recorder (`uploadUrls`) and says
 *   when its recording is complete (`recorderDone`). If the recorder leaves, someone else takes over.
 *   the host ends it, or everyone leaves → `check` (cron and the review screen's polling) waits for the last pieces,
 *   then moves the meeting to 'uploaded', and the usual steps write the notes and delete the sound.
 * The video is never recorded (owner 2026-11-18: it would take up too much space).
 *
 * The meeting agent (Ira) is NOT sent into these rooms: their tokens dispatch no agent.
 * Plan: docs/MEETING_TASKS_SPEC.md
 */

interface OnlineRow {
    id: string; title: string; created_by: string; attendee_ids: string[]; extra_names: string[]; confidential: boolean; status: string;
    workspace?: MeetingSpace | null; kind?: string | null; scheduled_for?: string | null; online?: OnlineState | null;
    lease_until: string | null;
    purpose?: string | null;
}

/** A short lock on the row while the call's state is changed (two people joining at once must not lose a write). */
const LOCK_MS = 60_000;
/** Join tokens: only for connecting; someone already in the call stays connected. */
const TOKEN_TTL = '15m';

const NOT_FOUND = () => new MeetingError(404, 'This meeting does not exist, or you are not invited to it.', 'NOT_FOUND');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function httpUrl(): string | null {
    const cfg = liveKitConfig();
    return cfg ? cfg.url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:') : null;
}
function roomClient(): RoomServiceClient | null {
    const cfg = liveKitConfig(), url = httpUrl();
    return cfg && url ? new RoomServiceClient(url, cfg.apiKey, cfg.apiSecret) : null;
}
/** A LiveKit error as a short line for the log and the `problem` field (never a key or a URL with a token). */
const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, '[url]').slice(0, 160);
const pad2 = (n: number) => String(n).padStart(2, '0');
/** A whole number from a request, or null. */
const intOrNull = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isInteger(Number(v)) ? null : Number(v));

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
                purpose: m.purpose === 'interview' ? 'interview' : null,
            },
            setup: onlineSetupGaps(),
            // Stage 2: the guest link (if the host turned it on) and who asked to join through it
            guests: this.guestsView(m),
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
     * Someone is connected (staff, or since stage 2 an admitted guest): the meeting is live. `userId` (staff only) is
     * noted as joined, and added to "who was present" when they are in the Task Manager. Owner 2026-11-19: recording is
     * no longer started here; a team member's browser records (see `recorderBeat`).
     */
    private static async goLive(id: string, who: { userId?: string; addAttendee?: boolean }) {
        const result = await this.locked(id, async m => {
            const online: OnlineState = { room: roomNameFor(id), ...(m.online ?? {}) };
            online.startedAt = online.startedAt ?? new Date().toISOString();
            if (who.userId) online.joined = [...new Set([...(online.joined ?? []), who.userId])];
            // Someone in the Task Manager who joined counts as present (the notes and the speech service use the names)
            const attendees = who.userId && who.addAttendee && !m.attendee_ids.includes(who.userId) ? [...m.attendee_ids, who.userId] : m.attendee_ids;
            return { online, patch: { status: 'live', attendee_ids: attendees }, result: { recording: true, problem: null as string | null } };
        });
        if (!result) throw new MeetingError(503, 'The meeting is busy. Please try again in a moment.');
        return result;
    }

    // ── recording in a team member's browser (owner 2026-11-19) ─────────────────

    /**
     * A team member's call page checks in every few seconds with the recording it is making (`segment`, or null) and
     * how many pieces it has recorded. The answer says whether this page records (and which recording number) or only
     * watches. Rules: online.ts `recorderDecision`.
     */
    static async recorderBeat(userId: string, id: string, spaces: ReadonlySet<MeetingSpace>, input: { segment?: unknown; pieces?: unknown }) {
        const m = await this.joinable(userId, id, spaces);
        if (m.status !== 'live' || m.online?.endedAt) return { role: 'watch' as const, recording: false };
        const mine = intOrNull(input.segment);
        const pieces = Math.max(0, Math.min(99_999, intOrNull(input.pieces) ?? 0));
        const out = await this.locked(id, async row => {
            if (row.status !== 'live' || row.online?.endedAt) return { result: { role: 'watch' as const, recording: false } };
            const online: OnlineState = { room: roomNameFor(id), ...(row.online ?? {}) };
            const now = Date.now(), at = new Date(now).toISOString();
            if (mine !== null) {
                online.recordings = (online.recordings ?? []).map(r => (r.segment === mine && r.userId === userId ? { ...r, pieces: Math.max(r.pieces, pieces), at } : r));
            }
            // Owner 2026-11-19: the meeting's creator takes the recording back whenever they are in the call
            const d = recorderDecision(online, userId, now, mine, row.created_by);
            if (d.role === 'record') {
                online.recorder = { userId, segment: d.segment, until: new Date(now + RECORDER_LEASE_MS).toISOString() };
                if (d.fresh) online.recordings = [...(online.recordings ?? []), { segment: d.segment, userId, pieces: 0, done: false, at }];
            }
            return { online, result: d.role === 'record' ? { role: 'record' as const, segment: d.segment } : d };
        });
        if (!out) throw new MeetingError(503, 'The meeting is busy. Please try again in a moment.');
        return out;
    }

    /**
     * A browser finished a recording (it left the call, lost the job, or the call ended) and has uploaded its pieces:
     * `pieces` is its final count. `cannot`: this browser cannot record at all, so the job goes to someone else.
     */
    static async recorderDone(userId: string, id: string, spaces: ReadonlySet<MeetingSpace>, input: { segment?: unknown; pieces?: unknown; cannot?: unknown }) {
        await this.joinable(userId, id, spaces);
        const seg = intOrNull(input.segment);
        const pieces = Math.max(0, Math.min(99_999, intOrNull(input.pieces) ?? 0));
        await this.locked(id, async row => {
            const online: OnlineState = { room: roomNameFor(id), ...(row.online ?? {}) };
            const at = new Date().toISOString();
            online.recordings = (online.recordings ?? []).map(r => (r.segment === seg && r.userId === userId ? { ...r, pieces: Math.max(r.pieces, pieces), done: true, at } : r));
            if (online.recorder?.userId === userId && online.recorder.segment === seg) online.recorder = null;
            if (input.cannot === true) online.cannotRecord = [...new Set([...(online.cannotRecord ?? []), userId])];
            return { online, result: true };
        });
        // The call may be over and this was the last thing it waited for
        await this.check(id);
        return { ok: true };
    }

    /**
     * Upload links for the recording browser's pieces (the same links the phone recorder gets). Only for a recording
     * this person's browser was given, and only while the meeting still takes sound (code FINISHED tells the browser
     * to drop what is left).
     */
    static async uploadUrls(userId: string, id: string, spaces: ReadonlySet<MeetingSpace>, input: { segment?: unknown; from?: unknown; count?: unknown; mimeType?: unknown }) {
        const m = await this.joinable(userId, id, spaces);
        if (m.status !== 'live') throw new MeetingError(409, 'This call has finished.', 'FINISHED');
        const seg = intOrNull(input.segment);
        if (!(m.online?.recordings ?? []).some(r => r.segment === seg && r.userId === userId)) throw new MeetingError(404, 'This recording is not yours.', 'NOT_FOUND');
        return MeetingService.pieceUploadUrls(id, input);
    }

    /** The host ends the call for everyone: the room closes (the recording browser then uploads its last pieces). */
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
        await closeRoom(room).catch(err => console.warn('[OnlineMeeting] closeRoom:', short(err)));
    }

    // ── guests without a login (stage 2, owner 2026-11-18) ──────────────────────
    //
    // The host turns on a guest link (/guest/<secret>). A guest types their name and agrees to the recording, then waits;
    // anyone who may join the meeting can let them in or refuse them, and remove someone already let in. A guest's own
    // secret `key` (in their browser) is the only way to see their answer and get a call token.

    /** What staff see: the guest link (if on) and the requests, never a guest's key. Only the creator turns the link on or off. */
    /**
     * The people who asked to join through the meeting's link (never a guest's own key). Owner 2026-11-18: the link is
     * always on (one link for everyone), so there is no switch any more; the waiting room is the gate.
     */
    static guestsView(m: { online?: OnlineState | null }) {
        const token = m.online?.guestToken;
        return { path: token ? guestPathFor(token) : null, list: guestsForStaff(m.online?.guests) };
    }

    /**
     * Owner 2026-11-18 (one link for everyone): a signed-in team member opened the meeting's link. If they may join
     * this meeting, the page sends them to the team's join screen (their own name, no waiting); otherwise null and they
     * ask to join like anyone else.
     */
    static async staffMeetingFor(token: unknown, userId: string, spaces: ReadonlySet<MeetingSpace>): Promise<string | null> {
        const m = await this.byGuestToken(token);
        return canJoin(m, userId, spaces) ? m.id : null;
    }

    /** Let a waiting guest in, refuse them, or remove one already let in. Anyone who may join the meeting can. */
    static async decideGuestRequest(userId: string, id: string, spaces: ReadonlySet<MeetingSpace>, guestId: unknown, decision: unknown) {
        if (decision !== 'admit' && decision !== 'deny' && decision !== 'remove') throw new MeetingError(400, 'Unknown choice.');
        if (typeof guestId !== 'string' || !isUuid(guestId)) throw new MeetingError(400, 'Unknown guest.');
        const m = await this.joinable(userId, id, spaces);
        if (!this.isOpen(m)) throw new MeetingError(409, 'This meeting has ended.', 'ENDED');
        // The three possible answers are named, so TypeScript does not narrow them to the first one (Vercel build error)
        const out = await this.locked<'missing' | 'answered' | GuestEntry>(id, async row => {
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
        const gone = () => new MeetingError(404, 'This meeting link is not valid. Please ask the person who invited you for a new one.', 'LINK_OFF');
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
            // The meeting may have been removed a moment ago
            if (online.guestToken !== token) return { result: 'off' as const };
            if ((online.guests ?? []).filter(g => g.state === 'waiting').length >= MAX_WAITING) return { result: 'full' as const };
            online.guests = [...(online.guests ?? []), entry];
            return { online, result: 'ok' as const };
        });
        if (out === null) throw new MeetingError(503, 'The meeting is busy. Please try again in a moment.');
        if (out === 'off') throw new MeetingError(404, 'This meeting link is not valid. Please ask the person who invited you for a new one.', 'LINK_OFF');
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
     * A live meeting: once the call is over, nobody is recording any more and the browsers' pieces are in (or have had
     * a few minutes to arrive), hands the meeting to the usual steps ('uploaded'). Called by the cron, by the review
     * screen's polling and when a browser finishes its recording. Never throws. Rules: online.ts `callOutcome`.
     */
    static async check(id: string): Promise<void> {
        try {
            const rooms = roomClient();
            if (!rooms) return;
            await this.locked(id, async m => {
                if (m.status !== 'live') return { result: null };
                const online: OnlineState = { room: roomNameFor(id), ...(m.online ?? {}) };
                const now = Date.now();
                const roomOpen = online.endedAt ? false : await rooms.listRooms([online.room]).then(r => r.length > 0).catch(() => null);
                const recorderAlive = leaseAlive(online.recorder, now);
                const recordings = online.recordings ?? [];
                // Storage is only read once the call is over and nobody records (the only time it matters)
                const settled = (roomOpen === false || !!online.endedAt) && !recorderAlive;
                const stored = settled ? await this.storedPieces(id, recordings.map(r => r.segment)) : new Map<number, number>();
                const lastRecordingAt = recordings.reduce<string | null>((a, r) => (!a || r.at > a ? r.at : a), null);
                const outcome = callOutcome({ roomOpen, endedAt: online.endedAt, startedAt: online.startedAt, recorderAlive, missingPieces: missingCallPieces(recordings, stored), lastRecordingAt, now });

                if (outcome === 'stop') {
                    await this.stopAndClose(online.room);
                    return { online: { ...online, endedAt: online.endedAt ?? new Date(now).toISOString(), problem: 'The call ran for more than 12 hours, so it was stopped.' }, result: null };
                }
                if (outcome === 'wait') return { result: null };

                online.endedAt = online.endedAt ?? new Date(now).toISOString();
                online.recorder = null;
                const hasAudio = [...stored.values()].some(n => n > 0);
                await TaskDatabaseService.logAudit({ eventType: 'meeting_online_finished', details: { meetingId: id, recordings: recordings.length, missing: missingCallPieces(recordings, stored), hasAudio } });
                if (hasAudio) return { online, patch: { status: 'uploaded', error: null, attempts: 0 }, result: null };
                return { online, patch: { status: 'failed', error: online.problem || 'The call was not recorded, so there are no notes.' }, result: null };
            });
        } catch (err) {
            console.error('[OnlineMeeting] check failed:', id, short(err));
        }
    }

    /** How many pieces storage holds for each recording folder (sNN) of a meeting. */
    private static async storedPieces(id: string, segments: number[]): Promise<Map<number, number>> {
        const out = new Map<number, number>();
        for (const seg of [...new Set(segments)]) {
            const { data, error } = await supabaseAdmin.storage.from(MEETING_BUCKET).list(`${id}/s${pad2(seg)}`, { limit: 10_000 });
            if (error) throw error;
            out.set(seg, (data ?? []).filter(f => /^c\d{5}\.\w+$/.test(f.name)).length);
        }
        return out;
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

    /** Deleting an online meeting: close the call. (MeetingService.discard then deletes the sound.) */
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
