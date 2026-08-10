import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    resolveCommandCenterAccess, isCommandCenterAccessError, readOrgId,
    isMissingRelation, unprovisioned, ROW_CEILING,
} from '@/backend/lib/commandCenter/access';
import type { WaterResponse, WaterSourceUsage, SeriesPoint } from '@/backend/lib/commandCenter/types';

/**
 * GET /api/command-center/water
 *
 * Water Intelligence card. water_readings is logged once PER DAY per source (a jar/tanker
 * delivery count, not a flow meter) — there is no intraday signal, so every figure below is
 * daily, and the leak-probability field is always null (see the comment further down).
 *
 * A single 14-day window ending on the latest reading date (as_of) covers everything the
 * card needs: the 14 bars for the chart, the "same day last week" comparison for delta_pct,
 * and both 7-day billing windows (this week vs the week before).
 *
 * litres is only meaningful when EVERY scoped source has capacity_litres on file — mixing a
 * jar's litre-equivalent with a tanker that has no configured capacity would silently
 * undercount, so the whole response falls back to `basis: 'units'` the moment one source is
 * missing it, rather than pretending on a per-day basis.
 */

export const dynamic = 'force-dynamic';

interface WaterSourceRow {
    id: string;
    property_id: string;
    name: string;
    source_type: string | null;
    capacity_litres: number | null;
    is_active: boolean | null;
}

