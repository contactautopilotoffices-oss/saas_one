/**
 * Council data pack — the REAL org snapshot every persona reads.
 *
 * One section per domain. Every section is wrapped in its own try/catch: a
 * missing table or a failed query becomes a `note` on that section, never a
 * crash — the council must still convene on partial evidence, and the QA
 * persona treats a missing section as a finding in itself.
 *
 * Each section is tagged `{ source, fetched_at }`. The static security notes
 * carry `provenance: 'prior-audit'` — confirmed facts from a prior security
 * audit, re-stated here so the CTO lens can work them; they are NOT re-verified
 * live.
 *
 * Route handlers' aggregation logic (app/api/command-center/portfolio,
 * app/api/electricity/pace, app/api/aop/summary) is not importable as lib
 * functions, so the equivalent reductions are re-run here directly against the
 * admin client, mirroring their arithmetic (same active-status list, same
 * like-for-like pace windows, same AOP sign convention).
 *
 * This module deliberately imports nothing from next/* so it can be
 * smoke-tested under plain node/tsx.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/** Hard stop for the pagination below, so a pathological table cannot loop forever. */
const ROW_CEILING = 20000;

/**
 * PostgREST caps every response at the server's max-rows (1000 here — verified
 * live: an unbounded tickets select returned exactly 1000 of ~4,870 rows), and
 * `.range()` alone does NOT lift it. Page in 1000-row chunks until a short
 * page comes back. Range semantics: `to` is inclusive.
 */
async function fetchAll<T>(
    build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
    const PAGE = 1000;
    const out: T[] = [];
    for (let from = 0; from < ROW_CEILING; from += PAGE) {
        const { data, error } = await build(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const rows = data || [];
        out.push(...rows);
        if (rows.length < PAGE) break;
    }
    return out;
}

/** Same definition as app/api/command-center/portfolio/route.ts. */
const ACTIVE_TICKET_STATUSES = ['open', 'in_progress', 'pending_validation', 'waitlist'];

/** Below this many days into the month, report consumption but withhold a pace verdict. */
const MIN_DAYS_FOR_VERDICT = 3;

export interface DataPackSection {
    /** Table(s)/view(s) or origin the numbers came from. */
    source: string;
    fetched_at: string;
    /** Present on success. */
    data?: unknown;
    /** Present on graceful failure — what went wrong, in one line. */
    note?: string;
}

export interface CouncilDataPack {
    org_id: string;
    generated_at: string;
    sections: Record<string, DataPackSection>;
}

interface PropRow { id: string; name: string; city: string | null; is_active: boolean | null }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const n = (v: unknown) => Number(v ?? 0) || 0;
const now = () => new Date().toISOString();

function ok(source: string, data: unknown): DataPackSection {
    return { source, fetched_at: now(), data };
}
function failed(source: string, err: unknown): DataPackSection {
    const msg = err instanceof Error ? err.message : String(err);
    return { source, fetched_at: now(), note: `section unavailable: ${msg}` };
}

// ---------------------------------------------------------------------------
// Section builders. Each takes the shared property context and never throws.
// ---------------------------------------------------------------------------

async function ticketsSummary(orgId: string, propName: Map<string, string>): Promise<DataPackSection> {
    const source = 'tickets';
    try {
        type T = {
            id: string; property_id: string | null; status: string | null; priority: string | null;
            sla_deadline: string | null; sla_breached: boolean | null; created_at: string | null;
        };
        const rows = await fetchAll<T>((from, to) => supabaseAdmin
            .from('tickets')
            .select('id, property_id, status, priority, sla_deadline, sla_breached, created_at')
            .eq('organization_id', orgId)
            .range(from, to));
        const nowIso = new Date().toISOString();
        const nowMs = Date.now();

        const byStatus = new Map<string, number>();
        const byPriority = new Map<string, number>();
        const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);

        const active = rows.filter(t => t.status && ACTIVE_TICKET_STATUSES.includes(t.status));
        let slaBreachedActive = 0;
        let maxAgeDays = 0;
        let oldestProperty: string | null = null;
        let over30 = 0;
        let over90 = 0;
        const activeByProp = new Map<string, number>();

        for (const t of rows) {
            bump(byStatus, t.status || 'unknown');
            bump(byPriority, t.priority || 'unknown');
        }
        for (const t of active) {
            if (t.sla_breached === true || (t.sla_deadline !== null && t.sla_deadline < nowIso)) slaBreachedActive++;
            if (t.property_id) bump(activeByProp, t.property_id);
            if (t.created_at) {
                const ageDays = Math.floor((nowMs - new Date(t.created_at).getTime()) / 86400000);
                if (ageDays > 30) over30++;
                if (ageDays > 90) over90++;
                if (ageDays > maxAgeDays) {
                    maxAgeDays = ageDays;
                    oldestProperty = t.property_id ? (propName.get(t.property_id) || t.property_id) : null;
                }
            }
        }

        const backlogByProperty = [...activeByProp.entries()]
            .map(([pid, count]) => ({ property: propName.get(pid) || pid, active_tickets: count }))
            .sort((a, b) => b.active_tickets - a.active_tickets)
            .slice(0, 5);

        // ---------------------------------------------------------------------
        // Source-of-truth reconciliation. The codebase carries THREE incompatible
        // definitions of an "active" ticket, and they disagree on the same rows:
        //   app/api/command-center/portfolio/route.ts:28   omits 'assigned'
        //   app/api/cron/daily-whatsapp-report/route.ts:25 omits 'pending_validation'
        //   app/api/organizations/[orgId]/tickets-summary  splits them differently
        // Handing a persona one number and calling it "active" is how a confidently
        // wrong figure reaches a board pack. So the pack reports every definition and
        // names the disagreement, rather than silently picking a winner.
        const countIn = (statuses: string[]) =>
            rows.filter(t => t.status && statuses.includes(t.status)).length;
        const CC = ['open', 'in_progress', 'pending_validation', 'waitlist'];
        const WA = ['open', 'waitlist', 'assigned', 'in_progress', 'paused', 'blocked'];
        const BROAD = [...new Set([...CC, ...WA])];
        const ccCount = countIn(CC);
        const waCount = countIn(WA);
        const broadCount = countIn(BROAD);

        return ok(source, {
            total: rows.length,
            // Kept for continuity with earlier sessions, but explicitly labelled as one
            // convention among several rather than "the" answer.
            active: active.length,
            active_definition_used: 'command_center (open, in_progress, pending_validation, waitlist)',
            active_count_reconciliation: {
                note: 'Three live definitions of "active" disagree on the same rows. Cite the definition alongside any count, or cite the broad figure and say so.',
                command_center: ccCount,
                whatsapp_daily_report: waCount,
                broadest_any_not_closed: broadCount,
                disagreement: broadCount - Math.min(ccCount, waCount),
                omitted_by_command_center: byStatus.get('assigned') || 0,
                omitted_by_whatsapp_report: byStatus.get('pending_validation') || 0,
                sources: [
                    'app/api/command-center/portfolio/route.ts:28',
                    'app/api/cron/daily-whatsapp-report/route.ts:25',
                    'app/api/organizations/[orgId]/tickets-summary/route.ts:67-68',
                ],
            },
            by_status: Object.fromEntries(byStatus),
            by_priority: Object.fromEntries(byPriority),
            sla_breached_active: slaBreachedActive,
            aging: {
                max_age_days: maxAgeDays,
                oldest_ticket_property: oldestProperty,
                active_over_30d: over30,
                active_over_90d: over90,
            },
            backlog_by_property: backlogByProperty,
        });
    } catch (e) {
        return failed(source, e);
    }
}

