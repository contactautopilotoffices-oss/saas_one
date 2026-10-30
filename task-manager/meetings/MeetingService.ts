import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskDatabaseService } from '../TaskDatabaseService';
import { isMissingSchema } from '../TaskLinks';
import { setTaskDue } from '../TaskDueService';
import { personLabel, sendTaskAssigned } from '../taskAlerts';
import { shortList, taskBell } from '../taskBell';
import { todayIST, isUuid } from '../WorkspaceService';
import { buildPeople, extractMeeting, isClockTime, isRealDate, type MeetingSummary } from './MeetingExtractor';
import { SPACE_DEPARTMENT, canSee, type MeetingSpace } from './visibility';
import { MEETING_NOTES_CAMPAIGN, notesParams, notesPreview } from './meetingNotesMessage';
import { TaskMessagingService } from '../TaskMessagingService';
import {
    SARVAM_MAX_FILES, baseMime, checkSarvamJob, meetingAudioExtension, startSarvamJob, transcribeWithWhisper,
    type AudioFile, type TranscriptLine,
} from './MeetingTranscriber';

/**
 * Meeting Notes → Tasks (owner 2026-10-29). The Tech dashboard's "Meetings" tab.
 *
 *   record (pieces uploaded straight to private storage) → finish → transcribe (Sarvam, Whisper as backup)
 *   → DELETE THE AUDIO → AI writes summary + draft tasks → a Tech user edits and presses Send.
 *
 * Owner rules: tasks are sent "from Autopilot" (no human sender) and do NOT go through the Task Manager's assignment
 * rules (no reporting chain, no department switches, no accept/decline). Only the Tech team can open the tab (checked
 * by the API routes). Keep the transcript, never the audio. A meeting marked confidential is visible to its creator only.
 *
 * Processing is moved forward one step at a time by `advance()`, which the review screen calls while it polls. A short
 * lease on the row stops two polls from running the same step twice.
 * Plan + Agent Spec Block: docs/MEETING_TASKS_SPEC.md
 */

export const MEETING_BUCKET = 'meeting-audio';
export const AUTOPILOT = 'Autopilot';

export class MeetingError extends Error {
    constructor(public readonly status: number, message: string, public readonly code?: string) {
        super(message);
        this.name = 'MeetingError';
    }
}

export type MeetingStatus = 'recording' | 'uploaded' | 'transcribing' | 'extracting' | 'ready' | 'failed' | 'discarded';
export const PROCESSING: readonly MeetingStatus[] = ['uploaded', 'transcribing', 'extracting'];

interface MeetingRow {
    id: string; title: string; meeting_date: string; created_by: string; attendee_ids: string[]; extra_names: string[];
    confidential: boolean; status: MeetingStatus; error: string | null; duration_seconds: number | null;
    stt: Record<string, unknown> | null; transcript: TranscriptLine[] | null; summary: MeetingSummary | null;
    llm: Record<string, unknown> | null; lease_until: string | null; attempts: number; created_at: string; updated_at: string;
    notes_sent_at?: string | null; notes_sent_count?: number | null;
    /** Owner 2026-10-29: which dashboard the meeting belongs to (absent before migration 20261029100005 = 'tech') */
    workspace?: MeetingSpace;
}
interface MeetingTaskRow {
    id: string; meeting_id: string; position: number; title: string; note: string | null; owner_name: string | null;
    /** Owner 2026-10-29: a task can be for several people. `owner_user_id` is kept as the first of them. */
    owner_user_id: string | null; owner_user_ids: string[] | null; due_date: string | null; due_time: string | null; quote: string | null;
    quote_at_seconds: number | null; quote_found: boolean | null; source: 'ai' | 'manual'; status: 'draft' | 'sending' | 'sent' | 'deleted';
    task_id: string | null; task_ids: string[] | null; sent_at: string | null; sent_by: string | null; error: string | null;
}
/** The people a task is for (rows from before several-people support only have `owner_user_id`). */
const ownersOf = (t: Pick<MeetingTaskRow, 'owner_user_id' | 'owner_user_ids'>) => (t.owner_user_ids?.length ? t.owner_user_ids : t.owner_user_id ? [t.owner_user_id] : []);
export const MAX_OWNERS = 20;

export interface MeetingPersonOption { id: string; name: string; department: string | null }

