import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingRelation } from '@/backend/lib/aop/access';

/**
 * Billed-vs-logger variance, at the grain the ops team actually argues about.
 *
 * RELATIONSHIP TO validate.ts — read this before adding anything here.
 * validate.ts already owns the comparison: it reads the anomaly-filtered
 * electricity_monthly_consumption view, gap-scans reading dates, computes the percentage
 * and persists one electricity_bill_validations row per run. That work is NOT repeated
 * here. This module reads the latest persisted run and adds the three things the stored
 * row cannot answer:
 *
 *   1. ABSOLUTE variance. The row stores variance_pct only, so "12% over" never says
 *      whether that is 40 kWh or 4,000 kWh — the number the provider is actually asked
 *      about in a dispute.
 *   2. METER GRAIN. The stored comparison is per PROPERTY, because electricity_billing_
 *      accounts carries no meter_id (SS Plaza runs EB-1 + Jio Tower on one property;
 *      3i - Crescent Solitaire runs three Adani connections). Until that link exists a
 *      bill cannot be pinned to one meter, so the breakdown below shows which meters made
 *      up the FMS total rather than pretending to a precision the schema does not have.
 *   3. TOLERANCE PER METER/SITE. validate.ts resolves one deployment-wide number. Sites
 *      differ: a tower with a diesel changeover deserves more slack than a single-meter
 *      floor. Resolution order is meter -> billing account -> the value the validation run
 *      already resolved -> DEFAULT_TOLERANCE_PCT.
 *
 * Nothing here writes to electricity_bill_validations or moves workflow_status; that
 * remains validate.ts's job. The only write this module performs is raiseVarianceTicket().
 */

/**
 * Fallback tolerance when no override and no validation run exist. Mirrors the same
 * default in validate.ts deliberately: a bill judged by this engine and a bill judged by
 * the nightly pass must not disagree because one of them fell back differently.
 */
export const DEFAULT_TOLERANCE_PCT = 5;

/**
 * 'undetermined' is a third state on purpose. A bill with no readings logged is not a
 * pass (nothing was checked) and not a variance exception either — chase.ts already owns
 * missing readings and would end up chasing the same gap twice. Saying "cannot judge" is
 * the honest answer and keeps the two engines off each other's territory.
 */
export type VarianceVerdict = 'pass' | 'exception' | 'undetermined';

export type VarianceReason =
    | 'within_tolerance'
    | 'over_tolerance'
    | 'missing_readings'
    | 'incomplete_data'
    | 'no_meter_link'
    | 'not_validated';

/** Where the applied tolerance came from, so a disputed verdict can be traced to its knob. */
export type ToleranceSource = 'meter' | 'account' | 'validation_run' | 'default';

export interface VarianceMeter {
    meterId: string;
    name: string | null;
    meterNumber: string | null;
    units: number;
    readingsCounted: number;
    readingsExcluded: number;
}

export interface VarianceBillContext {
    accountId: string;
    propertyId: string | null;
    provider: string;
    siteLabel: string;
    consumerRef: string | null;
    billingMonth: string;
    billDate: string | null;
    dueDate: string | null;
    totalAmount: number | null;
    billedUnitsUnit: string | null;
    workflowStatus: string;
}

export interface BillVariance {
    billId: string;
    organizationId: string;
    verdict: VarianceVerdict;
    reason: VarianceReason;

    billedUnits: number | null;
    loggedUnits: number | null;
    /** billed - logged, in kWh. Positive = the provider billed more than the FMS logged. */
    varianceUnits: number | null;
    variancePct: number | null;

    tolerancePct: number;
    toleranceSource: ToleranceSource;

    missingDates: string[];
    readingsCounted: number | null;
    readingsExcluded: number | null;

    meters: VarianceMeter[];
    bill: VarianceBillContext;

    validationRunAt: string | null;
    validationResult: string | null;
}

interface BillRow {
    id: string;
    organization_id: string;
    account_id: string;
    billing_month: string;
    bill_date: string | null;
    due_date: string | null;
    total_amount: number | null;
    billed_units_unit: string | null;
    workflow_status: string;
    electricity_billing_accounts: {
        id: string;
        property_id: string | null;
        provider: string;
        site_label: string;
        consumer_ref: string | null;
    } | null;
}

const BILL_SELECT = `
    id, organization_id, account_id, billing_month, bill_date, due_date, total_amount,
    billed_units_unit, workflow_status,
    electricity_billing_accounts ( id, property_id, provider, site_label, consumer_ref )
`;

