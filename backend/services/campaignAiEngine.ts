/**
 * Campaign AI Engine — deterministic insight layer.
 *
 * Pure functions that take a performance payload (from the /performance
 * endpoint) and return structured insights. No LLM dependency for v1: every
 * signal is a hard threshold on a real number.
 *
 * The "AI" is in the COMPOSITION — picking the right signal from a noisy
 * portfolio, framing it as a recommendation, ranking by severity. The goal is
 * "where are we bleeding / winning / stagnating" surfaced in 1 glance.
 *
 * Severity scale: 4 = critical, 3 = warning, 2 = watch, 1 = info, 0 = good news.
 *
 * Each insight is { severity, kind, campaignId?, title, message, action }.
 * The dashboard renders these as colored pills per-tile.
 */

export type Severity = 4 | 3 | 2 | 1 | 0;
export type InsightKind =
    | 'bleeding'         // spend > 2× median CPL, near zero leads
    | 'underperformer'   // CPL > 1.5× portfolio median
    | 'winner'           // CPL < 0.5× portfolio median, recommend scale
    | 'stale_pipeline'   // leads in window with no contact in 14+ days
    | 'source_concentration' // >70% of leads from one source
    | 'geo_concentration'    // >70% of leads from one city
    | 'meta_spend_drop'      // meta_api < 50% of manual for channel=meta_ads
    | 'no_metrics'           // has spend but zero impressions (sync broken?)
    | 'low_ctr'              // CTR < 0.5% (Meta benchmark ~1%)
    | 'high_cpc'             // CPC > 2× portfolio median
    | 'no_spend'             // active campaign with zero spend rows
    | 'flat_cpl'             // CPL within ±5% of median (healthy baseline)
    | 'positive_roi'
    | 'portfolio_health';    // summary insight (one only, at top)

export interface CampaignInsight {
    severity: Severity;
    kind: InsightKind;
    campaignId?: string;
    title: string;
    message: string;
    action: string;
    /** Numeric magnitude for sorting (e.g. CPL multiplier, ₹ wasted). */
    magnitude?: number;
}

export interface PortfolioInsight extends CampaignInsight {
    /** Index into the dashboards' KPI list — which tile to attach this to. */
    targetKpi: 'spend' | 'leads' | 'cpl' | 'cpa' | 'roi' | 'win_rate' | 'pipeline' | 'meta_sync' | 'overview';
}

export interface CampaignPerf {
    id: string;
    name: string;
    channel: string | null;
    status?: string | null;
    spend: number;
    manual_spend: number;
    meta_spend: number;
    leads: number;
    won: number;
    won_value: number;
    pipeline_value: number;
    impressions: number;
    clicks: number;
    ctr: number | null;
    cpc: number | null;
    cpm: number | null;
    cpl: number | null;
    cpa: number | null;
    roi: number | null;
    daily: Record<string, number>;
    last_contacted_ms: number | null;
    start_date: string | null;
    end_date: string | null;
}

export interface PerformancePayload {
    period: { from: string; to: string };
    kpis: {
        total_spend: number;
        total_leads: number;
        total_won: number;
        total_won_value: number;
        total_pipeline: number;
        cpl: number;
        cpa: number;
        roi: number;
        win_rate: number;
        total_impressions: number;
        total_clicks: number;
        ctr: number;
    };
    campaigns: CampaignPerf[];
    daily_spend: { date: string; amount: number }[];
    source_breakdown: { name: string; leads: number; won: number; value: number }[];
    city_breakdown: { name: string; leads: number; won: number; value: number }[];
    by_channel?: {
        channel: string; spend: number; leads: number; won: number; won_value: number;
        impressions: number; clicks: number; campaigns: number;
        ctr: number | null; cpl: number | null; roi: number | null;
    }[];
}

// ── Industry baselines (B2B flexible office space, India) ────────────────────
const BASELINE = {
    cpl: 1200,        // ₹/lead — Meta lead ads in commercial real estate
    ctr: 1.0,         // % — Meta benchmark for awareness campaigns
    win_rate: 15,     // % — closed-won from total leads
    cpc: 50,          // ₹/click — high-intent commercial search/display
    roi_healthy: 200, // % — 3× return on ad spend is the target
    stale_days: 14,
};

