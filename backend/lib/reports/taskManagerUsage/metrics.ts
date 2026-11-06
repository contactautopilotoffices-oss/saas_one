import type {
    AuditRow,
    DepartmentRow,
    FeatureUse,
    Kpi,
    MetricInput,
    PersonRow,
    ReportPerson,
    TaskRow,
    Tone,
    TrendPoint,
    UsageReport,
} from './types';

/**
 * Task Manager Usage Report: every number in the report is worked out here.
 *
 * Pure: no database, no clock, no LLM. The takeaways and actions are fixed rules over these numbers, so each sentence in
 * the PDF traces back to a figure (doctrine L1: this is a workflow, not an agent, so no Agent Spec Block applies).
 *
 * Definitions (owner 2026-11-04):
 *   cycle    a task both created and completed inside the period. It counts for the person who created it and the person
 *            who completed it; a self-assigned task counts once. Auto-generated fixed tasks and Zoho imports are not cycles
 *            because nobody created them in the Task Manager.
 *   regular  at least 3 cycles per 7 days of the period (never below 3).
 *   active   did something in the Task Manager in the period. Merely opening a screen leaves no record, so it cannot count.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 86_400_000;
const MAX_LISTED = 15;
const WORK_ITEMS = 5;
/** Longest range drawn day by day; beyond this the trend goes week by week. */
const DAILY_TREND_MAX_DAYS = 31;

/** Things a person did. Messages and reminders the system sent them are deliberately not here. */
export const ACTION_EVENTS = new Set([
    'task_created', 'task_assigned', 'task_assigned_group', 'task_assigned_cross_department', 'task_assigned_whatsapp',
    'task_completed', 'task_bulk_completed', 'task_status_changed', 'task_status_updated', 'task_deleted', 'task_edited',
    'task_renamed', 'task_note_added', 'task_handed_over', 'task_reminded', 'task_support_requested', 'task_locked',
    'task_unlocked', 'task_dependency_flagged', 'task_attachment_added', 'task_completion_remark_added',
    'task_import_confirmed', 'brain_live', 'voice_note', 'meeting_created', 'meeting_recorded',
]);

const WHATSAPP_ONLY_EVENTS = new Set(['brain_live', 'voice_note', 'task_assigned_whatsapp', 'task_import_confirmed']);
/** Logged by the WhatsApp command handler without a `via`; the website always sets one. */
const WHATSAPP_WHEN_UNLABELLED = new Set(['task_completed', 'task_bulk_completed']);

export const addDays = (day: string, n: number): string => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};
export const spanDays = (from: string, to: string): number =>
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
export const istDay = (ts: string): string => new Date(Date.parse(ts) + IST_OFFSET_MS).toISOString().slice(0, 10);

/** The target grows with the period, so a longer report is not easier to pass: 3 per 7 days, never below 3. */
export const regularTarget = (days: number): number => Math.max(3, Math.ceil((3 * days) / 7));

/** A task nobody created by hand. */
const isAutomatic = (t: TaskRow): boolean => !!t.task_template_id || t.source === 'zoho';

const inRange = (day: string, from: string, to: string): boolean => day >= from && day <= to;
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const list = (items: string[]): string =>
    items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

export function channelOf(row: Pick<AuditRow, 'event_type' | 'details'>): 'web' | 'whatsapp' {
    const via = String(row.details?.via ?? row.details?.channel ?? '').toLowerCase();
    if (via.startsWith('whatsapp')) return 'whatsapp';
    if (via.startsWith('web')) return 'web';
    if (WHATSAPP_ONLY_EVENTS.has(row.event_type)) return 'whatsapp';
    return WHATSAPP_WHEN_UNLABELLED.has(row.event_type) ? 'whatsapp' : 'web';
}

interface PeriodFigures {
    from: string;
    to: string;
    created: TaskRow[];
    completed: TaskRow[];
    cycles: TaskRow[];
    /** Cycles credited to each person. */
    cyclesBy: Map<string, number>;
    createdBy: Map<string, number>;
    completedBy: Map<string, number>;
    actionsBy: Map<string, number>;
    activeDaysBy: Map<string, Set<string>>;
    actions: AuditRow[];
}

