/**
 * simulate  record a SIMULATED approval and send the approved-PO WhatsApp to the TEST number. Super admins only.
 * resend    send the approved-PO WhatsApp again: to the vendor's own number when the switch is Live,
 *           otherwise to the test number. Purchase and admins (used after a missing phone number is added).
 * POST {org_id, po_id, action: 'simulate' | 'resend'}
 *
 * Zoho is never written to.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireInvoiceAccess, isInvoiceAccessError, forbidden } from '@/backend/lib/invoices/access';
import { isUuid } from '@/backend/lib/invoices/http';
import { recordSimulatedApproval, sendApprovedPoNotice } from '@/backend/lib/accounts/poApproval';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null) as { po_id?: string; action?: string } | null;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const a = await requireInvoiceAccess(request, body);
    if (isInvoiceAccessError(a)) return a;
    if (!isUuid(body.po_id) || !['simulate', 'resend'].includes(String(body.action))) return NextResponse.json({ error: 'po_id and action (simulate or resend) are required.' }, { status: 400 });
    if (body.action === 'simulate' ? !a.canConfigure : !(a.canConfigure || a.canGenerateLink)) return forbidden(body.action === 'simulate' ? 'Only super admins can simulate an approval.' : 'Only Purchase can resend this.');

    let invoiceDue: string | null = null;
    if (body.action === 'simulate') {
        const r = await recordSimulatedApproval(a.orgId, body.po_id, a.userId);
        if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
        invoiceDue = r.invoice_due_at;
    }
    const sent = await sendApprovedPoNotice(a.orgId, body.po_id, a.userId, body.action === 'simulate' ? 'simulation' : 'manual');
    // The approval stands even if the message failed; the failure is recorded and can be resent.
    return NextResponse.json({ simulated: true, invoice_due_at: invoiceDue, whatsapp: sent }, { status: sent.ok ? 200 : 207 });
}
