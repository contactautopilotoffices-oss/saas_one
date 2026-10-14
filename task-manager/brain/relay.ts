import type { ProgressState } from './types';

/**
 * Working with a superuser — telling the right people what his reply MEANT.
 *
 * When he answers a request ("working on it", "done", "stuck waiting for the vendor"), the person who gave him each task hears
 * what he meant, as the approved `task_update_v2` template ("Task / Assigned to / Update"). The Update line is built here from
 * the brain's understanding (the state, plus its one-line summary note) — his own words are NEVER forwarded, and no AI writes
 * free text that could invent anything. Each person is told only about THEIR tasks; nobody is told about anyone else's.
 */

const UPDATE: Record<ProgressState, string | null> = {
    working: 'Working on it', partly_done: 'Made progress, not finished yet', blocked: 'Stuck',
    done_all: 'Finished ✅', done_some: 'Finished ✅', other: null,
};

/** The template's Update line, e.g. "Working on it — two more days needed". Null for an unclear state (nothing is sent). */
export function relayUpdateLine(state: ProgressState, note: string | null): string | null {
    const base = UPDATE[state];
    if (!base) return null;
    const n = String(note ?? '').replace(/\s+/g, ' ').trim();
    return n ? `${base} — ${n}` : base;
}

export interface RelayTask { id: string; title: string; assigned_by: string | null }
export interface RelayPerson { id: string; name: string; phone_number: string; department_name: string | null; active: boolean }

export interface RelayIO {
    tasksByIds(ids: string[]): Promise<RelayTask[]>;
    getPerson(id: string): Promise<RelayPerson | null>;
    /** Sends through the safety gate (kill switches, Pretend Mode) as the approved `task_update_v2` template. */
    send(phone: string, update: string, from: string, titles: string[]): Promise<boolean>;
    audit(details: Record<string, unknown>): Promise<void>;
}

export interface RelayResult { told: string[]; couldNot: string[] }

export async function relayToAssigners(
    input: { actor: RelayPerson; taskIds: string[]; state: ProgressState; note: string | null; titles?: Record<string, string> },
    io: RelayIO
): Promise<RelayResult> {
    const out: RelayResult = { told: [], couldNot: [] };
    const update = relayUpdateLine(input.state, input.note);
    if (!update) return out;

    const tasks = await io.tasksByIds(input.taskIds);
    const byAssigner = new Map<string, string[]>();
    for (const t of tasks) {
        if (!t.assigned_by || t.assigned_by === input.actor.id) continue; // nobody to tell for tasks he gave himself
        byAssigner.set(t.assigned_by, [...(byAssigner.get(t.assigned_by) || []), input.titles?.[t.id] ?? t.title]);
    }

    const from = input.actor.department_name ? `${input.actor.name} (${input.actor.department_name})` : input.actor.name;
    for (const [assignerId, titles] of byAssigner) {
        const who = await io.getPerson(assignerId);
        if (!who || !who.active) continue;
        try {
            const ok = !!who.phone_number && await io.send(who.phone_number, update, from, titles);
            (ok ? out.told : out.couldNot).push(who.name);
            await io.audit({ assignerId, actorId: input.actor.id, state: input.state, count: titles.length, delivered: ok });
        } catch {
            out.couldNot.push(who.name);
        }
    }
    return out;
}

/** The real wiring. */
export async function defaultRelayIO(): Promise<RelayIO> {
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { sendTaskUpdate } = await import('../taskAlerts');
    return {
        async tasksByIds(ids) {
            const { data, error } = await supabaseAdmin.from('task_assignments').select('id, title, assigned_by').in('id', ids);
            if (error) throw error;
            return (data || []) as RelayTask[];
        },
        async getPerson(id) {
            const e = await TaskDatabaseService.getEmployeeById(id);
            return e ? { id: e.id, name: e.name, phone_number: e.phone_number, department_name: e.department_name, active: e.active } : null;
        },
        // Approved template ("Update regarding a task you assigned"), so it also reaches people outside the 24-hour window.
        send: (phone, update, from, titles) => sendTaskUpdate(phone, { titles, assigneeLabel: from, update, messageType: 'task_update' }),
        audit: details => TaskDatabaseService.logAudit({ eventType: 'task_reply_relayed', details }),
    };
}
