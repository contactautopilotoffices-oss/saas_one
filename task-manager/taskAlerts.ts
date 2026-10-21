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
 *   task_dependency_v1           Hello {{1}} · {{2}} says this is pending on you · Task: {{3}}   (owner 2026-10-19; must be
 *                                approved in AiSensy / Meta before it is delivered. Until then the in-app notice still works.)
 *   task_reminder_v1             Hello {{1}} · {{2}} is waiting on these tasks · {{3}}   (owner 2026-10-20, the person who GAVE
 *                                the tasks reminds the person doing them; same approval note as above)
 */

export const ASSIGNED_CAMPAIGN = process.env.AISENSY_TASK_ASSIGNED_CAMPAIGN || 'task_assigned_v1';
export const UPDATE_CAMPAIGN = process.env.AISENSY_TASK_UPDATE_CAMPAIGN || 'task_update_v2';
export const HANDOVER_CAMPAIGN = process.env.AISENSY_TASK_HANDOVER_CAMPAIGN || 'task_handover_v1';
export const COMPLETED_CAMPAIGN = process.env.AISENSY_TASK_COMPLETED_CAMPAIGN || 'task_completed_notice_v1';
export const TEAM_DIGEST_CAMPAIGN = process.env.AISENSY_TASK_TEAM_DIGEST_CAMPAIGN || 'task_manager_team_digest_v1';
export const DEPENDENCY_CAMPAIGN = process.env.AISENSY_TASK_DEPENDENCY_CAMPAIGN || 'task_dependency_v1';
export const REMINDER_CAMPAIGN = process.env.AISENSY_TASK_REMINDER_CAMPAIGN || 'task_reminder_v1';

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

/** done/total = tasks given TODAY (unchanged). carriedDone/carriedPending (owner 2026-10-16) = carried-forward tasks finished
 *  today / still open, shown separately and never added to today's numbers. */
export interface DigestRow { label: string; done: number; total: number; carriedDone?: number; carriedPending?: number }
const carriedNote = (r: DigestRow) => {
    const parts = [r.carriedDone ? `${r.carriedDone} done` : '', r.carriedPending ? `${r.carriedPending} pending` : ''].filter(Boolean);
    return parts.length ? ` · Carried forward: ${parts.join(', ')}` : '';
};
const statusItem = (r: DigestRow) => {
    const pending = Math.max(0, r.total - r.done);
    const tail = r.total === 0 ? 'no tasks' : pending === 0 ? '100% ✅' : `${pending} Pending ⏳`;
    return `• ${oneLine(r.label, 60)}: ${r.done}/${r.total} Done (${tail})`;
};
/** One line for the template blank: "Today: • Tech: 12/12 Done (100% ✅) · Carried forward: 2 done | • Ops: 18/20 Done (2 Pending ⏳)".
 *  "Today:" says the counts are today's tasks (owner 2026-10-16); the template's own heading is fixed by Meta. */
