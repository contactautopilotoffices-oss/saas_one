/**
 * GET /api/accounts/po/[id]/pdf — the PO as Zoho Books prints it, for anyone who can see the tracker.
 * Fetched from Zoho on demand (read-only) and streamed back as a download. Nothing is stored.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';
import { zohoContext, zohoGet } from '@/backend/lib/accounts/poApproval';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** A browser tab opened from the PO PDF button gets a readable page, not raw JSON. */
function failure(request: NextRequest, message: string, status: number) {
    if (!(request.headers.get('accept') ?? '').includes('text/html')) return NextResponse.json({ error: message }, { status });
    const safe = message.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    return new NextResponse(`<!doctype html><meta charset="utf-8"><title>PO PDF</title><body style="font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 16px;color:#334155"><h2 style="font-size:18px">The PO PDF could not be opened</h2><p>${safe}</p><p style="color:#94a3b8;font-size:13px">You can close this tab.</p></body>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;

    const { data: po } = await supabaseAdmin.from('zoho_purchase_orders').select('id, po_number, zoho_po_id').eq('id', id).eq('organization_id', access.organizationId).maybeSingle();
    if (!po) return failure(request, 'This PO was not found.', 404);
    if (!po.zoho_po_id) return failure(request, 'This PO was added by hand, so there is no Zoho copy to download.', 404);

    const z = await zohoContext(access.organizationId);
    if (!z) return failure(request, 'Zoho Books is not reachable right now. Try again in a minute.', 503);
    const res = await zohoGet(z, `purchaseorders/${encodeURIComponent(po.zoho_po_id)}`, { accept: 'pdf' });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || buf.subarray(0, 5).toString('latin1') !== '%PDF-') return failure(request, `Zoho did not return a PDF (HTTP ${res.status}). Try again in a minute.`, 502);

    const name = `${po.po_number.replace(/[^\w.-]+/g, '-')}.pdf`;
    return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'private, max-age=300' } });
}