const now = () => Date.now();

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Per-campaign insights. Shown in the table row + the campaign detail view. */
export function campaignInsights(c: CampaignPerf): CampaignInsight[] {
    const out: CampaignInsight[] = [];

    // 1. Bleeding: zero leads + spend > 0
    if (c.spend > 0 && c.leads === 0) {
        const wasted = c.spend;
        out.push({
            severity: 4,
            kind: 'bleeding',
            campaignId: c.id,
            title: 'Bleeding budget',
            message: `₹${fmt(wasted)} spent, 0 leads.`,
            action: 'Pause this campaign and review audience + creative.',
            magnitude: wasted,
        });
    }

    // 2. Underperformer: CPL > 1.5× baseline
    if (c.leads > 0 && c.cpl != null && c.cpl > BASELINE.cpl * 1.5) {
        out.push({
            severity: 3,
            kind: 'underperformer',
            campaignId: c.id,
            title: 'CPL above benchmark',
            message: `₹${Math.round(c.cpl).toLocaleString('en-IN')}/lead vs ₹${BASELINE.cpl} benchmark.`,
            action: 'Tighten audience; test a new creative or offer.',
            magnitude: c.cpl / BASELINE.cpl,
        });
    }

    // 3. Winner: CPL < 0.5× baseline + at least 5 leads
    if (c.leads >= 5 && c.cpl != null && c.cpl < BASELINE.cpl * 0.5) {
        out.push({
            severity: 0,
            kind: 'winner',
            campaignId: c.id,
            title: 'Scale candidate',
            message: `₹${Math.round(c.cpl).toLocaleString('en-IN')}/lead (best in portfolio).`,
            action: 'Increase budget 25–50% while efficiency holds.',
            magnitude: BASELINE.cpl / Math.max(c.cpl, 1),
        });
    }

    // 4. Low CTR: < 0.5% with > 1000 impressions (real signal, not noise)
    if (c.impressions >= 1000 && c.ctr != null && c.ctr < 0.5) {
        out.push({
            severity: 2,
            kind: 'low_ctr',
            campaignId: c.id,
            title: 'Creative fatigue risk',
            message: `CTR ${c.ctr.toFixed(2)}% (benchmark 1%).`,
            action: 'Refresh ad creative within 7 days.',
            magnitude: BASELINE.ctr / Math.max(c.ctr, 0.01),
        });
    }

    // 5. High CPC
    if (c.cpc != null && c.cpc > BASELINE.cpc * 2) {
        out.push({
            severity: 2,
            kind: 'high_cpc',
            campaignId: c.id,
            title: 'CPC elevated',
            message: `₹${c.cpc.toFixed(0)}/click — high-intent traffic expensive.`,
            action: 'Test broader audience; review bid strategy.',
            magnitude: c.cpc / BASELINE.cpc,
        });
    }

    // 6. No metrics sync but has spend
    if (c.spend > 0 && c.impressions === 0 && c.channel === 'meta_ads') {
        out.push({
            severity: 3,
            kind: 'no_metrics',
            campaignId: c.id,
            title: 'Meta sync broken',
            message: 'Spend logged but no impressions/clicks pulled from Meta.',
            action: 'Re-check ad account ID + token in CRM Settings.',
            magnitude: 0,
        });
    }

    // 7. No spend at all but campaign is "active" and within date range
    if (c.status === 'active' && c.spend === 0 && c.leads === 0 && c.start_date && c.end_date) {
        const start = new Date(c.start_date).getTime();
        const end = new Date(c.end_date).getTime();
        if (now() >= start && now() <= end) {
            out.push({
                severity: 2,
                kind: 'no_spend',
                campaignId: c.id,
                title: 'No spend logged',
                message: 'Campaign active but no spend rows in window.',
                action: 'Verify spend is being recorded; check Meta integration.',
                magnitude: 0,
            });
        }
    }

    // 8. Positive ROI (any win with positive return)
    if (c.roi != null && c.roi > BASELINE.roi_healthy && c.won > 0) {
        out.push({
            severity: 0,
            kind: 'positive_roi',
            campaignId: c.id,
            title: `${Math.round(c.roi)}% ROI`,
            message: `${c.won} won · ₹${fmt(c.won_value)}.`,
            action: 'Document playbook; replicate creative + targeting.',
            magnitude: c.roi,
        });
    }

    return out;
}

/**
 * Portfolio-level insights. Shown in the dashboard header and as overlay
 * tiles. One `portfolio_health` summary is always returned; per-KPI
 * insights are returned when the signal is strong.
 */