const bump = (m: Map<string, number>, key: string, by = 1): void => { m.set(key, (m.get(key) ?? 0) + by); };
const addDay = (m: Map<string, Set<string>>, key: string, day: string): void => {
    const days = m.get(key);
    if (days) days.add(day); else m.set(key, new Set([day]));
};

function figuresFor(from: string, to: string, tasks: TaskRow[], audit: AuditRow[], roster: Set<string>): PeriodFigures {
    const f: PeriodFigures = {
        from, to, created: [], completed: [], cycles: [], cyclesBy: new Map(), createdBy: new Map(), completedBy: new Map(),
        actionsBy: new Map(), activeDaysBy: new Map(), actions: [],
    };

    for (const t of tasks) {
        const createdDay = istDay(t.created_at);
        const createdIn = inRange(createdDay, from, to);
        const completedDay = t.status === 'completed' && t.completed_at ? istDay(t.completed_at) : null;
        const completedIn = !!completedDay && inRange(completedDay, from, to);

        if (createdIn) {
            f.created.push(t);
            if (t.assigned_by && roster.has(t.assigned_by)) {
                bump(f.createdBy, t.assigned_by);
                addDay(f.activeDaysBy, t.assigned_by, createdDay);
            }
        }
        if (completedIn) {
            f.completed.push(t);
            bump(f.completedBy, t.employee_id);
            addDay(f.activeDaysBy, t.employee_id, completedDay as string);
        }
        if (createdIn && completedIn && !isAutomatic(t)) {
            f.cycles.push(t);
            for (const person of new Set([t.assigned_by, t.employee_id])) {
                if (person && roster.has(person)) bump(f.cyclesBy, person);
            }
        }
    }

    for (const a of audit) {
        if (!a.actor_id || !roster.has(a.actor_id) || !ACTION_EVENTS.has(a.event_type)) continue;
        const day = istDay(a.created_at);
        if (!inRange(day, from, to)) continue;
        f.actions.push(a);
        bump(f.actionsBy, a.actor_id);
        addDay(f.activeDaysBy, a.actor_id, day);
    }
    return f;
}

const isRegular = (f: PeriodFigures, userId: string, target: number): boolean => (f.cyclesBy.get(userId) ?? 0) >= target;

function deltaText(now: number, before: number, unit: '' | ' pts' = ''): string {
    const diff = now - before;
    return diff === 0 ? 'No change' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)}${unit}`;
}
function deltaTone(now: number, before: number, upIsGood: boolean): Tone {
    if (now === before) return 'neutral';
    return now > before === upIsGood ? 'good' : 'bad';
}

function trendPoints(from: string, days: number, tasks: TaskRow[], audit: AuditRow[], roster: Set<string>): { unit: 'day' | 'week'; points: TrendPoint[] } {
    const unit = days <= DAILY_TREND_MAX_DAYS ? 'day' : 'week';
    const step = unit === 'day' ? 1 : 7;
    const points: TrendPoint[] = [];
    for (let i = 0; i < days; i += step) {
        const start = addDays(from, i);
        const end = addDays(from, Math.min(i + step, days) - 1);
        const f = figuresFor(start, end, tasks, audit, roster);
        const label = new Date(`${start}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
        points.push({ label, active: f.activeDaysBy.size, created: f.created.length, completed: f.completed.length });
    }
    return { unit, points };
}

