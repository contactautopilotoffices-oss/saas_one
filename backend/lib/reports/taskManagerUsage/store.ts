import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingRelation } from '@/backend/lib/commandCenter/access';
import { DEFAULT_SCHEDULE, nextRunAfter, type ReportFrequency, type ReportSchedule } from './schedule';

/**
 * Task Manager Usage Report: the saved schedule and saved PDFs.
 *
 * Migration 20261104000002 may not have been run yet. Until it has, `provisioned` is false: reports can still be generated
 * and downloaded, and only scheduling and saving wait.
 */

export const REPORT_BUCKET = 'task-manager-reports';
const SIGNED_URL_SECONDS = 600;
const HISTORY_LIMIT = 50;

export type ReportTrigger = 'manual' | 'scheduled';

export interface SavedReport {
    id: string;
    periodFrom: string;
    periodTo: string;
    trigger: ReportTrigger;
    status: 'ready' | 'failed';
    fileSize: number | null;
    createdAt: string;
}

interface SettingsRow {
    organization_id: string;
    enabled: boolean;
    frequency: ReportFrequency;
    day_of_week: number;
    day_of_month: number;
    time_ist: string;
    coverage_days: number;
    next_run_at: string | null;
}

export interface ScheduleState {
    provisioned: boolean;
    schedule: ReportSchedule;
    nextRunAt: string | null;
}

const toSchedule = (r: SettingsRow): ReportSchedule => ({
    enabled: r.enabled,
    frequency: r.frequency,
    dayOfWeek: r.day_of_week,
    dayOfMonth: r.day_of_month,
    timeIst: r.time_ist,
    coverageDays: r.coverage_days,
});

export async function getScheduleState(organizationId: string): Promise<ScheduleState> {
    const { data, error } = await supabaseAdmin.from('task_manager_report_settings')
        .select('*').eq('organization_id', organizationId).maybeSingle();
    if (isMissingRelation(error)) return { provisioned: false, schedule: DEFAULT_SCHEDULE, nextRunAt: null };
    if (error) throw new Error(`Could not read the report schedule: ${error.message}`);
    if (!data) return { provisioned: true, schedule: DEFAULT_SCHEDULE, nextRunAt: null };
    return { provisioned: true, schedule: toSchedule(data as SettingsRow), nextRunAt: data.enabled ? data.next_run_at : null };
}