interface DayAgg {
    units: number;
    cost: number;
    /** Sum of quantity * capacity_litres. Only accumulated when basis === 'litres'. */
    litres: number | null;
    bySource: Map<string, { units: number; cost: number; litres: number }>;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const shiftDate = (isoDate: string, deltaDays: number): string => {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return iso(d);
};

export async function GET(request: NextRequest) {
    const access = await resolveCommandCenterAccess(request, readOrgId(request));
    if (isCommandCenterAccessError(access)) return access;

    // --- sources, scoped to the caller's properties -------------------------------------
    const { data: sourcesRaw, error: srcErr } = await supabaseAdmin
        .from('water_sources')
        .select('id, property_id, name, source_type, capacity_litres, is_active')
        .in('property_id', access.propertyIds)
        .range(0, ROW_CEILING - 1);

    if (srcErr) {
        if (isMissingRelation(srcErr)) return unprovisioned('No water_sources table on this deployment.');
        console.error('[cc/water] water_sources', srcErr.message);
        return NextResponse.json({ error: 'Could not load water sources' }, { status: 500 });
    }

    const sources = ((sourcesRaw || []) as WaterSourceRow[]).filter(s => s.is_active !== false);
    if (!sources.length) {
        return unprovisioned('No water sources configured for these properties.');
    }
    const sourceIds = sources.map(s => s.id);
    const sourceById = new Map(sources.map(s => [s.id, s]));

    // --- latest date with a reading, across the scoped sources ---------------------------
    const { data: latestRows, error: latestErr } = await supabaseAdmin
        .from('water_readings')
        .select('reading_date')
        .in('source_id', sourceIds)
        .order('reading_date', { ascending: false })
        .limit(1);

    if (latestErr) {
        if (isMissingRelation(latestErr)) return unprovisioned('No water_readings table on this deployment.');
        console.error('[cc/water] water_readings (latest)', latestErr.message);
        return NextResponse.json({ error: 'Could not load water readings' }, { status: 500 });
    }

    const asOf = latestRows?.[0]?.reading_date as string | undefined;
    if (!asOf) {
        return unprovisioned('No water readings recorded yet for these properties.');
    }

    // --- the 14-day window: [asOf-13, asOf] -----------------------------------------------
    const rangeStart = shiftDate(asOf, -13);
    const { data: readingsRaw, error: readErr } = await supabaseAdmin
        .from('water_readings')
        .select('source_id, reading_date, quantity, computed_cost')
        .in('source_id', sourceIds)
        .gte('reading_date', rangeStart)
        .lte('reading_date', asOf)
        .range(0, ROW_CEILING - 1);

    if (readErr) {
        console.error('[cc/water] water_readings (window)', readErr.message);
        return NextResponse.json({ error: 'Could not load water readings' }, { status: 500 });
    }

    const sourcesMissingCapacity = sources.filter(s => s.capacity_litres == null).map(s => s.name);
    const basis: WaterResponse['basis'] = sourcesMissingCapacity.length === 0 ? 'litres' : 'units';

    // --- aggregate by day, and by source within each day ----------------------------------
    const byDate = new Map<string, DayAgg>();
    for (const r of (readingsRaw || []) as Array<{ source_id: string; reading_date: string; quantity: number | null; computed_cost: number | null }>) {
        const src = sourceById.get(r.source_id);
        if (!src) continue;
        const qty = Number(r.quantity || 0);
        const cost = Number(r.computed_cost || 0);
        const litres = src.capacity_litres != null ? qty * Number(src.capacity_litres) : null;

        let day = byDate.get(r.reading_date);
        if (!day) {
            day = { units: 0, cost: 0, litres: basis === 'litres' ? 0 : null, bySource: new Map() };
            byDate.set(r.reading_date, day);
        }
        day.units += qty;
        day.cost += cost;
        if (basis === 'litres') day.litres = (day.litres ?? 0) + (litres ?? 0);

        const s = day.bySource.get(r.source_id) || { units: 0, cost: 0, litres: 0 };
        s.units += qty;
        s.cost += cost;
        s.litres += litres ?? 0;
        day.bySource.set(r.source_id, s);
    }

    const dayValue = (d: DayAgg | undefined): number | null => {
        if (!d) return null;
        return basis === 'litres' ? (d.litres ?? 0) : d.units;
    };

    // --- 14-day series for the bar chart ---------------------------------------------------
    const series: SeriesPoint[] = Array.from({ length: 14 }, (_, i) => {
        const date = shiftDate(rangeStart, i);
        const day = byDate.get(date);
        return { date, value: day ? dayValue(day) : null };
    });

    // --- today (as_of) ----------------------------------------------------------------------
    const todayAgg = byDate.get(asOf);
    const today: WaterResponse['today'] = {
        units: todayAgg?.units ?? 0,
        litres: basis === 'litres' ? (todayAgg?.litres ?? 0) : null,
        cost: todayAgg?.cost ?? 0,
    };

    // --- delta vs the same day last week -----------------------------------------------------
    const lastWeekAgg = byDate.get(shiftDate(asOf, -7));
    const todayValue = dayValue(todayAgg) ?? 0;
    const lastWeekValue = dayValue(lastWeekAgg);
    const delta_pct = lastWeekValue !== null && lastWeekValue > 0
        ? Math.round(((todayValue - lastWeekValue) / lastWeekValue) * 100)
        : null;

    // --- billing: this 7-day window vs the 7 days before it -----------------------------------
    const costsByOffset = Array.from({ length: 14 }, (_, i) => byDate.get(shiftDate(rangeStart, i))?.cost ?? 0);
    const last_week_bill = costsByOffset.slice(0, 7).reduce((a, b) => a + b, 0);
    const expected_bill = costsByOffset.slice(7, 14).reduce((a, b) => a + b, 0);

    // --- highest-use source today -------------------------------------------------------------
    let highest_use_source: WaterResponse['highest_use_source'] = null;
    if (todayAgg && todayAgg.bySource.size) {
        let bestId: string | null = null;
        let bestValue = -Infinity;
        for (const [sid, agg] of todayAgg.bySource) {
            const v = basis === 'litres' ? agg.litres : agg.units;
            if (v > bestValue) { bestValue = v; bestId = sid; }
        }
        if (bestId) {
            const src = sourceById.get(bestId)!;
            const agg = todayAgg.bySource.get(bestId)!;
            const usage: WaterSourceUsage = {
                source_id: src.id,
                name: src.name,
                source_type: src.source_type,
                property_id: src.property_id,
                units: agg.units,
                litres: basis === 'litres' ? agg.litres : null,
                cost: agg.cost,
            };
            highest_use_source = {
                ...usage,
                share_pct: todayValue > 0 ? Math.round((bestValue / todayValue) * 100) : null,
            };
        }
    }

    const payload: WaterResponse = {
        provisioned: true,
        as_of: asOf,
        today,
        delta_pct,
        basis,
        series,
        granularity: 'daily',
        granularity_note:
            'water_readings holds one delivery count per source per day, not a flow reading — this is a daily series, not hourly.',
        billing: {
            expected_bill,
            last_week_bill,
            saving: last_week_bill - expected_bill,
        },
        highest_use_source,
        leak_probability: null,
        leak_probability_note:
            'Leak detection needs a continuous flow signal. water_readings stores discrete jar/tanker delivery counts per day, so a probability here would be invented, not measured.',
        data_quality: {
            sources_missing_capacity: sourcesMissingCapacity,
            note: sourcesMissingCapacity.length
                ? `${sourcesMissingCapacity.length} source${sourcesMissingCapacity.length === 1 ? '' : 's'} have no capacity_litres on file, so usage is shown in delivery units rather than litres.`
                : null,
        },
    };

    return NextResponse.json(payload);
}
