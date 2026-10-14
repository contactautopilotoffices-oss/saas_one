import { TaskMessagingService } from './TaskMessagingService';

/**
 * Event alerts (a task was assigned / handed over / finished / a superuser replied), sent ONLY as Meta-approved templates.
 * Free text is rejected by WhatsApp for anyone who has not messaged in the last 24 hours ("Re-engagement message"), and that
 * rejection arrives after AiSensy has already said OK, so a free-text-first send silently fails. Kill switches and Pretend
 * Mode still apply (everything goes through TaskMessagingService.sendMessage).
 *
 *   task_assigned_v1             Task: {{1}} · Assigned by: {{2}} · Date: {{3}}   (+ a "tasks" quick-reply button)
 *   task_update_v2               Task: {{1}} · Assigned to: {{2}} · Update: {{3}}   (a superuser's reply, relayed)
 *   task_handover_v1             Hello {{1}} · {{2}} handed over · Task: {{3}} · Target date: {{4}}
 *   task_completed_notice_v1     Hello {{1}} · Task: {{2}} · Completed by: {{3}} ({{4}}) · At: {{5}}
 *   task_manager_team_digest_v1  Hello {{1}} · scope {{2}} · Date {{3}} · Members {{4}} · Done {{5}} · Pending {{6}} · Status {{7}}
 *   task_overdue_alert_v1        (rule "Overdue alert", built in TaskNotificationService) Hello {{1}} · {{2}} overdue · {{3}}
 */