export function portfolioInsights(p: PerformancePayload): PortfolioInsight[] {
    const out: PortfolioInsight[] = [];
    const { kpis, campaigns, source_breakdown, city_breakdown } = p;

    // 1. Portfolio health summary (always)
    if (kpis.total_spend === 0) {
        out.push({
            severity: 1,
            kind: 'portfolio_health',
            targetKpi: 'overview',
            title: 'No spend in window',
            message: 'Log spend or sync Meta to see campaign performance.',
            action: 'Connect Meta Ads in CRM Settings → Integrations.',
        });
    } else if (kpis.roi > BASELINE.roi_healthy) {
        out.push({
            severity: 0,
            kind: 'portfolio_health',
            targetKpi: 'overview',
            title: `Healthy portfolio · ${Math.round(kpis.roi)}% ROI`,
            message: `₹${fmt(kpis.total_spend)} → ₹${fmt(kpis.total_won_value)} won.`,
            action: 'Maintain current spend mix.',
        });
    } else if (kpis.cpl > BASELINE.cpl * 1.2) {
        out.push({
            severity: 3,
            kind: 'portfolio_health',
            targetKpi: 'overview',
            title: `CPL ${Math.round(kpis.cpl).toLocaleString('en-IN')} above benchmark`,
            message: 'Portfolio CPL is elevated vs ₹' + BASELINE.cpl + ' target.',
            action: 'Identify and pause the worst 1–2 campaigns.',
        });
    }

    // 2. Bleeding campaigns (aggregate magnitude)
    const bleeders = campaigns.filter((c) => c.spend > 0 && c.leads === 0);
    if (bleeders.length > 0) {
        const totalWasted = bleeders.reduce((s, c) => s + c.spend, 0);
        out.push({
            severity: 4,
            kind: 'bleeding',
            targetKpi: 'spend',
            title: `${bleeders.length} campaign${bleeders.length > 1 ? 's' : ''} bleeding budget`,
            message: `₹${fmt(totalWasted)} wasted in window across ${bleeders.length} zero-lead campaigns.`,
            action: `Pause: ${bleeders.slice(0, 3).map((c) => c.name).join(', ')}.`,
            magnitude: totalWasted,
        });
    }

    // 3. Win rate vs benchmark
    if (kpis.total_leads >= 10) {
        if (kpis.win_rate < BASELINE.win_rate * 0.5) {
            out.push({
                severity: 4,
                kind: 'stale_pipeline',
                targetKpi: 'win_rate',
                title: `Win rate ${kpis.win_rate.toFixed(1)}% critically low`,
                message: `Below the ${BASELINE.win_rate}% benchmark for B2B office space.`,
                action: 'Audit lead qualification criteria and follow-up SLA.',
            });
        } else if (kpis.win_rate < BASELINE.win_rate) {
            out.push({
                severity: 2,
                kind: 'stale_pipeline',
                targetKpi: 'win_rate',
                title: `Win rate ${kpis.win_rate.toFixed(1)}% under benchmark`,
                message: `Target ${BASELINE.win_rate}% for the segment.`,
                action: 'Add follow-up reminders; review lost reasons.',
            });
        }
    }

    // 4. Stale pipeline: leads in window with no recent contact
    const staleCount = campaigns.reduce((s, c) => {
        if (!c.last_contacted_ms) return s;
        const days = (now() - c.last_contacted_ms) / 86400_000;
        return s + (days > BASELINE.stale_days && c.leads > 0 ? 1 : 0);
    }, 0);
    if (staleCount > 0) {
        out.push({
            severity: 2,
            kind: 'stale_pipeline',
            targetKpi: 'pipeline',
            title: `${staleCount} lead${staleCount > 1 ? 's' : ''} uncontacted ${BASELINE.stale_days}+ days`,
            message: 'Pipeline cooling — close before competitor does.',
            action: 'Trigger WhatsApp / call blast to stale leads.',
        });
    }

    // 5. Source concentration risk
    const totalSrcLeads = source_breakdown.reduce((s, x) => s + x.leads, 0);
    if (totalSrcLeads > 0) {
        const top = source_breakdown[0];
        const topShare = top.leads / totalSrcLeads;
        if (topShare > 0.7) {
            out.push({
                severity: 3,
                kind: 'source_concentration',
                targetKpi: 'leads',
                title: `${Math.round(topShare * 100)}% leads from ${top.name}`,
                message: 'Heavy dependency on a single source = high risk.',
                action: 'Diversify — at least 2 channels > 15% each.',
                magnitude: topShare,
            });
        }
    }

    // 6. Geo concentration
    const totalCityLeads = city_breakdown.reduce((s, x) => s + x.leads, 0);
    if (totalCityLeads > 0 && city_breakdown[0]) {
        const top = city_breakdown[0];
        const topShare = top.leads / totalCityLeads;
        if (topShare > 0.7) {
            out.push({
                severity: 2,
                kind: 'geo_concentration',
                targetKpi: 'leads',
                title: `${Math.round(topShare * 100)}% leads from ${top.name}`,
                message: 'Geo risk — single-market dependency.',
                action: 'Expand to 2 more cities; test new metro campaigns.',
                magnitude: topShare,
            });
        }
    }

    // 7. Meta sync health
    const metaSpend = campaigns.reduce((s, c) => s + c.meta_spend, 0);
    const manualSpend = campaigns.reduce((s, c) => s + c.manual_spend, 0);
    const metaChannelSpend = campaigns.filter((c) => c.channel === 'meta_ads').reduce((s, c) => s + c.spend, 0);
    if (metaChannelSpend > 0 && metaSpend === 0) {
        out.push({
            severity: 3,
            kind: 'meta_spend_drop',
            targetKpi: 'meta_sync',
            title: 'No Meta-sourced spend rows',
            message: `${fmt(manualSpend)} manual only. Cron not running or token expired.`,
            action: 'Check last_sync_status in CRM Settings → Integrations.',
        });
    }

    // 8. Low CTR at portfolio level
    if (kpis.total_impressions > 5000 && kpis.ctr < 0.5) {
        out.push({
            severity: 3,
            kind: 'low_ctr',
            targetKpi: 'overview',
            title: `Portfolio CTR ${kpis.ctr.toFixed(2)}% critically low`,
            message: `Benchmark is ${BASELINE.ctr}%. Creative is fatiguing or targeting off.`,
            action: 'Refresh 30% of creatives this week.',
        });
    }

    return out;
}

