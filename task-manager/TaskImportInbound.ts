import { normalizeInbound } from '@/backend/lib/whatsapp/assistant/protocol.mjs';
import type { AccessDecision } from './TaskAccessService';
import type { Employee, TestingConfig } from './types';
import type { ParseInput } from './TaskImportParser';
import {
    ImportClaim, ImportDeps, IMPORT_TEXT, TaskImportService, captionMentionsTasks, looksLikeImportText,
} from './TaskImportService';

/**
 * Task Import — Stage 2: the webhook adapter.
 *
 * `claimTaskImport(body)` is called FIRST by the AiSensy webhook. It answers one question:
 * "is this inbound message part of a task import?"
 *   • not ours  → { handled:false } and the webhook carries on EXACTLY as it did before.
 *   • ours      → { handled:true } (+ optional slow `background` work to run after the webhook has answered).
 *
 * It is deliberately quiet for everyone it does not apply to: switch OFF, not a registered employee,
 * Task Manager locked for them, or outside the sandbox → handled:false, no reply, no side effect.
 * Any error BEFORE a message is claimed also means handled:false (the old behaviour is the safe default).
 */

// ── Reading the AiSensy payload (own code: the shared parser is left untouched) ──

export type MediaClass = 'text' | 'image' | 'document' | 'other';

export interface InboundCandidate {
    phone: string;
    messageId: string;
    text: string;
    mediaUrl: string | null;
    mediaClass: MediaClass;
    fileName: string | null;
    mimeType: string | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const first = (...v: unknown[]): string => v.map(str).find(Boolean) || '';

export function extractCandidate(body: unknown): InboundCandidate | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const b = body as any;
    const data = b.data || b.payload || b;
    const msg = data.messages?.[0] || data.message || {};
    const doc = msg.document || data.document || msg.message_content?.document || {};

    const docUrl = first(doc.url, doc.link, doc.mediaUrl, doc.media_url);
    // The shared parser ignores a message with no text and no URL it recognises; hand it the document URL so
    // a caption-less Excel file still yields a phone number and message id.
    const normalized: any = normalizeInbound(!str(b.mediaUrl) && docUrl ? { ...b, mediaUrl: docUrl } : b);
    if (!normalized) return null;

    const fileName = first(doc.filename, doc.fileName, doc.file_name, msg.filename, msg.fileName, data.filename, data.fileName,
        msg.message_content?.filename, msg.message_content?.fileName) || null;
    const mimeType = first(doc.mime_type, doc.mimeType, msg.mime_type, msg.mimeType, data.mime_type, data.mimeType,
        msg.message_content?.mime_type, msg.message_content?.mimeType).toLowerCase() || null;

    const type = String(normalized.mediaType || 'text').toLowerCase();
    const mediaUrl: string | null = normalized.mediaUrl || docUrl || null;
    let mediaClass: MediaClass = 'text';
    if (mediaUrl) {
        if (type === 'image') mediaClass = 'image';
        else if (type === 'video' || type === 'audio' || type === 'sticker' || type === 'voice' || type === 'ptt') mediaClass = 'other';
        else mediaClass = 'document';
    }
    return { phone: normalized.phone, messageId: normalized.messageId || '', text: normalized.text || '', mediaUrl, mediaClass, fileName, mimeType };
}

// ── Who may use it ───────────────────────────────────────────────────────────

export type EligibilityReason = 'ok' | 'department_off' | 'not_employee' | 'locked' | 'outside_sandbox';

const last10 = (p: string) => String(p || '').replace(/\D/g, '').slice(-10);

/**
 * Pure decision. A registered employee whose department has TASK IMPORT switched ON (Control Center, one button
 * per department) AND who is unlocked for the Task Manager itself (department ON + kickoff recorded).
 * No department is named in code. While the SANDBOX is ON, only the sandbox numbers pass.
 */