export const ASSIGNED_CAMPAIGN = process.env.AISENSY_TASK_ASSIGNED_CAMPAIGN || 'task_assigned_v1';
export const UPDATE_CAMPAIGN = process.env.AISENSY_TASK_UPDATE_CAMPAIGN || 'task_update_v2';
export const HANDOVER_CAMPAIGN = process.env.AISENSY_TASK_HANDOVER_CAMPAIGN || 'task_handover_v1';
export const COMPLETED_CAMPAIGN = process.env.AISENSY_TASK_COMPLETED_CAMPAIGN || 'task_completed_notice_v1';
export const TEAM_DIGEST_CAMPAIGN = process.env.AISENSY_TASK_TEAM_DIGEST_CAMPAIGN || 'task_manager_team_digest_v1';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One line: Meta rejects line breaks, tabs and long runs of spaces inside a template variable. */
export const oneLine = (s: unknown, max = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** "Priyanka (Procurement)", or just the name. */
export const personLabel = (name: string, department?: string | null) =>
    oneLine(department ? `${name} (${department})` : name, 100);

/** 2026-10-11 → "11 Oct 2026". Anything else is passed through. */
export function formatDate(date: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
    return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : oneLine(date, 30);
}

/** One task → its title. Several → "1. A | 2. B", cut with "…and N more" to stay short. */
export function taskList(titles: string[], max = 600): string {
    const clean = titles.map(t => oneLine(t, 120)).filter(Boolean);
    if (clean.length <= 1) return clean[0] || 'a task';
    let out = '';
    for (let i = 0; i < clean.length; i++) {
        const next = out ? `${out} | ${i + 1}. ${clean[i]}` : `1. ${clean[i]}`;
        if (next.length > max) return `${out} | …and ${clean.length - i} more`;
        out = next;
    }
    return out;
}

export function assignedParams(titles: string[], fromLabel: string, date: string): [string, string, string] {
    return [taskList(titles), oneLine(fromLabel, 100) || 'Your team', formatDate(date)];
}

export function updateParams(titles: string[], assigneeLabel: string, update: string): [string, string, string] {
    return [taskList(titles), oneLine(assigneeLabel, 100) || 'Someone', oneLine(update, 400) || 'Updated'];
}

/** What the person receives, filled in (used as the Pretend-Mode preview and in logs). */
export function assignedPreview(p: [string, string, string]): string {
    return `🔔 A new task has been assigned to you.\n\nTask: ${p[0]}\nAssigned by: ${p[1]}\nDate: ${p[2]}\n\nReply "tasks" to see your list and mark it done.`;
}

export function updatePreview(p: [string, string, string]): string {
    return `📌 Update regarding a task you assigned.\n\nTask: ${p[0]}\nAssigned to: ${p[1]}\nUpdate: ${p[2]}\nPlease review this update for your records.`;
}

const validPhone = (phone?: string | null): phone is string => !!phone && phone.trim().length >= 10;

/** "A new task has been assigned to you" — one message even for several tasks. Never throws. */
export async function sendTaskAssigned(phone: string | null | undefined, input: { titles: string[]; fromLabel: string; date: string; messageType?: string; departmentId?: string }): Promise<boolean> {
    if (!validPhone(phone) || input.titles.length === 0) return false;
    const params = assignedParams(input.titles, input.fromLabel, input.date);
    try {
        return await TaskMessagingService.sendMessage(phone, assignedPreview(params), {
            messageType: input.messageType || 'task_assigned', departmentId: input.departmentId,
            campaignName: ASSIGNED_CAMPAIGN, templateParams: params, templateOnly: true,
        });
    } catch (err) {
        console.error('[taskAlerts] Failed to send task-assigned alert:', err instanceof Error ? err.message : err);
        return false;
    }
}

/** "Update regarding a task you assigned" — to the person who GAVE the task(s). Never throws. */
export async function sendTaskUpdate(phone: string | null | undefined, input: { titles: string[]; assigneeLabel: string; update: string; messageType?: string; departmentId?: string }): Promise<boolean> {
    if (!validPhone(phone) || input.titles.length === 0) return false;
    const params = updateParams(input.titles, input.assigneeLabel, input.update);
    try {
        return await TaskMessagingService.sendMessage(phone, updatePreview(params), {
            messageType: input.messageType || 'task_update', departmentId: input.departmentId,
            campaignName: UPDATE_CAMPAIGN, templateParams: params, templateOnly: true,
        });
    } catch (err) {
        console.error('[taskAlerts] Failed to send task-update alert:', err instanceof Error ? err.message : err);
        return false;
    }
}

// ── task_handover_v1 · task_completed_notice_v1 · task_manager_team_digest_v1 ──────────────────────────────────────

/** "Vidya Nair" → "Vidya" (the templates greet by first name). */
export const firstName = (name: string | null | undefined) => oneLine(name, 60).split(' ')[0] || 'there';

/** A moment in India time, e.g. "11 Oct 2026, 04:30 PM". */
export function formatIstDateTime(at: Date): string {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).formatToParts(at);
    const g = (t: string) => p.find(x => x.type === t)?.value || '';
    return `${g('day')} ${g('month')} ${g('year')}, ${g('hour')}:${g('minute')} ${g('dayPeriod').toUpperCase()}`;
}

export function handoverParams(recipientName: string, fromLabel: string, titles: string[], date: string): [string, string, string, string] {
    return [firstName(recipientName), oneLine(fromLabel, 100) || 'A teammate', taskList(titles), formatDate(date)];
}
export function handoverPreview(p: [string, string, string, string]): string {
    return `🤝 Task Handed Over\n\nHello ${p[0]},\n${p[1]} has handed over a task to you:\n📋 Task: ${p[2]}\n📅 Target Date: ${p[3]}`;
}

export function completedParams(giverName: string, titles: string[], completedByName: string, department: string | null | undefined, at: Date): [string, string, string, string, string] {
    return [firstName(giverName), taskList(titles), oneLine(completedByName, 60) || 'A teammate', oneLine(department, 60) || 'No department', formatIstDateTime(at)];
}
export function completedPreview(p: [string, string, string, string, string]): string {
    return `✅ Task Completed\n\nHello ${p[0]},\nA task you assigned has been completed:\n📋 Task: ${p[1]}\n👤 Completed By: ${p[2]} (${p[3]})\n⏰ Completed At: ${p[4]}`;
}

