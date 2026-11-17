/**
 * Task Manager Usage Report: the shapes shared by the metrics, the PDF and the Report tab.
 *
 * Who counts (owner 2026-11-04): only departments switched on for the Task Manager and only people who have been
 * onboarded to it. Superusers are left out completely: they are not in the base, totals, names or task titles.
 * Days are IST calendar days; `from` and `to` are inclusive YYYY-MM-DD strings.
 */

export interface ReportPerson {
    userId: string;
    name: string;
    departmentId: string;
    departmentName: string;
}

export interface ReportDepartment {
    id: string;
    name: string;
}

export interface TaskRow {
    id: string;
    title: string;
    employee_id: string;
    assigned_by: string | null;
    assigned_date: string;
    status: string;
    created_at: string;
    completed_at: string | null;
    due_date: string | null;
    task_template_id: string | null;
    source: string | null;
    assign_group_id: string | null;
}

export interface AuditRow {
    event_type: string;
    actor_id: string | null;
    created_at: string;
    details: Record<string, unknown> | null;
}

export interface MetricInput {
    orgName: string;
    from: string;
    to: string;
    /** When this report was produced (ISO time). Comes in from outside so the metrics stay pure. */
    generatedAt: string;
    /** First day the audit log holds anything, or null when it is empty. */
    historyFrom: string | null;
    people: ReportPerson[];
    tasks: TaskRow[];
    audit: AuditRow[];
}

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

export interface Kpi {
    key: 'active' | 'regular' | 'cycles' | 'completion' | 'overdue';
    label: string;
    /** Display text, e.g. "11 of 14" or "71%". */
    display: string;
    /** One line under the number, e.g. "79% of people with access". */
    detail: string;
    /** Change from the previous period as display text, or null when there is nothing fair to compare with. */
    change: string | null;
    /** Whether the change is good news. */
    changeTone: Tone;
    /** How this number reads on its own. */
    tone: Tone;
}

export interface TrendPoint {
    label: string;
    active: number;
    created: number;
    completed: number;
}

export interface FeatureUse {
    label: string;
    uses: number;
    people: number;
}

export interface DepartmentWorkItem {
    title: string;
    owner: string;
    /** Days open at the end of the period; null for completed work. */
    ageDays: number | null;
}

export interface DepartmentRow {
    id: string;
    name: string;
    people: number;
    active: number;
    adoptionPct: number;
    regular: number;
    created: number;
    completed: number;
    cycles: number;
    /** Share of tasks created in the period that were also completed in it; null when none were created. */
    completionPct: number | null;
    open: number;
    overdue: number;
    actions: number;
    activeChange: number | null;
    tone: Tone;
    selfAssigned: number;
    delegated: number;
    oldestOpen: DepartmentWorkItem[];
    recentlyCompleted: DepartmentWorkItem[];
}

export interface PersonRow {
    name: string;
    department: string;
    cycles: number;
    activeDays: number;
    created: number;
    completed: number;
    actions: number;
    regular: boolean;
    /** Last IST day with any activity, or null when none is known. */
    lastActive: string | null;
}

export interface UsageReport {
    orgName: string;
    generatedAt: string;
    period: { from: string; to: string; days: number };
    /** The same number of days right before `period`; null when the history cannot support a fair comparison. */
    previousPeriod: { from: string; to: string } | null;
    base: { departments: number; people: number };
    /** Completed cycles needed in this period to count as a regular user. */
    regularTarget: number;
    kpis: Kpi[];
    adoption: {
        funnel: { label: string; count: number }[];
        trend: TrendPoint[];
        trendUnit: 'day' | 'week';
    };
    engagement: {
        /** How many people were active on 0, 1, 2, 3-4, 5+ days. */
        activeDays: { label: string; people: number }[];
        channels: { web: number; whatsapp: number };
        /** 7 rows (Monday first) of 12 two-hour columns, in IST. */
        heatmap: number[][];
        features: FeatureUse[];
    };
    departments: DepartmentRow[];
    execution: {
        created: number;
        completed: number;
        cycles: number;
        completionPct: number | null;
        selfAssigned: number;
        delegated: number;
        automatic: number;
        deleted: number;
        overdue: number;
        openAtEnd: number;
        openAgeing: { label: string; count: number }[];
        medianHoursToComplete: number | null;
        due: { tasksDue: number; onTime: number; onTimePct: number | null; coveragePct: number | null };
    };
    people: {
        regulars: PersonRow[];
        /** Active in the previous period, nothing in this one. */
        stopped: PersonRow[];
        /** Have access, nothing in this period, and were not active in the previous one either. */
        quiet: PersonRow[];
    };
    takeaways: string[];
    actions: string[];
    /** Plain notes about how far the data can be trusted for this period. */
    notes: string[];
}
