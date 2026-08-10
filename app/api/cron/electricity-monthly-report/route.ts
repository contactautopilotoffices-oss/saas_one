import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { loadMonthlyReportData, buildElectricityMonthlyReportPdf } from '@/backend/lib/electricity/monthlyReportPdf';
import { loadReportRecipients, sendMonthlyReport } from '@/backend/lib/electricity/monthlyReportMailer';

/**
 * GET /api/cron/electricity-monthly-report
 *
 * Emails last month's electricity pack to every org's ops_super_admin / org_super_admin
 * members (Phase 5 of docs/ELECTRICITY_AUTOMATION_PLAN.md). Bearer-guarded like the
 * other cron routes. Needs vercel.json schedule `0 5 5 * *` — the 5th of the month,
 * after most bills have arrived.
 *
 * The org set is derived from electricity_billing_accounts: an org with no accounts has
 * nothing to report and gets no email. Per-org failures are collected, not thrown — one
 * broken SMTP session must not silence the other orgs.
 */

// One Chromium render per org, sequentially, well past the default function timeout.
export const maxDuration = 300;

function lastMonth(): string {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
}

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const month = lastMonth();
    const monthLabelText = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', {
        month: 'long', year: 'numeric', timeZone: 'UTC',
    });

    const { data: accounts, error } = await supabaseAdmin
        .from('electricity_billing_accounts')
        .select('organization_id')
        .range(0, 9999);

    if (error) {
        console.error('[electricity-monthly-report] org lookup failed:', error.message);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const orgIds = [...new Set((accounts || []).map(a => a.organization_id).filter(Boolean))];
    const results: Array<{ organization_id: string; ok: boolean; sent_to?: number; error?: string; skipped?: string }> = [];

    for (const organizationId of orgIds) {
        try {
            const data = await loadMonthlyReportData(organizationId, month);
            if (!data.provisioned) {
                results.push({ organization_id: organizationId, ok: true, skipped: 'not provisioned' });
                continue;
            }
            const recipients = await loadReportRecipients(organizationId);
            if (!recipients.length) {
                results.push({ organization_id: organizationId, ok: true, skipped: 'no recipients' });
                continue;
            }
            const pdf = await buildElectricityMonthlyReportPdf(data);
            const sent = await sendMonthlyReport({
                to: recipients,
                orgName: data.orgName,
                monthLabel: monthLabelText,
                pdf,
                filename: `electricity-report-${month}.pdf`,
            });
            results.push({
                organization_id: organizationId,
                ok: sent.sent,
                sent_to: sent.sent ? recipients.length : undefined,
                error: sent.error,
            });
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            console.error(`[electricity-monthly-report] org ${organizationId} failed:`, message);
            results.push({ organization_id: organizationId, ok: false, error: message });
        }
    }

    const failed = results.filter(r => !r.ok).length;
    // A run that failed for every org must not read as healthy in Vercel's cron log.
    return NextResponse.json(
        { ok: failed === 0, month, results },
        { status: failed > 0 && failed === results.length ? 500 : 200 },
    );
}
