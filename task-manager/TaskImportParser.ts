import ExcelJS from 'exceljs';
import { TaskStatus } from './types';

/**
 * Task Import — Stage 1: the smart parser (parse → structure).
 *
 * PURE: no database, no WhatsApp, no sending. Turns text / image / Excel into a list of task drafts.
 * Nothing here saves anything; the confirm + save steps come in later stages.
 *
 * Doctrine: a fixed workflow, not an agent (L1). The AI does two narrow jobs only — read a picture,
 * and structure loose text. Excel with recognisable headers needs no AI at all. Errors come back as
 * values, never thrown (L3).
 */

export type ImportInputKind = 'text' | 'image' | 'excel';

export interface ParsedTask {
    title: string;
    site: string | null;
    remark: string | null;
    status: TaskStatus;
    finalStatus: string | null;
}

export interface ParseResult {
    ok: boolean;
    kind: ImportInputKind;
    tasks: ParsedTask[];
    /** YYYY-MM-DD — the date found in the sheet/text, else today. */
    date: string;
    dateFromSource: boolean;
    structuredBy: 'rules' | 'llm';
    /** Human-readable problem; set when ok is false. */
    error?: string;
}

/** The only two AI jobs. Injectable so tests never touch the network. */
export interface ImportLlm {
    /** Read an image and return the task table/list as plain text, one row per line. */
    imageToText(image: Buffer, mimeType: string): Promise<string>;
    /** Turn loose text into task objects. Returns raw (untrusted) JSON-like data. */
    structureText(rawText: string): Promise<unknown>;
}

export const MAX_TASKS_PER_IMPORT = 100;
export const MAX_TITLE_LENGTH = 200;
const MAX_TEXT_LENGTH = 20000;

// ── Small helpers ────────────────────────────────────────────────────────────

export function todayInIndia(now: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12
};

function iso(y: number, m: number, d: number): string | null {
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null; // e.g. 31 Feb
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Finds a date inside a string: 25-Sep-26, 25 Sep 2026, 25/09/2026 (day first), 2026-09-25. */
export function findDateInText(text: string): string | null {
    const t = String(text || '');
    let m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = t.match(/\b(\d{1,2})[\s\-\/.]([A-Za-z]{3,9})[\s\-\/.,]*(\d{2}|\d{4})\b/);
    if (m) {
        const mon = MONTHS[m[2].toLowerCase().slice(0, 4)] || MONTHS[m[2].toLowerCase().slice(0, 3)];
        if (mon) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], mon, +m[1]);
    }
    m = t.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})\b/);
    if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
    return null;
}

export function normalizeStatus(raw: unknown): TaskStatus {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s) return 'pending';
    if (/^(done|complete|completed|closed|finished|over)\b/.test(s)) return 'completed';
    if (/^(wip|w\.i\.p|in[\s-]?progress|ongoing|started|working|partial)/.test(s)) return 'in_progress';
    return 'pending';
}

const clean = (v: unknown, max = 500): string | null => {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, max) : null;
};

