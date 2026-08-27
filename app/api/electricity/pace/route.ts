import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAopAccess, isAopAccessError, readOrgId, isMissingRelation } from '@/backend/lib/aop/access';

/**
 * GET /api/electricity/pace
 *
 * "Are we burning more power this month than last, and is anything on fire?"
 *
 * Replaces the old tile that rendered a bare "0 kWh", which told nobody anything. Two
 * things make that number meaningless on its own and both are handled here.
 *
 * 1. PARTIAL-MONTH COMPARISON. On the 2nd of the month, this month's total will always
 *    look tiny next to last month's. The only fair comparison is like-for-like: consumption
 *    from the 1st to today, against the 1st to the SAME day-of-month of the previous
 *    period. Two further corrections make it honest:
 *
 *      a. Only meters that reported in BOTH windows are counted. A meter commissioned this
 *         month would otherwise show up as a spike, and a meter that stopped reporting
 *         would look like a saving.
 *      b. Before day 3 no pace verdict is issued at all. One or two days of readings is
 *         noise, and an alarm on the 1st of every month trains people to ignore the tile.
 *
 * 2. CORRUPT READINGS. 13 of 2,219 readings hold impossible values — a meter multiplier of
 *    1000 on a register that already reads kWh, plus three dropped-digit entries. They push
 *    July 2026 to 717 million kWh against a median day of ~1,200. Every figure here excludes
 *    them via electricity_reading_anomalies, and the count is returned so the UI can say so
 *    out loud rather than quietly under-reporting.
 */

export const dynamic = 'force-dynamic';

// Below this many days into the month, report consumption but withhold a pace verdict.
const MIN_DAYS_FOR_VERDICT = 3;

interface Reading {
    id: string;
    property_id: string | null;
    meter_id: string | null;
    reading_date: string;
    final_units: number | null;
    computed_units: number | null;
    computed_cost: number | null;
}