export function decideImportEligibility(
    config: Pick<TestingConfig, 'enabled' | 'manager' | 'employees'>,
    phone: string,
    employee: Pick<Employee, 'id' | 'department_id'> | null,
    access: Pick<AccessDecision, 'allowed'> | null,
    importDepartments: ReadonlySet<string>
): { ok: boolean; reason: EligibilityReason } {
    if (!employee) return { ok: false, reason: 'not_employee' };
    if (!employee.department_id || !importDepartments.has(employee.department_id)) return { ok: false, reason: 'department_off' };
    if (!access?.allowed) return { ok: false, reason: 'locked' };
    if (config.enabled) {
        const me = last10(phone);
        const inSandbox = (config.manager?.phone && last10(config.manager.phone) === me)
            || (config.employees || []).some(e => e.phone && last10(e.phone) === me);
        if (!inSandbox) return { ok: false, reason: 'outside_sandbox' };
    }
    return { ok: true, reason: 'ok' };
}

// ── Downloading what was sent (bounded, https only) ──────────────────────────

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MEDIA_TIMEOUT_MS = 25_000;
const MAX_REDIRECTS = 3;

export type MediaFetchResult = { ok: true; buffer: Buffer; contentType: string } | { ok: false; error: string };

/** https only; no localhost, internal names or raw IP addresses (a provider URL is a name on a CDN). */
export function isSafeMediaUrl(raw: string): boolean {
    let u: URL;
    try { u = new URL(raw); } catch { return false; }
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.includes(':')) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
    return true;
}

export async function fetchMediaSafely(url: string, fetchImpl: typeof fetch = fetch): Promise<MediaFetchResult> {
    try {
        let current = url;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            if (!isSafeMediaUrl(current)) return { ok: false, error: 'unsafe url' };
            const res = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) });
            if (res.status >= 300 && res.status < 400) {
                const loc = res.headers.get('location');
                if (!loc) return { ok: false, error: 'redirect without location' };
                current = new URL(loc, current).toString();
                continue;
            }
            if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
            const declared = Number(res.headers.get('content-length') || 0);
            if (declared > MAX_MEDIA_BYTES) return { ok: false, error: 'file too large' };

            const chunks: Buffer[] = [];
            let total = 0;
            const reader = res.body?.getReader();
            if (!reader) return { ok: false, error: 'empty body' };
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.byteLength;
                if (total > MAX_MEDIA_BYTES) { await reader.cancel().catch(() => undefined); return { ok: false, error: 'file too large' }; }
                chunks.push(Buffer.from(value));
            }
            if (!total) return { ok: false, error: 'empty file' };
            return { ok: true, buffer: Buffer.concat(chunks), contentType: (res.headers.get('content-type') || '').toLowerCase() };
        }
        return { ok: false, error: 'too many redirects' };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'download failed' };
    }
}

export type SniffedKind = { kind: 'excel' } | { kind: 'image'; mimeType: string } | { kind: 'pdf' } | { kind: 'old_excel' } | { kind: 'unknown' };

