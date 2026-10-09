import type { ParsedTask } from './TaskImportParser';
import type { TaskStatus } from './types';
import type { ImportDraft, SaveOutcome } from './TaskImportService';

/**
 * Task Import — Stage 3: the save step (confirm → save).
 *
 * Runs ONLY after the person has replied YES to the preview. Pure logic: every database touch comes in
 * through `SaveIO`, so the rules (what is written, what counts as a duplicate, what happens on a partial
 * failure) are testable offline. The real wiring is in TaskImportInbound.ts.
 *
 * The task table has no site / remark / final-status columns, so those go into the description as plain lines.
 */

export interface ExistingTask { title: string; description: string | null }

export interface SaveIO {
    /** The person's tasks already on that date (used only to skip duplicates). */
    listExisting(employeeId: string, date: string): Promise<ExistingTask[]>;
    /** Creates ONE task; returns its id. Throws on failure. */
    create(input: {
        employeeId: string; title: string; description: string | null; assignedDate: string;
        status: TaskStatus; assignedBy: string;
    }): Promise<{ id: string }>;
    /** One audit row per created task (same shape the web Tasks tab writes). */
    auditCreated(input: { employeeId: string; taskId: string; title: string; date: string; source: string }): Promise<void>;
}

/** The slice of TaskDatabaseService the save step needs (so tests can pass a fake). */
export interface SaveDb {
    getDailyAssignments(p: { employeeId: string; date?: string }): Promise<Array<{ title: string; description: string | null }>>;
    createTaskAssignment(p: {
        employeeId: string; title: string; description?: string; assignedDate?: string; assignedBy?: string; status?: TaskStatus;
    }): Promise<{ id: string }>;
    logAudit(p: { eventType: string; actorId?: string | null; targetEmployeeId?: string | null; taskId?: string | null; details?: Record<string, any> }): Promise<void>;
}

/** Maps the save step onto the EXISTING task functions — no new database logic. */
export function buildSaveIO(db: SaveDb): SaveIO {
    return {
        listExisting: async (employeeId, date) =>
            (await db.getDailyAssignments({ employeeId, date })).map(t => ({ title: t.title, description: t.description })),
        create: i => db.createTaskAssignment({
            employeeId: i.employeeId, title: i.title, description: i.description ?? undefined,
            assignedDate: i.assignedDate, assignedBy: i.assignedBy, status: i.status,
        }),
        auditCreated: i => db.logAudit({
            eventType: 'task_assigned', actorId: i.employeeId, targetEmployeeId: i.employeeId, taskId: i.taskId,
            details: { title: i.title, assignedDate: i.date, via: i.source },
        }),
    };
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Plain, readable lines — also what the duplicate check reads the site back from. */
export function buildDescription(t: Pick<ParsedTask, 'site' | 'remark' | 'finalStatus'>): string | null {
    const lines = [
        t.site ? `Site: ${t.site}` : '',
        t.remark ? `Remark: ${t.remark}` : '',
        t.finalStatus ? `Final status: ${t.finalStatus}` : '',
    ].filter(Boolean);
    return lines.length ? lines.join('\n') : null;
}

function siteOf(description: string | null): string {
    const m = (description || '').match(/^Site:\s*(.+)$/im);
    return m ? m[1] : '';
}

/**
 * A task is "already there" when the person has a task on that date with the same title AND the same site.
 * (Same title at a different site is a different job — e.g. "Chair Inspection" at Sigma vs ETPL.)
 */
export function taskKey(title: string, site: string | null | undefined): string {
    return `${norm(title)}|${norm(site)}`;
}

export async function saveImportedTasks(
    params: { employeeId: string; draft: ImportDraft; source?: string },
    io: SaveIO
): Promise<SaveOutcome> {
    const { employeeId, draft } = params;
    const source = params.source || 'whatsapp_import';

    // Snapshot BEFORE writing anything: new rows must not make later rows in the same list look like duplicates.
    const existing = await io.listExisting(employeeId, draft.date);
    const seen = new Set(existing.map(e => taskKey(e.title, siteOf(e.description))));

    const outcome: Required<SaveOutcome> = { saved: 0, skipped: 0, failed: 0, failedIndexes: [], taskIds: [] };

    for (let i = 0; i < draft.tasks.length; i++) {
        const t = draft.tasks[i];
        const key = taskKey(t.title, t.site);
        if (seen.has(key)) { outcome.skipped++; continue; }
        try {
            const row = await io.create({
                employeeId, title: t.title, description: buildDescription(t), assignedDate: draft.date,
                // New work always lands in To do; finished rows stay finished
                status: t.status === 'in_progress' ? 'pending' : t.status, assignedBy: employeeId,
            });
            seen.add(key);
            outcome.saved++;
            outcome.taskIds.push(row.id);
            // Audit is best-effort: a missing audit row must never undo or fail a task that was saved.
            await io.auditCreated({ employeeId, taskId: row.id, title: t.title, date: draft.date, source }).catch(() => undefined);
        } catch (err) {
            console.warn('[TaskImportSave] could not save one task:', err instanceof Error ? err.message : err);
            outcome.failed++;
            outcome.failedIndexes.push(i);
        }
    }
    return outcome;
}
