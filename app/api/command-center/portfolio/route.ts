import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    resolveCommandCenterAccess, isCommandCenterAccessError, readOrgId,
    isMissingRelation, ROW_CEILING,
} from '@/backend/lib/commandCenter/access';
import { buildComponents, scoreFrom, SCORING_NOTE } from '@/backend/lib/commandCenter/scoring';
import type { PortfolioResponse, PropertyHealth, SeriesPoint } from '@/backend/lib/commandCenter/types';

/**
 * GET /api/command-center/portfolio
 *
 * Per-building health, for the Portfolio Overview card.
 *
 * Every signal is fetched ONCE for the whole org and bucketed by property in memory,
 * rather than issuing a query per property. With 13 properties the per-property version
 * would be 52 round trips for a card that renders five rows.
 *
 * On the sparkline: it is the 7-day trend of that property's OPEN TICKET COUNT, not of the
 * score. Reconstructing a historical score would require historical PPM and budget state
 * we do not retain, and drawing a fabricated 7-day score line under a real number is
 * exactly the kind of decoration that makes a dashboard untrustworthy. The card labels it
 * for what it is.
 */

export const dynamic = 'force-dynamic';

const ACTIVE_TICKET_STATUSES = ['open', 'in_progress', 'pending_validation', 'waitlist'];

