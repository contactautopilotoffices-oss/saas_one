import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Electricity bill validation engine (Phase 2 of docs/ELECTRICITY_AUTOMATION_PLAN.md).
 *
 * For one bill: map account -> property via electricity_billing_accounts.property_id,
 * read the anomaly-filtered electricity_monthly_consumption view for the bill's
 * billing_month, gap-scan electricity_readings.reading_date across the billing period,
 * compute variance vs a tolerance (default 5%, overridable via the system_config key
 * `electricity_variance_tolerance_pct`), insert an electricity_bill_validations row
 * (one row per run, latest wins) and move the bill's workflow_status to 'validated'
 * (pass) or 'chasing' (variance / incomplete data / no meter link).
 */

export interface ValidationRunResult {
    ok: boolean;
    billId: string;
    result?: 'pass' | 'variance' | 'incomplete_data' | 'no_meter_link';
    workflowStatus?: 'validated' | 'chasing';
    variancePct?: number | null;
    missingDates?: string[];
    error?: string;
}

const DEFAULT_TOLERANCE_PCT = 5;

// The meter register reads kWh (backend/db/migrations/electricity_logger.sql), so a
// bill billed in anything else (kVAh, MWh, ...) cannot be compared directly. Plan §9
// item 6: unit mismatch -> 'incomplete_data', never a guessed conversion.
const KWH_EQUIVALENTS = new Set(['kwh', 'units', 'unit']);

function normalizeUnit(unit: string | null | undefined): string | null {
    const u = (unit || '').trim().toLowerCase();
    return u === '' ? null : u;
}

async function readTolerancePct(): Promise<number> {
    const { data } = await supabaseAdmin
        .from('system_config').select('value')
        .eq('key', 'electricity_variance_tolerance_pct').maybeSingle();
    const v = Number(data?.value);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_TOLERANCE_PCT;
}

