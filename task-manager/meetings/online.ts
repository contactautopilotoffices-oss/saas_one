/**
 * Meeting Assistant — online meetings (owner 2026-11-18, stage 1). The rules only: no database, no network, so the
 * tests run offline (task-manager/tests/test_meetings.ts). The LiveKit and database side is OnlineMeetingService.ts.
 *
 * An online meeting is a video call on hosted LiveKit with its own link (/meet/<id>). LiveKit records the call's
 * SOUND only, as one OGG file per recording, into the 'meeting-audio' bucket at the same place the phone recorder puts
 * its pieces (<id>/s00/c00000.ogg). The usual steps then run unchanged: transcript, voice naming, notes, draft tasks,
 * and the sound is deleted once it is text. The video is NOT recorded (owner 2026-11-18: it would take up too much space).
 *
 * Status: scheduled (link made, nobody joined) → live (someone joined, recording) → uploaded → … as before.
 */

import type { MeetingSpace } from './visibility';

export type MeetingKind = 'room' | 'online';
export const ONLINE_STATUSES = ['scheduled', 'live'] as const;

export interface ExternalContact {
    name: string;
    phone?: string | null;
    email?: string | null;
}

/** Where the call's state lives (meeting_notes.online). Every field is optional so older or partial rows still read. */
export interface OnlineState {
    room: string;
    /** First person joined */
    startedAt?: string | null;
    /** The host ended it, or the call was found closed */
    endedAt?: string | null;
    endedBy?: string | null;
    /**
     * Owner 2026-11-19 (free LiveKit plan): the call's sound is recorded in a team member's BROWSER, not by LiveKit.
     * `recorder` is whose browser records right now (one at a time, kept alive by its beat); `recordings` lists each
     * continuous recording a browser made (folder sNN, like the phone recorder) with the pieces it says it made.
     */
    recorder?: RecorderLease | null;
    recordings?: CallRecording[];
    /** Team members whose browser could not record (they are not asked again in this call) */
    cannotRecord?: string[];
    /** Everyone who joined (user ids), for "who was present" */
    joined?: string[];
    /** A plain sentence when recording could not start or stopped early */
    problem?: string | null;
    /** Stage 2 (owner 2026-11-18): the secret in the guest link /guest/<token>; null or absent = guests not allowed */
    guestToken?: string | null;
    /** Stage 2: everyone who asked to join through the guest link */
    guests?: GuestEntry[];
    /** Optional phone/email details for typed external attendees (kept alongside `extra_names`). */
    externalContacts?: ExternalContact[];
    /** Last "Send meeting link" timestamp and recipient count. */
    linkSentAt?: string | null;
    linkSentCount?: number | null;
}

/**
 * Stage 2 (owner 2026-11-18): someone without a login who asked to join through the guest link. `key` is the guest's
 * own secret, kept in their browser, so only they can see their answer and fetch a call token. Never sent to staff.
 */
export interface GuestEntry {
    id: string;
    name: string;
    key: string;
    state: GuestState;
    askedAt: string;
    /** When they agreed to the recording (asking to join is refused without it) */
    consentAt: string;
    decidedAt?: string | null;
    /** The user id of the staff member who let them in, refused or removed them */
    decidedBy?: string | null;
}
export type GuestState = 'waiting' | 'admitted' | 'denied' | 'removed';

/** Owner 2026-11-19: the browser recording the call now. `until` is pushed forward by each of its beats. */
export interface RecorderLease { userId: string; segment: number; until: string }
/** One continuous recording made in a browser (folder sNN). `pieces` is what that browser says it recorded. */
export interface CallRecording { segment: number; userId: string; pieces: number; done: boolean; at: string }

/** The LiveKit room of an online meeting. Prefixed so it can never collide with an Ira meeting room. */
export const roomNameFor = (meetingId: string) => `mn-${meetingId}`;


/**
 * Who may join an online meeting (owner 2026-11-18). Signed in, and one of:
 *   - the person who created it,
 *   - someone picked as attending (from any department: the link is shared with them),
 *   - for a meeting that is not confidential, anyone who has this Meeting Assistant (the meeting's space).
 * A confidential meeting is for its creator and the people picked only.
 */
export function canJoin(
    m: { created_by: string; attendee_ids: string[] | null; confidential: boolean; workspace?: MeetingSpace | null },
    userId: string,
    spaces: ReadonlySet<MeetingSpace>,
): boolean {
    if (m.created_by === userId) return true;
    if ((m.attendee_ids ?? []).includes(userId)) return true;
    return !m.confidential && spaces.has(m.workspace ?? 'tech');
}

/** How long a call may stay "live" before it is closed and processed anyway. */
export const LIVE_GIVE_UP_MS = 12 * 60 * 60 * 1000;

// ── Recording in the browser (owner 2026-11-19: stay on LiveKit's free plan) ───────────────────────────────────────
// LiveKit's own recording (egress) is capped at 60 minutes a month on the free plan, so the call's sound is recorded by
// ONE team member's browser instead: it mixes its own microphone with everyone else's sound and uploads 15-second
// pieces exactly like the phone recorder. Every team member's call page checks in ("beat"); the server hands the job to
// one of them. If that person leaves or their page dies, the job passes to someone else within a lease.