/** billing_month is stored as the 1st of the month; PostgREST may hand it back with a time part. */
function monthKey(raw: string): string {
    return String(raw).slice(0, 10);
}

function monthBounds(billingMonth: string): { first: string; last: string } {
    const first = monthKey(billingMonth);
    const start = new Date(`${first}T00:00:00Z`);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    return { first, last: end.toISOString().slice(0, 10) };
}

/**
 * Reads an optional per-row tolerance override.
 *
 * A missing column and a blank cell collapse to the same answer — null, meaning "inherit
 * from the next rung". The override columns are additive and may not be provisioned in
 * every deployment yet, and an unmigrated database must degrade to the org-wide tolerance
 * rather than fail the read.
 */
async function readOverrideTolerance(table: string, id: string): Promise<number | null> {
    const { data, error } = await supabaseAdmin
        .from(table).select('variance_tolerance_pct').eq('id', id).maybeSingle();
    if (error || data?.variance_tolerance_pct == null) return null;
    const v = Number(data.variance_tolerance_pct);
    return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * meter -> billing account -> the validation run's own resolved value -> hardcoded default.
 *
 * The third rung reuses tolerance_pct off the stored validation row instead of re-reading
 * system_config, so this engine and the nightly pass can never resolve the org-wide number
 * differently.
 */
async function resolveTolerance(
    account: BillRow['electricity_billing_accounts'],
    runTolerancePct: number | null,
): Promise<{ pct: number; source: ToleranceSource }> {
    // Meter-grain tolerance only means something when the site has exactly one meter —
    // then the bill and the meter are the same thing. With two connections on one property
    // the bill covers a mix, and no single meter's knob can speak for the whole bill.
    if (account?.property_id) {
        const { data: meters } = await supabaseAdmin
            .from('electricity_meters')
            .select('id')
            .eq('property_id', account.property_id)
            .eq('status', 'active');
        if (meters?.length === 1) {
            const pct = await readOverrideTolerance('electricity_meters', meters[0].id);
            if (pct != null) return { pct, source: 'meter' };
        }
    }

    if (account?.id) {
        const pct = await readOverrideTolerance('electricity_billing_accounts', account.id);
        if (pct != null) return { pct, source: 'account' };
    }

    if (runTolerancePct != null && Number.isFinite(runTolerancePct) && runTolerancePct > 0) {
        return { pct: runTolerancePct, source: 'validation_run' };
    }
    return { pct: DEFAULT_TOLERANCE_PCT, source: 'default' };
}

/**
 * Per-meter FMS units for the billing month, matching the electricity_monthly_consumption
 * view's arithmetic exactly: SUM(COALESCE(final_units, computed_units, 0)) with anomaly
 * rows excluded. The view aggregates away meter_id, so the same filter is reproduced here
 * over the raw rows rather than by re-deriving the numbers a different way — the property
 * total below must always be the view's total.
 */
async function loadMeterBreakdown(propertyId: string, billingMonth: string): Promise<VarianceMeter[]> {
    const { first, last } = monthBounds(billingMonth);

    const { data: readings, error } = await supabaseAdmin
        .from('electricity_readings')
        .select('id, meter_id, final_units, computed_units')
        .eq('property_id', propertyId)
        .gte('reading_date', first)
        .lte('reading_date', last)
        .range(0, 9999);
    if (error || !readings?.length) return [];

    const { data: anomalies } = await supabaseAdmin
        .from('electricity_reading_anomalies')
        .select('id')
        .eq('property_id', propertyId)
        .gte('reading_date', first)
        .lte('reading_date', last)
        .range(0, 9999);
    const excluded = new Set((anomalies || []).map(a => String(a.id)));

    const byMeter = new Map<string, VarianceMeter>();
    for (const r of readings) {
        const meterId = String(r.meter_id);
        const entry = byMeter.get(meterId) ?? {
            meterId, name: null, meterNumber: null, units: 0, readingsCounted: 0, readingsExcluded: 0,
        };
        if (excluded.has(String(r.id))) {
            entry.readingsExcluded += 1;
        } else {
            entry.units += Number(r.final_units ?? r.computed_units ?? 0);
            entry.readingsCounted += 1;
        }
        byMeter.set(meterId, entry);
    }

    const { data: meters } = await supabaseAdmin
        .from('electricity_meters')
        .select('id, name, meter_number')
        .in('id', [...byMeter.keys()]);
    for (const m of meters || []) {
        const entry = byMeter.get(String(m.id));
        if (entry) {
            entry.name = m.name ?? null;
            entry.meterNumber = m.meter_number ?? null;
        }
    }

    return [...byMeter.values()]
        .map(m => ({ ...m, units: Math.round(m.units * 1000) / 1000 }))
        .sort((a, b) => b.units - a.units);
}

function judge(
    billedUnits: number | null,
    loggedUnits: number | null,
    variancePct: number | null,
    missingDates: string[],
    tolerancePct: number,
    validationResult: string | null,
): { verdict: VarianceVerdict; reason: VarianceReason } {
    if (validationResult === 'no_meter_link') return { verdict: 'undetermined', reason: 'no_meter_link' };
    if (billedUnits == null || loggedUnits == null) {
        return { verdict: 'undetermined', reason: 'incomplete_data' };
    }
    // Readings exist but net to zero while the provider billed units: no percentage is
    // definable, yet this is the loudest exception there is. The absolute variance carries
    // it — do not let the divide-by-zero guard downgrade it to 'cannot judge'.
    if (loggedUnits === 0) {
        return billedUnits > 0
            ? { verdict: 'exception', reason: 'over_tolerance' }
            : { verdict: 'undetermined', reason: 'incomplete_data' };
    }
    if (variancePct == null) return { verdict: 'undetermined', reason: 'incomplete_data' };
    // Over tolerance wins even with days missing: the gap can only have understated the
    // FMS side, so the bill is already over by at least this much.
    if (Math.abs(variancePct) > tolerancePct) return { verdict: 'exception', reason: 'over_tolerance' };
    // Inside tolerance but days are missing — the FMS total is incomplete, so this is not
    // a clean pass. chase.ts is already chasing those readings; do not ticket it twice.
    if (missingDates.length > 0) return { verdict: 'undetermined', reason: 'missing_readings' };
    return { verdict: 'pass', reason: 'within_tolerance' };
}

/**
 * Variance for one bill. Read-only: no validation row is written and workflow_status is
 * untouched. Returns null when the bill does not exist in the given org.
 */
export async function computeBillVariance(billId: string, organizationId: string): Promise<BillVariance | null> {
    const { data: bill, error } = await supabaseAdmin
        .from('electricity_bills')
        .select(BILL_SELECT)
        .eq('id', billId)
        .eq('organization_id', organizationId)
        .maybeSingle();
    if (error || !bill) return null;

    return buildVariance(bill as unknown as BillRow);
}

/**
 * Variance for every bill in one billing month. Same read-only contract as
 * computeBillVariance; billingMonth accepts 'YYYY-MM' or 'YYYY-MM-01'.
 */
export async function computePeriodVariance(organizationId: string, billingMonth: string): Promise<BillVariance[]> {
    const month = billingMonth.length === 7 ? `${billingMonth}-01` : monthKey(billingMonth);

    const { data: bills, error } = await supabaseAdmin
        .from('electricity_bills')
        .select(BILL_SELECT)
        .eq('organization_id', organizationId)
        .eq('billing_month', month)
        .range(0, 499);
    if (error || !bills?.length) return [];

    const out: BillVariance[] = [];
    for (const b of bills as unknown as BillRow[]) {
        out.push(await buildVariance(b));
    }
    // Worst variance first — the queue should open on the bill worth arguing about. Bills
    // with no computable percentage sort last; they need a validation run, not an argument.
    const rank = (v: BillVariance) => (v.variancePct == null ? -1 : Math.abs(v.variancePct));
    return out.sort((a, b) => rank(b) - rank(a));
}

async function buildVariance(bill: BillRow): Promise<BillVariance> {
    const account = bill.electricity_billing_accounts;

    const { data: latest } = await supabaseAdmin
        .from('electricity_bill_validations')
        .select('run_at, billed_units, logged_units, variance_pct, tolerance_pct, missing_dates, readings_counted, readings_excluded, result')
        .eq('bill_id', bill.id)
        .order('run_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    const { pct: tolerancePct, source: toleranceSource } =
        await resolveTolerance(account, latest?.tolerance_pct != null ? Number(latest.tolerance_pct) : null);

    const billContext: VarianceBillContext = {
        accountId: bill.account_id,
        propertyId: account?.property_id ?? null,
        provider: account?.provider ?? 'Unknown provider',
        siteLabel: account?.site_label ?? 'Unknown site',
        consumerRef: account?.consumer_ref ?? null,
        billingMonth: monthKey(bill.billing_month),
        billDate: bill.bill_date,
        dueDate: bill.due_date,
        totalAmount: bill.total_amount != null ? Number(bill.total_amount) : null,
        billedUnitsUnit: bill.billed_units_unit,
        workflowStatus: bill.workflow_status,
    };

    const meters = account?.property_id
        ? await loadMeterBreakdown(account.property_id, billContext.billingMonth)
        : [];

    // No run yet means validate.ts has never compared this bill. Re-deriving the
    // comparison here would fork the arithmetic; the caller is told to run the engine
    // (POST /api/electricity/validations) instead.
    if (!latest) {
        return {
            billId: bill.id, organizationId: bill.organization_id,
            verdict: 'undetermined', reason: 'not_validated',
            billedUnits: null, loggedUnits: null, varianceUnits: null, variancePct: null,
            tolerancePct, toleranceSource,
            missingDates: [], readingsCounted: null, readingsExcluded: null,
            meters, bill: billContext,
            validationRunAt: null, validationResult: null,
        };
    }

    const billedUnits = latest.billed_units != null ? Number(latest.billed_units) : null;
    const loggedUnits = latest.logged_units != null ? Number(latest.logged_units) : null;
    const variancePct = latest.variance_pct != null ? Number(latest.variance_pct) : null;
    const varianceUnits = billedUnits != null && loggedUnits != null
        ? Math.round((billedUnits - loggedUnits) * 1000) / 1000
        : null;
    const missingDates = (latest.missing_dates as string[] | null) ?? [];

    const { verdict, reason } = judge(
        billedUnits, loggedUnits, variancePct, missingDates, tolerancePct, latest.result ?? null);

    return {
        billId: bill.id, organizationId: bill.organization_id,
        verdict, reason,
        billedUnits, loggedUnits, varianceUnits, variancePct,
        tolerancePct, toleranceSource,
        missingDates,
        readingsCounted: latest.readings_counted != null ? Number(latest.readings_counted) : null,
        readingsExcluded: latest.readings_excluded != null ? Number(latest.readings_excluded) : null,
        meters, bill: billContext,
        validationRunAt: latest.run_at ?? null,
        validationResult: latest.result ?? null,
    };
}

// ---------------------------------------------------------------------------
// Exception ticket
// ---------------------------------------------------------------------------

/**
 * Idempotency marker. tickets carries no bill_id column and adding one is a schema change
 * this module does not own, so the bill is stamped into the description and the same
 * string is what the duplicate check looks for. A uuid contains no LIKE wildcards, so the
 * lookup pattern is safe to build by concatenation.
 */
export function varianceTicketMarker(billId: string): string {
    return `electricity-variance/${billId}`;
}

export async function findVarianceTicket(organizationId: string, billId: string): Promise<{ id: string; created_at: string } | null> {
    const { data, error } = await supabaseAdmin
        .from('tickets')
        .select('id, created_at')
        .eq('organization_id', organizationId)
        .ilike('description', `%${varianceTicketMarker(billId)}%`)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
    if (error || !data) return null;
    return data as { id: string; created_at: string };
}

const inr = (v: number | null): string =>
    v == null ? 'not parsed' : `₹${Math.round(v).toLocaleString('en-IN')}`;

const kwh = (v: number | null): string =>
    v == null ? 'not available' : `${Math.round(v).toLocaleString('en-IN')} kWh`;

const signed = (v: number | null, suffix: string): string =>
    v == null ? 'not available' : `${v > 0 ? '+' : ''}${v.toLocaleString('en-IN')}${suffix}`;

function monthLabel(billingMonth: string): string {
    return new Date(`${billingMonth}T00:00:00Z`)
        .toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Which meter to name. With one meter behind the site the bill IS that meter; with several
 * the ticket names them all with their share, because attributing the whole bill to one of
 * them would be a guess the reader could not check.
 */
function meterLine(v: BillVariance): string {
    if (v.meters.length === 0) return 'not linked — no meter readings for this site in the period';
    const label = (m: VarianceMeter) =>
        `${m.name || 'unnamed meter'}${m.meterNumber ? ` (${m.meterNumber})` : ''}`;
    if (v.meters.length === 1) return label(v.meters[0]);
    return `${v.meters.length} meters at this site — ${v.meters.map(m => `${label(m)} ${kwh(m.units)}`).join(', ')}`;
}

export function buildVarianceTicketBody(v: BillVariance): { title: string; description: string } {
    const site = v.bill.consumerRef ? `${v.bill.siteLabel} (${v.bill.consumerRef})` : v.bill.siteLabel;
    // A zero-logger month has no definable percentage; the title falls back to the unit
    // gap so it still names a number the reader can act on.
    const headline = v.variancePct != null ? signed(v.variancePct, '%') : signed(v.varianceUnits, ' kWh');
    const title = `Electricity variance: ${site} — ${monthLabel(v.bill.billingMonth)} (${headline})`;

    const lines = [
        `Meter: ${meterLine(v)}`,
        `Bill consumption: ${kwh(v.billedUnits)}`,
        `FMS consumption: ${kwh(v.loggedUnits)}`,
        `Variance: ${signed(v.varianceUnits, ' kWh')}`,
        `Variance %: ${signed(v.variancePct, '%')} against a tolerance of ${v.tolerancePct}% (${v.toleranceSource})`,
        `Bill amount: ${inr(v.bill.totalAmount)}`,
        `Due date: ${v.bill.dueDate || 'not parsed'}`,
        '',
        `Provider: ${v.bill.provider}`,
    ];

    if (v.missingDates.length > 0) {
        // Days with no reading can only understate the FMS side, so the real gap is at
        // least the number above. The reader needs to know that before calling the provider.
        lines.push(`Readings missing on ${v.missingDates.length} day(s): ${v.missingDates.slice(0, 10).join(', ')}${v.missingDates.length > 10 ? ' …' : ''} — the FMS figure is understated by that much.`);
    }
    if (v.readingsExcluded) {
        lines.push(`${v.readingsExcluded} reading(s) excluded as anomalies from the FMS figure.`);
    }
    lines.push(`Validated at: ${v.validationRunAt || 'unknown'}`);
    lines.push(`Ref: ${varianceTicketMarker(v.billId)}`);

    return { title, description: lines.join('\n') };
}

export interface RaiseTicketResult {
    ok: boolean;
    ticketId?: string;
    alreadyRaised?: boolean;
    error?: string;
}

/**
 * Raises one ticket for a variance exception, once.
 *
 * The guard is a read of the existing marker before the insert. tickets has no unique
 * constraint to lean on, so two simultaneous POSTs for the same bill could still slip
 * through; every real caller is a single operator clicking once or a serial cron pass,
 * and adding a constraint means a migration this module does not own.
 */
export async function raiseVarianceTicket(v: BillVariance, raisedBy: string): Promise<RaiseTicketResult> {
    if (v.verdict !== 'exception') {
        return { ok: false, error: `Bill is '${v.verdict}' (${v.reason}), not a variance exception` };
    }

    const existing = await findVarianceTicket(v.organizationId, v.billId);
    if (existing) return { ok: true, ticketId: existing.id, alreadyRaised: true };

    const { title, description } = buildVarianceTicketBody(v);

    const { data: ticket, error } = await supabaseAdmin
        .from('tickets')
        .insert({
            organization_id: v.organizationId,
            property_id: v.bill.propertyId,
            raised_by: raisedBy,
            title,
            description,
            category: 'Electricity / Billing',
            priority: 'high',
            status: 'open',
        })
        .select('id')
        .single();

    if (error || !ticket) {
        console.error('[electricity variance] ticket insert:', error?.message);
        return { ok: false, error: error?.message || 'ticket insert failed' };
    }

    await notifyVarianceTicket(v, title, description);
    return { ok: true, ticketId: ticket.id, alreadyRaised: false };
}

/**
 * Same recipients as the chase engine's strike ticket: org super admins plus master
 * admins. Kept best-effort — a failed notification must not undo a raised ticket.
 */
async function notifyVarianceTicket(v: BillVariance, title: string, message: string): Promise<void> {
    const { data: orgAdmins } = await supabaseAdmin
        .from('organization_memberships')
        .select('user_id')
        .eq('organization_id', v.organizationId)
        .eq('role', 'org_super_admin')
        .eq('is_active', true);
    const { data: masterAdmins } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('is_master_admin', true);

    const recipientIds = [...new Set([
        ...(orgAdmins || []).map(r => r.user_id),
        ...(masterAdmins || []).map(r => r.id),
    ])];
    if (recipientIds.length === 0) return;

    const { error } = await supabaseAdmin.from('notifications').insert(
        recipientIds.map(userId => ({
            user_id: userId,
            organization_id: v.organizationId,
            property_id: v.bill.propertyId,
            notification_type: 'ELECTRICITY_BILL_VARIANCE',
            title,
            message,
        })),
    );
    if (error && !isMissingRelation(error)) {
        console.error('[electricity variance] notifications:', error.message);
    }
}