const units = (r: Reading) => Number(r.final_units ?? r.computed_units ?? 0) || 0;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function GET(request: NextRequest) {
    const access = await resolveAopAccess(request, readOrgId(request));
    if (isAopAccessError(access)) return access;

    const sp = new URL(request.url).searchParams;
    const propertyFilter = sp.get('property_id');

    const { data: props, error: propErr } = await supabaseAdmin
        .from('properties').select('id, name').eq('organization_id', access.organizationId);
    if (propErr) {
        console.error('[electricity pace] properties', propErr.message);
        return NextResponse.json({ error: 'Could not load properties' }, { status: 500 });
    }
    const propertyIds = (props || [])
        .map(p => p.id)
        .filter(id => !propertyFilter || id === propertyFilter);
    const propertyName = new Map((props || []).map(p => [p.id, p.name]));

    if (!propertyIds.length) {
        return NextResponse.json({ provisioned: true, current: null, previous: null, verdict: null });
    }

    // Anchor on the newest reading, not on today. The dataset also contains future-dated
    // rows, and anchoring on wall-clock time would compare a month nobody has logged yet.
    const { data: latestRow } = await supabaseAdmin
        .from('electricity_readings')
        .select('reading_date')
        .in('property_id', propertyIds)
        .lte('reading_date', iso(new Date()))
        .order('reading_date', { ascending: false })
        .limit(1)
        .maybeSingle();

    const anchor = latestRow?.reading_date ? new Date(latestRow.reading_date + 'T00:00:00Z') : new Date();
    const dayOfMonth = anchor.getUTCDate();
    const y = anchor.getUTCFullYear();
    const m = anchor.getUTCMonth();

    const curStart = new Date(Date.UTC(y, m, 1));
    const curEnd = anchor;
    const prevStart = new Date(Date.UTC(y, m - 1, 1));
    // Clamp to the previous month's length so a 31st never rolls into the following month.
    const prevMonthDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const prevEnd = new Date(Date.UTC(y, m - 1, Math.min(dayOfMonth, prevMonthDays)));

    const { data: readings, error } = await supabaseAdmin
        .from('electricity_readings')
        .select('id, property_id, meter_id, reading_date, final_units, computed_units, computed_cost')
        .in('property_id', propertyIds)
        .gte('reading_date', iso(prevStart))
        .lte('reading_date', iso(curEnd))
        .range(0, 9999);

    if (error) {
        console.error('[electricity pace]', error.message);
        return NextResponse.json({ error: 'Could not load electricity readings' }, { status: 500 });
    }

    // Anomalies are advisory rows from a view; excluded from every figure below.
    const { data: anomalies, error: anomErr } = await supabaseAdmin
        .from('electricity_reading_anomalies')
        .select('id, meter_name, property_name, reading_date, units, times_typical, anomaly_kind')
        .in('property_id', propertyIds)
        .range(0, 999);

    const anomalyUnprovisioned = anomErr ? isMissingRelation(anomErr) : false;
    if (anomErr && !anomalyUnprovisioned) console.error('[electricity pace] anomalies', anomErr.message);
    const excluded = new Set((anomalies || []).map(a => a.id));

    const all = (readings || []) as Reading[];
    const inWindow = (r: Reading, from: Date, to: Date) =>
        r.reading_date >= iso(from) && r.reading_date <= iso(to);

    const clean = all.filter(r => !excluded.has(r.id));
    const curRows = clean.filter(r => inWindow(r, curStart, curEnd));
    const prevRows = clean.filter(r => inWindow(r, prevStart, prevEnd));

    // Like-for-like: only meters that reported in both windows.
    const curMeters = new Set(curRows.map(r => r.meter_id).filter(Boolean) as string[]);
    const prevMeters = new Set(prevRows.map(r => r.meter_id).filter(Boolean) as string[]);
    const shared = [...curMeters].filter(id => prevMeters.has(id));
    const sharedSet = new Set(shared);

    const total = (rows: Reading[], restrict: boolean) => {
        const scoped = restrict ? rows.filter(r => r.meter_id && sharedSet.has(r.meter_id)) : rows;
        return {
            units: Math.round(scoped.reduce((s, r) => s + units(r), 0)),
            cost: Math.round(scoped.reduce((s, r) => s + (Number(r.computed_cost) || 0), 0)),
            readings: scoped.length,
            meters: new Set(scoped.map(r => r.meter_id)).size,
        };
    };

    const current = total(curRows, true);
    const previous = total(prevRows, true);
    const currentAll = total(curRows, false);

    const enoughDays = dayOfMonth >= MIN_DAYS_FOR_VERDICT;
    const comparable = shared.length > 0 && previous.units > 0 && enoughDays;
    const deltaPct = comparable
        ? Math.round(((current.units - previous.units) / previous.units) * 1000) / 10
        : null;

    // Severity ladder. Deliberately wide bands: real month-on-month swings of 10-15% are
    // normal (weather, occupancy), so anything tighter would alarm constantly and get muted.
    let severity: 'ok' | 'info' | 'warn' | 'critical' = 'ok';
    if (deltaPct !== null) {
        if (deltaPct >= 25) severity = 'critical';
        else if (deltaPct >= 12) severity = 'warn';
        else if (deltaPct <= -12) severity = 'info';   // a real saving is worth surfacing too
    }
    // A broken data pipeline outranks any consumption reading.
    if (excluded.size > 0 && severity !== 'critical') severity = 'warn';

    const projected = comparable && dayOfMonth > 0
        ? Math.round((current.units / dayOfMonth) * new Date(Date.UTC(y, m + 1, 0)).getUTCDate())
        : null;

    // Per-property breakdown for the expanded size class.
    const byProperty = new Map<string, { property_id: string; name: string; current: number; previous: number }>();
    for (const r of curRows) {
        if (!r.property_id || !r.meter_id || !sharedSet.has(r.meter_id)) continue;
        const e = byProperty.get(r.property_id)
            || { property_id: r.property_id, name: propertyName.get(r.property_id) || 'Unknown', current: 0, previous: 0 };
        e.current += units(r);
        byProperty.set(r.property_id, e);
    }
    for (const r of prevRows) {
        if (!r.property_id || !r.meter_id || !sharedSet.has(r.meter_id)) continue;
        const e = byProperty.get(r.property_id)
            || { property_id: r.property_id, name: propertyName.get(r.property_id) || 'Unknown', current: 0, previous: 0 };
        e.previous += units(r);
        byProperty.set(r.property_id, e);
    }

    const properties = [...byProperty.values()]
        .map(p => ({
            ...p,
            current: Math.round(p.current),
            previous: Math.round(p.previous),
            delta_pct: p.previous > 0
                ? Math.round(((p.current - p.previous) / p.previous) * 1000) / 10
                : null,
        }))
        .sort((a, b) => (b.delta_pct ?? -999) - (a.delta_pct ?? -999));

    return NextResponse.json({
        provisioned: true,
        as_of: iso(anchor),
        day_of_month: dayOfMonth,
        window: {
            current: { from: iso(curStart), to: iso(curEnd) },
            previous: { from: iso(prevStart), to: iso(prevEnd) },
        },
        current,
        previous,
        // What the current month really used, including meters with no prior-period history.
        current_all_meters: currentAll,
        comparable,
        comparable_meters: shared.length,
        delta_pct: deltaPct,
        projected_month_units: projected,
        severity,
        verdict: !enoughDays
            ? `Only ${dayOfMonth} day${dayOfMonth === 1 ? '' : 's'} into the month — too early to compare.`
            : !comparable
                ? 'No meters reported in both periods, so there is nothing to compare yet.'
                : deltaPct === null
                    ? null
                    : deltaPct >= 0
                        ? `${deltaPct}% above the same ${dayOfMonth} days last month.`
                        : `${Math.abs(deltaPct)}% below the same ${dayOfMonth} days last month.`,
        data_quality: {
            provisioned: !anomalyUnprovisioned,
            excluded_readings: excluded.size,
            anomalies: (anomalies || []).slice(0, 10),
        },
        properties,
    });
}