/** How often a team member's call page checks in. */
export const RECORDER_BEAT_MS = 10_000;
/** A recorder that has not checked in for this long has left: someone else takes over. */
export const RECORDER_LEASE_MS = 35_000;
/** After the call, how long to wait for pieces a browser said it recorded but that have not arrived. */
export const UPLOAD_GRACE_MS = 3 * 60_000;
/** Recordings per call (each handover starts one); the speech service takes at most this many files. */
export const MAX_CALL_RECORDINGS = 20;

export const leaseAlive = (lease: RecorderLease | null | undefined, now: number) => !!lease && Date.parse(lease.until) > now;

/**
 * What a team member's call page should do on its beat. `mine` is the recording that page is making (null: none).
 *   record (fresh: false)  keep recording `segment` (your lease is renewed)
 *   record (fresh: true)   start a NEW recording `segment` (nobody is recording, your page restarted, or you are the
 *                          host taking the recording back)
 *   watch                  someone else records (`recording` true), or nobody can (`recording` false)
 * Owner 2026-11-19: the person who set up the meeting (`hostId`) is the main recorder. Whenever they are in the call
 * their browser records; someone else records only while they are away, and hands it back when they return (the
 * stand-in stops on its next check-in, so a few seconds may be in both recordings, none are lost).
 */
export function recorderDecision(
    state: { recorder?: RecorderLease | null; recordings?: CallRecording[]; cannotRecord?: string[] },
    userId: string, now: number, mine: number | null, hostId?: string | null,
): { role: 'record'; segment: number; fresh: boolean } | { role: 'watch'; recording: boolean } {
    const lease = state.recorder;
    const alive = leaseAlive(lease, now);
    if (alive && lease!.userId === userId && mine === lease!.segment) return { role: 'record', segment: mine, fresh: false };
    const someoneElse = alive && lease!.userId !== userId;
    const cannot = (state.cannotRecord ?? []).includes(userId);
    const hostTakesBack = !!hostId && userId === hostId && !cannot;
    if (someoneElse && !hostTakesBack) return { role: 'watch', recording: true };
    if (cannot) return { role: 'watch', recording: someoneElse };
    const used = (state.recordings ?? []).map(r => r.segment);
    const next = used.length ? Math.max(...used) + 1 : 0;
    if (next >= MAX_CALL_RECORDINGS) return { role: 'watch', recording: someoneElse };
    return { role: 'record', segment: next, fresh: true };
}

/** Pieces the browsers said they recorded that are not in storage yet (`stored`: folder number → pieces there). */
export function missingCallPieces(recordings: CallRecording[] | undefined, stored: ReadonlyMap<number, number>): number {
    return (recordings ?? []).reduce((sum, r) => sum + Math.max(0, r.pieces - (stored.get(r.segment) ?? 0)), 0);
}

/**
 * What to do with a live meeting:
 *   wait    the call is still on, a browser is still recording, or pieces are still on their way (for a while)
 *   finish  the call is over and the sound is in → process it (no sound at all → it fails with a plain reason)
 *   stop    it has been live for far too long → close the room, then finish
 * `roomOpen` null = could not ask LiveKit (treat as open: never finish on a guess).
 */
export function callOutcome(input: {
    roomOpen: boolean | null; endedAt: string | null | undefined; startedAt: string | null | undefined;
    recorderAlive: boolean; missingPieces: number; lastRecordingAt: string | null | undefined; now: number;
}): 'wait' | 'finish' | 'stop' {
    const since = Date.parse(String(input.startedAt ?? ''));
    if (Number.isFinite(since) && input.now - since > LIVE_GIVE_UP_MS) return 'stop';
    const over = input.roomOpen === false || !!input.endedAt;
    if (!over || input.recorderAlive) return 'wait';
    const last = Date.parse(String(input.lastRecordingAt ?? ''));
    if (input.missingPieces > 0 && Number.isFinite(last) && input.now - last < UPLOAD_GRACE_MS) return 'wait';
    return 'finish';
}

/**
 * A planned start time from the form: an ISO date-time between a day ago and a year ahead, or null (start now).
 * Throws a plain sentence for anything else.
 */
export function parseScheduledFor(input: unknown, now = Date.now()): string | null {
    if (input === null || input === undefined || input === '') return null;
    const t = typeof input === 'string' ? Date.parse(input) : NaN;
    if (!Number.isFinite(t)) throw new Error('The meeting time is not a real date and time.');
    if (t < now - 24 * 60 * 60 * 1000) throw new Error('The meeting time is in the past.');
    if (t > now + 366 * 24 * 60 * 60 * 1000) throw new Error('The meeting time is more than a year away.');
    return new Date(t).toISOString();
}

/**
 * What is missing for online meetings, in words, so the screen can say it instead of failing. Owner 2026-11-19: only
 * the LiveKit keys; the sound is uploaded by the browser like the phone recorder, so no storage keys are needed.
 */
