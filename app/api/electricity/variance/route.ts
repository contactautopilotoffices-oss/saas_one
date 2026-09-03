import { NextRequest, NextResponse } from 'next/server';
import {
    resolveElectricityAccess, isElectricityAccessError, readOrgId, isMissingRelation,
} from '@/backend/lib/electricity/access';
import {
    computeBillVariance, computePeriodVariance, findVarianceTicket, raiseVarianceTicket,
} from '@/backend/lib/electricity/variance';
import { recordBillEvent, actorLabelFor } from '@/backend/lib/electricity/audit';

/**
 * /api/electricity/variance — billed-vs-logger variance, and the ticket it earns.
 *
 * GET  ?billId=<uuid>  or  ?month=YYYY-MM
 *      Read-only. Returns the variance numbers off the latest stored validation run,
 *      re-judged against the meter/site tolerance. It writes nothing: no validation row,
 *      no workflow_status change, no ticket. A bill that has never been validated comes
 *      back verdict 'undetermined' / reason 'not_validated' — POST
 *      /api/electricity/validations runs the engine.
 *
 * POST { billId }
 *      Raises the exception ticket. Refuses anything that is not verdict 'exception', and
 *      returns the existing ticket instead of a second one when the bill has already been
 *      ticketed.
 *
 * Both verbs are open to the full ELECTRICITY_ROLES audience rather than checkers only:
 * raising a variance ticket is the day-to-day chase work procurement already does, not the
 * checker sign-off that moves a bill to 'verified'.
 */

export const dynamic = 'force-dynamic';

const MONTH_PATTERN = /^\d{4}-\d{2}(-\d{2})?$/;

export async function GET(request: NextRequest) {
    const access = await resolveElectricityAccess(request, readOrgId(request));
    if (isElectricityAccessError(access)) return access;

    const billId = request.nextUrl.searchParams.get('billId');
    const month = request.nextUrl.searchParams.get('month');

    if (!billId && !month) {
        return NextResponse.json({ error: 'billId or month (YYYY-MM) is required' }, { status: 400 });
    }
    if (month && !MONTH_PATTERN.test(month)) {
        return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
    }

    try {
        if (billId) {
            const variance = await computeBillVariance(billId, access.organizationId);
            if (!variance) {
                return NextResponse.json({ error: 'Bill not found in this organization' }, { status: 404 });
            }
            const ticket = await findVarianceTicket(access.organizationId, billId);
            return NextResponse.json({ provisioned: true, variance, ticket });
        }

        const variances = await computePeriodVariance(access.organizationId, month as string);
        return NextResponse.json({
            provisioned: true,
            month,
            variances,
            exceptions: variances.filter(v => v.verdict === 'exception').length,
        });
    } catch (e) {
        const err = e as { code?: string; message?: string };
        if (isMissingRelation(err)) {
            return NextResponse.json({ provisioned: false, variances: [] });
        }
        console.error('[electricity variance]', err.message);
        return NextResponse.json({ error: 'Could not compute variance' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const access = await resolveElectricityAccess(request, readOrgId(request));
    if (isElectricityAccessError(access)) return access;

    let body: { billId?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body.billId) {
        return NextResponse.json({ error: 'billId is required' }, { status: 400 });
    }

    // computeBillVariance is org-scoped, so a bill outside the caller's org resolves to
    // null here and never reaches the ticket insert.
    const variance = await computeBillVariance(body.billId, access.organizationId);
    if (!variance) {
        return NextResponse.json({ error: 'Bill not found in this organization' }, { status: 404 });
    }

    if (variance.verdict !== 'exception') {
        return NextResponse.json({
            error: variance.reason === 'not_validated'
                ? 'This bill has not been validated yet — run the validation engine first'
                : `Nothing to raise: the bill is '${variance.verdict}' (${variance.reason})`,
            variance,
        }, { status: 409 });
    }

    const result = await raiseVarianceTicket(variance, access.user.id);
    if (!result.ok) {
        console.error('[electricity variance] raise failed:', result.error);
        return NextResponse.json({ error: 'Could not raise the variance ticket' }, { status: 500 });
    }

    // Only the first raise goes on the bill's trail — a repeat POST is a no-op and should
    // not leave a trail entry suggesting a second ticket exists.
    if (!result.alreadyRaised) {
        await recordBillEvent({
            organizationId: variance.organizationId,
            billId: variance.billId,
            eventType: 'note',
            actorId: access.user.id,
            actorLabel: actorLabelFor(access),
            note: `Variance ticket raised (${variance.variancePct}% vs ${variance.tolerancePct}% tolerance)`,
            metadata: {
                kind: 'variance_exception_ticket',
                ticket_id: result.ticketId,
                billed_units: variance.billedUnits,
                logged_units: variance.loggedUnits,
                variance_units: variance.varianceUnits,
                variance_pct: variance.variancePct,
                tolerance_pct: variance.tolerancePct,
                tolerance_source: variance.toleranceSource,
            },
        });
    }

    return NextResponse.json({
        ok: true,
        ticketId: result.ticketId,
        alreadyRaised: result.alreadyRaised ?? false,
        variance,
    });
}