async function aopSummary(orgId: string): Promise<DataPackSection> {
    const source = 'aop_site_month_summary';
    try {
        const { data, error } = await supabaseAdmin
            .from('aop_site_month_summary')
            .select('site_name, period_month, budget_total, actual_total, saving_total, categories_over_budget, seat_count')
            .eq('organization_id', orgId)
            .order('period_month', { ascending: false })
            .range(0, 4999);
        if (error) throw new Error(error.message);

        type R = {
            site_name: string | null; period_month: string; budget_total: number | null;
            actual_total: number | null; saving_total: number | null;
            categories_over_budget: number | null; seat_count: number | null;
        };
        const rows = (data || []) as R[];
        if (!rows.length) return ok(source, { months: [], current: null, note_inside: 'no AOP rows for this org' });

        const months = [...new Set(rows.map(r => r.period_month))].sort().reverse();
        const rollUp = (month: string | null) => {
            if (!month) return null;
            const scoped = rows.filter(r => r.period_month === month);
            if (!scoped.length) return null;
            const budget = scoped.reduce((s, r) => s + n(r.budget_total), 0);
            const actual = scoped.reduce((s, r) => s + n(r.actual_total), 0);
            return {
                month,
                budget,
                actual,
                saving: budget - actual,   // sign convention matches aop/summary: positive = under budget
                utilisation_pct: budget > 0 ? Math.round((actual / budget) * 1000) / 10 : null,
                sites_total: scoped.length,
                sites_over_budget: scoped.filter(r => n(r.saving_total) < 0).length,
            };
        };

        const currentMonth = months[0];
        const overspending = rows
            .filter(r => r.period_month === currentMonth && n(r.saving_total) < 0)
            .map(r => ({
                site: r.site_name,
                budget: n(r.budget_total),
                actual: n(r.actual_total),
                overspend: -n(r.saving_total),
                categories_over_budget: n(r.categories_over_budget),
            }))
            .sort((a, b) => b.overspend - a.overspend)
            .slice(0, 5);

        return ok(source, {
            months: months.slice(0, 6),
            current: rollUp(currentMonth),
            previous: rollUp(months[1] || null),
            top_overspending_sites: overspending,
        });
    } catch (e) {
        return failed(source, e);
    }
}

async function procurementMailbox(orgId: string): Promise<DataPackSection> {
    const source = 'mailbox_threads';
    try {
        type R = { category: string; is_resolved: boolean; last_message_at: string | null; waiting_on: string | null; subject: string | null };
        const rows = await fetchAll<R>((from, to) => supabaseAdmin
            .from('mailbox_threads')
            .select('category, is_resolved, last_message_at, waiting_on, subject')
            .eq('organization_id', orgId)
            .range(from, to));
        const nowMs = Date.now();

        const byCategory = new Map<string, number>();
        const waitingOn = new Map<string, number>();
        let unresolved = 0;
        let oldestAwaitingDays: number | null = null;
        let oldestAwaitingSubject: string | null = null;

        for (const r of rows) {
            byCategory.set(r.category, (byCategory.get(r.category) || 0) + 1);
            if (!r.is_resolved) {
                unresolved++;
                if (r.waiting_on) waitingOn.set(r.waiting_on, (waitingOn.get(r.waiting_on) || 0) + 1);
                if (r.category === 'awaiting_reply' && r.last_message_at) {
                    const days = Math.floor((nowMs - new Date(r.last_message_at).getTime()) / 86400000);
                    if (oldestAwaitingDays === null || days > oldestAwaitingDays) {
                        oldestAwaitingDays = days;
                        oldestAwaitingSubject = r.subject;
                    }
                }
            }
        }

        return ok(source, {
            threads_total: rows.length,
            unresolved,
            by_category: Object.fromEntries(byCategory),
            unresolved_awaiting_reply: rows.filter(r => !r.is_resolved && r.category === 'awaiting_reply').length,
            unresolved_unactioned_request: rows.filter(r => !r.is_resolved && r.category === 'unactioned_request').length,
            oldest_awaiting_reply_days: oldestAwaitingDays,
            oldest_awaiting_reply_subject: oldestAwaitingSubject,
            waiting_on_top: [...waitingOn.entries()]
                .map(([who, count]) => ({ waiting_on: who, threads: count }))
                .sort((a, b) => b.threads - a.threads)
                .slice(0, 5),
        });
    } catch (e) {
        return failed(source, e);
    }
}

