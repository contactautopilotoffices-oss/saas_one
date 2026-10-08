import { ParsedTask, ParseInput, ParseResult, ImportInputKind, findDateInText } from './TaskImportParser';
import { parseConfirmAnswer } from './TaskGateway';

/**
 * Task Import — Stage 2: the conversation (preview → confirm).
 *
 * A fixed workflow, not an agent: parse (Stage 1) → structure → CONFIRM → save (Stage 3).
 * This file is the "confirm" part. It has NO database and NO network code of its own: everything it
 * touches (conversation state, sending, parsing, audit) comes in through `ImportDeps`, so the whole
 * conversation is testable offline. The real wiring lives in TaskImportInbound.ts.
 *
 * Nothing is saved here. `deps.save` is absent until Stage 3, so a YES only says "saving is not on yet".
 */

export const IMPORT_CONTEXT = {
    AWAITING: 'IMPORT_AWAITING',   // "send me your list" — waiting for the file/text
    PROCESSING: 'IMPORT_PROCESSING', // reading the file right now
    PREVIEW: 'IMPORT_PREVIEW',     // shown the list, waiting for YES / NO / edits
} as const;

export const AWAITING_TTL_MIN = 10;
export const PROCESSING_TTL_MIN = 5;
export const PREVIEW_TTL_MIN = 30;
export const MAX_MESSAGE_CHARS = 3500; // WhatsApp's hard limit is 4096; keep a margin

export interface ImportDraft {
    tasks: ParsedTask[];
    date: string;
    dateFromSource: boolean;
    source: ImportInputKind;
    structuredBy: 'rules' | 'llm';
}

export interface SaveOutcome {
    saved: number;
    skipped: number;                 // already in the person's list (same title + site + date)
    failed?: number;                 // could not be written
    failedIndexes?: number[];        // positions in draft.tasks of the ones that failed (to retry only those)
    taskIds?: string[];              // ids created, for the audit trail
}

export interface ImportDeps {
    getContext(phone: string): Promise<{ type: string; data: any } | null>;
    setContext(phone: string, type: string, data: Record<string, unknown>, ttlMinutes: number): Promise<void>;
    clearContext(phone: string): Promise<void>;
    /** Sends one WhatsApp message through the safety gate (kill switches, Pretend Mode). */
    reply(phone: string, text: string): Promise<void>;
    parse(input: ParseInput): Promise<ParseResult>;
    audit(event: string, phone: string, details: Record<string, unknown>): Promise<void>;
    today(): string;
    /** Stage 3. Absent in Stage 2 → a YES keeps nothing and says so. */
    save?(phone: string, draft: ImportDraft): Promise<SaveOutcome>;
}

export interface ImportClaim {
    /** true = this message belongs to Task Import; the caller must not run any other handler for it. */
    handled: boolean;
    /** Slow work (download + AI read). The caller runs it AFTER answering the webhook. Never throws. */
    background?: () => Promise<void>;
}

const NOT_HANDLED: ImportClaim = { handled: false };

// ── What the person types ────────────────────────────────────────────────────