/**
 * AI TILE — small "you're here" pill to overlay on any KPI in the dashboard.
 * Returns a single short, dense line ("above benchmark / losing 12% MoM / etc").
 */
export function kpiMicroInsight(
    kpi: 'spend' | 'leads' | 'cpl' | 'cpa' | 'roi' | 'win_rate' | 'pipeline' | 'ctr',
    p: PerformancePayload
): { tone: 'good' | 'warn' | 'bad' | 'info'; text: string } {
    const { kpis } = p;
    switch (kpi) {
        case 'cpl':
            if (kpis.cpl === 0) return { tone: 'info', text: 'awaiting data' };
            if (kpis.cpl <= BASELINE.cpl * 0.8) return { tone: 'good', text: `${Math.round((1 - kpis.cpl / BASELINE.cpl) * 100)}% under benchmark` };
            if (kpis.cpl <= BASELINE.cpl * 1.2) return { tone: 'info', text: 'within ±20%' };
            return { tone: 'warn', text: `${Math.round((kpis.cpl / BASELINE.cpl - 1) * 100)}% above benchmark` };
        case 'roi':
            if (kpis.roi > BASELINE.roi_healthy) return { tone: 'good', text: 'above 3× target' };
            if (kpis.roi > 0) return { tone: 'info', text: 'positive but < 3×' };
            if (kpis.roi === 0) return { tone: 'info', text: 'no closed deals yet' };
            return { tone: 'bad', text: 'losing money' };
        case 'win_rate':
            if (kpis.win_rate >= BASELINE.win_rate) return { tone: 'good', text: 'at benchmark' };
            if (kpis.win_rate >= BASELINE.win_rate * 0.5) return { tone: 'warn', text: 'below benchmark' };
            return { tone: 'bad', text: 'critical' };
        case 'ctr':
            if (kpis.ctr >= 1.0) return { tone: 'good', text: 'healthy' };
            if (kpis.ctr >= 0.5) return { tone: 'info', text: 'below 1%' };
            return { tone: 'bad', text: 'creative fatigue' };
        case 'spend':
            return { tone: 'info', text: `${p.daily_spend.length} days` };
        case 'leads':
            if (kpis.total_leads === 0) return { tone: 'bad', text: 'no leads in window' };
            return { tone: 'info', text: 'see campaign table ↓' };
        case 'cpa':
            if (kpis.cpa === 0) return { tone: 'info', text: 'no wins yet' };
            if (kpis.cpa <= 30000) return { tone: 'good', text: 'healthy for office space' };
            if (kpis.cpa <= 80000) return { tone: 'warn', text: 'elevated' };
            return { tone: 'bad', text: 'too expensive' };
        case 'pipeline':
            if (kpis.total_pipeline === 0) return { tone: 'info', text: 'no open deals' };
            return { tone: 'info', text: `${Math.round(kpis.total_pipeline / 100000)}L in motion` };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
    if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)} Cr`;
    if (n >= 100_000) return `${(n / 100_000).toFixed(1)} L`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return Math.round(n).toString();
}