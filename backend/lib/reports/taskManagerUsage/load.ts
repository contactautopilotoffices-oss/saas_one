import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskAccessService } from '@/task-manager/TaskAccessService';
import { computeUsageReport, addDays, spanDays } from './metrics';
import type { AuditRow, ReportPerson, TaskRow, UsageReport } from './types';

/**
 * Task Manager Usage Report: reads what the report needs. Read-only, and every read goes through the service role, so
 * callers must have checked the viewer first (see app/api/reports/task-manager-usage/_shared.ts).
 *
 * The base is the Task Manager's own access rule (department switched on and person onboarded), limited to this
 * organisation, with superusers left out completely (owner 2026-11-04).
 */

const PAGE_SIZE = 1000;
const MAX_PAGES = 200;
/** People per query: enough to keep a request URL well inside its limit, however large the organisation gets. */
const ID_CHUNK = 150;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function fetchAll<T>(makePage: (from: number, to: number) => Page<T>, label: string): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
        const start = page * PAGE_SIZE;
        const { data, error } = await makePage(start, start + PAGE_SIZE - 1);
        if (error) throw new Error(`Could not read ${label}: ${error.message}`);
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE_SIZE) return rows;
    }
    throw new Error(`Too much ${label} to report on at once`);
}

function chunks(ids: string[]): string[][] {
    const out: string[][] = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK) out.push(ids.slice(i, i + ID_CHUNK));
    return out;
}

const istStart = (day: string): string => new Date(`${day}T00:00:00+05:30`).toISOString();
const istEnd = (day: string): string => new Date(`${day}T23:59:59.999+05:30`).toISOString();

async function loadOrgName(organizationId: string): Promise<string> {
    const { data } = await supabaseAdmin.from('organizations').select('name').eq('id', organizationId).maybeSingle();
    return data?.name || 'Your organisation';
}

/** Everyone the report covers. */
export async function loadReportPeople(organizationId: string): Promise<ReportPerson[]> {
    const snapshot = await TaskAccessService.getSnapshot();
    if (!snapshot.readable) throw new Error('Task Manager access settings could not be read');

    const [profiles, departments] = await Promise.all([
        fetchAll<{ user_id: string; first_name: string | null; last_name: string | null; department_id: string | null; task_role: string | null }>(
            (a, b) => supabaseAdmin.from('employee_profiles')
                .select('user_id, first_name, last_name, department_id, task_role')
                .eq('organization_id', organizationId)
                .eq('is_active', true)
                .order('user_id')
                .range(a, b),
            'employee profiles',
        ),
        fetchAll<{ id: string; name: string }>(
            (a, b) => supabaseAdmin.from('departments').select('id, name').order('id').range(a, b),
            'departments',
        ),
    ]);
    const departmentName = new Map(departments.map(d => [d.id, d.name]));

    return profiles
        .filter(p => p.task_role !== 'superuser' && TaskAccessService.decide(snapshot, { userId: p.user_id, departmentId: p.department_id }).allowed)
        .map(p => ({
            userId: p.user_id,
            name: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed employee',
            departmentId: p.department_id as string,
            departmentName: departmentName.get(p.department_id as string) || 'Department',
        }));
}

/**
 * Tasks owned by people in the base that can matter to this period or the one before it: created or completed since
 * then, or still open. The Task Manager tables have no organization_id, so the base is what keeps a report to one
 * organisation.
 */
async function loadTasks(userIds: string[], sinceDay: string): Promise<TaskRow[]> {
    const since = istStart(sinceDay);
    const pages = await Promise.all(chunks(userIds).map(ids => fetchAll<TaskRow>(
        (a, b) => supabaseAdmin.from('task_assignments')
            .select('id, title, employee_id, assigned_by, assigned_date, status, created_at, completed_at, due_date, task_template_id, source, assign_group_id')
            .in('employee_id', ids)
            .or(`created_at.gte.${since},completed_at.gte.${since},status.neq.completed`)
            .order('id')
            .range(a, b),
        'tasks',
    )));
    return pages.flat();
}

async function loadAudit(userIds: string[], sinceDay: string, toDay: string): Promise<AuditRow[]> {
    const pages = await Promise.all(chunks(userIds).map(ids => fetchAll<AuditRow>(
        (a, b) => supabaseAdmin.from('task_audit_logs')
            .select('event_type, actor_id, created_at, details')
            .in('actor_id', ids)
            .gte('created_at', istStart(sinceDay))
            .lte('created_at', istEnd(toDay))
            .order('id')
            .range(a, b),
        'activity records',
    )));
    return pages.flat();
}

/** The first IST day anyone in the base has an activity record. */
async function loadHistoryStart(userIds: string[]): Promise<string | null> {
    const results = await Promise.all(chunks(userIds).map(ids => supabaseAdmin.from('task_audit_logs')
        .select('created_at').in('actor_id', ids).order('created_at', { ascending: true }).limit(1).maybeSingle()));
    const earliest = results.map(r => r.data?.created_at as string | undefined).filter((t): t is string => !!t).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    return earliest ? new Date(Date.parse(earliest) + 330 * 60 * 1000).toISOString().slice(0, 10) : null;
}

export async function buildUsageReport(organizationId: string, from: string, to: string, generatedAt: string): Promise<UsageReport> {
    const previousFrom = addDays(from, -spanDays(from, to));
    const people = await loadReportPeople(organizationId);
    const userIds = people.map(p => p.userId);
    const [orgName, tasks, audit, historyFrom] = await Promise.all([
        loadOrgName(organizationId),
        loadTasks(userIds, previousFrom),
        loadAudit(userIds, previousFrom, to),
        loadHistoryStart(userIds),
    ]);
    return computeUsageReport({ orgName, from, to, generatedAt, historyFrom, people, tasks, audit });
}
