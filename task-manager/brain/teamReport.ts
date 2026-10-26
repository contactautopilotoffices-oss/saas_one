/**
 * Phase 4 "Team reports" (docs/WHATSAPP_BOT_PRODUCTION_PLAN.md): the text for "how is my team doing today?".
 * PURE — the caller fetches the people (already permission-filtered) and their tasks; this only counts and words them.
 * "Overdue" = still open and carried forward from an earlier day.
 */

export interface TeamMemberTasks {
    name: string;
    tasks: Array<{ status: 'pending' | 'in_progress' | 'completed'; isCarriedForward?: boolean; title?: string; assignedDate?: string }>;
}

export const MAX_TEAM_LINES = 25;

export function buildTeamReport(members: TeamMemberTasks[]): string {
    if (!members.length) return 'Nobody in your team yet.';
    const rows = members.map(m => {
        const total = m.tasks.length;
        const done = m.tasks.filter(t => t.status === 'completed').length;
        const doing = m.tasks.filter(t => t.status === 'in_progress').length;
        const overdue = m.tasks.filter(t => t.status !== 'completed' && t.isCarriedForward).length;
        return { m, total, done, doing, overdue };
    });
    // Who needs attention first: overdue, then most open work, then name.
    rows.sort((a, b) => b.overdue - a.overdue || (b.total - b.done) - (a.total - a.done) || a.m.name.localeCompare(b.m.name));

    const line = (r: typeof rows[number]) => {
        if (!r.total) return `• ${r.m.name}: no tasks today`;
        const parts = [`${r.done}/${r.total} done`];
        if (r.doing) parts.push(`${r.doing} in progress`);
        if (r.overdue) parts.push(`${r.overdue} overdue ⚠️`);
        return `• ${r.m.name}: ${parts.join(', ')}${r.done === r.total ? ' ✅' : ''}`;
    };
    const shown = rows.slice(0, MAX_TEAM_LINES).map(line);
    if (rows.length > MAX_TEAM_LINES) shown.push(`…and ${rows.length - MAX_TEAM_LINES} more`);

    const all = rows.reduce((a, r) => ({ total: a.total + r.total, done: a.done + r.done, overdue: a.overdue + r.overdue }), { total: 0, done: 0, overdue: 0 });
    const head = `Team today: ${all.done}/${all.total} tasks done${all.overdue ? `, ${all.overdue} overdue` : ''}.`;
    return `${head}\n${shown.join('\n')}`;
}

const STATUS_WORD: Record<'pending' | 'in_progress' | 'completed', string> = { pending: 'To do', in_progress: 'In progress', completed: 'Done' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (d?: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : null; };

/**
 * Owner 2026-10-21: "what is my team doing?" (different from "how is my team doing?", which is buildTeamReport's counts):
 * EVERY task of each person for today, carried-forward ones included, each with its status. PURE, like buildTeamReport.
 * People with open carried-forward work come first, then most open work, then by name (same order as the progress report).
 */
export function buildTeamTaskList(members: TeamMemberTasks[]): string {
    if (!members.length) return 'Nobody in your team yet.';
    const open = (m: TeamMemberTasks) => m.tasks.filter(t => t.status !== 'completed').length;
    const late = (m: TeamMemberTasks) => m.tasks.filter(t => t.status !== 'completed' && t.isCarriedForward).length;
    const ordered = [...members].sort((a, b) => late(b) - late(a) || open(b) - open(a) || a.name.localeCompare(b.name));
    const total = members.reduce((n, m) => n + m.tasks.length, 0);
    const blocks = ordered.map(m => {
        if (!m.tasks.length) return `*${m.name}*: no tasks today`;
        const lines = m.tasks.map(t => {
            const from = t.isCarriedForward ? dayLabel(t.assignedDate) : null;
            const status = t.isCarriedForward && t.status !== 'completed' ? `${STATUS_WORD[t.status]}, from ${from ?? 'an earlier day'}` : STATUS_WORD[t.status];
            return `• ${t.title || 'Untitled task'}: ${status}`;
        });
        return `*${m.name}* (${m.tasks.length})\n${lines.join('\n')}`;
    });
    return `Your team today: ${members.length} ${members.length === 1 ? 'person' : 'people'}, ${total} ${total === 1 ? 'task' : 'tasks'}.\n\n${blocks.join('\n\n')}`;
}