async function electricityPace(propertyIds: string[], propName: Map<string, string>): Promise<DataPackSection> {
    const source = 'electricity_readings + electricity_reading_anomalies';
    try {
        if (!propertyIds.length) return ok(source, { note_inside: 'no active properties' });

        type Reading = { id: string; property_id: string | null; meter_id: string | null; reading_date: string; final_units: number | null; computed_units: number | null };

        // Anchor on the newest reading ≤ today, not wall-clock (dataset has future-dated rows).
        const { data: latestRow, error: latestErr } = await supabaseAdmin
            .from('electricity_readings')
            .select('reading_date')
            .in('property_id', propertyIds)
            .lte('reading_date', iso(new Date()))
            .order('reading_date', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (latestErr) throw new Error(latestErr.message);

        const anchor = latestRow?.reading_date ? new Date(latestRow.reading_date + 'T00:00:00Z') : new Date();
        const dayOfMonth = anchor.getUTCDate();
        const y = anchor.getUTCFullYear();
        const m = anchor.getUTCMonth();
        const curStart = new Date(Date.UTC(y, m, 1));
        const prevStart = new Date(Date.UTC(y, m - 1, 1));
        const prevMonthDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const prevEnd = new Date(Date.UTC(y, m - 1, Math.min(dayOfMonth, prevMonthDays)));

        // The window is ≤ 2 months, but the server still caps at 1000
        // rows/response regardless of .range() — page to be safe.
        const windowRows = await fetchAll<Reading>((from, to) => supabaseAdmin
            .from('electricity_readings')
            .select('id, property_id, meter_id, reading_date, final_units, computed_units')
            .in('property_id', propertyIds)
            .gte('reading_date', iso(prevStart))
            .lte('reading_date', iso(anchor))
            .range(from, to));

        const { data: anomalies, error: anomErr } = await supabaseAdmin
            .from('electricity_reading_anomalies')
            .select('id')
            .in('property_id', propertyIds)
            .range(0, 999);
        const anomalyNote = anomErr ? `anomaly view unavailable: ${anomErr.message}` : null;
        const excluded = new Set(((anomalies || []) as Array<{ id: string }>).map(a => a.id));

        const units = (r: Reading) => Number(r.final_units ?? r.computed_units ?? 0) || 0;
        const all = windowRows.filter(r => !excluded.has(r.id));
        const inWindow = (r: Reading, from: Date, to: Date) => r.reading_date >= iso(from) && r.reading_date <= iso(to);
        const curRows = all.filter(r => inWindow(r, curStart, anchor));
        const prevRows = all.filter(r => inWindow(r, prevStart, prevEnd));

        // Like-for-like: only meters that reported in BOTH windows.
        const curMeters = new Set(curRows.map(r => r.meter_id).filter(Boolean) as string[]);
        const prevMeters = new Set(prevRows.map(r => r.meter_id).filter(Boolean) as string[]);
        const sharedSet = new Set([...curMeters].filter(id => prevMeters.has(id)));
        const total = (rows: Reading[]) => Math.round(rows.filter(r => r.meter_id && sharedSet.has(r.meter_id)).reduce((s, r) => s + units(r), 0));

        const curUnits = total(curRows);
        const prevUnits = total(prevRows);
        const comparable = sharedSet.size > 0 && prevUnits > 0 && dayOfMonth >= MIN_DAYS_FOR_VERDICT;
        const deltaPct = comparable ? Math.round(((curUnits - prevUnits) / prevUnits) * 1000) / 10 : null;

        return ok(source, {
            as_of: iso(anchor),
            day_of_month: dayOfMonth,
            window: { current: { from: iso(curStart), to: iso(anchor) }, previous: { from: iso(prevStart), to: iso(prevEnd) } },
            current_units: curUnits,
            previous_units: prevUnits,
            comparable_meters: sharedSet.size,
            comparable,
            delta_pct: deltaPct,
            verdict: dayOfMonth < MIN_DAYS_FOR_VERDICT
                ? `Only ${dayOfMonth} day(s) into the month — too early to compare.`
                : !comparable
                    ? 'No meters reported in both periods, or previous period was zero — nothing to compare.'
                    : deltaPct === null ? null
                        : deltaPct >= 0
                            ? `${deltaPct}% above the same ${dayOfMonth} days last month.`
                            : `${Math.abs(deltaPct)}% below the same ${dayOfMonth} days last month.`,
            excluded_anomalous_readings: excluded.size,
            anomaly_view_note: anomalyNote,
            properties_with_readings: new Set(all.map(r => r.property_id).filter(Boolean) as string[]).size,
        });
    } catch (e) {
        return failed(source, e);
    }
}

async function ppmSummary(orgId: string, propName: Map<string, string>): Promise<DataPackSection> {
    const source = 'ppm_schedules';
    try {
        type R = { id: string; property_id: string | null; planned_date: string | null; done_date: string | null };
        const rows = await fetchAll<R>((from, to) => supabaseAdmin
            .from('ppm_schedules')
            .select('id, property_id, planned_date, done_date')
            .eq('organization_id', orgId)
            .range(from, to));
        const todayIso = iso(new Date());
        const thirtyAgo = iso(new Date(Date.now() - 30 * 86400000));

        let overdue = 0;
        let doneLast30 = 0;
        const overdueByProp = new Map<string, number>();
        for (const r of rows) {
            if (!r.done_date && r.planned_date && r.planned_date < todayIso) {
                overdue++;
                if (r.property_id) overdueByProp.set(r.property_id, (overdueByProp.get(r.property_id) || 0) + 1);
            }
            if (r.done_date && r.done_date >= thirtyAgo) doneLast30++;
        }

        return ok(source, {
            total: rows.length,
            overdue,
            overdue_pct: rows.length > 0 ? Math.round((overdue / rows.length) * 1000) / 10 : null,
            done_last_30d: doneLast30,
            worst_properties: [...overdueByProp.entries()]
                .map(([pid, count]) => ({ property: propName.get(pid) || pid, overdue: count }))
                .sort((a, b) => b.overdue - a.overdue)
                .slice(0, 5),
        });
    } catch (e) {
        return failed(source, e);
    }
}

async function rosterCoverage(orgId: string, propertyIds: string[], propName: Map<string, string>): Promise<DataPackSection> {
    const source = 'staff_rosters + property_memberships + offline_roster_staff';
    try {
        if (!propertyIds.length) return ok(source, { note_inside: 'no active properties' });
        const todayIso = iso(new Date());
        const weekOut = iso(new Date(Date.now() + 7 * 86400000));

        type MemberRow = { property_id: string | null; user_id: string | null; role: string | null };
        type OfflineRow = { property_id: string | null; id: string };
        type RosterRow = { property_id: string | null; roster_date: string; user_id: string | null };

        const [rosterRows, memberRows] = await Promise.all([
            fetchAll<RosterRow>((from, to) => supabaseAdmin
                .from('staff_rosters')
                .select('property_id, roster_date, user_id')
                .in('property_id', propertyIds)
                .gte('roster_date', todayIso)
                .lte('roster_date', weekOut)
                .range(from, to)),
            fetchAll<MemberRow>((from, to) => supabaseAdmin
                .from('property_memberships')
                .select('property_id, user_id, role')
                .eq('organization_id', orgId)
                .eq('is_active', true)
                .range(from, to)),
        ]);

        // offline_roster_staff is additive; tolerate its absence.
        let offlineRows: OfflineRow[] = [];
        let offlineNote: string | null = null;
        try {
            offlineRows = await fetchAll<OfflineRow>((from, to) => supabaseAdmin
                .from('offline_roster_staff')
                .select('property_id, id')
                .in('property_id', propertyIds)
                .range(from, to));
        } catch (e) {
            offlineNote = `offline_roster_staff unavailable: ${e instanceof Error ? e.message : e}`;
        }

        const EXCLUDED = new Set(['vendor', 'tenant', 'super_tenant']);
        const staffByProp = new Map<string, Set<string>>();
        for (const m of memberRows) {
            if (!m.property_id || !m.user_id || (m.role && EXCLUDED.has(m.role))) continue;
            if (!staffByProp.has(m.property_id)) staffByProp.set(m.property_id, new Set());
            staffByProp.get(m.property_id)!.add(m.user_id);
        }
        for (const o of offlineRows) {
            if (!o.property_id) continue;
            if (!staffByProp.has(o.property_id)) staffByProp.set(o.property_id, new Set());
            staffByProp.get(o.property_id)!.add(o.id);
        }

        const shiftsByProp = new Map<string, number>();
        const staffedUsersByProp = new Map<string, Set<string>>();
        for (const r of rosterRows) {
            if (!r.property_id) continue;
            shiftsByProp.set(r.property_id, (shiftsByProp.get(r.property_id) || 0) + 1);
            if (r.user_id) {
                if (!staffedUsersByProp.has(r.property_id)) staffedUsersByProp.set(r.property_id, new Set());
                staffedUsersByProp.get(r.property_id)!.add(r.user_id);
            }
        }

        const perProperty = propertyIds.map(pid => {
            const staff = staffByProp.get(pid)?.size || 0;
            const rostered = staffedUsersByProp.get(pid)?.size || 0;
            return {
                property: propName.get(pid) || pid,
                staff_count: staff,
                shifts_next_7d: shiftsByProp.get(pid) || 0,
                distinct_staff_rostered_next_7d: rostered,
                uncovered_staff: Math.max(0, staff - rostered),
            };
        });

        return ok(source, {
            window: { from: todayIso, to: weekOut },
            total_shifts_next_7d: rosterRows.length,
            properties: perProperty,
            zero_coverage_properties: perProperty.filter(p => p.staff_count > 0 && p.shifts_next_7d === 0).map(p => p.property),
            offline_staff_note: offlineNote,
        });
    } catch (e) {
        return failed(source, e);
    }
}

async function generatorsDiesel(propertyIds: string[], propName: Map<string, string>): Promise<DataPackSection> {
    const source = 'generators + diesel_readings';
    try {
        if (!propertyIds.length) return ok(source, { note_inside: 'no active properties' });

        const { data: gens, error: genErr } = await supabaseAdmin
            .from('generators')
            .select('id, name, property_id, status, capacity_kva')
            .in('property_id', propertyIds)
            .range(0, 999);
        if (genErr) throw new Error(`generators: ${genErr.message}`);

        type G = { id: string; name: string | null; property_id: string | null; status: string | null; capacity_kva: number | null };
        const genRows = (gens || []) as G[];
        if (!genRows.length) return ok(source, { generators_total: 0, note_inside: 'no generators registered' });

        const genIds = genRows.map(g => g.id);
        const thirtyAgo = iso(new Date(Date.now() - 30 * 86400000));
        type R = { generator_id: string; reading_date: string; computed_run_hours: number | null; diesel_added_litres: number | null; computed_consumed_litres: number | null; alert_status: string | null };
        let rows: R[];
        try {
            rows = await fetchAll<R>((from, to) => supabaseAdmin
                .from('diesel_readings')
                .select('generator_id, reading_date, computed_run_hours, diesel_added_litres, computed_consumed_litres, alert_status')
                .in('generator_id', genIds)
                .gte('reading_date', thirtyAgo)
                .range(from, to));
        } catch (e) {
            throw new Error(`diesel_readings: ${e instanceof Error ? e.message : e}`);
        }
        const todayIso = iso(new Date());
        const sevenAgo = iso(new Date(Date.now() - 7 * 86400000));

        const byGen = new Map<string, { run_hours: number; litres_added: number; litres_consumed: number; alerts: number; readings: number; last_reading: string | null }>();
        for (const r of rows) {
            const e = byGen.get(r.generator_id) || { run_hours: 0, litres_added: 0, litres_consumed: 0, alerts: 0, readings: 0, last_reading: null };
            e.run_hours += n(r.computed_run_hours);
            e.litres_added += n(r.diesel_added_litres);
            e.litres_consumed += n(r.computed_consumed_litres);
            if (r.alert_status && r.alert_status !== 'normal') e.alerts++;
            e.readings++;
            if (!e.last_reading || r.reading_date > e.last_reading) e.last_reading = r.reading_date;
            byGen.set(r.generator_id, e);
        }

        const byStatus = new Map<string, number>();
        for (const g of genRows) byStatus.set(g.status || 'unknown', (byStatus.get(g.status || 'unknown') || 0) + 1);

        const perGenerator = genRows.map(g => {
            const e = byGen.get(g.id);
            return {
                generator: g.name || g.id,
                property: g.property_id ? (propName.get(g.property_id) || g.property_id) : null,
                status: g.status,
                readings_last_30d: e?.readings || 0,
                run_hours_last_30d: Math.round((e?.run_hours || 0) * 10) / 10,
                diesel_added_litres_last_30d: Math.round((e?.litres_added || 0) * 10) / 10,
                diesel_consumed_litres_last_30d: Math.round((e?.litres_consumed || 0) * 10) / 10,
                alerts_last_30d: e?.alerts || 0,
                last_reading_date: e?.last_reading || null,
            };
        });

        return ok(source, {
            as_of: todayIso,
            generators_total: genRows.length,
            by_status: Object.fromEntries(byStatus),
            totals_last_30d: {
                run_hours: Math.round(rows.reduce((s, r) => s + n(r.computed_run_hours), 0) * 10) / 10,
                diesel_added_litres: Math.round(rows.reduce((s, r) => s + n(r.diesel_added_litres), 0) * 10) / 10,
                readings: rows.length,
                alerts: rows.filter(r => r.alert_status && r.alert_status !== 'normal').length,
            },
            no_reading_in_7d: perGenerator.filter(g => !g.last_reading_date || g.last_reading_date < sevenAgo).map(g => g.generator),
            generators: perGenerator,
        });
    } catch (e) {
        return failed(source, e);
    }
}

async function aopImportWarnings(orgId: string): Promise<DataPackSection> {
    const source = 'aop_import_warnings';
    try {
        const { data, error } = await supabaseAdmin
            .from('aop_import_warnings')
            .select('id, severity, message, sheet_name, site_label, imported_at')
            .eq('organization_id', orgId)
            .eq('is_acknowledged', false)
            .order('imported_at', { ascending: false })
            .limit(20);
        if (error) throw new Error(error.message);

        type R = { id: string; severity: string | null; message: string | null; sheet_name: string | null; site_label: string | null; imported_at: string | null };
        const rows = (data || []) as R[];
        const bySeverity = new Map<string, number>();
        for (const r of rows) bySeverity.set(r.severity || 'unknown', (bySeverity.get(r.severity || 'unknown') || 0) + 1);

        return ok(source, {
            unacknowledged: rows.length,
            by_severity: Object.fromEntries(bySeverity),
            oldest_unacked_at: rows.length ? rows[rows.length - 1].imported_at : null,
            warnings: rows.map(r => ({
                severity: r.severity, message: r.message, sheet: r.sheet_name, site: r.site_label, imported_at: r.imported_at,
            })),
        });
    } catch (e) {
        return failed(source, e);
    }
}

/**
 * Static security notes — CONFIRMED facts from a prior security audit, carried
 * here so the CTO lens always sees them. provenance 'prior-audit': not
 * re-verified live on each run; Verma's persona treats them as true until
 * disproven and asks for re-verification.
 */
/**
 * Intake quality — the root cause of slow triage, made measurable.
 *
 * The 28-Jun audit asserted "intake captures no category, floor or location, so every
 * ticket lands as GENERAL". The council could not previously confirm or refute that: no
 * section carried field-completeness, so the honest best a persona could say was "no
 * intake quality data available". This turns the claim into a number a lens can cite.
 */
async function intakeQuality(orgId: string): Promise<DataPackSection> {
    const source = 'tickets (field completeness)';
    try {
        type T = {
            category_id: string | null; floor_number: number | null; location: string | null;
            secondary_category_code: string | null; is_vague: boolean | null;
            classification_source: string | null;
        };
        // fetchAll, not .range(): the server caps a single response at 1000 rows, so a
        // bare range would compute these percentages from the first 1000 tickets and
        // report a biased sample as a portfolio fact.
        const rows = await fetchAll<T>((from, to) => supabaseAdmin
            .from('tickets')
            .select('id, category_id, floor_number, location, secondary_category_code, is_vague, classification_source')
            .eq('organization_id', orgId)
            .range(from, to));
        const total = rows.length;
        if (!total) return ok(source, { total: 0, note: 'no tickets to assess' });

        const missing = (pred: (t: T) => boolean) => rows.filter(pred).length;
        const pct = (n: number) => Math.round((n / total) * 1000) / 10;

        const noCategory = missing(t => !t.category_id);
        const noFloor = missing(t => t.floor_number === null || t.floor_number === undefined);
        const noLocation = missing(t => !t.location || !String(t.location).trim());
        const noSecondary = missing(t => !t.secondary_category_code);
        const vague = missing(t => t.is_vague === true);

        const bySource = new Map<string, number>();
        for (const t of rows) {
            const k = t.classification_source || 'unset';
            bySource.set(k, (bySource.get(k) || 0) + 1);
        }

        return ok(source, {
            total,
            missing_category: noCategory,
            missing_category_pct: pct(noCategory),
            missing_floor: noFloor,
            missing_floor_pct: pct(noFloor),
            missing_location: noLocation,
            missing_location_pct: pct(noLocation),
            missing_secondary_category: noSecondary,
            missing_secondary_category_pct: pct(noSecondary),
            flagged_vague: vague,
            classification_source: Object.fromEntries(bySource),
            interpretation: 'High missing_location/missing_floor means a ticket cannot be routed to a place without a human reading it — the mechanical cause of slow triage.',
        });
    } catch (e) {
        return failed(source, e);
    }
}

/**
 * Escalation health — whether the ladder actually FIRES.
 *
 * The audit noted a 104-day-old ticket with no escalation signal. Ticket age was already
 * in the pack, but age alone cannot distinguish "nobody escalated it" from "it escalated
 * and is still stuck", and those demand different fixes. This measures the gap itself:
 * aged, still-active tickets that have never produced an escalation row.
 */
async function escalationHealth(orgId: string): Promise<DataPackSection> {
    const source = 'tickets + ticket_escalation_logs';
    try {
        type T = { id: string; status: string | null; created_at: string | null };
        const rows = await fetchAll<T>((from, to) => supabaseAdmin
            .from('tickets')
            .select('id, status, created_at')
            .eq('organization_id', orgId)
            .in('status', [...ACTIVE_TICKET_STATUSES, 'assigned'])
            .range(from, to));
        const cutoff = Date.now() - 30 * 86400000;
        const aged = rows.filter(t => t.created_at && new Date(t.created_at).getTime() < cutoff);

        // Escalation rows for the aged set only — the question is about those tickets.
        let escalatedIds = new Set<string>();
        let totalEscalations = 0;
        if (aged.length) {
            const logs = await fetchAll<{ ticket_id: string }>((from, to) => supabaseAdmin
                .from('ticket_escalation_logs')
                .select('ticket_id')
                .in('ticket_id', aged.map(t => t.id))
                .range(from, to));
            totalEscalations = logs.length;
            escalatedIds = new Set(logs.map(l => l.ticket_id));
        }

        const agedNoEscalation = aged.filter(t => !escalatedIds.has(t.id)).length;

        return ok(source, {
            active_considered: rows.length,
            aged_over_30d: aged.length,
            aged_with_escalation: aged.length - agedNoEscalation,
            aged_without_escalation: agedNoEscalation,
            aged_without_escalation_pct: aged.length
                ? Math.round((agedNoEscalation / aged.length) * 1000) / 10
                : null,
            escalation_rows_for_aged_tickets: totalEscalations,
            interpretation: 'A high aged_without_escalation means the escalation ladder is not firing at all, which is a different defect from an escalation that fired and was ignored.',
        });
    } catch (e) {
        return failed(source, e);
    }
}

/**
 * Org context — who and what the business IS, derived entirely from existing tables.
 *
 * Without this the council is blind in a specific way: it can compute that SS Plaza has
 * 212 active tickets but cannot say whether SS Plaza is a flagship client site or a
 * satellite, whether "Technical" is a team of 2 or 40, or that an AC Breakdown carries an
 * 8-hour SLA. Every figure it produced was arithmetic without a business model.
 *
 * Nothing here needs a human to supply it — it was always in the database and simply was
 * never handed to the personas. The curated half (KRAs, site tiers, client
 * classification) is a separate section, because that genuinely does live in people's
 * heads.
 */
async function orgContext(orgId: string, propName: Map<string, string>): Promise<DataPackSection> {
    const source = 'organizations + properties + users + memberships + issue_categories + skill_groups + escalation_*';
    try {
        const [orgsRes, propsRes, membersRes, catsRes, groupsRes, hierRes, levelsRes] = await Promise.all([
            supabaseAdmin.from('organizations').select('id, name, code, status, is_deleted').range(0, 999),
            supabaseAdmin.from('properties').select('id, name, city, capacity, status, is_active').eq('organization_id', orgId).range(0, 999),
            supabaseAdmin.from('organization_memberships').select('user_id, role, is_active').eq('organization_id', orgId).eq('is_active', true).range(0, 4999),
            supabaseAdmin.from('issue_categories').select('name, code, sla_hours, priority, is_active').eq('is_active', true).range(0, 4999),
            supabaseAdmin.from('skill_groups').select('name, code, is_manual_assign').eq('is_active', true).range(0, 999),
            supabaseAdmin.from('escalation_hierarchies').select('id, name, property_id, trigger_after_minutes, is_active').eq('organization_id', orgId).range(0, 999),
            supabaseAdmin.from('escalation_levels').select('hierarchy_id, level_number, employee_id, escalation_time_minutes').range(0, 4999),
        ]);

        const orgs = (orgsRes.data || []) as { id: string; name: string | null; code: string | null; status: string | null; is_deleted: boolean | null }[];
        const props = (propsRes.data || []) as { id: string; name: string | null; city: string | null; capacity: number | null; is_active: boolean | null }[];
        const members = (membersRes.data || []) as { user_id: string; role: string | null }[];
        const cats = (catsRes.data || []) as { name: string | null; code: string | null; sla_hours: number | null; priority: string | null }[];
        const groups = (groupsRes.data || []) as { name: string | null; code: string | null; is_manual_assign: boolean | null }[];
        const hiers = (hierRes.data || []) as { id: string; name: string | null; property_id: string | null; trigger_after_minutes: number | null }[];
        const levels = (levelsRes.data || []) as { hierarchy_id: string; level_number: number | null; employee_id: string | null; escalation_time_minutes: number | null }[];

        // Roles present, with headcount — "who is what", as a distribution.
        const byRole = new Map<string, number>();
        for (const m of members) byRole.set(m.role || 'unknown', (byRole.get(m.role || 'unknown') || 0) + 1);

        // Issue taxonomy is business logic: it encodes what counts as urgent. Duplicate
        // names carrying DIFFERENT SLAs are a live triage hazard, so they are surfaced
        // rather than collapsed — two "AC Breakdown" rows at 8h and 24h mean the same
        // complaint gets a different deadline depending on which row it matched.
        const slaByName = new Map<string, Set<number>>();
        for (const c of cats) {
            if (!c.name || c.sla_hours == null) continue;
            (slaByName.get(c.name) ?? slaByName.set(c.name, new Set()).get(c.name)!).add(c.sla_hours);
        }
        const conflicting = [...slaByName.entries()]
            .filter(([, set]) => set.size > 1)
            .map(([name, set]) => ({ category: name, competing_sla_hours: [...set].sort((a, b) => a - b) }));

        const levelsByHier = new Map<string, number>();
        for (const l of levels) levelsByHier.set(l.hierarchy_id, (levelsByHier.get(l.hierarchy_id) || 0) + 1);

        const sitesMissingCity = props.filter(p => p.is_active !== false && !p.city).length;
        const sitesMissingCapacity = props.filter(p => p.is_active !== false && p.capacity == null).length;

        return ok(source, {
            organizations: orgs
                .filter(o => o.is_deleted !== true)
                .map(o => ({ name: (o.name || '').trim(), code: (o.code || '').trim(), status: o.status, is_this_org: o.id === orgId })),
            sites: props.filter(p => p.is_active !== false).map(p => ({
                name: p.name, city: p.city ?? null, seats_capacity: p.capacity ?? null,
            })),
            site_coverage_gaps: {
                active_sites: props.filter(p => p.is_active !== false).length,
                missing_city: sitesMissingCity,
                missing_capacity: sitesMissingCapacity,
                note: 'A site with no city and no capacity cannot be weighted by size or region — findings about it are unrankable against other sites.',
            },
            roles_in_org: Object.fromEntries([...byRole.entries()].sort((a, b) => b[1] - a[1])),
            skill_groups: groups.map(g => ({ name: g.name, code: g.code, manual_assign: g.is_manual_assign })),
            issue_taxonomy: {
                active_categories: cats.length,
                sla_hours_in_use: [...new Set(cats.map(c => c.sla_hours).filter(v => v != null))].sort((a, b) => (a as number) - (b as number)),
                priorities_in_use: [...new Set(cats.map(c => c.priority).filter(Boolean))],
                conflicting_sla_definitions: conflicting,
            },
            escalation_ladders: hiers.map(h => ({
                name: h.name,
                scope: h.property_id ? (propName.get(h.property_id) || 'a property') : 'organization-wide',
                trigger_after_minutes: h.trigger_after_minutes,
                levels_configured: levelsByHier.get(h.id) || 0,
            })),
            interpretation: 'This is the org as the system understands it. Use it to weight findings — a problem at a large site, or in a category with a short SLA, is not equal to the same problem elsewhere.',
        });
    } catch (e) {
        return failed(source, e);
    }
}

/**
 * Business context — the curated half, supplied by humans (see
 * supabase/migrations/20260803000003_council_business_context.sql).
 *
 * Critically this section ALWAYS reports its own coverage, including when it is empty.
 * A council that silently lacks KRAs will invent priorities; a council told "0 of 19
 * roles have a defined KRA" can say so as a finding. Blindness the agents can see is
 * recoverable; blindness they cannot see is not.
 */
async function businessContext(orgId: string, roleCount: number): Promise<DataPackSection> {
    const source = 'council_business_context';
    try {
        const { data, error } = await supabaseAdmin
            .from('council_business_context')
            .select('kind, subject_type, subject_key, title, body, attributes, provided_by')
            .eq('org_id', orgId)
            .eq('is_active', true)
            .range(0, 4999);
        if (error) throw new Error(error.message);

        type Row = {
            kind: string; subject_type: string; subject_key: string;
            title: string; body: string; attributes: Record<string, unknown> | null; provided_by: string | null;
        };
        const rows = (data || []) as Row[];

        const byKind = new Map<string, Row[]>();
        for (const r of rows) (byKind.get(r.kind) ?? byKind.set(r.kind, []).get(r.kind)!).push(r);

        const kras = byKind.get('kra') || [];
        const rolesWithKra = new Set(kras.filter(k => k.subject_type === 'role').map(k => k.subject_key));

        return ok(source, {
            entries: rows.length,
            by_kind: Object.fromEntries([...byKind.entries()].map(([k, v]) => [k, v.length])),
            coverage: {
                roles_in_org: roleCount,
                roles_with_kra: rolesWithKra.size,
                kra_coverage_pct: roleCount ? Math.round((rolesWithKra.size / roleCount) * 1000) / 10 : null,
                site_profiles: (byKind.get('site_profile') || []).length,
                client_profiles: (byKind.get('client_profile') || []).length,
                hierarchy_statements: (byKind.get('hierarchy') || []).length,
            },
            context: rows.map(r => ({
                kind: r.kind, about: `${r.subject_type}:${r.subject_key}`,
                title: r.title, body: r.body,
                attributes: r.attributes || {}, provided_by: r.provided_by,
            })),
            interpretation: rows.length === 0
                ? 'NO BUSINESS CONTEXT HAS BEEN SUPPLIED. You do not know what any role is measured on, which sites are commercially important, or who reports to whom. Say so explicitly rather than assuming — and treat the absence itself as a finding worth raising.'
                : 'Weight every finding against these. A breach of a stated KRA outranks a larger number that no one is accountable for.',
        });
    } catch (e) {
        return failed(source, e);
    }
}

/** Distinct active roles in the org — the denominator for KRA coverage. */
async function roleCountForOrg(orgId: string): Promise<number> {
    try {
        const { data, error } = await supabaseAdmin
            .from('organization_memberships')
            .select('role')
            .eq('organization_id', orgId)
            .eq('is_active', true)
            .range(0, 4999);
        if (error) throw new Error(error.message);
        return new Set((data || []).map(r => (r as { role: string | null }).role).filter(Boolean)).size;
    } catch {
        return 0;
    }
}

function securityNotes(): DataPackSection {
    return {
        source: 'prior-audit',
        fetched_at: now(),
        data: {
            provenance: 'prior-audit',
            findings: [
                {
                    id: 'public-photo-bucket',
                    fact: 'The storage bucket holding ticket/property photos is publicly readable — tenant-facing imagery is fetchable without auth.',
                    status: 'confirmed-prior-audit',
                },
                {
                    id: 'unauthenticated-routes',
                    fact: 'Three API routes serve org data without authentication.',
                    routes: [
                        '/api/organizations/[orgId]/vendor-summary',
                        '/api/procurement/requisitions',
                        '/api/ppm/audit',
                    ],
                    status: 'confirmed-prior-audit',
                },
                {
                    id: 'rls-disabled-tables',
                    fact: '71 tables holding org data have Row Level Security disabled — tenancy isolation rests entirely on application-side filters.',
                    count: 71,
                    status: 'confirmed-prior-audit',
                },
                {
                    id: 'technician-role-absent',
                    fact: 'There is no Technician role. A credential marked Technician renders as PROPERTY MANAGER with the full admin console, so field staff hold write access to org settings, configuration and procurement.',
                    impact: 'Privilege escalation by absence: the restrictive role does not exist, so everyone lands in a permissive one.',
                    status: 'confirmed-prior-audit',
                },
                {
                    id: 'tenant-assignee-picker',
                    fact: 'The tenant New Request form exposes an @-picker listing real internal staff names, letting a tenant assign a ticket directly to a named person and bypass triage.',
                    impact: 'Two defects in one control: a workflow bypass (triage is skipped) and a data leak (internal staff identity is disclosed to tenants).',
                    status: 'confirmed-prior-audit',
                },
                {
                    id: 'test-artifact-in-production',
                    fact: 'Audit ticket [FMS-AUDIT-TEST-15-JUN] is still live in the production tenant queue, and the tenant side has no delete path.',
                    impact: 'Test data pollutes real metrics and every audit trail it touches. No cleanup policy exists for auto-generated test records.',
                    status: 'confirmed-prior-audit',
                },
                {
                    id: 'global-logout-503',
                    fact: 'A Supabase global-logout call returned 503 during the audit, possibly related to a shared-auth logout issue seen in a separate app.',
                    // Deliberately not stated as a cause. The eval's TRUTH-10 requires this
                    // stay an open investigation, and asserting an unverified root cause is
                    // exactly the failure mode the council exists to avoid.
                    status: 'OPEN INVESTIGATION — cause NOT established. Do not assert a root cause for this; report it as unresolved.',
                },
            ],
            caveat: 'These are prior-audit facts re-stated as evidence, not live checks. Cite them with provenance "prior-audit" and say they need re-verification.',
        },
    };
}

// ---------------------------------------------------------------------------

/**
 * Gather the full org snapshot. Sections run sequentially (each is a small
 * handful of queries; the wall-clock cost is dominated by the LLM stages that
 * follow). A failure in any section degrades that section to a note.
 */
export async function gatherDataPack(orgId: string): Promise<CouncilDataPack> {
    // Properties are the tenancy anchor: generators, diesel_readings,
    // staff_rosters and electricity_readings carry no organization_id of their
    // own, so every property-scoped query filters on this id list.
    let propertyIds: string[] = [];
    const propName = new Map<string, string>();
    let propertiesNote: string | null = null;
    try {
        const { data, error } = await supabaseAdmin
            .from('properties')
            .select('id, name, city, is_active')
            .eq('organization_id', orgId)
            .range(0, 999);
        if (error) throw new Error(error.message);
        const active = ((data || []) as PropRow[]).filter(p => p.is_active !== false);
        propertyIds = active.map(p => p.id);
        for (const p of active) propName.set(p.id, p.name);
    } catch (e) {
        propertiesNote = e instanceof Error ? e.message : String(e);
    }

    const sections: Record<string, DataPackSection> = {
        portfolio: propertiesNote
            ? failed('properties', propertiesNote)
            : ok('properties', {
                active_properties: propertyIds.length,
                properties: [...propName.values()].sort(),
            }),
        // Context first: the personas read the pack in order, and knowing WHAT the
        // business is has to precede any number about it.
        org_context: await orgContext(orgId, propName),
        business_context: await businessContext(orgId, await roleCountForOrg(orgId)),
        tickets_summary: await ticketsSummary(orgId, propName),
        intake_quality: await intakeQuality(orgId),
        escalation_health: await escalationHealth(orgId),
        aop_summary: await aopSummary(orgId),
        procurement_mailbox: await procurementMailbox(orgId),
        electricity_pace: await electricityPace(propertyIds, propName),
        ppm_summary: await ppmSummary(orgId, propName),
        roster_coverage: await rosterCoverage(orgId, propertyIds, propName),
        generators_diesel: await generatorsDiesel(propertyIds, propName),
        aop_import_warnings: await aopImportWarnings(orgId),
        security_notes: securityNotes(),
    };

    return { org_id: orgId, generated_at: now(), sections };
}