function featureUse(cur: PeriodFigures, peopleById: Map<string, ReportPerson>): FeatureUse[] {
    const fromEvents = (label: string, ...events: string[]): FeatureUse => {
        const rows = cur.actions.filter(a => events.includes(a.event_type));
        return { label, uses: rows.length, people: new Set(rows.map(a => a.actor_id)).size };
    };
    const fromTasks = (label: string, rows: TaskRow[], person: 'assigned_by' | 'employee_id' = 'assigned_by'): FeatureUse => ({
        label, uses: rows.length, people: new Set(rows.map(t => t[person]).filter(p => !!p && peopleById.has(p))).size,
    });
    const delegated = cur.created.filter(t => t.assigned_by && t.assigned_by !== t.employee_id);
    const crossDepartment = delegated.filter(t => {
        const creator = peopleById.get(t.assigned_by as string);
        const owner = peopleById.get(t.employee_id);
        return !!creator && !!owner && creator.departmentId !== owner.departmentId;
    });
    return [
        fromTasks('Delegated tasks', delegated),
        fromTasks('Cross-department tasks', crossDepartment),
        fromTasks('Due dates set', cur.created.filter(t => t.due_date)),
        fromEvents('WhatsApp assistant', 'brain_live'),
        fromEvents('Voice notes', 'voice_note'),
        fromEvents('Meeting assistant', 'meeting_created', 'meeting_recorded'),
        fromEvents('Task handovers', 'task_handed_over'),
        fromEvents('Notes and attachments', 'task_note_added', 'task_attachment_added'),
        fromTasks('Zoho task imports', cur.created.filter(t => t.source === 'zoho'), 'employee_id'),
    ];
}

function medianHours(rows: TaskRow[]): number | null {
    const hours = rows
        .map(t => (Date.parse(t.completed_at as string) - Date.parse(t.created_at)) / 3_600_000)
        .filter(h => h >= 0)
        .sort((a, b) => a - b);
    if (!hours.length) return null;
    const mid = Math.floor(hours.length / 2);
    return Math.round((hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2) * 10) / 10;
}

function departmentTone(adoptionPct: number, completionPct: number | null): Tone {
    if (adoptionPct < 50 || (completionPct !== null && completionPct < 40)) return 'bad';
    if (adoptionPct >= 75 && (completionPct === null || completionPct >= 70)) return 'good';
    return 'warn';
}