const TRIGGER_VERB = /^\s*(?:please\s+)?(?:add|import|upload|save|register|log)\s+(?:my\s+|these\s+|the\s+|today'?s\s+|todays\s+|daily\s+)*(?:tasks?|task\s*list|to[\s-]?do(?:\s*list)?)\b\s*[:\-–]?\s*([\s\S]*)$/i;
const TRIGGER_HEADING = /^\s*(?:my\s+|today'?s\s+|todays\s+|daily\s+)*(?:task\s*list|tasks|to[\s-]?do\s*list)\b[^\n:–-]*[:–-]\s*([\s\S]*)$/i;

/** "add tasks" / "add my tasks: 1. …" / "Tasks for 25/09:\n1. …". `rest` is whatever followed (may be empty). */
export function matchImportTrigger(text: string): { rest: string } | null {
    const t = String(text || '');
    const m = t.match(TRIGGER_VERB) || t.match(TRIGGER_HEADING);
    return m ? { rest: (m[1] || '').trim() } : null;
}

/** An image is only treated as a task list when its caption talks about tasks (otherwise it may be a ticket photo). */
export function captionMentionsTasks(text: string): boolean {
    return !!matchImportTrigger(text) || /\btasks?\b|task\s*list|to[\s-]?do/i.test(String(text || ''));
}

const nonEmptyLines = (t: string) => String(t || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

export type PreviewCommand =
    | { kind: 'yes' }
    | { kind: 'no' }
    | { kind: 'remove'; numbers: number[] }
    | { kind: 'date'; date: string }
    | { kind: 'bad_date' }
    | { kind: 'help' };

function addDays(isoDate: string, days: number): string {
    return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function parsePreviewCommand(text: string, today: string): PreviewCommand | null {
    const t = String(text || '').trim();
    if (!t || t.length > 120) return null;
    const lower = t.toLowerCase().replace(/[.!\s]+$/g, '');

    const answer = parseConfirmAnswer(t);
    if (answer === 'yes' || /^save(?:\s+(?:all|them|it|these))?$/.test(lower)) return { kind: 'yes' };
    if (answer === 'no' || /^(?:cancel|discard|delete\s+all|clear)$/.test(lower)) return { kind: 'no' };
    if (/^(?:help|\?|options|edit)$/.test(lower)) return { kind: 'help' };

    const rm = lower.match(/^(?:remove|delete|drop|skip)\s+(?:tasks?\s+|number\s+|no\.?\s*|#)?(\d[\d\s,&and]*)$/);
    if (rm) return { kind: 'remove', numbers: [...new Set((rm[1].match(/\d+/g) || []).map(Number))] };

    const dm = lower.match(/^(?:date|change\s+date\s+to|set\s+date\s+to|date\s+is)\s+(.+)$/);
    if (dm) {
        const w = dm[1].trim();
        if (w === 'today') return { kind: 'date', date: today };
        if (w === 'tomorrow') return { kind: 'date', date: addDays(today, 1) };
        if (w === 'yesterday') return { kind: 'date', date: addDays(today, -1) };
        const found = findDateInText(w) || findDateInText(`${w} ${today.slice(0, 4)}`);
        return found ? { kind: 'date', date: found } : { kind: 'bad_date' };
    }
    return null;
}

/** Cheap, no-I/O check the webhook uses to skip everything else for ordinary messages. */
export function looksLikeImportText(text: string, today: string): boolean {
    const t = String(text || '');
    return !!matchImportTrigger(t) || !!parsePreviewCommand(t, today) || nonEmptyLines(t).length >= 2;
}

// ── What the bot says ────────────────────────────────────────────────────────

const STATUS_LABEL: Record<ParsedTask['status'], string> = { in_progress: 'In progress', completed: 'Done', pending: 'Pending' };
const SOURCE_LABEL: Record<ImportInputKind, string> = { image: 'your image', excel: 'your Excel file', text: 'your message' };
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Fri, 25 Sep 2026". Built by hand: Intl abbreviates September differently ("Sep" vs "Sept") across runtimes. */
export function dateLabel(isoDate: string): string {
    const d = new Date(`${isoDate}T00:00:00Z`);
    return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function taskBlock(t: ParsedTask, i: number): string {
    const head = `${i + 1}. ${t.title}${t.site ? ` (${t.site})` : ''}`;
    const meta = [STATUS_LABEL[t.status], t.remark ? trunc(t.remark, 90) : ''].filter(Boolean).join(' · ');
    return [head, `   ${meta}`, t.finalStatus ? `   Next: ${trunc(t.finalStatus, 90)}` : ''].filter(Boolean).join('\n');
}

/** The numbered preview, split so no single WhatsApp message passes the length limit. */
export function formatPreview(draft: ImportDraft, today?: string): string[] {
    const n = draft.tasks.length;
    const intro = `📋 I found ${n} task${n === 1 ? '' : 's'} in ${SOURCE_LABEL[draft.source]} for ${dateLabel(draft.date)}` +
        `${draft.dateFromSource ? '' : ' (today — I could not find a date in it)'}:`;
    // Saved tasks appear in the Tasks tab on THEIR date, so say so when it is not today.
    const notToday = today && draft.date !== today
        ? `\n⚠️ That is not today's date, so these will not show on today's list. Reply "date today" to move them to today.` : '';
    const footer = `Reply YES to save these.\nReply NO to cancel.\nTo drop one: "remove 3".  To change the date: "date 21 Aug".${notToday}`;

    const blocks = draft.tasks.map(taskBlock);
    const chunks: string[] = [];
    let current = intro;
    for (const b of blocks) {
        if (current.length + b.length + 2 > MAX_MESSAGE_CHARS) { chunks.push(current); current = b; }
        else current += `\n\n${b}`;
    }
    if (current.length + footer.length + 2 > MAX_MESSAGE_CHARS) { chunks.push(current); current = footer; }
    else current += `\n\n${footer}`;
    chunks.push(current);
    return chunks;
}

const HELP_TEXT = 'You can reply:\n• YES — save this list\n• NO — cancel\n• "remove 3" or "remove 2, 5" — drop tasks\n• "date 21 Aug" or "date tomorrow" — change the date';
const PDF_TEXT = 'I can\'t read PDFs yet. Please send your list as an image, an Excel file, or paste it as text.';
export const IMPORT_TEXT = { HELP: HELP_TEXT, PDF: PDF_TEXT };

// ── The conversation ─────────────────────────────────────────────────────────

export class TaskImportService {
    /** A text message from an eligible person. Returns handled:false for anything that is not ours. */
    static async handleText(phone: string, text: string, deps: ImportDeps): Promise<ImportClaim> {
        const ctx = await deps.getContext(phone);
        const today = deps.today();

        if (ctx?.type === IMPORT_CONTEXT.PREVIEW) {
            const cmd = parsePreviewCommand(text, today);
            if (!cmd) return NOT_HANDLED; // unrelated message: the normal bot answers it
            await this.applyCommand(phone, ctx.data as ImportDraft, cmd, deps);
            return { handled: true };
        }

        if (ctx?.type === IMPORT_CONTEXT.PROCESSING) {
            await deps.reply(phone, ctx.data?.saving
                ? '⏳ I\'m still saving your tasks. One moment.'
                : '⏳ I\'m still reading your last list. I\'ll send it as soon as it\'s ready.');
            return { handled: true };
        }

        if (ctx?.type === IMPORT_CONTEXT.AWAITING) {
            const lower = text.trim().toLowerCase().replace(/[.!\s]+$/g, '');
            if (parseConfirmAnswer(text) === 'no' || lower === 'cancel') {
                await deps.clearContext(phone);
                await deps.reply(phone, 'Okay, cancelled. Nothing was added.');
                return { handled: true };
            }
            const trigger = matchImportTrigger(text);
            const body = trigger ? trigger.rest : text.trim();
            if (nonEmptyLines(body).length >= 1 && (trigger || nonEmptyLines(text).length >= 2)) {
                return this.begin(phone, { label: 'list', load: async () => ({ kind: 'text', text: body }) }, deps);
            }
            return NOT_HANDLED;
        }

        const trigger = matchImportTrigger(text);
        if (!trigger) return NOT_HANDLED;
        if (trigger.rest) {
            return this.begin(phone, { label: 'list', load: async () => ({ kind: 'text', text: trigger.rest }) }, deps);
        }
        await deps.setContext(phone, IMPORT_CONTEXT.AWAITING, {}, AWAITING_TTL_MIN);
        await deps.reply(phone, 'Sure. Send me your task list now: as an image, an Excel file, or just paste it here.\nReply CANCEL to stop.');
        await deps.audit('task_import_awaiting', phone, {});
        return { handled: true };
    }

    /** A file or image arrived while another one is still being read. */
    static async busy(phone: string, deps: ImportDeps): Promise<boolean> {
        const ctx = await deps.getContext(phone);
        if (ctx?.type !== IMPORT_CONTEXT.PROCESSING) return false;
        await deps.reply(phone, '⏳ I\'m still reading your last list. Please send the next one in a minute.');
        return true;
    }

    /** True when the person has said "add tasks" and we are waiting for their file. */
    static async isAwaiting(phone: string, deps: ImportDeps): Promise<boolean> {
        return (await deps.getContext(phone))?.type === IMPORT_CONTEXT.AWAITING;
    }

    /**
     * Start an import: remember "reading", send the instant acknowledgement, and hand back the slow part.
     * `load` produces the parser input (downloading the file first, if there is one) or a friendly error.
     */
    static async begin(
        phone: string,
        p: { label: string; load: () => Promise<ParseInput | { error: string }> },
        deps: ImportDeps
    ): Promise<ImportClaim> {
        await deps.setContext(phone, IMPORT_CONTEXT.PROCESSING, { startedAt: new Date().toISOString() }, PROCESSING_TTL_MIN);
        await deps.reply(phone, `📥 Got your ${p.label}. Reading your tasks now. This can take up to a minute.`);
        await deps.audit('task_import_received', phone, { source: p.label });
        return { handled: true, background: () => this.run(phone, p, deps) };
    }

    /** The slow part. Never throws: every failure becomes a friendly message and a cleared state. */
    static async run(
        phone: string,
        p: { label: string; load: () => Promise<ParseInput | { error: string }> },
        deps: ImportDeps
    ): Promise<void> {
        try {
            const loaded = await p.load();
            if ('error' in loaded) {
                await deps.clearContext(phone);
                await deps.reply(phone, loaded.error);
                await deps.audit('task_import_failed', phone, { reason: 'unreadable_input' });
                return;
            }
            const result = await deps.parse(loaded);
            if (!result.ok || !result.tasks.length) {
                await deps.clearContext(phone);
                await deps.reply(phone, `${result.error || 'I could not find any tasks in that.'}\nYou can send a clearer image, an Excel file, or paste the list as text.`);
                await deps.audit('task_import_failed', phone, { reason: 'no_tasks', source: result.kind });
                return;
            }
            const draft: ImportDraft = {
                tasks: result.tasks, date: result.date, dateFromSource: result.dateFromSource,
                source: result.kind, structuredBy: result.structuredBy,
            };
            await deps.setContext(phone, IMPORT_CONTEXT.PREVIEW, draft as unknown as Record<string, unknown>, PREVIEW_TTL_MIN);
            for (const chunk of formatPreview(draft, deps.today())) await deps.reply(phone, chunk);
            await deps.audit('task_import_previewed', phone, { source: draft.source, count: draft.tasks.length, structuredBy: draft.structuredBy, dateFromSource: draft.dateFromSource });
        } catch (err) {
            console.warn('[TaskImportService] import failed:', err instanceof Error ? err.message : err);
            await deps.clearContext(phone).catch(() => undefined);
            await deps.reply(phone, 'Sorry, something went wrong while reading that. Please try again.').catch(() => undefined);
        }
    }

    /** Apply YES / NO / remove / date to the list being previewed. */
    static async applyCommand(phone: string, draft: ImportDraft, cmd: PreviewCommand, deps: ImportDeps): Promise<void> {
        switch (cmd.kind) {
            case 'help':
                await deps.reply(phone, HELP_TEXT);
                return;

            case 'no':
                await deps.clearContext(phone);
                await deps.reply(phone, 'Okay, I\'ve discarded that list. Nothing was saved.');
                await deps.audit('task_import_cancelled', phone, { count: draft.tasks.length });
                return;

            case 'bad_date':
                await deps.reply(phone, 'I couldn\'t understand that date. Try "date 21 Aug", "date 21-08-2026" or "date tomorrow".');
                return;

            case 'date': {
                const next = { ...draft, date: cmd.date, dateFromSource: true };
                await deps.setContext(phone, IMPORT_CONTEXT.PREVIEW, next as unknown as Record<string, unknown>, PREVIEW_TTL_MIN);
                await deps.reply(phone, `Date changed to ${dateLabel(cmd.date)}.`);
                for (const chunk of formatPreview(next, deps.today())) await deps.reply(phone, chunk);
                return;
            }

            case 'remove': {
                const n = draft.tasks.length;
                const bad = cmd.numbers.filter(x => x < 1 || x > n);
                if (!cmd.numbers.length || bad.length) {
                    await deps.reply(phone, `I couldn't find task ${bad.join(', ') || '—'}. You have ${n} task${n === 1 ? '' : 's'}; use a number from 1 to ${n}.`);
                    return;
                }
                if (cmd.numbers.length >= n) {
                    await deps.reply(phone, 'That would remove every task. Reply NO to cancel the whole list instead.');
                    return;
                }
                const drop = new Set(cmd.numbers);
                const next = { ...draft, tasks: draft.tasks.filter((_, i) => !drop.has(i + 1)) };
                await deps.setContext(phone, IMPORT_CONTEXT.PREVIEW, next as unknown as Record<string, unknown>, PREVIEW_TTL_MIN);
                await deps.reply(phone, `Removed ${cmd.numbers.length === 1 ? `task ${cmd.numbers[0]}` : `${cmd.numbers.length} tasks`}. ${next.tasks.length} left.`);
                for (const chunk of formatPreview(next, deps.today())) await deps.reply(phone, chunk);
                await deps.audit('task_import_edited', phone, { removed: cmd.numbers.length, left: next.tasks.length });
                return;
            }

            case 'yes': {
                if (!deps.save) {
                    // Stage 2: the save step does not exist yet. Say so honestly; keep nothing.
                    await deps.clearContext(phone);
                    await deps.reply(phone, '✅ Thanks, your list looks good. But saving is not switched on yet, so nothing has been stored.');
                    await deps.audit('task_import_confirmed', phone, { count: draft.tasks.length, savedCount: 0 });
                    return;
                }
                // Lock first: a second YES (double tap, repeat delivery on another server) must not save the list twice.
                await deps.setContext(phone, IMPORT_CONTEXT.PROCESSING, { saving: true }, PROCESSING_TTL_MIN);
                let outcome: SaveOutcome;
                try {
                    outcome = await deps.save(phone, draft);
                } catch (err) {
                    console.warn('[TaskImportService] save failed:', err instanceof Error ? err.message : err);
                    // Nothing is lost: put the list back so YES can be tried again.
                    await deps.setContext(phone, IMPORT_CONTEXT.PREVIEW, draft as unknown as Record<string, unknown>, PREVIEW_TTL_MIN);
                    await deps.reply(phone, 'Sorry, I couldn\'t save your tasks just now. Your list is still here. Reply YES to try again, or NO to cancel.');
                    await deps.audit('task_import_save_failed', phone, { count: draft.tasks.length });
                    return;
                }

                const failed = outcome.failed || 0;
                const when = dateLabel(draft.date);
                const skippedNote = outcome.skipped ? ` I skipped ${outcome.skipped} you already have.` : '';
                if (failed > 0) {
                    // Keep ONLY the ones that did not save, so YES retries just those (never the ones already saved).
                    const idx = new Set(outcome.failedIndexes || []);
                    const rest: ImportDraft = { ...draft, tasks: draft.tasks.filter((_, i) => idx.has(i)) };
                    await deps.setContext(phone, IMPORT_CONTEXT.PREVIEW, rest as unknown as Record<string, unknown>, PREVIEW_TTL_MIN);
                    await deps.reply(phone, `⚠️ Saved ${outcome.saved} of ${draft.tasks.length} for ${when}.${skippedNote} ` +
                        `${failed} could not be saved. Reply YES to try those again, or NO to leave them.`);
                } else {
                    await deps.clearContext(phone);
                    await deps.reply(phone, outcome.saved === 0
                        ? `Those ${outcome.skipped} task${outcome.skipped === 1 ? ' is' : 's are'} already in your list for ${when}, so I didn't add anything new.`
                        : `✅ Saved ${outcome.saved} task${outcome.saved === 1 ? '' : 's'} for ${when}.${skippedNote} You'll find them in your Tasks tab.` +
                          `${draft.date !== deps.today() ? ' (They are on that date, not today.)' : ''}`);
                }
                await deps.audit('task_import_confirmed', phone, {
                    count: draft.tasks.length, savedCount: outcome.saved, skipped: outcome.skipped, failed, date: draft.date, taskIds: outcome.taskIds || [],
                });
                return;
            }
        }
    }
}