export function onlineSetupGaps(env: Record<string, string | undefined> = process.env): string[] {
    const lk = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'].filter(k => !(env[k] ?? '').trim());
    return lk.length ? [`${lk.join(', ')} ${lk.length === 1 ? 'is' : 'are'} not set, so nobody can join a video call yet.`] : [];
}

// ── Stage 2: guests without a login (owner 2026-11-18) ──────────────────────────────────────────────────────────────

/** At most this many people may wait at once, so a leaked link cannot flood the waiting list. */
export const MAX_WAITING = 30;

/** A guest's identity in the LiveKit room. Prefixed, so it can never be mistaken for a staff member's user id. */
export const guestIdentity = (guestId: string) => `guest-${guestId}`;

/** The public page of the guest link. */
export const guestPathFor = (token: string) => `/guest/${token}`;

/**
 * Owner 2026-11-18: ONE link for everyone, like Google Meet. Every online meeting gets its secret link when it is made;
 * team members who open it while signed in go straight to the join screen, everyone else asks to join and waits.
 * A meeting made before this (no secret) keeps its team-only link.
 */
export const meetingLinkPath = (meetingId: string, token: string | null | undefined) => (token ? guestPathFor(token) : `/meet/${meetingId}`);

/** A guest link secret looks like this (24 random bytes, base64url). Anything else is refused before a database read. */
export const isGuestToken = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{32}$/.test(v);

/** The name a guest typed: spaces tidied, 2 to 60 characters, letters required. Throws a plain sentence otherwise. */
export function cleanGuestName(input: unknown): string {
    const name = typeof input === 'string' ? input.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim() : '';
    if (name.length < 2 || name.length > 60) throw new Error('Please type your name (2 to 60 characters).');
    if (!/\p{L}/u.test(name)) throw new Error('Please type your name.');
    return name;
}

/** What staff see about the guests: never their key. Waiting first (oldest first), then the rest (newest first). */
export function guestsForStaff(guests: GuestEntry[] | undefined) {
    const list = (guests ?? []).map(g => ({ id: g.id, name: g.name, state: g.state, askedAt: g.askedAt }));
    const waiting = list.filter(g => g.state === 'waiting').sort((a, b) => a.askedAt.localeCompare(b.askedAt));
    const rest = list.filter(g => g.state !== 'waiting').sort((a, b) => b.askedAt.localeCompare(a.askedAt));
    return [...waiting, ...rest];
}

/** A guest's request, after a staff decision. Only a waiting guest can be let in or refused; only one let in can be removed. */
export function decideGuest(g: GuestEntry, decision: 'admit' | 'deny' | 'remove', by: string, now: string): GuestEntry | null {
    if ((decision === 'admit' || decision === 'deny') && g.state !== 'waiting') return null;
    if (decision === 'remove' && g.state !== 'admitted') return null;
    const state: GuestState = decision === 'admit' ? 'admitted' : decision === 'deny' ? 'denied' : 'removed';
    return { ...g, state, decidedAt: now, decidedBy: by };
}

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalises optional phone/email contacts for typed external names (`extraNames`).
 * When `rawContacts` is undefined, keeps existing contacts whose name remains in `extraNames`.
 * Throws a plain sentence if a provided phone number or email address is invalid.
 */
export function normalizeExternalContacts(
    extraNames: string[],
    rawContacts: unknown,
    existingContacts: ExternalContact[] = [],
): ExternalContact[] {
    const allowed = new Map(extraNames.map(n => [n.toLowerCase(), n]));
    if (rawContacts === undefined) {
        return existingContacts.filter(c => allowed.has(c.name.toLowerCase()) && (c.phone || c.email));
    }
    if (!Array.isArray(rawContacts)) return [];
    const byName = new Map<string, ExternalContact>();
    for (const item of rawContacts) {
        if (!item || typeof item !== 'object') continue;
        const r = item as Record<string, unknown>;
        const nameKey = typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim().toLowerCase() : '';
        const canonical = allowed.get(nameKey);
        if (!canonical) continue;

        let phone: string | null = null;
        if (typeof r.phone === 'string' && r.phone.trim()) {
            const cleaned = r.phone.trim();
            const digits = cleaned.replace(/\D/g, '');
            if (digits.length < 10 || digits.length > 15) {
                throw new Error(`Enter a valid 10–15 digit phone number for ${canonical}.`);
            }
            phone = cleaned.slice(0, 24);
        }

        let email: string | null = null;
        if (typeof r.email === 'string' && r.email.trim()) {
            const cleaned = r.email.trim().toLowerCase();
            if (cleaned.length > 254 || !SIMPLE_EMAIL.test(cleaned)) {
                throw new Error(`Enter a valid email address for ${canonical}.`);
            }
            email = cleaned;
        }

        if (phone || email) byName.set(nameKey, { name: canonical, phone, email });
        else byName.delete(nameKey);
    }
    return [...byName.values()];
}