/** Untrusted rows (from rules or the AI) → validated tasks. Drops empties, dedupes, caps the count. */
export function sanitizeTasks(rows: unknown): ParsedTask[] {
    if (!Array.isArray(rows)) return [];
    const seen = new Set<string>();
    const out: ParsedTask[] = [];
    for (const r of rows) {
        if (!r || typeof r !== 'object') continue;
        const o = r as Record<string, unknown>;
        const title = clean(o.title ?? o.task, MAX_TITLE_LENGTH);
        if (!title) continue;
        const site = clean(o.site ?? o.site_name, 100);
        const key = `${title.toLowerCase()}|${(site || '').toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            title,
            site,
            remark: clean(o.remark ?? o.description ?? o.remarks, 500),
            status: normalizeStatus(o.status),
            finalStatus: clean(o.finalStatus ?? o.final_status, 500)
        });
        if (out.length >= MAX_TASKS_PER_IMPORT) break;
    }
    return out;
}

// ── Excel (rules first, no AI when the headers are recognisable) ─────────────

function cellText(v: unknown): string {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object') {
        const o = v as any;
        if (Array.isArray(o.richText)) return o.richText.map((p: any) => p.text).join('');
        if (o.result !== undefined) return cellText(o.result);
        if (o.text !== undefined) return String(o.text);
        if (o.hyperlink) return String(o.text ?? o.hyperlink);
        return '';
    }
    return String(v).trim();
}

type Col = 'title' | 'site' | 'remark' | 'status' | 'finalStatus';

function classifyHeader(h: string): Col | null {
    const t = h.toLowerCase().trim();
    if (!t) return null;
    if (/final\s*status|outcome|update|next\s*step/.test(t)) return 'finalStatus';
    if (/^status$|^state$/.test(t)) return 'status';
    if (/site|cent(er|re)|location|branch/.test(t)) return 'site';
    if (/remark|note|comment|detail|description/.test(t)) return 'remark';
    if (/task|activity|work\s*item|action|^item$/.test(t)) return 'title';
    return null;
}

interface SheetGrid { rows: string[][]; dateFromCells: string | null }

async function readFirstSheet(buffer: Buffer): Promise<SheetGrid> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets.find(w => w.actualRowCount > 0);
    if (!ws) return { rows: [], dateFromCells: null };
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
        const cells: string[] = [];
        for (let c = 1; c <= Math.max(row.cellCount, 1); c++) cells.push(cellText(row.getCell(c).value));
        rows.push(cells);
    });
    let dateFromCells: string | null = null;
    // Only the top rows: a sheet's date sits above the table, and task text further down must not be mistaken for it.
    for (const r of rows.slice(0, 4)) {
        for (const c of r) { const d = findDateInText(c); if (d) { dateFromCells = d; break; } }
        if (dateFromCells) break;
    }
    return { rows, dateFromCells };
}

function rowsByHeaders(rows: string[][]): ParsedTask[] | null {
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const map: Partial<Record<Col, number>> = {};
        rows[i].forEach((h, idx) => {
            const col = classifyHeader(h);
            if (col && map[col] === undefined) map[col] = idx;
        });
        if (map.title === undefined) continue;
        const data: unknown[] = [];
        for (const r of rows.slice(i + 1)) {
            const get = (c: Col) => (map[c] === undefined ? '' : r[map[c] as number] || '');
            if (!get('title').trim()) continue;
            data.push({ title: get('title'), site: get('site'), remark: get('remark'), status: get('status'), finalStatus: get('finalStatus') });
        }
        return sanitizeTasks(data);
    }
    return null;
}

// ── Text rules (numbered / bulleted lists need no AI) ────────────────────────

function rowsByLines(text: string): ParsedTask[] | null {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const listLines = lines.filter(l => /^(\d{1,3}[.)]|[-*•])\s+\S/.test(l));
    // Only trust the rules when almost every line is a list item (plus at most one heading/date line).
    if (listLines.length < 1 || lines.length - listLines.length > 1) return null;
    return sanitizeTasks(listLines.map(l => ({ title: l.replace(/^(\d{1,3}[.)]|[-*•])\s+/, '') })));
}

// ── Image transcript rules (a clean " | " table needs no second AI call) ─────

function rowsByPipeTable(text: string): ParsedTask[] | null {
    const grid = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.includes('|'))
        .map(l => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()))
        .filter(r => !r.every(c => c === '' || /^:?-{2,}:?$/.test(c)));
    const h = grid.findIndex(r => r.some(c => classifyHeader(c) === 'title'));
    if (h < 0) return null;
    // Every row must line up with the header. A dropped blank cell would shift a status into the wrong column,
    // so on any mismatch we do NOT guess — the caller falls back to the AI structuring step.
    if (grid.slice(h).some(r => r.length !== grid[h].length)) return null;
    return rowsByHeaders(grid.slice(h));
}

// ── The AI client: Engy, primary model first, secondary model as automatic fallback ──
//
// Chosen from a measured image test (see the Stage 1 findings): qwen3.8-27b read every field of the
// sample sheet correctly and was cheapest/fastest; glm-5.3-flash was the next best (one name misread).
// A model is only skipped to the next one when it ERRORS, times out, returns nothing, or returns JSON
// we cannot parse — never because its answer was "no tasks" (that is a valid answer).

export const IMPORT_PRIMARY_MODEL = 'qwen3.8-27b';
export const IMPORT_SECONDARY_MODEL = 'glm-5.3-flash';
export const IMPORT_MODELS: readonly string[] = [IMPORT_PRIMARY_MODEL, IMPORT_SECONDARY_MODEL];

const AI_MAX_TOKENS = 4000;
const AI_TIMEOUT_MS = 60_000;

const STRUCTURE_PROMPT = `You extract a person's daily TASK LIST from text.
Return ONLY JSON: {"tasks":[{"title":string,"site":string|null,"remark":string|null,"status":string|null,"finalStatus":string|null}]}
Rules, follow in order and do not skip any:
1. One object per task. Ignore headings, dates, serial numbers, column titles and blank rows.
2. "title" is the short task name. "site" is the site/centre/location if given, else null.
3. "remark" is the extra detail for that task. "status" is the status word if given (e.g. WIP, Done). "finalStatus" is any final/next-step note.
4. Never invent tasks. Never merge two tasks. If there are no tasks return {"tasks":[]}.
5. If the text is not a list of tasks to do (for example purchase orders, invoices, payment or price tables) return {"tasks":[]}.`;

const IMAGE_PROMPT = `Transcribe the task list or table in this image as plain text, one row per line, columns separated by " | ".
Keep an empty cell as an empty value between the " | " separators so columns stay aligned.
Include the header row and any date shown. Do not summarise, correct, or add anything.
If the image is not a list of tasks to do (for example a purchase-order, invoice, payment or price table, or a photo), reply exactly: NO_TASKS`;

/** The two network calls, injectable so the fallback logic is testable offline. Both throw on failure. */
export interface EngyTransport {
    vision(model: string, image: Buffer, mimeType: string, instruction: string): Promise<string>;
    chat(model: string, prompt: string): Promise<string>;
}

const defaultTransport: EngyTransport = {
    // Reuses the repo's existing Engy vision helper (base64 only, never throws, never logs the key).
    async vision(model, image, mimeType, instruction) {
        const { visionExtract } = await import('@/backend/lib/ocr/vision');
        const r = await visionExtract({
            pages: [{ buffer: image, mime: mimeType as 'image/jpeg' }],
            instruction, model, maxTokens: AI_MAX_TOKENS
        });
        if (!r.ok || !r.text?.trim()) throw new Error(r.error || 'the model returned nothing');
        return r.text;
    },
    // Reuses the repo's provider routing (COUNCIL_PROVIDER / COUNCIL_BASE_URL / COUNCIL_API_KEY).
    async chat(model, prompt) {
        const { resolveProvider } = await import('@/backend/lib/council/llm');
        const { spec, apiKey } = resolveProvider();
        if (!apiKey) throw new Error('no AI key is configured');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
        try {
            const res = await fetch(`${spec.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model, max_tokens: AI_MAX_TOKENS, temperature: 0,
                    messages: [{ role: 'user', content: prompt }],
                    response_format: { type: 'json_object' }
                }),
                signal: controller.signal
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const j: any = await res.json();
            const text = j?.choices?.[0]?.message?.content;
            if (typeof text !== 'string' || !text.trim()) throw new Error('the model returned nothing');
            return text;
        } finally {
            clearTimeout(timer);
        }
    }
};