export interface DigestRow { label: string; done: number; total: number }
/** One line for the template blank: "• Tech: 12/12 Done (100% ✅) | • Ops: 18/20 Done (2 Pending ⏳)". */
export function digestStatusList(rows: DigestRow[], max = 700): string {
    if (!rows.length) return 'No tasks today.';
    const items = rows.map(r => {
        const pending = Math.max(0, r.total - r.done);
        const tail = r.total === 0 ? 'no tasks' : pending === 0 ? '100% ✅' : `${pending} Pending ⏳`;
        return `• ${oneLine(r.label, 60)}: ${r.done}/${r.total} Done (${tail})`;
    });
    let out = '';
    for (let i = 0; i < items.length; i++) {
        const next = out ? `${out} | ${items[i]}` : items[i];
        if (next.length > max) return `${out} | …and ${items.length - i} more`;
        out = next;
    }
    return out;
}
export function teamDigestParams(input: { recipientName: string; scope: string; date: string; members: number; completed: number; pending: number; rows: DigestRow[] }): string[] {
    return [firstName(input.recipientName), oneLine(input.scope, 80), formatDate(input.date), String(input.members), String(input.completed), String(input.pending), digestStatusList(input.rows)];
}
export function teamDigestPreview(p: string[]): string {
    return `📊 Daily Team Progress Summary\n\nHello ${p[0]},\nHere is today's task completion summary for ${p[1]}:\n📅 Date: ${p[2]}\n👥 Total Members: ${p[3]}\n✅ Tasks Completed Today: ${p[4]}\n⏳ Tasks Remaining Pending: ${p[5]}\n📋 Team Status:\n${p[6]}`;
}

/** "{{2}} has handed over a task to you" — to the NEW holder. Never throws. */
export async function sendTaskHandover(phone: string | null | undefined, input: { recipientName: string; fromLabel: string; titles: string[]; date: string; departmentId?: string }): Promise<boolean> {
    if (!validPhone(phone) || input.titles.length === 0) return false;
    const params = handoverParams(input.recipientName, input.fromLabel, input.titles, input.date);
    try {
        return await TaskMessagingService.sendMessage(phone, handoverPreview(params), {
            messageType: 'task_handover', departmentId: input.departmentId,
            campaignName: HANDOVER_CAMPAIGN, templateParams: params, templateOnly: true,
        });
    } catch (err) {
        console.error('[taskAlerts] Failed to send hand-over alert:', err instanceof Error ? err.message : err);
        return false;
    }
}

/** "A task you assigned has been completed" — to the person who GAVE the task(s). Never throws. */
export async function sendTaskCompleted(phone: string | null | undefined, input: { giverName: string; titles: string[]; completedByName: string; department?: string | null; at?: Date; departmentId?: string }): Promise<boolean> {
    if (!validPhone(phone) || input.titles.length === 0) return false;
    const params = completedParams(input.giverName, input.titles, input.completedByName, input.department, input.at ?? new Date());
    try {
        return await TaskMessagingService.sendMessage(phone, completedPreview(params), {
            messageType: 'task_completed_relay', departmentId: input.departmentId,
            campaignName: COMPLETED_CAMPAIGN, templateParams: params, templateOnly: true,
        });
    } catch (err) {
        console.error('[taskAlerts] Failed to send completion notice:', err instanceof Error ? err.message : err);
        return false;
    }
}

/** The end-of-day team summary for a manager (their department) or a superuser (all departments). Never throws. */
export async function sendTeamDigest(phone: string | null | undefined, input: Parameters<typeof teamDigestParams>[0] & { departmentId?: string }): Promise<boolean> {
    if (!validPhone(phone)) return false;
    const params = teamDigestParams(input);
    try {
        return await TaskMessagingService.sendMessage(phone, teamDigestPreview(params), {
            messageType: 'team_digest', ruleType: 'team_digest', departmentId: input.departmentId,
            campaignName: TEAM_DIGEST_CAMPAIGN, templateParams: params, templateOnly: true,
        });
    } catch (err) {
        console.error('[taskAlerts] Failed to send team digest:', err instanceof Error ? err.message : err);
        return false;
    }
}
