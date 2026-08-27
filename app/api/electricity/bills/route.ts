import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAopAccess, isAopAccessError, readOrgId, isMissingRelation } from '@/backend/lib/aop/access';

/**
 * GET /api/electricity/bills
 *
 * "Which electricity bills are about to cost us money by sitting still?"
 *
 * Most boards on this portfolio discount an early payment and penalise a late one. Across
 * the seven months already on file that discount is worth about Rs 1.7 lakh, of which only
 * Rs 16,497 can be proven captured and Rs 48,150 was demonstrably paid after the date. The
 * rest was never tracked closely enough to say. Nobody can watch 15 accounts x 12 months of
 * dates by hand, which is exactly what this widget is for.
 *
 * Reads the electricity_bill_alerts view so the urgency ladder and the money-at-risk maths
 * live in one place and cannot drift between this route, a cron reminder and an email digest.
 */

export const dynamic = 'force-dynamic';

// Most severe first — the UI renders in this order and the tile's own severity is the max.
const URGENCY_ORDER = ['overdue', 'due_soon', 'discount_expiring', 'discount_missed', 'ok', 'settled'] as const;
type Urgency = typeof URGENCY_ORDER[number];

interface AlertRow {
    id: string;
    site_label: string;
    provider: string;
    consumer_ref: string | null;
    property_id: string | null;
    billing_month: string;
    bill_date: string | null;
    due_date: string | null;
    total_amount: number | null;
    early_payment_date: string | null;
    early_payment_amount: number | null;
    after_due_date_amount: number | null;
    payment_status: string;
    payment_date: string | null;
    days_to_early_payment: number | null;
    days_to_due: number | null;
    discount_at_risk: number | null;
    penalty_exposure: number | null;
    urgency: Urgency;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

export async function GET(request: NextRequest) {
    const access = await resolveAopAccess(request, readOrgId(request));
    if (isAopAccessError(access)) return access;

    const { data, error } = await supabaseAdmin
        .from('electricity_bill_alerts')
        .select('*')
        .eq('organization_id', access.organizationId)
        .range(0, 4999);

    if (error) {
        if (isMissingRelation(error)) {
            return NextResponse.json({ provisioned: false, open: [], totals: null });
        }
        console.error('[electricity bills]', error.message);
        return NextResponse.json({ error: 'Could not load electricity bills' }, { status: 500 });
    }

    const rows = (data || []) as AlertRow[];
    const open = rows.filter(r => r.payment_status === 'pending');

    const rank = (u: Urgency) => URGENCY_ORDER.indexOf(u);
    const sorted = [...open].sort((a, b) => {
        const byUrgency = rank(a.urgency) - rank(b.urgency);
        if (byUrgency !== 0) return byUrgency;
        // Within a band, whatever costs most if ignored comes first.
        const aRisk = n(a.discount_at_risk) + n(a.penalty_exposure);
        const bRisk = n(b.discount_at_risk) + n(b.penalty_exposure);
        return bRisk - aRisk;
    });

    const count = (u: Urgency) => open.filter(r => r.urgency === u).length;
    const overdue = count('overdue');
    const dueSoon = count('due_soon');
    const expiring = count('discount_expiring');

    // Historical capture rate, over settled bills only. Three buckets, not two: a bill paid
    // with no date recorded cannot be scored either way, and calling that "missed" would
    // invent a loss. The unverifiable figure is itself worth showing — it is the argument
    // for logging payment dates at all.
    let available = 0, captured = 0, missed = 0, unverifiable = 0;
    for (const r of rows) {
        const gap = n(r.total_amount) - n(r.early_payment_amount);
        if (!r.total_amount || !r.early_payment_amount || gap <= 0) continue;
        available += gap;
        if (r.payment_status !== 'paid') continue;
        if (!r.payment_date || !r.early_payment_date) unverifiable += gap;
        else if (r.payment_date <= r.early_payment_date) captured += gap;
        else missed += gap;
    }

    const severity: 'ok' | 'info' | 'warn' | 'critical' =
        overdue > 0 ? 'critical'
            : (dueSoon > 0 || expiring > 0) ? 'warn'
                : open.length > 0 ? 'info'
                    : 'ok';

    const atRisk = open.reduce((s, r) => s + n(r.discount_at_risk), 0);
    const penalty = open.reduce((s, r) => s + n(r.penalty_exposure), 0);

    const headline =
        overdue > 0
            ? `${overdue} bill${overdue === 1 ? '' : 's'} past the due date.`
            : expiring > 0
                ? `₹${Math.round(atRisk).toLocaleString('en-IN')} of early-payment discount expires within 3 days.`
                : dueSoon > 0
                    ? `${dueSoon} bill${dueSoon === 1 ? '' : 's'} due within 3 days.`
                    : open.length > 0
                        ? `${open.length} bill${open.length === 1 ? '' : 's'} open, nothing urgent.`
                        : 'Every bill is settled.';

    return NextResponse.json({
        provisioned: true,
        severity,
        headline,
        totals: {
            open: open.length,
            overdue,
            due_soon: dueSoon,
            discount_expiring: expiring,
            discount_missed: count('discount_missed'),
            open_value: Math.round(open.reduce((s, r) => s + n(r.total_amount), 0)),
            discount_at_risk: Math.round(atRisk),
            penalty_exposure: Math.round(penalty),
        },
        history: {
            discount_available: Math.round(available),
            discount_captured: Math.round(captured),
            discount_missed: Math.round(missed),
            discount_unverifiable: Math.round(unverifiable),
            capture_rate_pct: available > 0 ? Math.round((captured / available) * 1000) / 10 : null,
        },
        open: sorted.slice(0, 25),
        months: [...new Set(rows.map(r => r.billing_month))].sort().reverse(),
    });
}