export async function saveSchedule(organizationId: string, schedule: ReportSchedule, userId: string): Promise<ScheduleState> {
    const nextRunAt = schedule.enabled ? new Date(nextRunAfter(schedule, Date.now())).toISOString() : null;
    const { error } = await supabaseAdmin.from('task_manager_report_settings').upsert({
        organization_id: organizationId,
        enabled: schedule.enabled,
        frequency: schedule.frequency,
        day_of_week: schedule.dayOfWeek,
        day_of_month: schedule.dayOfMonth,
        time_ist: schedule.timeIst,
        coverage_days: schedule.coverageDays,
        next_run_at: nextRunAt,
        updated_by: userId,
        updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Could not save the report schedule: ${error.message}`);
    return { provisioned: true, schedule, nextRunAt };
}

export interface DueSchedule {
    organizationId: string;
    schedule: ReportSchedule;
    scheduledAt: string;
}

export async function listDueSchedules(nowIso: string): Promise<DueSchedule[]> {
    const { data, error } = await supabaseAdmin.from('task_manager_report_settings')
        .select('*').eq('enabled', true).lte('next_run_at', nowIso);
    if (isMissingRelation(error)) return [];
    if (error) throw new Error(`Could not read due report schedules: ${error.message}`);
    return ((data ?? []) as SettingsRow[]).map(r => ({
        organizationId: r.organization_id,
        schedule: toSchedule(r),
        scheduledAt: r.next_run_at as string,
    }));
}

/**
 * Move a due schedule on to its next run. Only one caller can win, because the update matches the run time it read, so
 * two overlapping cron calls cannot both produce the report.
 */
export async function claimRun(due: DueSchedule, nextRunAt: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin.from('task_manager_report_settings')
        .update({ next_run_at: nextRunAt })
        .eq('organization_id', due.organizationId)
        .eq('enabled', true)
        .eq('next_run_at', due.scheduledAt)
        .select('organization_id');
    if (error) throw new Error(`Could not claim the scheduled report: ${error.message}`);
    return (data ?? []).length > 0;
}

export async function listSavedReports(organizationId: string): Promise<{ provisioned: boolean; reports: SavedReport[] }> {
    const { data, error } = await supabaseAdmin.from('task_manager_reports')
        .select('id, period_from, period_to, trigger, status, file_size, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT);
    if (isMissingRelation(error)) return { provisioned: false, reports: [] };
    if (error) throw new Error(`Could not read saved reports: ${error.message}`);
    return {
        provisioned: true,
        reports: (data ?? []).map(r => ({
            id: r.id,
            periodFrom: r.period_from,
            periodTo: r.period_to,
            trigger: r.trigger,
            status: r.status,
            fileSize: r.file_size,
            createdAt: r.created_at,
        })),
    };
}

/** Keeps a generated PDF. Never throws: failing to save must not cost the viewer the report they just generated. */
export async function saveReport(params: {
    organizationId: string;
    from: string;
    to: string;
    trigger: ReportTrigger;
    userId: string | null;
    pdf: Buffer;
}): Promise<string | null> {
    const { organizationId, from, to, trigger, userId, pdf } = params;
    try {
        const path = `${organizationId}/${from}_${to}_${crypto.randomUUID()}.pdf`;
        const upload = await supabaseAdmin.storage.from(REPORT_BUCKET).upload(path, pdf, { contentType: 'application/pdf' });
        if (upload.error) throw new Error(upload.error.message);
        const { data, error } = await supabaseAdmin.from('task_manager_reports').insert({
            organization_id: organizationId, period_from: from, period_to: to, trigger, status: 'ready',
            storage_path: path, file_size: pdf.length, generated_by: userId,
        }).select('id').single();
        if (error) {
            await supabaseAdmin.storage.from(REPORT_BUCKET).remove([path]);
            throw new Error(error.message);
        }
        return data.id;
    } catch (e) {
        console.warn('[task-manager-usage] report was not saved:', e instanceof Error ? e.message : e);
        return null;
    }
}

/** Records a scheduled run that failed, so the Saved reports list shows it rather than a silent gap. */
export async function recordFailedRun(organizationId: string, from: string, to: string, message: string): Promise<void> {
    const { error } = await supabaseAdmin.from('task_manager_reports').insert({
        organization_id: organizationId, period_from: from, period_to: to, trigger: 'scheduled', status: 'failed', error: message.slice(0, 500),
    });
    if (error) console.error('[task-manager-usage] could not record a failed run:', error.message);
}

/** A 10-minute download link, only for a report that belongs to this organisation. */
export async function signedReportUrl(organizationId: string, id: string): Promise<{ url: string; fileName: string } | null> {
    const { data, error } = await supabaseAdmin.from('task_manager_reports')
        .select('storage_path, period_from, period_to')
        .eq('id', id).eq('organization_id', organizationId).eq('status', 'ready').maybeSingle();
    if (error) {
        if (isMissingRelation(error)) return null;
        throw new Error(`Could not find the report: ${error.message}`);
    }
    if (!data?.storage_path) return null;
    const fileName = reportFileName(data.period_from, data.period_to);
    const signed = await supabaseAdmin.storage.from(REPORT_BUCKET)
        .createSignedUrl(data.storage_path, SIGNED_URL_SECONDS, { download: fileName });
    if (signed.error) throw new Error(`Could not create the download link: ${signed.error.message}`);
    return { url: signed.data.signedUrl, fileName };
}

export const reportFileName = (from: string, to: string): string => `task-manager-usage-report-${from}-to-${to}.pdf`;