function daysInMonth(billingMonth: string): string[] {
    const start = new Date(`${billingMonth}T00:00:00Z`);
    const days: string[] = [];
    const cursor = new Date(start);
    while (cursor.getUTCMonth() === start.getUTCMonth()) {
        days.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
}

export async function validateBill(billId: string, method: 'auto' | 'manual' = 'auto'): Promise<ValidationRunResult> {
    const { data: bill, error: billError } = await supabaseAdmin
        .from('electricity_bills')
        .select('id, organization_id, account_id, billing_month, billed_units, billed_units_unit')
        .eq('id', billId).maybeSingle();

    if (billError || !bill) {
        return { ok: false, billId, error: billError?.message || 'bill not found' };
    }

    const { data: account } = await supabaseAdmin
        .from('electricity_billing_accounts')
        .select('property_id')
        .eq('id', bill.account_id).maybeSingle();

    const tolerancePct = await readTolerancePct();

    const finish = async (row: Record<string, unknown>, result: ValidationRunResult['result']): Promise<ValidationRunResult> => {
        const workflowStatus: 'validated' | 'chasing' = result === 'pass' ? 'validated' : 'chasing';
        const { error: insertError } = await supabaseAdmin
            .from('electricity_bill_validations')
            .insert({ ...row, organization_id: bill.organization_id, bill_id: bill.id, method, tolerance_pct: tolerancePct, result });
        if (insertError) return { ok: false, billId, error: insertError.message };

        const { error: updateError } = await supabaseAdmin
            .from('electricity_bills')
            .update({ workflow_status: workflowStatus, updated_at: new Date().toISOString() })
            .eq('id', bill.id);
        if (updateError) return { ok: false, billId, error: updateError.message };

        return {
            ok: true, billId, result, workflowStatus,
            variancePct: (row.variance_pct as number | null) ?? null,
            missingDates: (row.missing_dates as string[]) ?? [],
        };
    };

    // No property link -> there is no meter stream to validate against.
    if (!account?.property_id) {
        return finish({
            billed_units: bill.billed_units ?? null, logged_units: null, variance_pct: null,
            missing_dates: null, readings_counted: null, readings_excluded: null,
        }, 'no_meter_link');
    }

    // Unit mismatch between the bill and the meter register (kWh).
    const billUnit = normalizeUnit(bill.billed_units_unit);
    if (billUnit && !KWH_EQUIVALENTS.has(billUnit)) {
        return finish({
            billed_units: bill.billed_units ?? null, logged_units: null, variance_pct: null,
            missing_dates: null, readings_counted: null, readings_excluded: null,
        }, 'incomplete_data');
    }

    const { data: consumption } = await supabaseAdmin
        .from('electricity_monthly_consumption')
        .select('units, readings_counted, readings_excluded')
        .eq('property_id', account.property_id)
        .eq('period_month', bill.billing_month)
        .maybeSingle();

    // Gap scan: every day of the billing period should have at least one reading.
    const periodDays = daysInMonth(billingMonthOf(bill.billing_month));
    const { data: readingRows } = await supabaseAdmin
        .from('electricity_readings')
        .select('reading_date')
        .eq('property_id', account.property_id)
        .gte('reading_date', periodDays[0])
        .lte('reading_date', periodDays[periodDays.length - 1]);

    const loggedDates = new Set((readingRows || []).map(r => String(r.reading_date).slice(0, 10)));
    const missingDates = periodDays.filter(d => !loggedDates.has(d));

    const billedUnits = bill.billed_units != null ? Number(bill.billed_units) : null;
    const loggedUnits = consumption?.units != null ? Number(consumption.units) : null;

    // Nothing logged for the period at all -> incomplete data, not a variance.
    if (loggedUnits == null || (consumption?.readings_counted ?? 0) === 0 || billedUnits == null) {
        return finish({
            billed_units: billedUnits, logged_units: loggedUnits, variance_pct: null,
            missing_dates: missingDates,
            readings_counted: consumption?.readings_counted ?? 0,
            readings_excluded: consumption?.readings_excluded ?? 0,
        }, 'incomplete_data');
    }

    const variancePct = loggedUnits !== 0
        ? Math.round(((billedUnits - loggedUnits) / loggedUnits) * 100000) / 1000
        : null;

    const result = (variancePct != null && Math.abs(variancePct) <= tolerancePct && missingDates.length === 0)
        ? 'pass'
        : 'variance';

    return finish({
        billed_units: billedUnits, logged_units: loggedUnits, variance_pct: variancePct,
        missing_dates: missingDates,
        readings_counted: consumption?.readings_counted ?? 0,
        readings_excluded: consumption?.readings_excluded ?? 0,
    }, result);
}

// billing_month is stored as the 1st of the month; normalize anything PostgREST hands back.
function billingMonthOf(raw: string): string {
    return String(raw).slice(0, 10);
}

export interface BatchValidationSummary {
    scanned: number;
    validated: number;
    chasing: number;
    failed: number;
    results: ValidationRunResult[];
}

// Nightly pass: every bill still waiting on a validation outcome gets re-checked.
// 'chasing' is included so a bill whose readings were fixed during the day can
// recover to 'validated' without a manual re-run.
export async function validatePendingBills(): Promise<BatchValidationSummary> {
    const { data: bills, error } = await supabaseAdmin
        .from('electricity_bills')
        .select('id')
        .in('workflow_status', ['parsed', 'validating', 'chasing'])
        .range(0, 4999);

    if (error) {
        return { scanned: 0, validated: 0, chasing: 0, failed: 0, results: [{ ok: false, billId: '', error: error.message }] };
    }

    const summary: BatchValidationSummary = { scanned: 0, validated: 0, chasing: 0, failed: 0, results: [] };
    for (const b of bills || []) {
        const r = await validateBill(b.id, 'auto');
        summary.scanned += 1;
        if (!r.ok) summary.failed += 1;
        else if (r.workflowStatus === 'validated') summary.validated += 1;
        else summary.chasing += 1;
        summary.results.push(r);
    }
    return summary;
}
