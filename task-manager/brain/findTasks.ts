import type { BrainContext, BrainPerson } from './types';
import { addDays, clip, isIsoDate, norm } from './text';

/**
 * Flexible "look up tasks" — `find_tasks` (docs/TASK_LOOKUP_PLAN.md, 2026-10-13).
 *
 * The AI never writes a database query. It fills a FIXED form (TaskQuery). This file checks every field (validateQuery),
 * turns the form into exact dates and allowed people (in tasksDomain.decide, which applies the permission rule), and
 * writes the answer from the real rows (formatFound). Read-only: nothing here can change a task.
 *
 * Everything in this file is pure: no database, no network.
 */

export const FIND_MAX_DAYS = 92;      // the widest date window one question may cover
export const FIND_MAX_LINES = 25;     // lines shown in one answer ("…and N more" after that)
export const FIND_MAX_ROWS = 500;     // rows read for one question
export const FIND_MAX_WORDS = 5;

export type Whose = 'me' | 'people' | 'team' | 'department' | 'everyone' | 'anyone';
export type Period = 'any' | 'today' | 'yesterday' | 'tomorrow' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'last_n_days' | 'range';
export type FindStatus = 'any' | 'open' | 'not_started' | 'in_progress' | 'done';
export type ShowAs = 'list' | 'count' | 'by_person' | 'by_department' | 'by_day';

/** The form the AI fills. Missing fields take the defaults; a field with an invalid value makes the whole reading invalid. */
export interface TaskQuery {
    whose: Whose; people: string[]; department: string | null;
    givenBy: 'anyone' | 'me' | 'person'; givenByName: string | null;
    period: Period; n: number | null; from: string | null; to: string | null;
    dateField: 'assigned' | 'finished';
    status: FindStatus; overdueOnly: boolean; minDaysOld: number | null;
    kind: 'any' | 'fixed' | 'one_off';
    words: string[];
    showAs: ShowAs; sort: 'oldest' | 'newest' | 'person'; limit: number;
}

/** The form after code has resolved names to allowed people and words like "last week" to exact dates. */
export interface ResolvedQuery {
    employeeIds: string[]; whoLabel: string;
    givenById: string | null; givenByLabel: string | null;
    from: string; to: string; periodLabel: string;
    dateField: 'assigned' | 'finished';
    status: FindStatus; overdueOnly: boolean; minDaysOld: number | null;
    kind: 'any' | 'fixed' | 'one_off';
    words: string[];
    showAs: ShowAs; sort: 'oldest' | 'newest' | 'person'; limit: number;
    today: string;
}

/** One task row as read from the database (only the fields the answer needs). */
export interface FoundTask {
    id: string; title: string; employee_id: string; assigned_date: string;
    status: 'pending' | 'in_progress' | 'completed'; assigned_by: string | null; completed_at: string | null; task_template_id: string | null;
}

/** The form for the AI. "team" is only offered while the "Team reports" switch is ON (same rule as view_tasks). */
export const findQuerySchema = (withTeam: boolean) => `{"whose":"me"|"people"|${withTeam ? '"team"|' : ''}"department"|"everyone"|"anyone","people":[<person name>],"department":<department>|null,`
    + '"given_by":"anyone"|"me"|"person","given_by_name":<person name>|null,'
    + '"period":"any"|"today"|"yesterday"|"tomorrow"|"this_week"|"last_week"|"this_month"|"last_month"|"last_n_days"|"range","n":int|null,"from":"YYYY-MM-DD"|null,"to":"YYYY-MM-DD"|null,'
    + '"date_field":"assigned"|"finished","status":"any"|"open"|"not_started"|"in_progress"|"done","overdue_only":boolean,"min_days_old":int|null,'
    + '"kind":"any"|"fixed"|"one_off","words":[string],"show_as":"list"|"count"|"by_person"|"by_department"|"by_day","sort":"oldest"|"newest"|"person","limit":int|null}';

const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T | undefined =>
    v === undefined || v === null || v === '' ? dflt : (allowed as readonly string[]).includes(String(v)) ? (v as T) : undefined;
const int = (v: unknown, min: number, max: number): number | null | undefined =>
    v === undefined || v === null ? null : Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : undefined;

