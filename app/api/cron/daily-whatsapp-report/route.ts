import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { WhatsAppRecipientResolver } from '@/backend/services/WhatsAppRecipientResolver';
import { WhatsAppQueueService } from '@/backend/services/WhatsAppQueueService';

/**
 * GET /api/cron/daily-whatsapp-report
 * Generates an AI-driven executive summary of tickets, electricity consumption,
 * PPM completed vs missed, and SOP compliance across all properties.
 */
export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: orgSettings, error: orgsErr } = await supabaseAdmin
        .from('organization_settings')
        .select('organization_id, notification_matrix, whatsapp_service_config, whatsapp_templates, organizations:organization_id(id, name)');

    if (orgsErr) {
        return NextResponse.json({ error: orgsErr.message }, { status: 500 });
    }

    const ACTIVE_STATUSES = ['open', 'waitlist', 'assigned', 'in_progress', 'paused', 'blocked'];
    const results: { orgId: string; orgName: string; recipients: number; sent: boolean; error?: string }[] = [];

    const now = new Date();
    const dateLabel = now.toLocaleDateString('en-GB', {
        timeZone: 'Asia/Kolkata',
    }); // Formats to dd/mm/yyyy (e.g. 21/08/2026)
    const todayStr = now.toISOString().split('T')[0];

    for (const row of orgSettings || []) {
        const orgId = row.organization_id;
        const orgName = (row.organizations as any)?.name || 'AutoPilot Organization';

        try {
            const matrix = (row as any).notification_matrix || {};
            const waConfig = (row as any).whatsapp_service_config || {};
            const reportConfig = matrix?.scheduled_reports?.daily_property_report || waConfig?.scheduled_reports || {};

            const isEnabled = reportConfig?.channels?.whatsapp === true || reportConfig?.enabled === true;
            if (!isEnabled) {
                continue;
            }

            // 1. Properties
            const { data: properties } = await supabaseAdmin
                .from('properties')
                .select('id, name')
                .eq('organization_id', orgId);

            const propIds = (properties || []).map(p => p.id);

            // 2. Tickets
            const { data: tickets } = await supabaseAdmin
                .from('tickets')
                .select('id, status, priority, property_id, created_at, resolved_at')
                .eq('organization_id', orgId);

            const allTickets = tickets || [];
            const activeTickets = allTickets.filter(t => ACTIVE_STATUSES.includes((t as any).status ?? ''));
            const resolvedTodayTickets = allTickets.filter(t => (t as any).status === 'resolved' || (t as any).status === 'closed');

            let criticalCount = 0;
            let highCount = 0;
            const propertyActive: Record<string, number> = {};

            for (const t of activeTickets) {
                const p = ((t as any).priority || 'medium').toLowerCase();
                if (p === 'critical') criticalCount++;
                if (p === 'high') highCount++;
                const pid = (t as any).property_id || 'unknown';
                propertyActive[pid] = (propertyActive[pid] || 0) + 1;
            }

            // 3. Electricity / Utility Consumption Logged Today
            let totalElectricityKwh = 0;
            let totalDgLiters = 0;

            try {
                const { data: utilityLogs } = await supabaseAdmin
                    .from('property_utility_readings')
                    .select('reading_value, utility_type')
                    .in('property_id', propIds.length > 0 ? propIds : ['00000000-0000-0000-0000-000000000000'])
                    .gte('reading_date', todayStr);

                (utilityLogs || []).forEach((u: any) => {
                    if (u.utility_type === 'electricity') totalElectricityKwh += Number(u.reading_value || 0);
                    if (u.utility_type === 'diesel' || u.utility_type === 'dg') totalDgLiters += Number(u.reading_value || 0);
                });
            } catch {
                // Utility reading table optional
            }

            // 4. SOP Checklists
            const { count: sopDoneCount } = await supabaseAdmin
                .from('sop_completions')
                .select('id', { count: 'exact', head: true })
                .gte('completed_at', `${todayStr}T00:00:00Z`);

            const { count: activeTemplatesCount } = await supabaseAdmin
                .from('sop_templates')
                .select('id', { count: 'exact', head: true })
                .eq('is_active', true)
                .in('property_id', propIds.length > 0 ? propIds : ['00000000-0000-0000-0000-000000000000']);

            const totalSopsExpected = activeTemplatesCount || 0;
            const totalSopsDone = sopDoneCount || 0;
            const sopCompliancePct = totalSopsExpected > 0 ? Math.round((totalSopsDone / totalSopsExpected) * 100) : 100;

            // 5. PPM Completed vs Missed
            const { count: ppmCompletedCount } = await supabaseAdmin
                .from('ppm_schedules')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', orgId)
                .eq('status', 'completed')
                .gte('completed_date', todayStr);

            const { count: ppmMissedCount } = await supabaseAdmin
                .from('ppm_schedules')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', orgId)
                .eq('status', 'pending')
                .lt('planned_date', todayStr);

            // AI Insights Engine
            const aiInsights: string[] = [];
            if (criticalCount > 0) {
                aiInsights.push(`• ⚠️ Attention: ${criticalCount} critical ticket(s) require immediate supervision.`);
            } else {
                aiInsights.push(`• ✅ Zero critical ticket escalations today.`);
            }

            if (sopCompliancePct >= 90) {
                aiInsights.push(`• 🎯 High SOP inspection compliance (${sopCompliancePct}%).`);
            } else {
                aiInsights.push(`• ⚠️ SOP compliance is at ${sopCompliancePct}%. Supervisors should follow up on pending checklists.`);
            }

            if ((ppmMissedCount || 0) > 0) {
                aiInsights.push(`• 🔧 Alert: ${ppmMissedCount} preventive maintenance task(s) missed due date.`);
            } else {
                aiInsights.push(`• 🔧 PPM execution on track with zero overdue tasks.`);
            }

            const aiInsightsText = aiInsights.join('\n');

            // Multi-Property Scaling Breakdown Engine
            const propList = properties || [];
            let propertyLines = 'All properties operational';
            if (propList.length > 0) {
                if (propList.length <= 6) {
                    propertyLines = propList
                        .map((prop: any) => `• ${prop.name}: ${propertyActive[prop.id] || 0} open tickets`)
                        .join('\n');
                } else {
                    // Sort descending so sites with open tickets appear first
                    const sorted = [...propList].sort((a, b) => (propertyActive[b.id] || 0) - (propertyActive[a.id] || 0));
                    const topSites = sorted.slice(0, 5).map((prop: any) => `• ${prop.name}: ${propertyActive[prop.id] || 0} open tickets`);
                    const otherCount = propList.length - 5;
                    propertyLines = `${topSites.join('\n')}\n• +${otherCount} other properties (Operational)`;
                }
            }

            // Resolve Recipients
            const { users } = await WhatsAppRecipientResolver.resolveRecipients({
                organizationId: orgId,
                featureKey: 'scheduled_reports'
            });

            if (users.length === 0) {
                const { data: admins } = await supabaseAdmin
                    .from('organization_memberships')
                    .select('user_id')
                    .eq('organization_id', orgId)
                    .in('role', ['org_super_admin', 'owner', 'admin', 'master_admin'])
                    .eq('is_active', true);

                const adminIds = (admins || []).map(a => a.user_id);
                if (adminIds.length > 0) {
                    const { data: adminUsers } = await supabaseAdmin
                        .from('users')
                        .select('id, phone, full_name')
                        .in('id', adminIds);
                    (adminUsers || []).forEach((u: any) => {
                        if (u?.phone) users.push({ id: u.id, phone: u.phone, name: u.full_name || null });
                    });
                }
            }

            if (users.length === 0) {
                results.push({ orgId, orgName, recipients: 0, sent: false });
                continue;
            }

            const templates = (row as any).whatsapp_templates || {};
            const template = templates['daily_property_report'] || {
                campaign_name: 'ai_property_report_v1',
                params: [
                    'user_name', 'org_name', 'date',
                    'critical_count', 'open_count', 'resolved_count',
                    'electricity_kwh', 'dg_liters',
                    'ppm_completed', 'ppm_missed',
                    'sop_compliance', 'property_summary', 'ai_insights'
                ]
            };

            const paramValues: Record<string, string> = {
                user_name: 'Org Super Admin',
                org_name: `${orgName} (${(properties || []).length} Properties)`,
                date: dateLabel,
                critical_count: String(criticalCount),
                open_count: String(activeTickets.length),
                resolved_count: String(resolvedTodayTickets.length),
                electricity_kwh: totalElectricityKwh > 0 ? totalElectricityKwh.toLocaleString() : 'Standard',
                dg_liters: totalDgLiters > 0 ? String(totalDgLiters) : '0',
                ppm_completed: String(ppmCompletedCount || 0),
                ppm_missed: String(ppmMissedCount || 0),
                sop_compliance: `${sopCompliancePct}% (${totalSopsDone}/${totalSopsExpected})`,
                property_summary: propertyLines,
                ai_insights: aiInsightsText
            };

            const orderedParams: string[] = (template.params || []).map((k: string) => paramValues[k] ?? 'N/A');

            const summaryMessage = `🤖 *${orgName} — Daily AI Operations Report*\n📅 ${dateLabel}\n🎫 Tickets: 🔴 ${criticalCount} Critical | 🟠 ${activeTickets.length} Open | ✅ ${resolvedTodayTickets.length} Resolved\n⚡ Energy: ${paramValues.electricity_kwh} kWh (DG: ${paramValues.dg_liters} L)\n🔧 PPM: ${ppmCompletedCount || 0} Done | ⚠️ ${ppmMissedCount || 0} Overdue\n📋 SOPs: ${sopCompliancePct}%\n\n🏢 *Multi-Property Breakdown:*\n${propertyLines}\n\n🤖 *AI Insights:*\n${aiInsightsText}`;

            await WhatsAppQueueService.enqueue({
                userIds: users.map(u => u.id),
                message: summaryMessage,
                eventType: 'DAILY_PROPERTY_REPORT',
                organizationId: orgId,
                templateName: template.campaign_name,
                templateParams: orderedParams
            });

            results.push({ orgId, orgName, recipients: users.length, sent: true });

        } catch (err: any) {
            results.push({ orgId, orgName, recipients: 0, sent: false, error: err.message });
        }
    }

    return NextResponse.json({ success: true, results });
}
