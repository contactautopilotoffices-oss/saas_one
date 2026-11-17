/**
 * Brain Console: every enum value the API sends, in plain words, and the number formats. One map per kind, so a label
 * reads the same on every screen. Readers are a small Tech team and a non-engineer owner: sentences, not jargon.
 */
import type { RoleClass } from '@/backend/lib/aiLayer/brain/config';
import type { BrainChannel, BrainModule, Outcome, SkillMode } from '@/backend/lib/aiLayer/brain/types';
import type { Flag, Note } from '@/backend/lib/aiLayer/brain/console/types';

export const OUTCOME_LABEL: Record<Outcome, string> = {
    answer: 'Answered',
    ask: 'Asked a question',
    propose: 'Offered an action',
    executed: 'Did the action',
    not_executed: 'Action not carried out',
    cancelled: 'Person cancelled',
    handoff: 'Passed to a person',
    refuse: 'Declined',
    unsupported: 'Cannot do that yet',
    error: 'Failed',
};

/** Outcomes that count as the brain handling the message (the server's own list for handledRate). */
export const HANDLED_OUTCOMES: readonly Outcome[] = ['answer', 'ask', 'propose', 'executed', 'cancelled'];
export const outcomeTone = (o: Outcome | string): Tone =>
    o === 'error' || o === 'not_executed' ? 'bad' : o === 'handoff' || o === 'refuse' || o === 'unsupported' ? 'warn' : 'neutral';
export const outcomeLabel = (o: string | null | undefined): string => (o ? OUTCOME_LABEL[o as Outcome] ?? o : 'Not recorded');

export const FLAG_LABEL: Record<Flag, string> = {
    gave_up: 'Gave up',
    not_done: 'Not done',
    ungrounded: 'Not backed by data',
    correction: 'Corrected',
    asked_again: 'Asked again',
    question_loop: 'Two questions in a row',
    handed_to_person: 'Passed to a person',
};

/** Why a turn was flagged, as one sentence a reviewer can act on. */
export const FLAG_SENTENCE: Record<Flag, string> = {
    gave_up: 'The brain could not answer: every model failed, or the turn ended in an error.',
    not_done: 'The person said Yes, but the action could not be carried out.',
    ungrounded: 'The reply mentioned a number, ticket or link that none of the look-ups supported.',
    correction: 'The person’s next message corrected it (“no”, “wrong”, “I meant …”).',
    asked_again: 'The person asked for the same thing again within two minutes.',
    question_loop: 'The brain asked two questions in a row instead of getting on with it.',
    handed_to_person: 'The brain passed the conversation to a person.',
};

export const NOTE_LABEL: Record<Note, string> = {
    backup_model: 'A backup model answered',
    slow: 'Slow reply (12 s or more)',
    photo: 'A photo was attached',
    hr_hidden: 'HR matter: the words are hidden',
    text_cleared: 'Words cleared after the keep period',
};

export const ROLE_LABEL: Record<RoleClass | 'unknown', string> = { staff: 'Staff', client: 'Client', vendor: 'Vendor', unknown: 'Unknown' };
export const CHANNEL_LABEL: Record<BrainChannel, string> = { whatsapp: 'WhatsApp', app_chat: 'In-app chat' };
export const MODULE_LABEL: Record<BrainModule, string> = {
    tickets: 'Tickets', rooms: 'Meeting rooms', tasks: 'Tasks', electricity: 'Electricity', knowledge: 'Knowledge', memory: 'Memory',
};

/** The console's mode (whole brain). */
export const MODE_LABEL: Record<SkillMode, string> = { off: 'Off', shadow: 'Shadow', live: 'Live' };
export const MODE_SENTENCE: Record<SkillMode, string> = {
    off: 'The brain does nothing. Every message goes to the bots that answer today.',
    shadow: 'The brain reads the same messages and records what it would have said and done. It sends nothing and changes nothing.',
    live: 'The brain answers the people in the audience. Everyone else is untouched.',
};
/** One skill's mode: "shadow" is "practice only" for a skill. */
export const SKILL_MODE_LABEL: Record<SkillMode, string> = { off: 'Off', shadow: 'Practice only', live: 'Live' };

export const RISK_LABEL: Record<number, string> = {
    0: 'Reads only',
    1: 'Changes only the person’s own things',
    2: 'Changes things for other people',
    3: 'App only, never offered to the brain',
};

export const TOOL_KIND_LABEL: Record<'read' | 'write' | 'control', string> = { read: 'Look-up', write: 'Action', control: 'Control' };

const STOP_REASON: Record<string, string> = {
    end_turn: 'Finished',
    tool_use: 'Asked for a look-up',
    max_tokens: 'Hit the length limit',
    stop_sequence: 'Stopped at a marker',
    refusal: 'Model refused',
    pause_turn: 'Paused',
};
export const stopReasonLabel = (r: string): string => STOP_REASON[r] ?? (r || 'Not recorded');

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'accent';