/** Words are matched as plain text: letters, digits, spaces and hyphens only (no wildcards, no query syntax). */
export const cleanWord = (w: unknown): string => String(w ?? '').toLowerCase().replace(/[^a-z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);

/** Strict check of the AI's form. null = invalid (the next model is tried, exactly like any other invalid reading). */
export function validateQuery(raw: Record<string, unknown>): TaskQuery | null {
    const whose = pick(raw.whose, ['me', 'people', 'team', 'department', 'everyone', 'anyone'] as const, 'me');
    const givenBy = pick(raw.given_by, ['anyone', 'me', 'person'] as const, 'anyone');
    const period = pick(raw.period, ['any', 'today', 'yesterday', 'tomorrow', 'this_week', 'last_week', 'this_month', 'last_month', 'last_n_days', 'range'] as const, 'any');
    const dateField = pick(raw.date_field, ['assigned', 'finished'] as const, 'assigned');
    const status = pick(raw.status, ['any', 'open', 'not_started', 'in_progress', 'done'] as const, 'any');
    const kind = pick(raw.kind, ['any', 'fixed', 'one_off'] as const, 'any');
    const showAs = pick(raw.show_as, ['list', 'count', 'by_person', 'by_department', 'by_day'] as const, 'list');
    const sort = pick(raw.sort, ['oldest', 'newest', 'person'] as const, 'oldest');
    const n = int(raw.n, 1, FIND_MAX_DAYS);
    const minDaysOld = int(raw.min_days_old, 1, 365);
    const limit = int(raw.limit, 1, FIND_MAX_LINES);
    if (!whose || !givenBy || !period || !dateField || !status || !kind || !showAs || !sort || n === undefined || minDaysOld === undefined || limit === undefined) return null;
    const from = raw.from == null ? null : isIsoDate(raw.from) ? raw.from : undefined;
    const to = raw.to == null ? null : isIsoDate(raw.to) ? raw.to : undefined;
    if (from === undefined || to === undefined) return null;
    if (period === 'last_n_days' && !n) return null;
    if (period === 'range' && !from) return null;
    const people = (Array.isArray(raw.people) ? raw.people : []).map(p => clip(p, 60)).filter(Boolean).slice(0, 8);
    if (whose === 'people' && !people.length) return null;
    const words = [...new Set((Array.isArray(raw.words) ? raw.words : []).map(cleanWord).filter(w => w.length >= 2))].slice(0, FIND_MAX_WORDS);
    return {
        whose, people, department: typeof raw.department === 'string' && raw.department.trim() ? clip(raw.department, 60) : null,
        givenBy, givenByName: typeof raw.given_by_name === 'string' && raw.given_by_name.trim() ? clip(raw.given_by_name, 60) : null,
        period, n, from, to, dateField, status, overdueOnly: raw.overdue_only === true, minDaysOld, kind, words, showAs, sort,
        limit: limit ?? FIND_MAX_LINES,
    };
}

/** Every searched word must really be in the message (the AI may not invent a search term). */
export const wordsGrounded = (q: TaskQuery, message: string): boolean => {
    const m = norm(message);
    return q.words.every(w => m.includes(norm(w)));
};

// ── dates (India time; a week starts on Monday) ─────────────────────────────

const dow = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;   // Monday = 0
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const monthEnd = (iso: string) => addDays(monthStart(addDays(monthStart(iso), 32)), -1);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/**
 * Exact dates for a period, never wider than FIND_MAX_DAYS. "any" = the last FIND_MAX_DAYS days up to today (an open task
 * older than that is not shown; that is the cost of keeping one question bounded).
 */
export function periodRange(q: Pick<TaskQuery, 'period' | 'n' | 'from' | 'to'>, today: string): { from: string; to: string; label: string } {
    let from: string; let to: string; let label: string;
    switch (q.period) {
        case 'today': from = to = today; label = 'today'; break;
        case 'yesterday': from = to = addDays(today, -1); label = `yesterday (${shortDate(from)})`; break;
        case 'tomorrow': from = to = addDays(today, 1); label = `tomorrow (${shortDate(from)})`; break;
        case 'this_week': from = addDays(today, -dow(today)); to = addDays(from, 6); label = `this week (${shortDate(from)}–${shortDate(to)})`; break;
        case 'last_week': from = addDays(today, -dow(today) - 7); to = addDays(from, 6); label = `last week (${shortDate(from)}–${shortDate(to)})`; break;
        case 'this_month': from = monthStart(today); to = monthEnd(today); label = 'this month'; break;
        case 'last_month': to = addDays(monthStart(today), -1); from = monthStart(to); label = 'last month'; break;
        case 'last_n_days': from = addDays(today, -((q.n ?? 7) - 1)); to = today; label = `the last ${q.n} days`; break;
        case 'range': from = q.from!; to = q.to && q.to >= q.from! ? q.to : q.from!; label = from === to ? shortDate(from) : `${shortDate(from)}–${shortDate(to)}`; break;
        default: from = addDays(today, -(FIND_MAX_DAYS - 1)); to = today; label = ''; break;
    }
    if (addDays(from, FIND_MAX_DAYS - 1) < to) from = addDays(to, -(FIND_MAX_DAYS - 1));
    return { from, to, label };
}

// ── the answer, written by code from the real rows ──────────────────────────

const STATUS_WORD: Record<FoundTask['status'], string> = { pending: 'Not started', in_progress: 'In progress', completed: 'Done' };
const STATUS_FILTER_WORD: Record<FindStatus, string> = { any: '', open: 'open', not_started: 'not started', in_progress: 'in progress', done: 'done' };

/** The filters in plain words, echoed in every answer so a misreading is visible at once. */
export function describeQuery(q: ResolvedQuery): string {
    const parts = [
        q.overdueOnly ? 'overdue' : STATUS_FILTER_WORD[q.status],
        q.kind === 'fixed' ? 'fixed daily' : q.kind === 'one_off' ? 'one-off' : '',
        q.whoLabel,
        q.givenByLabel ? `given by ${q.givenByLabel}` : '',
        q.words.length ? `about "${q.words.join('", "')}"` : '',
        q.minDaysOld ? `open for ${q.minDaysOld}+ days` : '',
        q.periodLabel ? `${q.dateField === 'finished' ? 'finished ' : ''}${q.periodLabel}` : '',
    ].filter(Boolean);
    return parts.join(' · ');
}

export interface FindView {
    /** id → name / department of everyone the asker can see (from the brain context). */
    people: Map<string, BrainPerson>;
    /** The asker's own numbered list: task id → number ("done N" works on these). */
    ownNumbers: Map<string, number>;
}

export function viewFor(ctx: BrainContext): FindView {
    return {
        people: new Map([ctx.sender, ...ctx.people].map(p => [p.id, p])),
        ownNumbers: new Map(ctx.tasks.map(t => [t.id, t.n])),
    };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Sort and filter rows exactly as the form says (the database already applied the coarse filters). */
export function applyQuery(rows: FoundTask[], q: ResolvedQuery, v: FindView): FoundTask[] {
    const out = rows.filter(r => q.employeeIds.includes(r.employee_id));
    const name = (id: string) => v.people.get(id)?.name ?? '';
    const key = (r: FoundTask) => (q.dateField === 'finished' ? r.completed_at ?? '' : r.assigned_date);
    out.sort((a, b) => q.sort === 'person' ? name(a.employee_id).localeCompare(name(b.employee_id)) || key(a).localeCompare(key(b))
        : q.sort === 'newest' ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b)));
    return out;
}

