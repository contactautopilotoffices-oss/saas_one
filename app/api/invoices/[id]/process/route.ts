/**
 * Read the invoice (again) and re-match. For a read that failed, or to retry after a
 * provider outage. Refuses to overwrite a person's corrections unless told to.
 * POST { org_id, discard_corrections?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError, forbidden } from '@/backend/lib/invoices/access';
import { processInvoice } from '@/backend/lib/invoices/process';
import { logInvoiceEvent } from '@/backend/lib/invoices/audit';
import { isUuid } from '@/backend/lib/invoices/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as { discard_corrections?: boolean };
    const a = await requireInvoiceAccess(request, body);
    if (isInvoiceAccessError(a)) return a;
    if (!a.canResolveSoft) return forbidden();
    if (!isUuid(id)) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });

    const { data: inv } = await supabaseAdmin.from('invoices').select('id, po_id, review_status, corrected_at').eq('id', id).eq('organization_id', a.orgId).maybeSingle();
    if (!inv) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
    if (['accepted', 'rejected'].includes(inv.review_status)) return NextResponse.json({ error: `This invoice is already ${inv.review_status}.` }, { status: 409 });
    if (inv.corrected_at) {
        if (body.discard_corrections !== true) return NextResponse.json({ error: 'A person has corrected this invoice. Reading it again would overwrite those corrections.', needs_confirmation: true }, { status: 409 });
        await supabaseAdmin.from('invoices').update({ corrected_at: null, corrected_by: null }).eq('id', id);
        await logInvoiceEvent({ organizationId: a.orgId, invoiceId: id, poId: inv.po_id, actorUserId: a.userId, actorRole: a.roles[0], eventType: 'corrections_discarded' });
    }

    const r = await processInvoice(id, a.userId);
    if (!r.ok) return NextResponse.json({ error: r.error, status: 'failed' }, { status: 422 });
    return NextResponse.json({ status: r.status });
}