/** Pull the task array out of a model reply; throws (→ fall back) if there is no usable JSON. */
function tasksFromModelJson(text: string): unknown {
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    const parsed = JSON.parse(m ? m[0] : text);
    const rows = Array.isArray(parsed) ? parsed : parsed?.tasks;
    if (!Array.isArray(rows)) throw new Error('the reply was not a task list');
    return rows;
}

export function createEngyImportLlm(
    models: readonly string[] = IMPORT_MODELS,
    transport: EngyTransport = defaultTransport
): ImportLlm {
    const withFallback = async <T>(what: string, run: (model: string) => Promise<T>): Promise<T> => {
        let last: unknown = new Error('no model configured');
        for (let i = 0; i < models.length; i++) {
            try { return await run(models[i]); }
            catch (err) {
                last = err;
                console.warn(`[TaskImportParser] ${what} failed on ${models[i]}: ${err instanceof Error ? err.message : err}` +
                    (i + 1 < models.length ? ` — trying ${models[i + 1]}` : ' — no more models'));
            }
        }
        throw last;
    };
    return {
        imageToText: (image, mimeType) => withFallback('image read', async m => {
            const t = (await transport.vision(m, image, mimeType, IMAGE_PROMPT)).trim();
            if (!t) throw new Error('the model returned nothing');
            return t;
        }),
        structureText: rawText => withFallback('structuring', async m =>
            tasksFromModelJson(await transport.chat(m, `${STRUCTURE_PROMPT}\n\nTEXT:\n${rawText}`)))
    };
}