export function formatFound(rows: FoundTask[], q: ResolvedQuery, v: FindView, askerId: string): { text: string; count: number; summary: string } {
    const echo = describeQuery(q);
    const list = applyQuery(rows, q, v);
    // The filters are NOT shown to the person (owner, 2026-10-13); they only guide the one-line intro the AI writes.
    if (!list.length) return { text: 'No matching tasks found.', count: 0, summary: `No tasks found${echo ? ` for: ${echo}` : ''}` };
    const name = (id: string) => v.people.get(id)?.name ?? 'Someone';
    const dept = (id: string) => v.people.get(id)?.department ?? 'No department';
    const done = list.filter(r => r.status === 'completed').length;
    const head = `${plural(list.length, 'task')}${list.length >= FIND_MAX_ROWS ? '+' : ''}`;
    const group = (by: (r: FoundTask) => string) => {
        const m = new Map<string, FoundTask[]>();
        for (const r of list) m.set(by(r), [...(m.get(by(r)) ?? []), r]);
        return [...m.entries()];
    };
    const tally = (rs: FoundTask[]) => `${rs.filter(r => r.status === 'completed').length} done of ${rs.length}`;
    let body: string;
    if (q.showAs === 'count') {
        body = `${plural(list.length, 'task')}: ${done} done, ${list.length - done} open.`;
    } else if (q.showAs === 'by_person' || q.showAs === 'by_department' || q.showAs === 'by_day') {
        const by = q.showAs === 'by_person' ? (r: FoundTask) => name(r.employee_id) : q.showAs === 'by_department' ? (r: FoundTask) => dept(r.employee_id) : (r: FoundTask) => r.assigned_date;
        const g = group(by).sort((a, b) => (q.showAs === 'by_day' ? a[0].localeCompare(b[0]) : b[1].length - a[1].length || a[0].localeCompare(b[0])));
        const lines = g.slice(0, q.limit).map(([k, rs]) => `• ${q.showAs === 'by_day' ? shortDate(k) : k}: ${tally(rs)}`);
        if (g.length > q.limit) lines.push(`…and ${g.length - q.limit} more`);
        body = lines.join('\n');
    } else {
        const onePerson = new Set(list.map(r => r.employee_id)).size === 1;
        const oneDay = new Set(list.map(r => r.assigned_date)).size === 1;
        const lines = list.slice(0, q.limit).map(r => {
            // The asker's OWN open task keeps its real number, so "done N" works. Anything else gets a bullet, so "done 3"
            // can never point at someone else's task or an old one.
            const own = r.employee_id === askerId && r.status !== 'completed' ? v.ownNumbers.get(r.id) : undefined;
            const extra = [onePerson ? '' : name(r.employee_id), oneDay ? '' : shortDate(r.assigned_date), STATUS_WORD[r.status]].filter(Boolean).join(' · ');
            return `${own ? `${own}.` : '•'} ${r.title}${extra ? ` (${extra})` : ''}`;
        });
        if (list.length > q.limit) lines.push(`…and ${list.length - q.limit} more`);
        body = lines.join('\n');
    }
    return { text: q.showAs === 'count' ? body : `${head}:\n${body}`, count: list.length, summary: `Found ${head}${echo ? ` for: ${echo}` : ''}` };
}
