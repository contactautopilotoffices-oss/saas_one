import type { ReplyFacts } from './domain';
import { composeReply } from './respond';
import { knownWordsFrom } from './respond';
import type { BrainLlm } from './llm';
import { BRAIN_REPLY_MODELS } from './llm';
import type { ProgressState } from './types';

/**
 * Working with a superuser — telling the right people what his reply MEANT.
 *
 * When he answers a request ("working on it", "done", "stuck waiting for the vendor"), the person who gave him each task hears
 * what he meant, in a short natural sentence written fresh each time. His own words are NEVER forwarded: the brain's summary of
 * the meaning is all that travels. Each person is told only about THEIR tasks; nobody is told about anyone else's.
 */

const PHRASE: Record<ProgressState, string | null> = {
    working: 'is working on', partly_done: 'has made progress on', blocked: 'is stuck on',
    done_all: 'has finished', done_some: 'has finished', other: null,
};

const bullets = (titles: string[]) => titles.map(t => `• ${t}`).join('\n');

export function relayFacts(p: { assignerName: string; actorName: string; state: ProgressState; titles: string[]; note: string | null }): ReplyFacts | null {
    const phrase = PHRASE[p.state];
    if (!phrase) return null;
    const unfinished = p.state === 'partly_done' ? ' (not finished yet)' : '';
    const note = p.note ? ` (${p.note})` : '';
    return {
        kind: `relay_${p.state}`,
        describe: `Write a short message to ${p.assignerName}, a colleague, saying that ${p.actorName} ${phrase} the tasks listed below${unfinished}. `
            + `Say it in your own words as a summary of what was meant, never as a quote.${p.note ? ` Also pass on, in your own words, that: ${p.note}.` : ''} Use names, never he or she.`,
        values: { tasks: bullets(p.titles) },
        required: ['tasks'],
        asksQuestion: false,
        claimsNothingDone: false,
        names: [p.assignerName, p.actorName],
        fallback: `${p.actorName} ${phrase} ${p.titles.length === 1 ? 'this task' : 'these tasks'}${unfinished}${note}:\n${bullets(p.titles)}`,
    };
}

export interface RelayTask { id: string; title: string; assigned_by: string | null }
export interface RelayPerson { id: string; name: string; phone_number: string; department_name: string | null; active: boolean }

export interface RelayIO {
    tasksByIds(ids: string[]): Promise<RelayTask[]>;
    getPerson(id: string): Promise<RelayPerson | null>;
    /** Writes the message (AI, fact-checked, with a plain fallback). */
    compose(facts: ReplyFacts, known: Set<string>): Promise<string>;
    /** Sends through the safety gate (kill switches, Pretend Mode); outside the 24-hour window the approved template is used. */
    send(phone: string, text: string, from: string): Promise<boolean>;
    audit(details: Record<string, unknown>): Promise<void>;
}

export interface RelayResult { told: string[]; couldNot: string[] }

export async function relayToAssigners(
    input: { actor: RelayPerson; taskIds: string[]; state: ProgressState; note: string | null; titles?: Record<string, string> },
    io: RelayIO
): Promise<RelayResult> {
    const out: RelayResult = { told: [], couldNot: [] };
    if (!PHRASE[input.state]) return out;

    const tasks = await io.tasksByIds(input.taskIds);
    const byAssigner = new Map<string, string[]>();
    for (const t of tasks) {
        if (!t.assigned_by || t.assigned_by === input.actor.id) continue; // nobody to tell for tasks he gave himself
        byAssigner.set(t.assigned_by, [...(byAssigner.get(t.assigned_by) || []), input.titles?.[t.id] ?? t.title]);
    }

    for (const [assignerId, titles] of byAssigner) {
        const who = await io.getPerson(assignerId);
        if (!who || !who.active) continue;
        try {
            const facts = relayFacts({ assignerName: who.name, actorName: input.actor.name, state: input.state, titles, note: input.note });
            if (!facts) continue;
            const text = await io.compose(facts, knownWordsFrom([who.name, input.actor.name, input.note, ...titles]));
            const from = input.actor.department_name ? `${input.actor.name} (${input.actor.department_name})` : input.actor.name;
            const ok = !!who.phone_number && await io.send(who.phone_number, text, from);
            (ok ? out.told : out.couldNot).push(who.name);
            await io.audit({ assignerId, actorId: input.actor.id, state: input.state, count: titles.length, delivered: ok });
        } catch {
            out.couldNot.push(who.name);
        }
    }
    return out;
}

/** The real wiring. */
export async function defaultRelayIO(llm: BrainLlm): Promise<RelayIO> {
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskMessagingService } = await import('../TaskMessagingService');
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
        async compose(facts, known) {
            return (await composeReply({ llm, models: BRAIN_REPLY_MODELS, facts, userMessage: '', known })).text;
        },
        send: (phone, text) => TaskMessagingService.sendMessage(phone, text, { messageType: 'task_update', freeformOnly: true }), // no template: only inside the 24-hour window
        audit: details => TaskDatabaseService.logAudit({ eventType: 'task_reply_relayed', details }),
    };
}