export const engyImportLlm: ImportLlm = createEngyImportLlm();

// ── The smart parser ─────────────────────────────────────────────────────────

export interface ParseInput {
    kind: ImportInputKind;
    text?: string;
    buffer?: Buffer;
    mimeType?: string;
}

export interface ParseOptions {
    llm?: ImportLlm;
    /** YYYY-MM-DD used when the source has no date. Defaults to today (India). */
    today?: string;
}

/** Decide the input kind from a WhatsApp mime type / filename; null = unsupported (e.g. PDF). */
export function detectInputKind(mimeType?: string | null, fileName?: string | null): ImportInputKind | null {
    const mt = (mimeType || '').toLowerCase();
    const fn = (fileName || '').toLowerCase();
    if (mt.startsWith('image/')) return 'image';
    if (mt.includes('spreadsheetml') || mt === 'application/vnd.ms-excel' || /\.xlsx$/.test(fn)) return 'excel';
    if (mt.startsWith('text/') || /\.txt$/.test(fn)) return 'text';
    return null;
}

export async function parseTaskImport(input: ParseInput, opts: ParseOptions = {}): Promise<ParseResult> {
    const llm = opts.llm ?? engyImportLlm;
    const today = opts.today ?? todayInIndia();
    const fail = (error: string, date = today, dateFromSource = false): ParseResult =>
        ({ ok: false, kind: input.kind, tasks: [], date, dateFromSource, structuredBy: 'rules', error });

    try {
        let rawText = '';
        let sourceDate: string | null = null;

        if (input.kind === 'excel') {
            if (!input.buffer?.length) return fail('The file is empty.');
            let grid: SheetGrid;
            try { grid = await readFirstSheet(input.buffer); }
            catch { return fail('I could not open that Excel file. Please send a .xlsx file.'); }
            if (!grid.rows.length) return fail('That Excel file has no data.');
            sourceDate = grid.dateFromCells;
            const tasks = rowsByHeaders(grid.rows);
            if (tasks && tasks.length) {
                return { ok: true, kind: 'excel', tasks, date: sourceDate || today, dateFromSource: !!sourceDate, structuredBy: 'rules' };
            }
            rawText = grid.rows.map(r => r.filter(Boolean).join(' | ')).filter(Boolean).join('\n');
        } else if (input.kind === 'image') {
            if (!input.buffer?.length) return fail('The image is empty.');
            const transcript = (await llm.imageToText(input.buffer, input.mimeType || 'image/jpeg')).trim();
            if (!transcript || /^NO_TASKS\b/i.test(transcript)) return fail('I could not find a task list in that image.');
            rawText = transcript;
        } else {
            rawText = String(input.text ?? '').trim();
            if (!rawText) return fail('There is no text to read.');
        }

        rawText = rawText.slice(0, MAX_TEXT_LENGTH);
        sourceDate = sourceDate || findDateInText(rawText.split('\n').slice(0, 3).join(' '));
        const date = sourceDate || today;

        // Rules first: a clean image table, or plain numbered/bulleted text; otherwise the one AI structuring call.
        if (input.kind === 'image') {
            const byTable = rowsByPipeTable(rawText);
            if (byTable && byTable.length) return { ok: true, kind: 'image', tasks: byTable, date, dateFromSource: !!sourceDate, structuredBy: 'rules' };
        }
        if (input.kind === 'text') {
            const byLines = rowsByLines(rawText);
            if (byLines && byLines.length) return { ok: true, kind: 'text', tasks: byLines, date, dateFromSource: !!sourceDate, structuredBy: 'rules' };
        }
        const tasks = sanitizeTasks(await llm.structureText(rawText));
        if (!tasks.length) return fail('I could not find any tasks in that.', date, !!sourceDate);
        return { ok: true, kind: input.kind, tasks, date, dateFromSource: !!sourceDate, structuredBy: 'llm' };
    } catch (err) {
        console.warn('[TaskImportParser] parse failed:', err instanceof Error ? err.message : err);
        return fail('Sorry, I had trouble reading that. Please try again or send a clearer file.');
    }
}
