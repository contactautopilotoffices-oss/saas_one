// auditService.ts – core logic for Digital Audit feature
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Generates audit data for a given organization/property and month.
 * Returns summary and detailed items.
 */
export async function generateAudit(
  organizationId: string,
  propertyId: string | null,
  auditMonth: string // format YYYY-MM
) {
  // Parse month range
  const [year, month] = auditMonth.split('-');
  const fromDate = `${auditMonth}-01`;
  const toDate = new Date(Number(year), Number(month), 0) // last day of month
    .toISOString()
    .split('T')[0];

  // Fetch PPM schedules for the month
  let query = supabaseAdmin
    .from('ppm_schedules')
    .select('*')
    .eq('organization_id', organizationId)
    .gte('planned_date', fromDate)
    .lte('planned_date', toDate);

  if (propertyId) query = query.eq('property_id', propertyId);

  const { data: schedules, error } = await query;
  if (error) throw error;

  const total = schedules?.length ?? 0;
  const items = [] as any[];
  let completed = 0;

  for (const sched of schedules ?? []) {
    // Check for attached completion report (assuming table ppm_completion_reports)
    const { data: reports } = await supabaseAdmin
      .from('ppm_completion_reports')
      .select('id, attachment_url')
      .eq('schedule_id', sched.id)
      .single();

    const hasReport = !!reports;
    if (hasReport) completed++;

    items.push({
      id: sched.id,
      system_name: sched.system_name,
      scheduled_date: sched.planned_date,
      status: sched.status,
      has_report: hasReport,
      attachment_url: reports?.attachment_url ?? null,
    });
  }

  const pending = total - completed;
  const compliance_pct = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;

  // Persist audit report
  const { error: insErr } = await supabaseAdmin.from('ppm_audit_reports').insert({
    organization_id: organizationId,
    property_id: propertyId,
    audit_month: `${auditMonth}-01`, // Ensure valid DATE syntax for DB
    total_tasks: total,
    completed_tasks: completed,
    pending_tasks: pending,
    compliance_pct,
  });
  if (insErr) throw insErr;

  return { summary: { total, completed, pending, compliance_pct }, items };
}
