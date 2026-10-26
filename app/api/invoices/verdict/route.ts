/**
 * GET /api/invoices/verdict?org_id=&po_id=
 *
 * What the invoice check says about one PO, for the Align screen to show BEFORE the
 * person fills the form — the same verdict the align route enforces, so the screen and
 * the server can never disagree.
 *
 * Read-only. It changes nothing and blocks nothing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireInvoiceAccess, isInvoiceAccessError } from '@/backend/lib/invoices/access';
import { invoiceVerdictForPo } from '@/backend/lib/invoices/alignGuard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const a = await requireInvoiceAccess(request);
    if (isInvoiceAccessError(a)) return a;

    const poId = new URL(request.url).searchParams.get('po_id');
    if (!poId) return NextResponse.json({ error: 'po_id is required' }, { status: 400 });

    const v = await invoiceVerdictForPo(a.orgId, poId);
    return NextResponse.json({
        state: v.state,
        message: v.message,
        invoice_id: v.invoiceId,
        invoice_number: v.invoiceNumber,
        failed_rules: v.failedRules,
        reasons: v.reasons,
        headline: v.headline,
        next: v.next,
        stage: v.stage,
        reason_required: v.needsReason,
        min_reason_length: 10,
    });
}
