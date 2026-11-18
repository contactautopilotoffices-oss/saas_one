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

/** Where the call's state lives (meeting_notes.online). Every field is optional so older or partial rows still read. */
export interface OnlineState {
    room: string;
    /** First person joined */
    startedAt?: string | null;
    /** The host ended it, or the call was found closed */
    endedAt?: string | null;
    endedBy?: string | null;
    /** One entry per sound recording (a recording that failed mid-call is followed by a new one) */
    audio?: EgressEntry[];
    /** Everyone who joined (user ids), for "who was present" */
    joined?: string[];
    /** A plain sentence when recording could not start or stopped early */
    problem?: string | null;
    /** Stage 2 (owner 2026-11-18): the secret in the guest link /guest/<token>; null or absent = guests not allowed */
    guestToken?: string | null;
    /** Stage 2: everyone who asked to join through the guest link */
    guests?: GuestEntry[];
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
export interface EgressEntry {
    egressId: string;
    /** Storage path in 'meeting-audio' */
    path: string;
    startedAt: string;
    state?: EgressState;
    bytes?: number;
    durationSeconds?: number;
    error?: string | null;
}
export type EgressState = 'active' | 'done' | 'failed';

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** The LiveKit room of an online meeting. Prefixed so it can never collide with an Ira meeting room. */
export const roomNameFor = (meetingId: string) => `mn-${meetingId}`;

/** Audio recording n as the phone recorder's layout: folder sNN holding one piece, so it is "one recording" to the pipeline. */
export const audioPathFor = (meetingId: string, n: number) => `${meetingId}/s${pad(n, 2)}/c00000.ogg`;

/**
 * LiveKit's egress status number → our three states. LIMIT_REACHED still leaves a usable file up to the limit, so it
 * counts as done; FAILED and ABORTED are failed. Unknown numbers are treated as still running (never finish early).
 */
export function egressState(status: number): EgressState {
    if (status === 3 || status === 6) return 'done';
    if (status === 4 || status === 5) return 'failed';
    return 'active';
}

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

/** How long a call may stay "live" before it is stopped and processed anyway (a recording LiveKit never closed). */
export const LIVE_GIVE_UP_MS = 12 * 60 * 60 * 1000;

/**
 * What to do with a live meeting, from what LiveKit reports:
 *   wait      the call or a recording is still going
 *   finish    nobody is in the room any more and every recording has stopped → process it
 *   stop      it has been live for far too long → stop the recordings and close the room, then finish
 * `roomOpen` null = could not ask LiveKit (treat as open: never finish on a guess).
 */
export function liveOutcome(input: { states: EgressState[]; roomOpen: boolean | null; endedAt: string | null | undefined; startedAt: string | null | undefined; now: number }): 'wait' | 'finish' | 'stop' {
    const since = Date.parse(String(input.startedAt ?? ''));
    if (Number.isFinite(since) && input.now - since > LIVE_GIVE_UP_MS) return 'stop';
    const recording = input.states.some(s => s === 'active');
    const closed = input.roomOpen === false || !!input.endedAt;
    return closed && !recording ? 'finish' : 'wait';
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

/** Supabase Storage's S3 address and keys, which LiveKit needs to save the call's sound into our bucket. */
export interface RecordingStorage { endpoint: string; region: string; accessKey: string; secret: string }

export function recordingStorage(env: Record<string, string | undefined> = process.env): RecordingStorage | null {
    const base = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
    const endpoint = (env.SUPABASE_S3_ENDPOINT ?? '').trim() || (base ? `${base}/storage/v1/s3` : '');
    const region = (env.SUPABASE_S3_REGION ?? '').trim();
    const accessKey = (env.SUPABASE_S3_ACCESS_KEY_ID ?? '').trim();
    const secret = (env.SUPABASE_S3_SECRET_ACCESS_KEY ?? '').trim();
    return endpoint && region && accessKey && secret ? { endpoint, region, accessKey, secret } : null;
}

/** What is missing for online meetings, in words, so the screen can say it instead of failing. */
export function onlineSetupGaps(env: Record<string, string | undefined> = process.env): string[] {
    const gaps: string[] = [];
    const lk = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'].filter(k => !(env[k] ?? '').trim());
    if (lk.length) gaps.push(`${lk.join(', ')} ${lk.length === 1 ? 'is' : 'are'} not set, so nobody can join a video call yet.`);
    if (!recordingStorage(env)) gaps.push('SUPABASE_S3_REGION, SUPABASE_S3_ACCESS_KEY_ID and SUPABASE_S3_SECRET_ACCESS_KEY are not set, so calls cannot be recorded (and no notes can be made).');
    return gaps;
}

// ── Stage 2: guests without a login (owner 2026-11-18) ──────────────────────────────────────────────────────────────

/** At most this many people may wait at once, so a leaked link cannot flood the waiting list. */
export const MAX_WAITING = 30;

/** A guest's identity in the LiveKit room. Prefixed, so it can never be mistaken for a staff member's user id. */
export const guestIdentity = (guestId: string) => `guest-${guestId}`;

/** The public page of the guest link. */
export const guestPathFor = (token: string) => `/guest/${token}`;

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
