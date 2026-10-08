import { TaskDatabaseService } from './TaskDatabaseService';
import { ControlledTaskTools } from './ControlledTaskTools';
import { SuperuserAIAssistant } from './SuperuserAIAssistant';
import { InsightDecision, matchByName } from './TaskGateway';
import { Employee } from './types';

/**
 * Superuser read-only lookups ("how is Procurement doing?", "what is Dev working on?", "who has pending tasks?").
 * Reuses the existing role-guarded tools and the existing WhatsApp formatter. Reads only; changes nothing.
 *
 * Names are matched against the REAL department and people lists. When several match (two Rajeshes, or two
 * departments with the same name) it returns the choices so the superuser can pick, instead of guessing.
 */

export interface PickOption {
    type: 'department' | 'person';
    id: string;
    label: string;
}

export type InsightResult =
    | { kind: 'reply'; text: string; tool: string }
    | { kind: 'pick'; prompt: string; options: PickOption[] };

const MAX_OPTIONS = 8;
const MAX_TASK_LINES = 12;

export const SUPERUSER_GUIDE = [
    `🛡️ *You are a Superuser*`,
    ``,
    `You can see and assign tasks across every department. Just write normally:`,
    ``,
    `📊 *Ask*`,
    `• "How is Procurement doing today?"`,
    `• "What is Dev working on?"`,
    `• "Who has pending tasks?"`,
    `• "How is everyone doing?"`,
    ``,
    `✅ *Assign* (I'll ask you to confirm first)`,
    `• "Give Satej a task to call vendor X"`,
    `• "Ask Priya to send the quotation"`,
    ``,
    `📋 *Your own tasks*`,
    `• "What do I have today?", "I finished the vendor call"`,
    ``,
    `If two people share a name I'll ask which one you mean.`,
].join('\n');

export class SuperuserInsights {
    static async run(params: {
        actor: Employee;
        decision: InsightDecision;
        date?: string;
        picked?: { type: 'department' | 'person'; id: string };
        question?: string;
    }): Promise<InsightResult> {
        const { actor, decision, date } = params;
        const done = async (tool: string, data: unknown): Promise<InsightResult> => {
            await TaskDatabaseService.logAudit({
                eventType: 'ai_tool_call',
                actorId: actor.id,
                details: { toolUsed: tool, query: params.question || decision.kind, date: date || null, channel: 'whatsapp' },
            });
            const text = await SuperuserAIAssistant.formatReply({ question: params.question || '', toolUsed: tool, data, date: date || new Date().toISOString().slice(0, 10) });
            return { kind: 'reply', text, tool };
        };

        if (decision.kind === 'pending_tasks') return done('get_pending_tasks', await ControlledTaskTools.get_pending_tasks(actor, { date }));
        if (decision.kind === 'org_overview') return done('get_organisation_progress', await ControlledTaskTools.get_organisation_progress(actor, { date }));

        // From here a department or a person is needed
        let target = params.picked || null;
        if (!target) {
            const subject = (decision.subject || '').trim();
            if (!subject) return { kind: 'reply', tool: 'none', text: `Which department or person do you mean?` };

            const departments = await TaskDatabaseService.getDepartments();
            const people = await TaskDatabaseService.getAllEmployees();
            const deptMatches = matchByName(subject, departments);
            const peopleMatches = matchByName(subject, people);
            const exactDept = deptMatches.filter(d => d.name.toLowerCase() === subject.toLowerCase());

            let candidates: PickOption[] = [];
            if (decision.kind === 'department_progress' || decision.kind === 'department_tasks') {
                candidates = deptMatches.map(d => ({ type: 'department' as const, id: d.id, label: d.name }));
            } else if (decision.kind === 'person_tasks') {
                candidates = peopleMatches.map(p => ({ type: 'person' as const, id: p.id, label: `${p.name}${p.department_name ? ` (${p.department_name})` : ''}` }));
            } else if (exactDept.length > 0) {
                // "Procurement" is a department even if someone is also called Procure...
                candidates = exactDept.map(d => ({ type: 'department' as const, id: d.id, label: d.name }));
            } else if (peopleMatches.length > 0) {
                candidates = peopleMatches.map(p => ({ type: 'person' as const, id: p.id, label: `${p.name}${p.department_name ? ` (${p.department_name})` : ''}` }));
            } else {
                candidates = deptMatches.map(d => ({ type: 'department' as const, id: d.id, label: d.name }));
            }

            if (candidates.length === 0) {
                const names = departments.map(d => d.name).slice(0, 20).join(', ');
                return { kind: 'reply', tool: 'none', text: `I couldn't find "${subject}" as a department or a person.\n\nDepartments: ${names}` };
            }
            if (candidates.length > 1) {
                const shown = candidates.slice(0, MAX_OPTIONS);
                const lines = shown.map((c, i) => `${i + 1}. ${c.label}`).join('\n');
                const more = candidates.length > MAX_OPTIONS ? `\n…and ${candidates.length - MAX_OPTIONS} more. Try a fuller name.` : '';
                return { kind: 'pick', options: shown, prompt: `Which one do you mean?\n\n${lines}${more}\n\nReply with the number.` };
            }
            target = { type: candidates[0].type, id: candidates[0].id };
        }

        if (target.type === 'person') {
            return done('get_employee_tasks', await ControlledTaskTools.get_employee_tasks(actor, { nameOrPhone: target.id, date }));
        }

        // A department: how it is doing, plus what is still open (kept short for WhatsApp)
        const progress = await ControlledTaskTools.get_department_progress(actor, { departmentNameOrId: target.id, date });
        const tasks = await ControlledTaskTools.get_department_tasks(actor, { departmentNameOrId: target.id, date });
        const first = await done('get_department_progress', progress);
        if (first.kind !== 'reply' || 'error' in (tasks as object)) return first;

        const open = ((tasks as { tasks: Array<{ status: string }> }).tasks || []).filter(t => t.status !== 'completed');
        if (open.length === 0) return first;
        const trimmed = { ...(tasks as object), tasks: open.slice(0, MAX_TASK_LINES) };
        const extra = await SuperuserAIAssistant.formatReply({ question: params.question || '', toolUsed: 'get_department_tasks', data: trimmed, date: date || new Date().toISOString().slice(0, 10) });
        const more = open.length > MAX_TASK_LINES ? `\n…and ${open.length - MAX_TASK_LINES} more open.` : '';
        return { kind: 'reply', tool: 'get_department_progress', text: `${first.text}\n\n${extra}${more}` };
    }
}