// ── The two older assistants (read only on the Review screen) ─────────────────────────────────────────────────────

export const OTHER_BOT_LABEL: Record<'task_assistant' | 'ai_assistant', string> = { task_assistant: 'Task assistant', ai_assistant: 'AI assistant' };
/** One line on each source tab of the Review screen: what is judged there. */
export const OTHER_BOT_WHERE: Record<'task_assistant' | 'ai_assistant', string> = {
    task_assistant: 'This is the task assistant’s own review: bot health, new instructions waiting for approval, and mistakes to review.',
    ai_assistant: 'Messages the AI assistant probably got wrong. Pick what it should have done and teach it, or ignore the message.',
};
export const OTHER_STATE: Record<'waiting' | 'judged' | 'ignored' | 'with_developer', { label: string; tone: Tone }> = {
    waiting: { label: 'Waiting to be judged', tone: 'warn' },
    judged: { label: 'Judged', tone: 'ok' },
    ignored: { label: 'Ignored', tone: 'neutral' },
    with_developer: { label: 'With a developer', tone: 'info' },
};

// ── Numbers ───────────────────────────────────────────────────────────────────────────────────────────────────────

const IN = 'en-IN';
export const int = (n: number | null | undefined): string => (n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString(IN));

/** Money in USD. A single message costs fractions of a cent, so per-message figures (tiny) show 4 decimals. */
export function usd(n: number | null | undefined, opts: { tiny?: boolean } = {}): string {
    if (n == null || !Number.isFinite(n)) return '—';
    if (n === 0) return '$0.00';
    const abs = Math.abs(n);
    // Per-message figures always get 4 decimals; anything else only when it is under a cent.
    const digits = opts.tiny || (abs > 0 && abs < 0.01) ? 4 : 2;
    return `$${n.toLocaleString(IN, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** 0..1 → "84%" (one decimal under 10%). */
export function pct(n: number | null | undefined): string {
    if (n == null || !Number.isFinite(n)) return '—';
    const v = n * 100;
    return `${v > 0 && v < 10 ? v.toFixed(1) : Math.round(v)}%`;
}

export function duration(ms: number | null | undefined): string {
    if (ms == null || !Number.isFinite(ms)) return '—';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    const s = ms / 1000;
    return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
}

export const tokens = (n: number): string => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : int(n));

// ── Dates, always India time ──────────────────────────────────────────────────────────────────────────────────────

const TZ = 'Asia/Kolkata';
const fTime = new Intl.DateTimeFormat(IN, { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const fDay = new Intl.DateTimeFormat(IN, { timeZone: TZ, day: 'numeric', month: 'short' });
const fDayYear = new Intl.DateTimeFormat(IN, { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const fWeekday = new Intl.DateTimeFormat(IN, { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });

const valid = (d: Date) => !Number.isNaN(d.getTime());
export const timeIN = (iso: string | null | undefined): string => (iso && valid(new Date(iso)) ? fTime.format(new Date(iso)) : '—');
export const dateIN = (iso: string | null | undefined): string => (iso && valid(new Date(iso)) ? fDay.format(new Date(iso)) : '—');
export const dateTimeIN = (iso: string | null | undefined): string => (iso && valid(new Date(iso)) ? `${fDay.format(new Date(iso))}, ${fTime.format(new Date(iso))}` : '—');
export const dateYearIN = (iso: string | null | undefined): string => (iso && valid(new Date(iso)) ? fDayYear.format(new Date(iso)) : '—');

/** "2026-11-14" (already an India day) → "Sat, 14 Nov". Read at noon so no time zone can move it to another day. */
export const dayLabel = (day: string): string => {
    const d = new Date(`${day}T12:00:00+05:30`);
    return valid(d) ? fWeekday.format(d) : day;
};
export const dayShort = (day: string): string => {
    const d = new Date(`${day}T12:00:00+05:30`);
    return valid(d) ? fDay.format(d) : day;
};

/** A series bucket: "2026-11-14T09" (hour) or "2026-11-14" (day), both India time. */
export const bucketLabel = (t: string, bucket: 'hour' | 'day'): string => (bucket === 'hour' ? `${t.slice(11, 13)}:00` : dayShort(t));
export const bucketLong = (t: string, bucket: 'hour' | 'day'): string => (bucket === 'hour' ? `${dayShort(t.slice(0, 10))}, ${t.slice(11, 13)}:00` : dayLabel(t));

export const plural = (n: number, one: string, many = `${one}s`): string => `${int(n)} ${n === 1 ? one : many}`;