/** What the BYTES are, regardless of what the payload claimed. */
export function sniffKind(buf: Buffer): SniffedKind {
    if (buf.length < 4) return { kind: 'unknown' };
    if (buf.slice(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf' };
    if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return { kind: 'excel' }; // zip (xlsx; a docx fails later, gracefully)
    if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return { kind: 'old_excel' };
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'image', mimeType: 'image/jpeg' };
    if (buf[0] === 0x89 && buf.slice(1, 4).toString('latin1') === 'PNG') return { kind: 'image', mimeType: 'image/png' };
    if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return { kind: 'image', mimeType: 'image/webp' };
    return { kind: 'unknown' };
}

const UNSUPPORTED_TEXT = 'I can read images, Excel (.xlsx) files and text. I couldn\'t use that file. Please send your list in one of those.';
const DOWNLOAD_FAILED_TEXT = 'I couldn\'t download that file. Please send it again.';

async function loadMedia(url: string, io: InboundIO): Promise<ParseInput | { error: string }> {
    const got = await io.fetchMedia(url);
    if (!got.ok) return { error: DOWNLOAD_FAILED_TEXT };
    const sniffed = sniffKind(got.buffer);
    switch (sniffed.kind) {
        case 'excel': return { kind: 'excel', buffer: got.buffer };
        case 'image': return { kind: 'image', buffer: got.buffer, mimeType: sniffed.mimeType };
        case 'pdf': return { error: IMPORT_TEXT.PDF };
        case 'old_excel': return { error: 'That is an old-format Excel file (.xls). Please save it as .xlsx and send it again.' };
        default: return { error: UNSUPPORTED_TEXT };
    }
}

// ── The claim ────────────────────────────────────────────────────────────────

export interface InboundIO {
    importDeps: ImportDeps;
    /** Sandbox settings (who may test while the sandbox is ON). */
    getConfig(): Promise<TestingConfig>;
    /** Departments with Task Import switched ON. Empty when none, or when it cannot be read (fail closed). */
    getImportDepartments(): Promise<ReadonlySet<string>>;
    getEmployee(phone: string): Promise<Employee | null>;
    checkAccess(employee: Employee): Promise<AccessDecision>;
    fetchMedia(url: string): Promise<MediaFetchResult>;
    /** Duplicate-delivery guard for claimed messages only (never marks a message we did not claim). */
    seenBefore(messageId: string): boolean;
    markSeen(messageId: string): void;
}

const NOT_HANDLED: ImportClaim = { handled: false };
const HANDLED: ImportClaim = { handled: true };

export async function claimTaskImport(body: unknown, io?: InboundIO): Promise<ImportClaim> {
    let cand: InboundCandidate | null;
    try { cand = extractCandidate(body); } catch { return NOT_HANDLED; }
    if (!cand || cand.mediaClass === 'other') return NOT_HANDLED;

    const real = io ?? await defaultInboundIO();
    const deps = real.importDeps;

    try {
        // Cheap checks first: ordinary chat never costs a database read.
        if (cand.mediaClass === 'text' && !looksLikeImportText(cand.text, deps.today())) return NOT_HANDLED;

        // One small read first: while no department has Task Import ON (the default), nothing else is read.
        const importDepartments = await real.getImportDepartments();
        if (importDepartments.size === 0) return NOT_HANDLED;
        const employee = await real.getEmployee(cand.phone);
        if (!employee?.department_id || !importDepartments.has(employee.department_id)) return NOT_HANDLED;
        const access = await real.checkAccess(employee);
        const config = await real.getConfig();
        if (!decideImportEligibility(config, cand.phone, employee, access, importDepartments).ok) return NOT_HANDLED;

        if (cand.messageId && real.seenBefore(cand.messageId)) return HANDLED; // a repeat delivery of something we already took

        const claim = await route(cand, real);
        if (claim.handled && cand.messageId) real.markSeen(cand.messageId);
        return claim;
    } catch (err) {
        console.warn('[TaskImportInbound] not handled, falling back to the normal flow:', err instanceof Error ? err.message : err);
        return NOT_HANDLED;
    }
}

async function route(cand: InboundCandidate, io: InboundIO): Promise<ImportClaim> {
    const deps = io.importDeps;

    if (cand.mediaClass === 'text') return TaskImportService.handleText(cand.phone, cand.text, deps);

    const url = cand.mediaUrl as string;

    if (cand.mediaClass === 'image') {
        // A photo may be a facility ticket. Only take it when the caption talks about tasks, or they said "add tasks" first.
        const awaiting = await TaskImportService.isAwaiting(cand.phone, deps);
        if (!awaiting && !captionMentionsTasks(cand.text)) return NOT_HANDLED;
        if (await TaskImportService.busy(cand.phone, deps)) return HANDLED;
        if (!isSafeMediaUrl(url)) { await deps.reply(cand.phone, DOWNLOAD_FAILED_TEXT); return HANDLED; }
        return TaskImportService.begin(cand.phone, { label: 'image', load: () => loadMedia(url, io) }, deps);
    }

    // A document (Excel, PDF, …) is never a facility request, so any eligible document is ours.
    if (await TaskImportService.busy(cand.phone, deps)) return HANDLED;
    const name = (cand.fileName || '').toLowerCase();
    if (/\.pdf$/.test(name) || cand.mimeType === 'application/pdf') { await deps.reply(cand.phone, IMPORT_TEXT.PDF); return HANDLED; }
    if (!isSafeMediaUrl(url)) { await deps.reply(cand.phone, DOWNLOAD_FAILED_TEXT); return HANDLED; }
    const label = /\.xlsx?$/.test(name) || /spreadsheet|excel/.test(cand.mimeType || '') ? 'Excel file' : 'file';
    return TaskImportService.begin(cand.phone, { label, load: () => loadMedia(url, io) }, deps);
}

// ── The real wiring (loaded lazily so tests never touch the database) ────────

const seen = new Map<string, number>();
const SEEN_TTL_MS = 15 * 60 * 1000;

export async function defaultInboundIO(): Promise<InboundIO> {
    const { TaskDatabaseService } = await import('./TaskDatabaseService');
    const { TaskAccessService } = await import('./TaskAccessService');
    const { TaskMessagingService } = await import('./TaskMessagingService');
    const { TaskAuditService } = await import('./TaskAuditService');
    const { parseTaskImport, todayInIndia } = await import('./TaskImportParser');
    const { saveImportedTasks, buildSaveIO } = await import('./TaskImportSave');

    const importDeps: ImportDeps = {
        async getContext(phone) {
            const c = await TaskDatabaseService.getConversationContext(phone, 'TASK_MANAGER');
            return c ? { type: c.context_type, data: c.context_data } : null;
        },
        async setContext(phone, type, data, ttlMinutes) {
            await TaskDatabaseService.setConversationContext({ phone, system: 'TASK_MANAGER', contextType: type, contextData: data, ttlMinutes });
        },
        async clearContext(phone) {
            // Only ever clear OUR state, never another Task Manager conversation.
            const c = await TaskDatabaseService.getConversationContext(phone, 'TASK_MANAGER');
            if (c && String(c.context_type).startsWith('IMPORT_')) await TaskDatabaseService.clearConversationContext(phone, 'TASK_MANAGER');
        },
        async reply(phone, text) {
            // Freeform only (the person just messaged us, so the 24-hour window is open). Gated: kill switches + Pretend Mode.
            await TaskMessagingService.sendFreeformReply(phone, text);
        },
        parse: input => parseTaskImport(input),
        async audit(event, phone, details) {
            await TaskDatabaseService.logAudit({ eventType: event, details: { phoneMasked: TaskAuditService.maskPhone(phone), ...details } });
        },
        today: () => todayInIndia(),
        // Stage 3: runs only after the person replied YES. Saves to the sender's OWN list (resolved again from their phone).
        async save(phone, draft) {
            const employee = await TaskDatabaseService.getEmployeeByPhone(phone);
            if (!employee) throw new Error('employee not found');
            return saveImportedTasks({ employeeId: employee.id, draft }, buildSaveIO(TaskDatabaseService));
        },
    };

    return {
        importDeps,
        getConfig: () => TaskDatabaseService.getTestingConfig(),
        getImportDepartments: async () => (await TaskAccessService.getTaskImportDepartments()).departments,
        getEmployee: phone => TaskDatabaseService.getEmployeeByPhone(phone),
        checkAccess: employee => TaskAccessService.check({ userId: employee.id, departmentId: employee.department_id }),
        fetchMedia: url => fetchMediaSafely(url),
        seenBefore: id => { const t = seen.get(id); return !!t && Date.now() - t < SEEN_TTL_MS; },
        markSeen: id => {
            const now = Date.now();
            seen.set(id, now);
            if (seen.size > 1000) seen.forEach((ts, k) => { if (now - ts > SEEN_TTL_MS) seen.delete(k); });
        },
    };
}