const NOT_READY = 'Meetings are not set up yet. Please ask the admin to apply the latest database update (meeting notes).';
/** Turns a database error into a plain sentence; a missing table means the migration has not been run. */
function dbFail(error: unknown, fallback: string): never {
    if (isMissingSchema(error)) throw new MeetingError(503, NOT_READY, 'NOT_READY');
    console.error(`[MeetingService] ${fallback}:`, (error as { message?: string } | null)?.message ?? error);
    throw new MeetingError(500, fallback);
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');
const MIME_FOR_EXT: Record<string, string> = { webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac' };

/** A recording left in 'recording' this long (the phone died, the tab was closed for good) is given up. */
const ABANDONED_AFTER_MS = 6 * 60 * 60 * 1000;
/** A failed meeting keeps its audio this long so "Try again" can work; then the audio is deleted. */
const FAILED_AUDIO_KEPT_MS = 24 * 60 * 60 * 1000;
/** If Sarvam has not finished by then, the Whisper backup is used. */
const SARVAM_GIVE_UP_MS = 40 * 60 * 1000;
const LEASE_MS = 280_000;
/** A step cut off by the platform this many times in a row is given up (no endless paid retries). */
const MAX_CUT_OFF = 3;
/** A task left "sending" this long (the request was cut off) goes back to draft so it can be checked and sent. */
const STUCK_SENDING_MS = 10 * 60 * 1000;

export class MeetingService {
    // ── people ────────────────────────────────────────────────────────────────

    /** Everyone in the Task Manager (all departments) — the "who was present" list and the "send to" list. */
    static async people(): Promise<MeetingPersonOption[]> {
        const all = await TaskDatabaseService.getAllEmployees();
        return all.filter(e => e.active).map(e => ({ id: e.id, name: e.name, department: e.department_name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    // ── reading ───────────────────────────────────────────────────────────────

    private static async row(id: string): Promise<MeetingRow> {
        if (!isUuid(id)) throw new MeetingError(400, 'Unknown meeting.');
        const { data, error } = await supabaseAdmin.from('meeting_notes').select('*').eq('id', id).maybeSingle();
        if (error) dbFail(error, 'Could not load the meeting');
        if (!data) throw new MeetingError(404, 'This meeting does not exist.');
        return data as MeetingRow;
    }

    private static async visible(userId: string, id: string): Promise<MeetingRow> {
        const m = await this.row(id);
        if (!canSee(m, userId) || m.status === 'discarded') throw new MeetingError(404, 'This meeting does not exist.');
        return m;
    }

    private static async owned(userId: string, id: string): Promise<MeetingRow> {
        const m = await this.visible(userId, id);
        if (m.created_by !== userId) throw new MeetingError(403, 'Only the person who started this meeting can do that.');
        return m;
    }

    /**
     * Owner 2026-10-29: each dashboard (Tech / HR / Super Admin) has its own meetings. The API checks the person's role
     * for the space; this checks the meeting is IN that space, before any other action on it (else "does not exist").
     */
    static async assertSpace(id: string, space: MeetingSpace): Promise<void> {
        if (!isUuid(id)) throw new MeetingError(400, 'Unknown meeting.');
        const { data, error } = await supabaseAdmin.from('meeting_notes').select('workspace').eq('id', id).maybeSingle();
        if (error) dbFail(error, 'Could not load the meeting');
        if (!data || (data.workspace ?? 'tech') !== space) throw new MeetingError(404, 'This meeting does not exist.');
    }

    static async list(userId: string, space: MeetingSpace) {
        await this.sweep().catch(err => console.warn('[MeetingService] sweep failed:', err instanceof Error ? err.message : err));
        const { data, error } = await supabaseAdmin.from('meeting_notes')
            .select('id, title, meeting_date, created_by, attendee_ids, extra_names, confidential, status, error, duration_seconds, created_at')
            .eq('workspace', space)
            .neq('status', 'discarded').or(`confidential.eq.false,created_by.eq.${userId}`)
            .order('created_at', { ascending: false }).limit(60);
        if (error) dbFail(error, 'Could not load meetings');
        const rows = (data ?? []) as Array<Pick<MeetingRow, 'id' | 'title' | 'meeting_date' | 'created_by' | 'attendee_ids' | 'extra_names' | 'confidential' | 'status' | 'error' | 'duration_seconds' | 'created_at'>>;
        const ids = rows.map(r => r.id);
        const [tasksRes, namesRes] = await Promise.all([
            ids.length ? supabaseAdmin.from('meeting_note_tasks').select('meeting_id, status').in('meeting_id', ids).neq('status', 'deleted') : Promise.resolve({ data: [], error: null }),
            ids.length ? supabaseAdmin.from('users').select('id, full_name').in('id', [...new Set(rows.map(r => r.created_by))]) : Promise.resolve({ data: [], error: null }),
        ]);
        if (tasksRes.error) dbFail(tasksRes.error, 'Could not load meetings');
        const counts = new Map<string, { total: number; sent: number }>();
        for (const t of (tasksRes.data ?? []) as Array<{ meeting_id: string; status: string }>) {
            const c = counts.get(t.meeting_id) ?? { total: 0, sent: 0 };
            c.total++; if (t.status === 'sent') c.sent++;
            counts.set(t.meeting_id, c);
        }
        const nameOf = new Map(((namesRes.data ?? []) as Array<{ id: string; full_name: string | null }>).map(u => [u.id, u.full_name || 'Someone']));
        return rows.map(r => ({
            id: r.id, title: r.title, meetingDate: r.meeting_date, status: r.status, error: r.error, confidential: r.confidential,
            durationSeconds: r.duration_seconds, createdAt: r.created_at, createdByName: nameOf.get(r.created_by) || 'Someone', mine: r.created_by === userId,
            peopleCount: (r.attendee_ids?.length ?? 0) + (r.extra_names?.length ?? 0),
            tasks: counts.get(r.id) ?? { total: 0, sent: 0 },
        }));
    }

    static async get(userId: string, id: string) {
        const m = await this.visible(userId, id);
        // A Send cut off mid-way leaves a card "sending": give it back as a draft, with a warning to check first
        await supabaseAdmin.from('meeting_note_tasks')
            .update({ status: 'draft', error: 'Sending was interrupted. Check the person\'s task list before sending again.' })
            .eq('meeting_id', id).eq('status', 'sending').is('task_id', null).eq('task_ids', '{}')
            .lt('updated_at', new Date(Date.now() - STUCK_SENDING_MS).toISOString());
        const [tasksRes, people, me] = await Promise.all([
            supabaseAdmin.from('meeting_note_tasks').select('*').eq('meeting_id', id).neq('status', 'deleted').order('position', { ascending: true }),
            this.people(),
            this.senderFor(userId, m.workspace ?? 'tech'),
        ]);
        if (tasksRes.error) dbFail(tasksRes.error, 'Could not load the tasks');
        const nameOf = new Map(people.map(p => [p.id, p.name]));
        return {
            meeting: {
                id: m.id, title: m.title, meetingDate: m.meeting_date, status: m.status, error: m.error, confidential: m.confidential,
                durationSeconds: m.duration_seconds, mine: m.created_by === userId, createdAt: m.created_at,
                attendees: m.attendee_ids.map(a => ({ id: a, name: nameOf.get(a) || 'Former employee' })), extraNames: m.extra_names,
                transcript: m.transcript ?? [], summary: m.summary, provider: (m.stt?.provider as string | undefined) ?? null,
                canRetry: m.status === 'failed' && (!!m.transcript?.length || m.stt?.audioDeleted !== true),
                notesSentAt: m.notes_sent_at ?? null, notesSentCount: m.notes_sent_count ?? null,
            },
            tasks: ((tasksRes.data ?? []) as MeetingTaskRow[]).map(t => ({
                id: t.id, title: t.title, note: t.note, ownerName: t.owner_name,
                ownerUserIds: ownersOf(t), ownerNames: ownersOf(t).map(o => nameOf.get(o) || 'Former employee'),
                dueDate: t.due_date, dueTime: t.due_time, quote: t.quote, quoteAtSeconds: t.quote_at_seconds, quoteFound: t.quote_found,
                source: t.source, status: t.status, sentAt: t.sent_at, error: t.error,
            })),
            people,
            // For "Send as: me" — how the person pressing Send is shown to the people who get the tasks
            me: { name: me.name, department: me.department },
        };
    }

    /**
     * The person pressing Send, as the task's giver: their Task Manager name and department; someone on Tech who is not
     * in the Task Manager is shown with their account name and the dashboard's team ("Tech", "HR", "Management").
     */
    private static async senderFor(userId: string, space: MeetingSpace): Promise<{ id: string; name: string; department: string }> {
        const team = SPACE_DEPARTMENT[space];
        const emp = await TaskDatabaseService.getEmployeeById(userId).catch(() => null);
        if (emp?.name) return { id: userId, name: emp.name, department: emp.department_name || team };
        const { data } = await supabaseAdmin.from('users').select('full_name').eq('id', userId).maybeSingle();
        return { id: userId, name: (data?.full_name as string | undefined) || `${team} team`, department: team };
    }

    // ── recording ─────────────────────────────────────────────────────────────

    static async create(userId: string, input: { title?: unknown; attendeeIds?: unknown; extraNames?: unknown; confidential?: unknown }, space: MeetingSpace) {
        const title = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim() : '';
        if (title.length < 1 || title.length > 150) throw new MeetingError(400, 'Give the meeting a name (up to 150 characters).');
        const wanted = Array.isArray(input.attendeeIds) ? input.attendeeIds.filter(isUuid) : [];
        const known = new Set((await this.people()).map(p => p.id));
        const attendeeIds = [...new Set(wanted.filter(id => known.has(id)))];
        const extraNames = [...new Set((Array.isArray(input.extraNames) ? input.extraNames : [])
            .map(n => (typeof n === 'string' ? n.replace(/\s+/g, ' ').trim() : '')).filter(n => n.length >= 1 && n.length <= 80))].slice(0, 30);
        const { data, error } = await supabaseAdmin.from('meeting_notes').insert({
            title, created_by: userId, attendee_ids: attendeeIds, extra_names: extraNames, confidential: input.confidential === true,
            meeting_date: todayIST(), status: 'recording', workspace: space,
        }).select('id').single();
        if (error || !data) dbFail(error, 'Could not start the meeting');
        await TaskDatabaseService.logAudit({ eventType: 'meeting_created', actorId: userId, details: { meetingId: data.id, people: attendeeIds.length + extraNames.length } });
        return { id: data.id as string };
    }

    /** The recordings already stored for a meeting: folder s00, s01, … — one per continuous recording. */
    private static async segments(id: string): Promise<string[]> {
        const { data, error } = await supabaseAdmin.storage.from(MEETING_BUCKET).list(id, { limit: 100, sortBy: { column: 'name', order: 'asc' } });
        if (error) throw new MeetingError(500, 'Could not read the recording.');
        return (data ?? []).map(f => f.name).filter(n => /^s\d{2}$/.test(n)).sort();
    }

    /** A new continuous recording (first start, or after the page was reloaded): returns its number. */
    static async startSegment(userId: string, id: string) {
        const m = await this.owned(userId, id);
        if (m.status !== 'recording') throw new MeetingError(409, 'This meeting has already finished recording.');
        const used = await this.segments(id);
        const next = used.length ? Number(used[used.length - 1].slice(1)) + 1 : 0;
        if (next >= SARVAM_MAX_FILES) throw new MeetingError(409, `A meeting can be restarted at most ${SARVAM_MAX_FILES} times. Please finish it.`);
        return { segment: next };
    }

    /** A one-time private upload link for one piece of audio; the phone uploads straight to storage. */
    static async uploadUrl(userId: string, id: string, input: { segment?: unknown; seq?: unknown; mimeType?: unknown }) {
        const m = await this.owned(userId, id);
        if (m.status !== 'recording') throw new MeetingError(409, 'This meeting has already finished recording.');
        const segment = Number(input.segment), seq = Number(input.seq);
        if (!Number.isInteger(segment) || segment < 0 || segment >= SARVAM_MAX_FILES) throw new MeetingError(400, 'Bad recording number.');
        if (!Number.isInteger(seq) || seq < 0 || seq > 99_999) throw new MeetingError(400, 'Bad piece number.');
        const ext = meetingAudioExtension(typeof input.mimeType === 'string' ? input.mimeType : '');
        if (!ext) throw new MeetingError(400, 'This kind of audio file is not supported. Use MP3, M4A, WAV, OGG or WEBM.');
        const path = `${id}/s${pad(segment, 2)}/c${pad(seq, 5)}.${ext}`;
        const { data, error } = await supabaseAdmin.storage.from(MEETING_BUCKET).createSignedUploadUrl(path, { upsert: true });
        if (error || !data) {
            console.error('[MeetingService] upload link failed:', error?.message);
            throw new MeetingError(/not found/i.test(error?.message || '') ? 503 : 500, /not found/i.test(error?.message || '') ? NOT_READY : 'Could not prepare the upload.');
        }
        // Keeps a long recording from looking abandoned
        await supabaseAdmin.from('meeting_notes').update({ updated_at: new Date().toISOString() }).eq('id', id);
        return { bucket: MEETING_BUCKET, path: data.path, token: data.token, contentType: baseMime(input.mimeType as string) };
    }

    static async finish(userId: string, id: string) {
        await this.owned(userId, id);
        if (!(await this.segments(id)).length) throw new MeetingError(409, 'No audio has been received yet. Please wait for the upload, or record again.');
        const { data, error } = await supabaseAdmin.from('meeting_notes').update({ status: 'uploaded', error: null, updated_at: new Date().toISOString() })
            .eq('id', id).eq('status', 'recording').select('id');
        if (error) dbFail(error, 'Could not finish the meeting');
        if (!data?.length) throw new MeetingError(409, 'This meeting has already finished recording.');
        await TaskDatabaseService.logAudit({ eventType: 'meeting_recorded', actorId: userId, details: { meetingId: id } });
        return { ok: true };
    }

    static async discard(userId: string, id: string) {
        await this.owned(userId, id);
        // Deleting removes the transcript and notes too; tasks already sent stay with the people
        const { error } = await supabaseAdmin.from('meeting_notes')
            .update({ status: 'discarded', transcript: null, summary: null, updated_at: new Date().toISOString() }).eq('id', id);
        if (error) dbFail(error, 'Could not delete the meeting');
        await supabaseAdmin.from('meeting_note_tasks').update({ status: 'deleted' }).eq('meeting_id', id).eq('status', 'draft');
        await this.deleteAudio(id);
        await TaskDatabaseService.logAudit({ eventType: 'meeting_discarded', actorId: userId, details: { meetingId: id } });
        return { ok: true };
    }

    /**
     * Owner 2026-10-30: "Start over" — a recording started by mistake. Deletes every audio piece recorded so far and keeps
     * the meeting open for recording (name, people and confidential setting stay). Only the person who started it, and
     * only while it is still recording. If any piece could not be deleted, nothing is reset and the person is told —
     * old audio must never be mixed into the new recording.
     */
    static async resetRecording(userId: string, id: string) {
        const m = await this.owned(userId, id);
        if (m.status !== 'recording') throw new MeetingError(409, 'This meeting has already finished recording.');
        try {
            await this.removeAudioFiles(id);
        } catch (err) {
            console.error('[MeetingService] reset: could not delete the audio:', id, err instanceof Error ? err.message : err);
            throw new MeetingError(500, 'Could not delete the recording. Please try again.');
        }
        // Check: no audio file may be left (an empty folder may still be listed for a moment, that is fine)
        for (const seg of await this.segments(id)) {
            const { data, error } = await supabaseAdmin.storage.from(MEETING_BUCKET).list(`${id}/${seg}`, { limit: 1 });
            if (error || data?.length) throw new MeetingError(500, 'Could not delete the whole recording. Please try again.');
        }
        const { error } = await supabaseAdmin.from('meeting_notes').update({ stt: null, error: null, updated_at: new Date().toISOString() })
            .eq('id', id).eq('status', 'recording');
        if (error) dbFail(error, 'Could not reset the recording');
        await TaskDatabaseService.logAudit({ eventType: 'meeting_recording_reset', actorId: userId, details: { meetingId: id } });
        return { ok: true };
    }

    /** Owner 2026-10-29: change the meeting's name (anyone who can open the meeting). */
    static async rename(userId: string, id: string, input: { title?: unknown }) {
        await this.visible(userId, id);
        const title = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim() : '';
        if (title.length < 1 || title.length > 150) throw new MeetingError(400, 'Give the meeting a name (up to 150 characters).');
        const { error } = await supabaseAdmin.from('meeting_notes').update({ title, updated_at: new Date().toISOString() }).eq('id', id);
        if (error) dbFail(error, 'Could not rename the meeting');
        return { title };
    }

    /**
     * Owner 2026-10-29: the notes on WhatsApp to everyone present who is in the Task Manager (typed names have no phone):
     * summary, decisions, and that person's own tasks from the meeting. One approved-template message each, through the
     * existing message sender (kill switches, sandbox and Pretend Mode apply).
     */
    static async sendNotes(userId: string, id: string) {
        const m = await this.visible(userId, id);
        if (m.status !== 'ready' || !m.summary) throw new MeetingError(409, 'The notes are not ready yet.');
        if (!m.attendee_ids.length) throw new MeetingError(409, 'Nobody from the Task Manager was marked as present, so there is no one to send the notes to.');

        const { data: rows, error } = await supabaseAdmin.from('meeting_note_tasks').select('*').eq('meeting_id', id).neq('status', 'deleted').order('position', { ascending: true });
        if (error) dbFail(error, 'Could not load the tasks');
        const tasks = (rows ?? []) as MeetingTaskRow[];

        let sent = 0, failed = 0, noPhone = 0;
        for (const personId of m.attendee_ids) {
            const person = await TaskDatabaseService.getEmployeeById(personId).catch(() => null);
            if (!person?.active || !person.phone_number || person.phone_number.replace(/\D/g, '').length < 10) { noPhone++; continue; }
            const theirs = tasks.filter(t => ownersOf(t).includes(personId)).map(t => (t.due_date ? `${t.title} (by ${t.due_date})` : t.title));
            const params = notesParams({
                name: person.name, meetingTitle: m.title, meetingDate: m.meeting_date,
                summary: m.summary.summary, decisions: m.summary.decisions, tasks: theirs,
            });
            try {
                const ok = await TaskMessagingService.sendMessage(person.phone_number, notesPreview(params), {
                    messageType: 'meeting_notes', departmentId: person.department_id || undefined,
                    campaignName: MEETING_NOTES_CAMPAIGN, templateParams: params, templateOnly: true,
                });
                if (ok) sent++; else failed++;
            } catch (err) {
                failed++;
                console.error('[MeetingService] meeting notes message failed:', err instanceof Error ? err.message : err);
            }
        }
        if (sent > 0) {
            await supabaseAdmin.from('meeting_notes').update({ notes_sent_at: new Date().toISOString(), notes_sent_count: sent }).eq('id', id);
        }
        await TaskDatabaseService.logAudit({ eventType: 'meeting_notes_sent', actorId: userId, details: { meetingId: id, sent, failed, noPhone } });
        return { sent, failed, noPhone };
    }

    static async retry(userId: string, id: string) {
        const m = await this.visible(userId, id);
        if (m.status !== 'failed') throw new MeetingError(409, 'Only a meeting that failed can be tried again.');
        const next: MeetingStatus | null = m.transcript?.length ? 'extracting' : m.stt?.audioDeleted !== true ? 'uploaded' : null;
        if (!next) throw new MeetingError(409, 'The recording has already been deleted, so this meeting cannot be tried again.');
        const stt = next === 'uploaded' ? null : m.stt;
        const { data, error } = await supabaseAdmin.from('meeting_notes')
            .update({ status: next, error: null, stt, lease_until: null, attempts: 0, updated_at: new Date().toISOString() })
            .eq('id', id).eq('status', 'failed').select('id');
        if (error) dbFail(error, 'Could not try again');
        if (!data?.length) throw new MeetingError(409, 'This meeting is already being processed.');
        return { ok: true };
    }

    // ── audio ─────────────────────────────────────────────────────────────────

    /** Every continuous recording as one file: its pieces joined in order (pieces of one recording form one valid file). */
    private static async readAudio(id: string): Promise<AudioFile[]> {
        const files: AudioFile[] = [];
        for (const seg of await this.segments(id)) {
            const { data, error } = await supabaseAdmin.storage.from(MEETING_BUCKET).list(`${id}/${seg}`, { limit: 10_000, sortBy: { column: 'name', order: 'asc' } });
            if (error) throw new Error(`could not list ${seg}`);
            const names = (data ?? []).map(f => f.name).filter(n => /^c\d{5}\.\w+$/.test(n)).sort();
            if (!names.length) continue;
            const parts: Buffer[] = [];
            for (let i = 0; i < names.length; i += 10) {
                const batch = await Promise.all(names.slice(i, i + 10).map(async n => {
                    const { data: blob, error: e } = await supabaseAdmin.storage.from(MEETING_BUCKET).download(`${id}/${seg}/${n}`);
                    if (e || !blob) throw new Error(`could not read ${seg}/${n}`);
                    return Buffer.from(await blob.arrayBuffer());
                }));
                parts.push(...batch);
            }
            const ext = names[0].split('.').pop() || 'webm';
            files.push({ name: `part${files.length + 1}.${ext}`, mimeType: MIME_FOR_EXT[ext] || 'audio/webm', bytes: Buffer.concat(parts) });
        }
        return files;
    }

    /** Owner rule: transcript only. Removes every stored piece of this meeting's audio. */
    /** Removes every stored audio piece of a meeting. Throws if anything could not be listed or removed. */
    private static async removeAudioFiles(id: string): Promise<void> {
        const paths: string[] = [];
        for (const seg of await this.segments(id)) {
            const { data, error } = await supabaseAdmin.storage.from(MEETING_BUCKET).list(`${id}/${seg}`, { limit: 10_000 });
            if (error) throw error;
            for (const f of data ?? []) paths.push(`${id}/${seg}/${f.name}`);
        }
        for (let i = 0; i < paths.length; i += 500) {
            const { error } = await supabaseAdmin.storage.from(MEETING_BUCKET).remove(paths.slice(i, i + 500));
            if (error) throw error;
        }
    }

    private static async deleteAudio(id: string): Promise<void> {
        try {
            await this.removeAudioFiles(id);
            const m = await supabaseAdmin.from('meeting_notes').select('stt').eq('id', id).maybeSingle();
            await supabaseAdmin.from('meeting_notes').update({ stt: { ...((m.data?.stt as Record<string, unknown> | null) ?? {}), audioDeleted: true } }).eq('id', id);
        } catch (err) {
            console.error('[MeetingService] could not delete meeting audio:', id, err instanceof Error ? err.message : err);
        }
    }

    /** Gives up abandoned recordings and removes old audio of failed meetings. Runs when the list is opened. */
    private static async sweep(): Promise<void> {
        const now = Date.now();
        const { data: stale } = await supabaseAdmin.from('meeting_notes').select('id').eq('status', 'recording')
            .lt('updated_at', new Date(now - ABANDONED_AFTER_MS).toISOString()).limit(10);
        for (const r of stale ?? []) {
            await supabaseAdmin.from('meeting_notes').update({ status: 'failed', error: 'The recording was never finished.' }).eq('id', r.id).eq('status', 'recording');
        }
        // Audio not yet marked deleted: failed/discarded after the grace period, and any finished meeting (in case the
        // delete right after transcription did not work)
        const notDeleted = 'stt.is.null,stt->>audioDeleted.is.null';
        const [{ data: old }, { data: done }] = await Promise.all([
            supabaseAdmin.from('meeting_notes').select('id').in('status', ['failed', 'discarded']).or(notDeleted)
                .lt('updated_at', new Date(now - FAILED_AUDIO_KEPT_MS).toISOString()).order('updated_at', { ascending: true }).limit(10),
            supabaseAdmin.from('meeting_notes').select('id').in('status', ['extracting', 'ready']).or(notDeleted).order('updated_at', { ascending: true }).limit(10),
        ]);
        for (const r of [...(old ?? []), ...(done ?? [])]) await this.deleteAudio(r.id);
    }

    // ── processing (one step per call) ───────────────────────────────────────

    /** Moves a processing meeting forward by one step. Safe to call from several polls at once. Never throws. */
    static async advance(id: string): Promise<void> {
        try {
            const nowIso = new Date().toISOString();
            const lease = new Date(Date.now() + LEASE_MS).toISOString();
            const { data: claimed } = await supabaseAdmin.from('meeting_notes')
                .update({ lease_until: lease })
                .eq('id', id).in('status', PROCESSING as MeetingStatus[]).or(`lease_until.is.null,lease_until.lt.${nowIso}`)
                .select('*');
            const m = (claimed?.[0] ?? null) as MeetingRow | null;
            if (!m) return;
            // `attempts` only goes up when a step was cut off before it could finish (the platform stopped it): the
            // normal end of every step puts it back to 0. A step cut off again and again is given up, not repeated forever.
            if ((m.attempts ?? 0) >= MAX_CUT_OFF) {
                await this.update(id, { status: 'failed', error: 'Processing kept stopping before it finished (the recording may be too long). Press "Try again", or upload a shorter recording.', lease_until: null });
                return;
            }
            await supabaseAdmin.from('meeting_notes').update({ attempts: (m.attempts ?? 0) + 1 }).eq('id', id).eq('lease_until', lease);
            try {
                if (m.status === 'uploaded') await this.stepStart(m);
                else if (m.status === 'transcribing') await this.stepCheck(m);
                else if (m.status === 'extracting') await this.stepExtract(m);
            } catch (err) {
                console.error('[MeetingService] processing failed:', id, err instanceof Error ? err.message : err);
                await this.update(id, { status: 'failed', error: 'Something went wrong while processing. Press "Try again".' }).catch(() => undefined);
            }
            // Only release OUR lease: a poll that took over after a very slow step keeps its own
            await supabaseAdmin.from('meeting_notes').update({ lease_until: null, attempts: 0 }).eq('id', id).eq('lease_until', lease);
        } catch (err) {
            console.error('[MeetingService] advance failed:', id, err instanceof Error ? err.message : err);
        }
    }

    /**
     * Saves a processing step's result. Only while the meeting is still processing: if it was deleted (or reset) in the
     * meantime, the late result is dropped instead of bringing the meeting back.
     */
    private static async update(id: string, patch: Record<string, unknown>) {
        const { error } = await supabaseAdmin.from('meeting_notes').update({ ...patch, updated_at: new Date().toISOString() })
            .eq('id', id).in('status', PROCESSING as MeetingStatus[]);
        if (error) throw new Error(`could not save the meeting: ${error.message}`);
    }

    private static async namesPresent(m: MeetingRow): Promise<string[]> {
        const people = await this.people();
        const nameOf = new Map(people.map(p => [p.id, p.name]));
        return [...m.attendee_ids.map(a => nameOf.get(a)).filter((n): n is string => !!n), ...m.extra_names];
    }

    /** uploaded → start the Sarvam job (→ transcribing), or transcribe with Whisper straight away (→ extracting). */
    private static async stepStart(m: MeetingRow) {
        const files = await this.readAudio(m.id);
        if (!files.length) { await this.update(m.id, { status: 'failed', error: 'No audio was received for this meeting.' }); return; }
        const sarvam = await startSarvamJob({ files, names: await this.namesPresent(m) });
        if (sarvam.ok) {
            await this.update(m.id, { status: 'transcribing', stt: { provider: 'sarvam', jobId: sarvam.jobId, files: sarvam.files, startedAt: new Date().toISOString() } });
            return;
        }
        console.warn(`[MeetingService] Sarvam could not start (${sarvam.reason}): ${sarvam.detail} — using Whisper`);
        await this.whisper(m, files, `sarvam: ${sarvam.reason}`);
    }

    /** transcribing → is Sarvam done? Done → save the transcript; failed or too slow → Whisper. */
    private static async stepCheck(m: MeetingRow) {
        const stt = m.stt ?? {};
        const check = await checkSarvamJob({ jobId: String(stt.jobId ?? ''), files: Array.isArray(stt.files) ? stt.files.map(String) : [] });
        if (check.state === 'done') { await this.saveTranscript(m, check.lines, { ...stt, finishedAt: new Date().toISOString() }); return; }
        const tooSlow = Date.now() - Date.parse(String(stt.startedAt ?? m.updated_at)) > SARVAM_GIVE_UP_MS;
        if (check.state === 'running' && !tooSlow) return;
        const why = check.state === 'failed' ? check.detail : 'took too long';
        console.warn(`[MeetingService] Sarvam job ${String(stt.jobId)}: ${why} — using Whisper`);
        await this.whisper(m, await this.readAudio(m.id), `sarvam: ${why}`);
    }

    private static async whisper(m: MeetingRow, files: AudioFile[], sarvamProblem: string) {
        const w = await transcribeWithWhisper(files);
        if (!w.ok) {
            const msg = w.reason === 'silent' ? 'No speech was found in the recording.'
                : w.reason === 'too_large' ? 'The recording is too large to transcribe.'
                    : 'The recording could not be turned into text. Press "Try again" in a few minutes.';
            await this.update(m.id, { status: 'failed', error: msg, stt: { provider: 'none', problems: [sarvamProblem, `whisper: ${w.reason}`] } });
            return;
        }
        await this.saveTranscript(m, w.lines, { provider: 'whisper', model: w.model, sarvamProblem });
    }

    /** Saves the text, then deletes the audio (owner rule: transcript only). */
    private static async saveTranscript(m: MeetingRow, lines: TranscriptLine[], stt: Record<string, unknown>) {
        const duration = lines.length ? Math.round(Math.max(...lines.map(l => l.end))) : null;
        await this.update(m.id, { status: 'extracting', transcript: lines, duration_seconds: duration, stt });
        await this.deleteAudio(m.id);
    }

    /** extracting → one AI call → summary + draft tasks → ready. */
    private static async stepExtract(m: MeetingRow) {
        const lines = m.transcript ?? [];
        if (!lines.length) { await this.update(m.id, { status: 'failed', error: 'The transcript is empty.' }); return; }
        const everyone = await this.people();
        const people = buildPeople({ everyone, attendeeIds: m.attendee_ids, extraNames: m.extra_names });
        let result;
        try {
            result = await extractMeeting({ title: m.title, meetingDate: m.meeting_date, people, lines });
        } catch (err) {
            console.error('[MeetingService] summary failed:', err instanceof Error ? err.message : err);
            await this.update(m.id, { status: 'failed', error: 'The AI could not write the notes. Press "Try again".' });
            return;
        }
        // A retry replaces earlier drafts that were never sent
        await supabaseAdmin.from('meeting_note_tasks').delete().eq('meeting_id', m.id).eq('status', 'draft').eq('source', 'ai');
        if (result.tasks.length) {
            const { error } = await supabaseAdmin.from('meeting_note_tasks').insert(result.tasks.map((t, i) => ({
                meeting_id: m.id, position: i, title: t.title, note: t.note, owner_name: t.ownerName, owner_user_id: t.ownerUserId, owner_user_ids: t.ownerUserId ? [t.ownerUserId] : [],
                due_date: t.dueDate, due_time: t.dueTime, quote: t.quote, quote_at_seconds: t.quoteAtSeconds, quote_found: t.quoteFound,
                source: 'ai', original: t, status: 'draft',
            })));
            if (error) throw new Error(`could not save the tasks: ${error.message}`);
        }
        await this.update(m.id, {
            status: 'ready', error: null, summary: result.summary,
            llm: { model: result.model, tokensIn: result.tokensIn, tokensOut: result.tokensOut, failures: result.failures, tasks: result.tasks.length },
        });
        await TaskDatabaseService.logAudit({ eventType: 'meeting_ready', details: { meetingId: m.id, tasks: result.tasks.length, model: result.model, provider: m.stt?.provider ?? null } });
    }

    // ── the task list ─────────────────────────────────────────────────────────

    private static async taskRow(meetingId: string, taskId: unknown): Promise<MeetingTaskRow> {
        if (!isUuid(taskId)) throw new MeetingError(400, 'Unknown task.');
        const { data, error } = await supabaseAdmin.from('meeting_note_tasks').select('*').eq('id', taskId).eq('meeting_id', meetingId).maybeSingle();
        if (error) dbFail(error, 'Could not load the task');
        if (!data || data.status === 'deleted') throw new MeetingError(404, 'This task no longer exists.');
        return data as MeetingTaskRow;
    }

    /** Checks the editable fields. Only the ones present in `input` are returned. */
    private static async fields(input: Record<string, unknown>): Promise<Record<string, unknown>> {
        const out: Record<string, unknown> = {};
        if ('title' in input) {
            const title = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim() : '';
            if (title.length < 1 || title.length > 200) throw new MeetingError(400, 'A task needs a title (up to 200 characters).');
            out.title = title;
        }
        if ('note' in input) {
            const note = typeof input.note === 'string' ? input.note.trim() : '';
            if (note.length > 1000) throw new MeetingError(400, 'The note can be at most 1000 characters.');
            out.note = note || null;
        }
        // Owner 2026-10-29: one or several people
        if ('ownerUserIds' in input) {
            const raw = input.ownerUserIds ?? [];
            if (!Array.isArray(raw) || raw.some(x => !isUuid(x))) throw new MeetingError(400, 'Choose people who are in the Task Manager.');
            const wanted = [...new Set(raw as string[])];
            if (wanted.length > MAX_OWNERS) throw new MeetingError(400, `A task can be for at most ${MAX_OWNERS} people.`);
            const active = new Set((await this.people()).map(p => p.id));
            if (wanted.some(id => !active.has(id))) throw new MeetingError(400, 'Choose people who are in the Task Manager.');
            out.owner_user_ids = wanted;
            out.owner_user_id = wanted[0] ?? null;
        }
        if ('dueDate' in input) {
            if (input.dueDate && !isRealDate(input.dueDate)) throw new MeetingError(400, 'The due date is not a real date.');
            out.due_date = input.dueDate || null;
            if (!input.dueDate) out.due_time = null;
        }
        if ('dueTime' in input && !(out.due_date === null)) {
            if (input.dueTime && !isClockTime(input.dueTime)) throw new MeetingError(400, 'The due time must look like 17:30.');
            out.due_time = input.dueTime || null;
        }
        return out;
    }

    static async updateTask(userId: string, meetingId: string, input: Record<string, unknown>) {
        const m = await this.visible(userId, meetingId);
        if (m.status !== 'ready') throw new MeetingError(409, 'The notes are not ready yet.');
        const t = await this.taskRow(meetingId, input.taskId);
        if (t.status !== 'draft') throw new MeetingError(409, 'This task has already been sent.');
        const patch = await this.fields(input);
        if (!Object.keys(patch).length) return { ok: true };
        const { error } = await supabaseAdmin.from('meeting_note_tasks').update({ ...patch, error: null, updated_at: new Date().toISOString() }).eq('id', t.id).eq('status', 'draft');
        if (error) dbFail(error, 'Could not save the task');
        return { ok: true };
    }

    static async addTask(userId: string, meetingId: string, input: Record<string, unknown>) {
        const m = await this.visible(userId, meetingId);
        if (m.status !== 'ready') throw new MeetingError(409, 'Tasks can be added once the notes are ready.');
        const patch = await this.fields({ title: input.title, ...input });
        // Owner 2026-10-29: a task added by hand goes to the TOP of the list, where the person can see it
        const { data: first } = await supabaseAdmin.from('meeting_note_tasks').select('position').eq('meeting_id', meetingId).order('position', { ascending: true }).limit(1);
        const { data, error } = await supabaseAdmin.from('meeting_note_tasks')
            .insert({ ...patch, meeting_id: meetingId, position: ((first?.[0]?.position as number | undefined) ?? 1) - 1, source: 'manual', status: 'draft' })
            .select('id').single();
        if (error || !data) dbFail(error, 'Could not add the task');
        return { id: data.id as string };
    }

    static async deleteTask(userId: string, meetingId: string, taskId: unknown) {
        const m = await this.visible(userId, meetingId);
        if (m.status !== 'ready') throw new MeetingError(409, 'The notes are not ready yet.');
        const t = await this.taskRow(meetingId, taskId);
        if (t.status !== 'draft') throw new MeetingError(409, 'A task that was sent cannot be removed here.');
        const { error } = await supabaseAdmin.from('meeting_note_tasks').update({ status: 'deleted', updated_at: new Date().toISOString() }).eq('id', t.id).eq('status', 'draft');
        if (error) dbFail(error, 'Could not remove the task');
        return { ok: true };
    }

    /**
     * Sends tasks, each into that person's list, with a bell and the usual WhatsApp alert. Owner rule: no Task Manager
     * assignment rules apply. Each task is sent at most once — the row is claimed (draft → sending) before anything is
     * created. Owner 2026-10-29: `sendAs`
     *   'autopilot' (default)  no human sender; shown as "Autopilot (meeting …)"
     *   'me'                   the person pressing Send is the giver (their name + department), so the task shows as
     *                          given by them and they hear when it is done
     */
    static async send(userId: string, meetingId: string, taskIds: unknown, sendAs: unknown = 'autopilot') {
        const m = await this.visible(userId, meetingId);
        if (m.status !== 'ready') throw new MeetingError(409, 'The notes are not ready yet.');
        const ids = (Array.isArray(taskIds) ? taskIds : [taskIds]).filter(isUuid).slice(0, 200);
        if (!ids.length) throw new MeetingError(400, 'Choose the tasks to send.');
        if (sendAs !== 'autopilot' && sendAs !== 'me') throw new MeetingError(400, 'Choose who the tasks are sent from.');
        const me = sendAs === 'me' ? await this.senderFor(userId, m.workspace ?? 'tech') : null;
        const fromLine = me ? `From ${me.name} (${me.department}) — meeting "${m.title}" on ${m.meeting_date}` : `From ${AUTOPILOT} — meeting "${m.title}" on ${m.meeting_date}`;

        const sent: Array<{ id: string; name: string }> = [];
        const skipped: Array<{ id: string; title: string; why: string }> = [];
        const today = todayIST();
        const byPerson = new Map<string, { titles: string[]; phone: string; departmentId: string | null; departmentName: string | null }>();

        for (const id of ids) {
            const { data: claimed, error: claimError } = await supabaseAdmin.from('meeting_note_tasks')
                .update({ status: 'sending', error: null, updated_at: new Date().toISOString() })
                .eq('id', id).eq('meeting_id', meetingId).eq('status', 'draft').select('*');
            if (claimError) dbFail(claimError, 'Could not send the tasks');
            const t = (claimed?.[0] ?? null) as MeetingTaskRow | null;
            if (!t) { skipped.push({ id, title: '', why: 'already sent' }); continue; }
            const release = async (why: string) => {
                await supabaseAdmin.from('meeting_note_tasks').update({ status: 'draft', error: why }).eq('id', t.id);
                skipped.push({ id: t.id, title: t.title, why });
            };
            const owners = ownersOf(t);
            if (!owners.length) { await release('Choose who this task is for.'); continue; }
            // Owner 2026-10-29: one Task Manager task per person. The card counts as sent once at least one copy exists;
            // anyone who could not get it is named on the card (it is NOT put back to draft, so nobody gets a second copy).
            const description = [t.note || '', fromLine].filter(Boolean).join('\n').slice(0, 1000);
            const created: Array<{ taskId: string; personId: string; name: string }> = [];
            const missed: string[] = [];
            for (const ownerId of owners) {
                const person = await TaskDatabaseService.getEmployeeById(ownerId).catch(() => null);
                if (!person?.active) { missed.push(person?.name || 'someone no longer in the Task Manager'); continue; }
                try {
                    const taskId = (await TaskDatabaseService.createTaskAssignment({ employeeId: person.id, title: t.title, description, assignedDate: today, assignedBy: me?.id })).id;
                    created.push({ taskId, personId: person.id, name: person.name });
                    const g = byPerson.get(person.id) ?? { titles: [], phone: person.phone_number, departmentId: person.department_id, departmentName: person.department_name };
                    g.titles.push(t.title);
                    byPerson.set(person.id, g);
                } catch (err) {
                    console.error('[MeetingService] could not create a task:', err instanceof Error ? err.message : err);
                    missed.push(person.name);
                }
            }
            if (!created.length) { await release(`Could not send this task${missed.length ? ` (${missed.join(', ')})` : ''}. Please try again.`); continue; }

            const taskIdsMade = created.map(c => c.taskId);
            const { error: markError } = await supabaseAdmin.from('meeting_note_tasks').update({
                status: 'sent', task_id: taskIdsMade[0], task_ids: taskIdsMade, sent_at: new Date().toISOString(), sent_by: userId,
                error: missed.length ? `Not sent to: ${missed.join(', ')}. Add a new task for them if needed.` : null,
            }).eq('id', t.id);
            if (markError) console.error('[MeetingService] task created but not marked sent (left "sending", never re-sent):', t.id, taskIdsMade, markError.message);
            sent.push({ id: t.id, name: created.map(c => c.name).join(', ') });
            try {
                if (t.due_date && !(await setTaskDue(taskIdsMade, { date: t.due_date, time: t.due_time }))) {
                    await supabaseAdmin.from('meeting_note_tasks').update({ error: 'Sent, but the due date could not be saved.' }).eq('id', t.id);
                }
                for (const c of created) {
                    await TaskDatabaseService.logAudit({ eventType: 'meeting_task_sent', actorId: userId, targetEmployeeId: c.personId, taskId: c.taskId, details: { meetingId, meetingTaskId: t.id, from: me ? 'sender' : AUTOPILOT } });
                }
            } catch (err) {
                console.warn('[MeetingService] after-send step failed (the task was sent):', err instanceof Error ? err.message : err);
            }
        }

        // One bell + one WhatsApp alert per person (the existing message sender, with its kill switches and sandbox)
        const from = me ? personLabel(me.name, me.department) : `${AUTOPILOT} (meeting "${m.title.slice(0, 60)}")`;
        const giver = me ? me.name : AUTOPILOT;
        await Promise.all([...byPerson.entries()].map(async ([personId, g]) => {
            // Sending to yourself as yourself: it is already in your list, no alert needed
            if (me && personId === me.id) return;
            void taskBell({ userId: personId, kind: 'TASK_ASSIGNED', title: `New task${g.titles.length === 1 ? '' : 's'} from ${giver}`, message: `From the meeting "${m.title}": ${shortList(g.titles)}`, departmentName: g.departmentName });
            await sendTaskAssigned(g.phone, { titles: g.titles, fromLabel: from, date: today, departmentId: g.departmentId || undefined });
        }));
        return { sent, skipped };
    }
}
