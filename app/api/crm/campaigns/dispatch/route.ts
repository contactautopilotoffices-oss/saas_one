import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { WhatsAppService } from '@/backend/services/WhatsAppService';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';

const BATCH = 100;

/**
 * POST /api/crm/campaigns/dispatch
 *
 * Sends all due (scheduled_at <= now, status='pending') campaign recipients
 * via the existing WhatsAppService. Two ways to call it:
 *   - Cron:  Authorization: Bearer <CRON_SECRET>   -> processes ALL orgs
 *   - Admin: normal CRM session + ?org_id=         -> processes that org only
 *
 * Wire the cron the same way the other queues are (Vercel cron, ~1 min).
 */
export async function POST(request: NextRequest) {
    const authHeader = request.headers.get('authorization') || '';
    const isCron = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;

    let orgFilter: string | null = null;
    if (!isCron) {
        const access = await resolveCrmAccess(request, readOrgId(request));
        if (isCrmAccessError(access)) return access;
        if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        orgFilter = access.organizationId;
    }

    const nowIso = new Date().toISOString();
    let q = supabaseAdmin
        .from('crm_campaign_recipients')
        .select('id, campaign_id, phone, message, crm_campaigns!inner(organization_id, status)')
        .eq('status', 'pending')
        .lte('scheduled_at', nowIso)
        .order('scheduled_at', { ascending: true })
        .limit(BATCH);
    if (orgFilter) q = q.eq('crm_campaigns.organization_id', orgFilter);

    const { data: due, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let sent = 0;
    let failed = 0;
    const touchedCampaigns = new Set<string>();

    for (const r of due || []) {
        // Skip recipients whose campaign was cancelled.
        if ((r as any).crm_campaigns?.status === 'cancelled') {
            await supabaseAdmin.from('crm_campaign_recipients')
                .update({ status: 'skipped' }).eq('id', r.id);
            continue;
        }
        touchedCampaigns.add(r.campaign_id);
        let ok = false;
        try {
            ok = await WhatsAppService.sendAsync(r.phone, { message: r.message, moduleName: 'crm' });
        } catch {
            ok = false;
        }
        await supabaseAdmin.from('crm_campaign_recipients').update({
            status: ok ? 'sent' : 'failed',
            sent_at: ok ? new Date().toISOString() : null,
            error: ok ? null : 'send failed',
        }).eq('id', r.id);
        ok ? sent++ : failed++;
        // Light throttle to be gentle on the WhatsApp provider.
        await new Promise((res) => setTimeout(res, 300));
    }

    // Recompute counters / completion for the campaigns we touched.
    for (const cid of touchedCampaigns) {
        const { data: counts } = await supabaseAdmin
            .from('crm_campaign_recipients')
            .select('status')
            .eq('campaign_id', cid);
        const all = counts || [];
        const sentCount = all.filter((x) => x.status === 'sent').length;
        const failedCount = all.filter((x) => x.status === 'failed').length;
        const pending = all.filter((x) => x.status === 'pending').length;
        await supabaseAdmin.from('crm_campaigns').update({
            sent_count: sentCount,
            failed_count: failedCount,
            status: pending === 0 ? 'completed' : 'running',
        }).eq('id', cid);
    }

    return NextResponse.json({ processed: (due || []).length, sent, failed });
}
