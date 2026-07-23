import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';

/**
 * GET /api/crm/campaigns/performance
 *
 * Performance Marketing dashboard data — single comprehensive payload the
 * PerformanceMarketingDashboard component renders without further client-side
 * aggregation. Combines:
 *   - crm_campaigns          (campaign metadata, channel, budget, dates)
 *   - crm_campaign_spend     (daily manual + meta_api spend rows)
 *   - crm_campaign_metrics   (impressions / clicks / CTR / CPC / CPM)
 *   - crm_leads              (attribution by name match to campaign)
 *
 * Query params:
 *   from=YYYY-MM-DD            (required)
 *   to=YYYY-MM-DD              (required)
 *   campaign_id=...            (optional, repeatable)
 *   channel=meta_ads|google    (optional filter)
 *
 * Response shape (campaignPerformance):
 *   {
 *     period, kpis, campaigns[], daily_spend[], source_breakdown[],
 *     city_breakdown[], ai_insights[] (deterministic from campaignAiEngine)
 *   }
 */

export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin && !access.isMasterAdmin) {
        return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!from || !to) {
        return NextResponse.json(
            { error: 'from and to query params required (YYYY-MM-DD)' },
            { status: 400 }
        );
    }
    const campaignIds = url.searchParams.getAll('campaign_id');
    const channel = url.searchParams.get('channel');

    // ── 1. All campaigns (filtered) ───────────────────────────────────────────
    let campaignsQ = supabaseAdmin
        .from('crm_campaigns')
        .select('id, name, channel, budget_total, budget_period, start_date, end_date, status, created_at, meta_campaign_id')
        .eq('organization_id', access.organizationId)
        .order('created_at', { ascending: false });
    if (campaignIds.length) campaignsQ = campaignsQ.in('id', campaignIds);
    if (channel) campaignsQ = campaignsQ.eq('channel', channel);
    const { data: campaigns } = await campaignsQ;

    const cList = campaigns || [];
    const cIds = cList.map((c: any) => c.id);

    // ── 2. Spend rows in the window ──────────────────────────────────────────
    const { data: spendRows } = cIds.length
        ? await supabaseAdmin
            .from('crm_campaign_spend')
            .select('id, campaign_id, spend_date, amount, source')
            .eq('organization_id', access.organizationId)
            .in('campaign_id', cIds)
            .gte('spend_date', from)
            .lte('spend_date', to)
        : { data: [] };

    // ── 3. Metrics (impressions/clicks/CTR/CPC/CPM) in the window ───────────
    const { data: metricsRows } = cIds.length
        ? await supabaseAdmin
            .from('crm_campaign_metrics')
            .select('campaign_id, metric_date, impressions, clicks, ctr, cpc, cpm')
            .eq('organization_id', access.organizationId)
            .in('campaign_id', cIds)
            .gte('metric_date', from)
            .lte('metric_date', to)
        : { data: [] };

    // ── 4. Leads in window, joined to campaigns by NAME (same convention as
    //      the impact report — crm_leads.campaign is a free-text name) ───────
    const fromMs = new Date(from + 'T00:00:00Z').getTime();
    const toMs = new Date(to + 'T23:59:59.999Z').getTime();

    // Lookback 24 months for closed events that might fall in this window.
    const { data: rawLeads } = await supabaseAdmin
        .from('crm_leads')
        .select(`
            id, status, deal_value, priority, created_at, updated_at, closed_at,
            last_contacted, lead_source, campaign, organization_id, assigned_to,
            city, source_info:crm_lead_sources(id, name),
            status_info:crm_lead_statuses(id, name, is_won, is_lost, is_terminal)
        `)
        .eq('organization_id', access.organizationId)
        .eq('is_archived', false)
        .gte('created_at', new Date(fromMs - 730 * 86400_000).toISOString());

    const campaignByName = new Map<string, any>();
    // Also index by meta_campaign_id for leads that carry it
    const campaignByMetaId = new Map<string, any>();
    for (const c of cList) {
        if (c.name) campaignByName.set(c.name.trim().toLowerCase(), c);
        if (c.meta_campaign_id) campaignByMetaId.set(String(c.meta_campaign_id), c);
    }

    // Build keyword index: each campaign keyword → campaign (for fuzzy match on short names
    // like "Lower Parel" → "Lead Generation - Lower Parel (New)")
    const campaignKeywords: Array<{ keywords: string[]; campaign: any }> = cList.map((c: any) => ({
        keywords: (c.name || '').toLowerCase().split(/[\s|,()\-]+/).filter((w: string) => w.length > 3),
        campaign: c,
    }));

    function resolveCampaign(leadCampaign: string | null, leadMetaCampaignId: string | null): any {
        if (!leadCampaign && !leadMetaCampaignId) return null;
        if (leadMetaCampaignId) {
            const byId = campaignByMetaId.get(leadMetaCampaignId);
            if (byId) return byId;
        }
        if (!leadCampaign) return null;
        const lc = leadCampaign.trim().toLowerCase();
        // Exact match
        const exact = campaignByName.get(lc);
        if (exact) return exact;
        // Fuzzy: campaign name contains the lead's campaign value, or vice versa
        for (const c of cList) {
            const cn = (c.name || '').toLowerCase();
            if (cn.includes(lc) || lc.includes(cn.replace(/\s*(lead gen|lead generation|leads|jan\d{4}|new|\(.*?\))\s*/gi, '').trim())) {
                return c;
            }
        }
        // Keyword-overlap scoring: pick the campaign sharing the most distinctive
        // words (e.g. "Managed Office - Lower Parel" ↔ "Lead Generation - Lower Parel"
        // both share "lower","parel"). Generic words are pre-filtered out below.
        const GENERIC = new Set(['lead', 'leads', 'generation', 'managed', 'office', 'offices', 'campaign', 'meta', 'turnkey', 'ad', 'adset', 'form', 'demand', 'lead gen', 'jan', 'jan2026', '2026', '2025', 'new', 'copy', 'untitled', 'generated']);
        const leadWords = lc.split(/[\s|,()\-]+/).filter((w: string) => w.length > 3 && !GENERIC.has(w));
        if (leadWords.length > 0) {
            let best: any = null;
            let bestScore = 0;
            for (const { keywords, campaign } of campaignKeywords) {
                const distinctive = keywords.filter((k: string) => !GENERIC.has(k));
                const score = leadWords.filter((w: string) => distinctive.some((k: string) => k.includes(w) || w.includes(k))).length;
                if (score > bestScore) { bestScore = score; best = campaign; }
            }
            if (best && bestScore >= 1) return best;
        }
        return null;
    }

    const leads = (rawLeads || []).filter((l: any) => {
        const cm = new Date(l.created_at).getTime();
        const cls = l.closed_at ? new Date(l.closed_at).getTime() : null;
        return (cm >= fromMs && cm <= toMs) || (cls != null && cls >= fromMs && cls <= toMs);
    });

    // ── 5. Per-campaign roll-up ──────────────────────────────────────────────
    const leadAgg: Record<string, {
        leads: number;
        connected: number;
        won: number;
        lost: number;
        pipeline: number;
        won_value: number;
        last_contacted_ms: number | null;
    }> = {};
    for (const c of cList) leadAgg[c.id] = emptyAgg();

    for (const l of leads as any[]) {
        const ci = resolveCampaign(l.campaign, l.meta_campaign_id);
        if (!ci) continue;
        const a = leadAgg[ci.id];
        if (!a) continue;
        a.leads++;
        a.pipeline += Number(l.deal_value || 0);
        if (l.status_info?.is_won) { a.won++; a.won_value += Number(l.deal_value || 0); }
        if (l.status_info?.is_lost) a.lost++;
        if (l.last_contacted) {
            const t = new Date(l.last_contacted).getTime();
            if (!a.last_contacted_ms || t > a.last_contacted_ms) a.last_contacted_ms = t;
        }
    }

    // ── 6. Per-campaign spend / metrics roll-up ──────────────────────────────
    const spendAgg: Record<string, {
        spend: number;
        manual_spend: number;
        meta_spend: number;
        daily: Record<string, number>;
    }> = {};
    for (const c of cList) spendAgg[c.id] = { spend: 0, manual_spend: 0, meta_spend: 0, daily: {} };

    for (const r of (spendRows || []) as any[]) {
        const a = spendAgg[r.campaign_id];
        if (!a) continue;
        const amt = Number(r.amount || 0);
        a.spend += amt;
        if (r.source === 'meta_api') a.meta_spend += amt;
        else a.manual_spend += amt;
        a.daily[r.spend_date] = (a.daily[r.spend_date] || 0) + amt;
    }

    const metricAgg: Record<string, {
        impressions: number;
        clicks: number;
        ctr_sum: number;
        ctr_n: number;
        cpc_sum: number;
        cpc_n: number;
        cpm_sum: number;
        cpm_n: number;
    }> = {};
    for (const c of cList) metricAgg[c.id] = emptyMetricAgg();

    for (const r of (metricsRows || []) as any[]) {
        const a = metricAgg[r.campaign_id];
        if (!a) continue;
        a.impressions += Number(r.impressions || 0);
        a.clicks += Number(r.clicks || 0);
        if (r.ctr != null) { a.ctr_sum += Number(r.ctr); a.ctr_n++; }
        if (r.cpc != null) { a.cpc_sum += Number(r.cpc); a.cpc_n++; }
        if (r.cpm != null) { a.cpm_sum += Number(r.cpm); a.cpm_n++; }
    }

    // ── 7. Compose the per-campaign list ─────────────────────────────────────
    const campPerf = cList.map((c: any) => {
        const s = spendAgg[c.id];
        const m = metricAgg[c.id];
        const l = leadAgg[c.id];
        const ctr = m.impressions > 0 ? (m.clicks / m.impressions) * 100 : (m.ctr_n > 0 ? m.ctr_sum / m.ctr_n : null);
        return {
            id: c.id,
            name: c.name,
            channel: c.channel,
            status: c.status,
            budget_total: c.budget_total || 0,
            budget_period: c.budget_period,
            start_date: c.start_date,
            end_date: c.end_date,
            spend: s.spend,
            manual_spend: s.manual_spend,
            meta_spend: s.meta_spend,
            leads: l.leads,
            won: l.won,
            lost: l.lost,
            won_value: l.won_value,
            pipeline_value: l.pipeline,
            impressions: m.impressions,
            clicks: m.clicks,
            ctr,
            cpc: m.cpc_n > 0 ? m.cpc_sum / m.cpc_n : null,
            cpm: m.cpm_n > 0 ? m.cpm_sum / m.cpm_n : null,
            cpl: l.leads > 0 ? s.spend / l.leads : null,
            cpa: l.won > 0 ? s.spend / l.won : null,
            roi: s.spend > 0 ? ((l.won_value - s.spend) / s.spend) * 100 : null,
            daily: s.daily,
            last_contacted_ms: l.last_contacted_ms,
        };
    });

    // ── 8. Daily total spend timeline ────────────────────────────────────────
    const dailyTotal: Record<string, number> = {};
    for (const r of (spendRows || []) as any[]) {
        dailyTotal[r.spend_date] = (dailyTotal[r.spend_date] || 0) + Number(r.amount || 0);
    }
    const dailyTimeline = Object.entries(dailyTotal)
        .map(([date, amount]) => ({ date, amount }))
        .sort((a, b) => a.date.localeCompare(b.date));

    // ── 9. Source + city breakdowns (attribution by lead_source) ─────────────
    const srcAgg: Record<string, { name: string; leads: number; won: number; value: number }> = {};
    const cityAgg: Record<string, { name: string; leads: number; won: number; value: number }> = {};
    for (const l of leads as any[]) {
        if (new Date(l.created_at).getTime() < fromMs) continue;
        const sInfo = Array.isArray(l.source_info) ? l.source_info[0] : l.source_info;
        const src = sInfo?.name || 'Unknown';
        if (!srcAgg[src]) srcAgg[src] = { name: src, leads: 0, won: 0, value: 0 };
        srcAgg[src].leads++;
        srcAgg[src].value += Number(l.deal_value || 0);
        if (l.status_info?.is_won) srcAgg[src].won++;

        const city = (l.city || 'Unknown').trim() || 'Unknown';
        if (!cityAgg[city]) cityAgg[city] = { name: city, leads: 0, won: 0, value: 0 };
        cityAgg[city].leads++;
        cityAgg[city].value += Number(l.deal_value || 0);
        if (l.status_info?.is_won) cityAgg[city].won++;
    }

    // ── 10. KPIs (portfolio-level) ───────────────────────────────────────────
    const totalSpend = campPerf.reduce((s, c) => s + c.spend, 0);
    const totalLeads = campPerf.reduce((s, c) => s + c.leads, 0);
    const totalWon = campPerf.reduce((s, c) => s + c.won, 0);
    const totalWonValue = campPerf.reduce((s, c) => s + c.won_value, 0);
    const totalPipeline = campPerf.reduce((s, c) => s + c.pipeline_value, 0);
    const totalImpressions = campPerf.reduce((s, c) => s + c.impressions, 0);
    const totalClicks = campPerf.reduce((s, c) => s + c.clicks, 0);

    // ── 11. Blended by-channel rollup (cross-channel report) ─────────────────
    const channelAgg: Record<string, any> = {};
    for (const c of campPerf) {
        const key = c.channel || 'other';
        const a = channelAgg[key] || (channelAgg[key] = {
            channel: key, spend: 0, leads: 0, won: 0, won_value: 0,
            impressions: 0, clicks: 0, campaigns: 0,
        });
        a.spend += c.spend; a.leads += c.leads; a.won += c.won;
        a.won_value += c.won_value; a.impressions += c.impressions;
        a.clicks += c.clicks; a.campaigns += 1;
    }
    const byChannel = Object.values(channelAgg).map((a: any) => ({
        ...a,
        ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : null,
        cpl: a.leads > 0 ? a.spend / a.leads : null,
        roi: a.spend > 0 ? ((a.won_value - a.spend) / a.spend) * 100 : null,
    })).sort((a: any, b: any) => b.spend - a.spend);

    return NextResponse.json({
        period: { from, to },
        kpis: {
            total_spend: totalSpend,
            total_leads: totalLeads,
            total_won: totalWon,
            total_won_value: totalWonValue,
            total_pipeline: totalPipeline,
            cpl: totalLeads > 0 ? totalSpend / totalLeads : 0,
            cpa: totalWon > 0 ? totalSpend / totalWon : 0,
            roi: totalSpend > 0 ? ((totalWonValue - totalSpend) / totalSpend) * 100 : 0,
            win_rate: totalLeads > 0 ? (totalWon / totalLeads) * 100 : 0,
            total_impressions: totalImpressions,
            total_clicks: totalClicks,
            ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
        },
        campaigns: campPerf,
        by_channel: byChannel,
        daily_spend: dailyTimeline,
        source_breakdown: Object.values(srcAgg).sort((a, b) => b.leads - a.leads),
        city_breakdown: Object.values(cityAgg).sort((a, b) => b.leads - a.leads),
        generated_at: new Date().toISOString(),
    });
}

function emptyAgg() {
    return { leads: 0, connected: 0, won: 0, lost: 0, pipeline: 0, won_value: 0, last_contacted_ms: null as number | null };
}
function emptyMetricAgg() {
    return { impressions: 0, clicks: 0, ctr_sum: 0, ctr_n: 0, cpc_sum: 0, cpc_n: 0, cpm_sum: 0, cpm_n: 0 };
}