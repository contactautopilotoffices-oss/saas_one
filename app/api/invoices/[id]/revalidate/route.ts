/** Re-run the matching rules against the CURRENT PO data and working values. POST { org_id } */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError, forbidden } from '@/backend/lib/invoices/access';
import { runMatching } from '@/backend/lib/invoices/process';
import { isUuid } from '@/backend/lib/invoices/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const a = await requireInvoiceAccess(request, body);
    if (isInvoiceAccessError(a)) return a;
    if (!a.canResolveSoft) return forbidden();
    if (!isUuid(id)) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });

    const { data: inv } = await supabaseAdmin.from('invoices').select('id, review_status, extraction_status').eq('id', id).eq('organization_id', a.orgId).maybeSingle();
    if (!inv) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
    // An accepted invoice is a closed decision; changing PO data underneath it must not silently reopen it.
    if (['accepted', 'rejected'].includes(inv.review_status)) return NextResponse.json({ error: `This invoice is already ${inv.review_status}.` }, { status: 409 });
    if (['pending', 'processing'].includes(inv.extraction_status)) return NextResponse.json({ error: 'The invoice is still being read.' }, { status: 409 });

    const r = await runMatching(id, a.userId);
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 422 });
    return NextResponse.json({ match_status: r.matchStatus, rules: r.rules });
}