export async function GET(request: NextRequest) {
    const access = await resolveCommandCenterAccess(request, readOrgId(request));
    if (isCommandCenterAccessError(access)) return access;
    const orgId = access.organizationId;

    const { data: properties, error: propErr } = await supabaseAdmin
        .from('properties')
        .select('id, name, city, is_active')
        .eq('organization_id', orgId)
        .order('name');

    if (propErr) {
        if (isMissingRelation(propErr)) {
            return NextResponse.json({ provisioned: false, reason: 'No properties table.' });
        }
        console.error('[cc/portfolio] properties', propErr.message);
        return NextResponse.json({ error: 'Could not load properties' }, { status: 500 });
    }

    const active = (properties || []).filter(p => p.is_active !== false);
    if (active.length === 0) {
        return NextResponse.json({ provisioned: false, reason: 'No active properties in this organization.' });
    }
    const propertyIds = active.map(p => p.id);

    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const daysAgo = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
    const nowIso = today.toISOString();

    // --- signals, one query each, all optional ------------------------------------------
    const [ticketsRes, ppmRes, anomalyRes] = await Promise.all([
        supabaseAdmin
            .from('tickets')
            .select('id, property_id, status, sla_deadline, sla_breached, created_at')
            .in('property_id', propertyIds)
            .in('status', ACTIVE_TICKET_STATUSES)
            .range(0, ROW_CEILING - 1),
        // ALL schedules, not just overdue ones — the total is the denominator for the
        // overdue RATE, and without it a site with 2 tasks looks the same as one with 364.
        supabaseAdmin
            .from('ppm_schedules')
            .select('id, property_id, planned_date, done_date')
            .eq('organization_id', orgId)
            .range(0, ROW_CEILING - 1),
        // View may not exist until 20260802000003 is applied — absence is expected, not an error.
        supabaseAdmin
            .from('electricity_reading_anomalies')
            .select('id, property_id')
            .in('property_id', propertyIds)
            .range(0, ROW_CEILING - 1),
    ]);

    const ticketsAvailable = !ticketsRes.error;
    const ppmAvailable = !ppmRes.error;
    const anomaliesAvailable = !anomalyRes.error;

    if (ticketsRes.error && !isMissingRelation(ticketsRes.error)) {
        console.error('[cc/portfolio] tickets', ticketsRes.error.message);
    }

    type Ticket = {
        id: string; property_id: string | null; status: string;
        sla_deadline: string | null; sla_breached: boolean | null; created_at: string | null;
    };
    const tickets = (ticketsRes.data || []) as Ticket[];

    const openByProp = new Map<string, number>();
    const breachedByProp = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string | null) => {
        if (k) m.set(k, (m.get(k) || 0) + 1);
    };

    for (const t of tickets) {
        bump(openByProp, t.property_id);
        const breached = t.sla_breached === true
            || (t.sla_deadline !== null && t.sla_deadline < nowIso);
        if (breached) bump(breachedByProp, t.property_id);
    }

    const todayIso = iso(today);
    const ppmTotalByProp = new Map<string, number>();
    const ppmOverdueByProp = new Map<string, number>();
    for (const r of (ppmRes.data || []) as Array<{ property_id: string | null; planned_date: string | null; done_date: string | null }>) {
        bump(ppmTotalByProp, r.property_id);
        if (!r.done_date && r.planned_date && r.planned_date < todayIso) {
            bump(ppmOverdueByProp, r.property_id);
        }
    }

    const anomByProp = new Map<string, number>();
    for (const r of (anomalyRes.data || []) as Array<{ property_id: string | null }>) {
        bump(anomByProp, r.property_id);
    }

    // Which properties report electricity at all. An anomaly count of 0 only means
    // "clean" where meters are actually sending readings.
    const elecPropIds = new Set<string>();
    {
        const { data } = await supabaseAdmin
            .from('electricity_readings')
            .select('property_id')
            .in('property_id', propertyIds)
            .range(0, ROW_CEILING - 1);
        for (const r of (data || []) as Array<{ property_id: string | null }>) {
            if (r.property_id) elecPropIds.add(r.property_id);
        }
    }

    // --- budget variance, per property, latest AOP month ---------------------------------
    // aop_sites.property_id is a nullable soft link; sites that do not map contribute
    // nothing rather than being force-matched to a property by name.
    const overspendPctByProp = new Map<string, number>();
    let budgetAvailable = false;
    {
        const { data: latest } = await supabaseAdmin
            .from('aop_entries')
            .select('period_month')
            .eq('organization_id', orgId)
            .order('period_month', { ascending: false })
            .limit(1);

        const month = latest?.[0]?.period_month;
        if (month) {
            const { data: rows, error } = await supabaseAdmin
                .from('aop_site_month_summary')
                .select('property_id, budget_total, actual_total')
                .eq('organization_id', orgId)
                .eq('period_month', month)
                .range(0, ROW_CEILING - 1);

            if (!error && rows) {
                budgetAvailable = true;
                const agg = new Map<string, { b: number; a: number }>();
                for (const r of rows as Array<{ property_id: string | null; budget_total: number | null; actual_total: number | null }>) {
                    if (!r.property_id) continue;
                    const cur = agg.get(r.property_id) || { b: 0, a: 0 };
                    cur.b += Number(r.budget_total || 0);
                    cur.a += Number(r.actual_total || 0);
                    agg.set(r.property_id, cur);
                }
                for (const [pid, { b, a }] of agg) {
                    if (b > 0) overspendPctByProp.set(pid, ((a - b) / b) * 100);
                }
            }
        }
    }

    // --- 7-day open-ticket trend ---------------------------------------------------------
    // Derived from created_at on the currently-open set: how many of today's open tickets
    // already existed on each of the last 7 days. It is a real measurement of backlog
    // growth, and it never claims to be a historical score.
    const seriesFor = (pid: string): SeriesPoint[] => {
        if (!ticketsAvailable) return [];
        const mine = tickets.filter(t => t.property_id === pid);
        return Array.from({ length: 7 }, (_, i) => {
            const d = daysAgo(6 - i);
            const cutoff = new Date(d); cutoff.setHours(23, 59, 59, 999);
            return {
                date: iso(d),
                value: mine.filter(t => t.created_at && new Date(t.created_at) <= cutoff).length,
            };
        });
    };

    const result: PropertyHealth[] = active.map(p => {
        const components = buildComponents({
            activeTickets: ticketsAvailable ? (openByProp.get(p.id) || 0) : null,
            slaBreached: ticketsAvailable ? (breachedByProp.get(p.id) || 0) : null,
            ppmTotal: ppmAvailable ? (ppmTotalByProp.get(p.id) || 0) : null,
            ppmOverdue: ppmAvailable ? (ppmOverdueByProp.get(p.id) || 0) : null,
            electricityAnomalies: anomaliesAvailable ? (anomByProp.get(p.id) || 0) : null,
            hasElectricityData: elecPropIds.has(p.id),
            budgetOverspendPct: budgetAvailable ? (overspendPctByProp.get(p.id) ?? null) : null,
        });
        const { score, availableCount, totalCount } = scoreFrom(components);
        return {
            property_id: p.id,
            name: p.name,
            city: p.city ?? null,
            score,
            signals_available: availableCount,
            signals_total: totalCount,
            components,
            series: seriesFor(p.id),
        };
    });

    // Worst first — the card shows five rows and they should be the five that matter.
    // Untracked sites (score null) sort to the bottom: they are a data-coverage problem,
    // not an operational emergency, and they must never occupy the top of an alert list.
    result.sort((a, b) => {
        if (a.score === null && b.score === null) return a.name.localeCompare(b.name);
        if (a.score === null) return 1;
        if (b.score === null) return -1;
        return a.score - b.score;
    });

    const payload: PortfolioResponse = {
        provisioned: true,
        as_of: nowIso,
        properties: result,
        scoring_note: SCORING_NOTE,
    };
    return NextResponse.json(payload);
}