const longDate = (day: string): string =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function computeUsageReport(input: MetricInput): UsageReport {
    const { from, to, people, historyFrom } = input;
    const days = spanDays(from, to);
    const previousTo = addDays(from, -1);
    const previousFrom = addDays(from, -days);
    // A range reaching back before tracking began must not raise the bar for days that hold no data.
    const trackedFrom = historyFrom && historyFrom > from && historyFrom <= to ? historyFrom : from;
    const target = regularTarget(spanDays(trackedFrom, to));

    const peopleById = new Map(people.map(p => [p.userId, p]));
    const roster = new Set(peopleById.keys());
    // Superusers and anyone without access own no task in this report: the base decides what is in scope.
    const tasks = input.tasks.filter(t => roster.has(t.employee_id));

    const cur = figuresFor(from, to, tasks, input.audit, roster);
    const canCompare = !!historyFrom && previousFrom >= historyFrom;
    const prev = canCompare ? figuresFor(previousFrom, previousTo, tasks, input.audit, roster) : null;

    const openOn = (day: string): TaskRow[] => tasks.filter(t => {
        if (istDay(t.created_at) > day) return false;
        return !(t.status === 'completed' && t.completed_at && istDay(t.completed_at) <= day);
    });
    const open = openOn(to);
    const overdue = open.filter(t => !!t.due_date && t.due_date < to);
    const ageOf = (t: TaskRow): number => spanDays(istDay(t.created_at), to) - 1;

    // ── Headline numbers ────────────────────────────────────────────────────
    const base = people.length;
    const activeCount = cur.activeDaysBy.size;
    const regularCount = people.filter(p => isRegular(cur, p.userId, target)).length;
    const manualCreated = cur.created.filter(t => !isAutomatic(t)).length;
    const completionPct = manualCreated ? pct(cur.cycles.length, manualCreated) : null;
    const prevRegular = prev ? people.filter(p => isRegular(prev, p.userId, target)).length : null;
    const prevManual = prev ? prev.created.filter(t => !isAutomatic(t)).length : 0;
    const prevCompletion = prev && prevManual ? pct(prev.cycles.length, prevManual) : null;
    const prevOverdue = prev ? openOn(previousTo).filter(t => !!t.due_date && t.due_date < previousTo).length : null;
    const adoptionPct = pct(activeCount, base);

    const kpis: Kpi[] = [
        {
            key: 'active', label: 'Active users', display: `${activeCount} of ${base}`,
            detail: `${adoptionPct}% of people with access`,
            change: prev ? deltaText(activeCount, prev.activeDaysBy.size) : null,
            changeTone: prev ? deltaTone(activeCount, prev.activeDaysBy.size, true) : 'neutral',
            tone: adoptionPct >= 75 ? 'good' : adoptionPct >= 50 ? 'warn' : 'bad',
        },
        {
            key: 'regular', label: 'Regular users', display: `${regularCount} of ${base}`,
            detail: `${target}+ completed cycles`,
            change: prevRegular === null ? null : deltaText(regularCount, prevRegular),
            changeTone: prevRegular === null ? 'neutral' : deltaTone(regularCount, prevRegular, true),
            tone: pct(regularCount, base) >= 50 ? 'good' : pct(regularCount, base) >= 25 ? 'warn' : 'bad',
        },
        {
            key: 'cycles', label: 'Completed cycles', display: String(cur.cycles.length),
            detail: 'Created and completed in this period',
            change: prev ? deltaText(cur.cycles.length, prev.cycles.length) : null,
            changeTone: prev ? deltaTone(cur.cycles.length, prev.cycles.length, true) : 'neutral',
            tone: 'neutral',
        },
        {
            key: 'completion', label: 'Completion rate', display: completionPct === null ? '—' : `${completionPct}%`,
            detail: 'Of tasks created in this period',
            change: completionPct === null || prevCompletion === null ? null : deltaText(completionPct, prevCompletion, ' pts'),
            changeTone: completionPct === null || prevCompletion === null ? 'neutral' : deltaTone(completionPct, prevCompletion, true),
            tone: completionPct === null ? 'neutral' : completionPct >= 70 ? 'good' : completionPct >= 40 ? 'warn' : 'bad',
        },
        {
            key: 'overdue', label: 'Overdue tasks', display: String(overdue.length),
            detail: 'Past their due date at period end',
            change: prevOverdue === null ? null : deltaText(overdue.length, prevOverdue),
            changeTone: prevOverdue === null ? 'neutral' : deltaTone(overdue.length, prevOverdue, false),
            tone: overdue.length === 0 ? 'good' : overdue.length <= 5 ? 'warn' : 'bad',
        },
    ];

    // ── Adoption and engagement ─────────────────────────────────────────────
    const cycleUsers = people.filter(p => (cur.cyclesBy.get(p.userId) ?? 0) > 0).length;
    const trend = trendPoints(from, days, tasks, input.audit, roster);

    const dayBuckets = [
        { label: 'No activity', test: (n: number) => n === 0 },
        { label: '1 day', test: (n: number) => n === 1 },
        { label: '2 days', test: (n: number) => n === 2 },
        { label: '3–4 days', test: (n: number) => n >= 3 && n <= 4 },
        { label: '5+ days', test: (n: number) => n >= 5 },
    ].map(b => ({ label: b.label, people: people.filter(p => b.test(cur.activeDaysBy.get(p.userId)?.size ?? 0)).length }));

    const channels = { web: 0, whatsapp: 0 };
    const heatmap = Array.from({ length: 7 }, () => new Array<number>(12).fill(0));
    for (const a of cur.actions) {
        channels[channelOf(a)]++;
        const ist = new Date(Date.parse(a.created_at) + IST_OFFSET_MS);
        heatmap[(ist.getUTCDay() + 6) % 7][Math.floor(ist.getUTCHours() / 2)]++;
    }

    // ── Departments ─────────────────────────────────────────────────────────
    const departmentIds = [...new Set(people.map(p => p.departmentId))];
    const departments: DepartmentRow[] = departmentIds.map(id => {
        const members = people.filter(p => p.departmentId === id);
        const ids = new Set(members.map(p => p.userId));
        const own = (t: TaskRow) => ids.has(t.employee_id);
        const created = cur.created.filter(own);
        const completed = cur.completed.filter(own);
        const cycles = cur.cycles.filter(own);
        const manual = created.filter(t => !isAutomatic(t));
        const deptOpen = open.filter(own);
        const active = members.filter(p => cur.activeDaysBy.has(p.userId)).length;
        const adoption = pct(active, members.length);
        const completion = manual.length ? pct(cycles.length, manual.length) : null;
        const ownerName = (t: TaskRow) => peopleById.get(t.employee_id)?.name ?? '';
        return {
            id,
            name: members[0].departmentName,
            people: members.length,
            active,
            adoptionPct: adoption,
            regular: members.filter(p => isRegular(cur, p.userId, target)).length,
            created: created.length,
            completed: completed.length,
            cycles: cycles.length,
            completionPct: completion,
            open: deptOpen.length,
            overdue: deptOpen.filter(t => !!t.due_date && t.due_date < to).length,
            actions: members.reduce((sum, p) => sum + (cur.actionsBy.get(p.userId) ?? 0), 0),
            activeChange: prev ? active - members.filter(p => prev.activeDaysBy.has(p.userId)).length : null,
            tone: departmentTone(adoption, completion),
            selfAssigned: created.filter(t => t.assigned_by === t.employee_id).length,
            delegated: created.filter(t => t.assigned_by && t.assigned_by !== t.employee_id).length,
            oldestOpen: [...deptOpen]
                .sort((a, b) => a.created_at.localeCompare(b.created_at))
                .slice(0, WORK_ITEMS)
                .map(t => ({ title: t.title, owner: ownerName(t), ageDays: ageOf(t) })),
            recentlyCompleted: [...completed]
                .sort((a, b) => (b.completed_at as string).localeCompare(a.completed_at as string))
                .slice(0, WORK_ITEMS)
                .map(t => ({ title: t.title, owner: ownerName(t), ageDays: null })),
        };
    }).sort((a, b) => b.actions - a.actions || a.name.localeCompare(b.name));

    // ── Execution ───────────────────────────────────────────────────────────
    const selfAssigned = cur.created.filter(t => t.assigned_by === t.employee_id).length;
    const delegated = cur.created.filter(t => t.assigned_by && t.assigned_by !== t.employee_id).length;
    const dueInPeriod = tasks.filter(t => !!t.due_date && inRange(t.due_date, from, to));
    const onTime = dueInPeriod.filter(t => t.status === 'completed' && t.completed_at && istDay(t.completed_at) <= (t.due_date as string)).length;
    const dueCoveragePct = cur.created.length ? pct(cur.created.filter(t => t.due_date).length, cur.created.length) : null;
    const ageing = [
        { label: '0–3 days', test: (n: number) => n <= 3 },
        { label: '4–7 days', test: (n: number) => n >= 4 && n <= 7 },
        { label: '8–14 days', test: (n: number) => n >= 8 && n <= 14 },
        { label: '15+ days', test: (n: number) => n >= 15 },
    ].map(b => ({ label: b.label, count: open.filter(t => b.test(ageOf(t))).length }));

    // ── People ──────────────────────────────────────────────────────────────
    const toRow = (p: ReportPerson): PersonRow => {
        const activeDays = cur.activeDaysBy.get(p.userId);
        const lastActive = [...(activeDays ?? prev?.activeDaysBy.get(p.userId) ?? [])].sort().pop() ?? null;
        return {
            name: p.name,
            department: p.departmentName,
            cycles: cur.cyclesBy.get(p.userId) ?? 0,
            activeDays: activeDays?.size ?? 0,
            created: cur.createdBy.get(p.userId) ?? 0,
            completed: cur.completedBy.get(p.userId) ?? 0,
            actions: cur.actionsBy.get(p.userId) ?? 0,
            regular: isRegular(cur, p.userId, target),
            lastActive,
        };
    };
    const regulars = people.filter(p => isRegular(cur, p.userId, target)).map(toRow)
        .sort((a, b) => b.cycles - a.cycles || b.activeDays - a.activeDays || a.name.localeCompare(b.name))
        .slice(0, MAX_LISTED);
    const inactive = people.filter(p => !cur.activeDaysBy.has(p.userId));
    const byName = (a: PersonRow, b: PersonRow) => a.name.localeCompare(b.name);
    const stopped = inactive.filter(p => prev?.activeDaysBy.has(p.userId)).map(toRow).sort(byName);
    const quiet = inactive.filter(p => !prev?.activeDaysBy.has(p.userId)).map(toRow).sort(byName);

    // ── Takeaways and actions (fixed rules, so each one traces back to a number) ─
    const takeaways: string[] = [
        `${activeCount} of ${plural(base, 'person', 'people')} with access used the Task Manager (${adoptionPct}%)${prev ? `, compared with ${prev.activeDaysBy.size} in the previous period` : ''}.`,
        `${plural(regularCount, 'person', 'people')} reached the regular-use target of ${plural(target, 'completed cycle')}.`,
    ];
    const busiest = departments[0];
    if (busiest && busiest.actions > 0) takeaways.push(`${busiest.name} was the most active department with ${plural(busiest.actions, 'recorded action')}.`);
    if (completionPct !== null) takeaways.push(`${completionPct}% of tasks created in this period were completed in it.`);
    if (overdue.length) {
        const worst = Math.max(...overdue.map(t => spanDays(t.due_date as string, to) - 1));
        takeaways.push(`${plural(overdue.length, 'task')} ${overdue.length === 1 ? 'was' : 'were'} overdue at period end, the oldest by ${plural(worst, 'day')}.`);
    } else {
        takeaways.push('No tasks with a due date were overdue at period end.');
    }

    const actions: string[] = [];
    if (quiet.length + stopped.length) actions.push(`Follow up with the ${plural(quiet.length + stopped.length, 'person', 'people')} who had no activity in this period.`);
    const lagging = departments.filter(d => d.tone === 'bad').map(d => d.name);
    if (lagging.length) actions.push(`Review adoption and completion in ${list(lagging)}.`);
    if (overdue.length) {
        const worstDept = [...departments].sort((a, b) => b.overdue - a.overdue)[0];
        actions.push(`Clear the ${plural(overdue.length, 'overdue task')}, starting with ${worstDept.name} (${worstDept.overdue}).`);
    }
    if (dueCoveragePct !== null && dueCoveragePct < 50) actions.push(`Encourage due dates: only ${dueCoveragePct}% of new tasks have one, which limits on-time tracking.`);
    if (cur.created.length && pct(selfAssigned, cur.created.length) >= 60) actions.push(`${pct(selfAssigned, cur.created.length)}% of tasks were self-assigned; check that managers are delegating through the Task Manager.`);
    if (!actions.length) actions.push('No follow-up is needed from this period’s numbers.');

    const notes: string[] = [];
    if (historyFrom && from < historyFrom) notes.push(`Activity records begin on ${longDate(historyFrom)}. Figures before that date come from task records only, and the regular-use target counts days from then.`);
    if (!prev) notes.push('No comparison is shown because the history does not fully cover the previous period of the same length.');
    if (dueCoveragePct !== null && dueCoveragePct < 50) notes.push(`On-time figures cover only the ${dueCoveragePct}% of new tasks that have a due date.`);

    return {
        orgName: input.orgName,
        generatedAt: input.generatedAt,
        period: { from, to, days },
        previousPeriod: prev ? { from: previousFrom, to: previousTo } : null,
        base: { departments: departments.length, people: base },
        regularTarget: target,
        kpis,
        adoption: {
            funnel: [
                { label: 'People with access', count: base },
                { label: 'Active in this period', count: activeCount },
                { label: 'Completed a cycle', count: cycleUsers },
                { label: 'Regular users', count: regularCount },
            ],
            trend: trend.points,
            trendUnit: trend.unit,
        },
        engagement: { activeDays: dayBuckets, channels, heatmap, features: featureUse(cur, peopleById) },
        departments,
        execution: {
            created: cur.created.length,
            completed: cur.completed.length,
            cycles: cur.cycles.length,
            completionPct,
            selfAssigned,
            delegated,
            automatic: cur.created.filter(isAutomatic).length,
            deleted: cur.actions.filter(a => a.event_type === 'task_deleted').length,
            overdue: overdue.length,
            openAtEnd: open.length,
            openAgeing: ageing,
            medianHoursToComplete: medianHours(cur.cycles),
            due: {
                tasksDue: dueInPeriod.length,
                onTime,
                onTimePct: dueInPeriod.length ? pct(onTime, dueInPeriod.length) : null,
                coveragePct: dueCoveragePct,
            },
        },
        people: { regulars, stopped, quiet },
        takeaways,
        actions,
        notes,
    };
}