export function digestStatusList(rows: DigestRow[], max = 700): string {
    if (!rows.length) return 'No tasks today.';
    const items = rows.map(r => `${statusItem(r)}${carriedNote(r)}`);
    let out = 'Today: ';
    for (let i = 0; i < items.length; i++) {
        const next = i === 0 ? `${out}${items[i]}` : `${out} | ${items[i]}`;
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

/**
 * The normal-message version (owner 2026-10-16), sent to someone who messaged the bot in the last 24 hours: Completed and
 * Pending, each split into today's and carried-forward tasks with who they belong to, then today's status per row.
 * `rowsArePeople`: names in brackets use first names (a department summary); a superuser's rows are departments.
 */
export function teamDigestChat(input: Parameters<typeof teamDigestParams>[0] & { rowsArePeople: boolean }): string {
    const who = (r: DigestRow) => (input.rowsArePeople ? firstName(r.label) : oneLine(r.label, 40));
    const named = (pick: (r: DigestRow) => number) => {
        const list = input.rows.filter(r => pick(r) > 0).map(r => `${who(r)} ${pick(r)}`);
        if (!list.length) return '';
        return ` (${list.slice(0, 8).join(', ')}${list.length > 8 ? `, +${list.length - 8} more` : ''})`;
    };
    const sum = (pick: (r: DigestRow) => number) => input.rows.reduce((a, r) => a + pick(r), 0);
    const cDone = sum(r => r.carriedDone || 0), cPending = sum(r => r.carriedPending || 0);
    const todayPending = (r: DigestRow) => Math.max(0, r.total - r.done);
    const status: string[] = []; let size = 0;
    for (let i = 0; i < input.rows.length; i++) {
        const line = statusItem(input.rows[i]);
        if (size + line.length > 2500) { status.push(`…and ${input.rows.length - i} more`); break; }
        status.push(line); size += line.length + 1;
    }
    return [
        '📊 Daily Team Progress Summary', '',
        `Hello ${firstName(input.recipientName)},`, '',
        `Here is today's task completion summary for ${oneLine(input.scope, 80)}:`, '',
        `📅 Date: ${formatDate(input.date)}`,
        `👥 Total Members: ${input.members}`, '',
        '✅ Completed',
        `• Today: ${input.completed}${named(r => r.done)}`,
        ...(cDone ? [`• Carried forward: ${cDone}${named(r => r.carriedDone || 0)}`] : []), '',
        '⏳ Pending',
        `• Today: ${input.pending}${named(todayPending)}`,
        ...(cPending ? [`• Carried forward: ${cPending}${named(r => r.carriedPending || 0)}`] : []), '',
        "📋 Today's Team Status:",
        ...(status.length ? status : ['No tasks today.']), '',
        'Review your full team board on the portal.',
    ].join('\n');
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

export function dependencyParams(recipientName: string, fromLabel: string, titles: string[]): [string, string, string] {
    return [firstName(recipientName), oneLine(fromLabel, 100) || 'A teammate', taskList(titles)];
}
export function dependencyPreview(p: [string, string, string]): string {
    return `⏳ Task Pending On You\n\nHello ${p[0]},\n${p[1]} says this task is waiting on you:\n📋 Task: ${p[2]}\nPlease check with them.`;
}

/** "This task of mine is pending on you" (owner 2026-10-19). Never throws. Gated like every other alert. */
export async function sendTaskDependency(phone: string | null | undefined, input: { recipientName: string; fromLabel: string; titles: string[]; departmentId?: string }): Promise<boolean> {
    if (!validPhone(phone) || input.titles.length === 0) return false;
    const params = dependencyParams(input.recipientName, input.fromLabel, input.titles);
    try {
        return await TaskMessagingService.sendMessage(phone, dependencyPreview(params), {
            messageType: 'task_dependency', departmentId: input.departmentId,
            campaignName: DEPENDENCY_CAMPAIGN, templateParams: params, templateOnly: true,
        });
    } catch (err) {
        console.error('[taskAlerts] Failed to send pending-on-you alert:', err instanceof Error ? err.message : err);
        return false;
    }
}

export function reminderParams(recipientName: string, fromLabel: string, titles: string[]): [string, string, string] {
    return [firstName(recipientName), oneLine(fromLabel, 100) || 'A teammate', taskList(titles)];
}
export function reminderPreview(p: [string, string, string]): string {
    return `🔔 Task Reminder\n\nHello ${p[0]},\n${p[1]} is waiting on these tasks:\n📋 ${p[2]}\nPlease update them when done.`;
}

/** "The tasks I gave you are still pending" (owner 2026-10-20). Never throws. Gated like every other alert. */
export async function sendTaskReminder(phone: string | null | undefined, input: { recipientName: string; fromLabel: string; titles: string[]; departmentId?: string }): Promise<boolean> {
    if (!validPhone(phone) || input.titles.length === 0) return false;
    const params = reminderParams(input.recipientName, input.fromLabel, input.titles);
    try {
        return await TaskMessagingService.sendMessage(phone, reminderPreview(params), {
            messageType: 'task_reminder', departmentId: input.departmentId,
            campaignName: REMINDER_CAMPAIGN, templateParams: params, templateOnly: true,
        });
    } catch (err) {
        console.error('[taskAlerts] Failed to send task reminder:', err instanceof Error ? err.message : err);
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
export async function sendTeamDigest(phone: string | null | undefined, input: Parameters<typeof teamDigestParams>[0] & { departmentId?: string; asChat?: boolean; rowsArePeople?: boolean }): Promise<boolean> {
    if (!validPhone(phone)) return false;
    const params = teamDigestParams(input);
    try {
        // Inside the 24-hour window (owner 2026-10-16): the normal message with headings first; the approved template if
        // that send fails. Outside it: the template only, as before.
        if (input.asChat) {
            return await TaskMessagingService.sendMessage(phone, teamDigestChat({ ...input, rowsArePeople: input.rowsArePeople !== false }), {
                messageType: 'team_digest', ruleType: 'team_digest', departmentId: input.departmentId,
                campaignName: TEAM_DIGEST_CAMPAIGN, templateParams: params, templateOnly: false,
            });
        }
        return await TaskMessagingService.sendMessage(phone, teamDigestPreview(params), {
            messageType: 'team_digest', ruleType: 'team_digest', departmentId: input.departmentId,
            campaignName: TEAM_DIGEST_CAMPAIGN, templateParams: params, templateOnly: true,
        });
    } catch (err) {
        console.error('[taskAlerts] Failed to send team digest:', err instanceof Error ? err.message : err);
        return false;
    }
}
