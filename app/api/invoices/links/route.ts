/**
 * Invoice upload links (internal).
 *
 * GET  ?org_id=&po_id=   links for one PO (never the token: it is not stored)
 * POST {org_id, po_id, expires_in_hours?}   issue a link. The raw token is in THIS response
 *      and nowhere else, ever. The vendor is derived from the PO, not from the request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError, forbidden } from '@/backend/lib/invoices/access';
import { newLinkToken, tooManyRequests } from '@/backend/lib/invoices/links';
import { checkPoForInvoicing } from '@/backend/lib/invoices/submission';
import { logInvoiceEvent } from '@/backend/lib/invoices/audit';
import { syncDocumentationState } from '@/backend/lib/invoices/docState';
import { appOrigin, dbError, isUuid } from '@/backend/lib/invoices/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const a = await requireInvoiceAccess(request);
    if (isInvoiceAccessError(a)) return a;
    const poId = new URL(request.url).searchParams.get('po_id');
    if (!isUuid(poId)) return NextResponse.json({ error: 'po_id is required.' }, { status: 400 });
    const { data, error } = await supabaseAdmin.from('invoice_intake_links')
        .select('id, status, expires_at, created_at, used_at, revoked_at, created_by')
        .eq('organization_id', a.orgId).eq('po_id', poId).order('created_at', { ascending: false }).limit(20);
    if (error) return dbError(error);
    // A link past its expiry reads as expired even before anything flips the stored status.
    const now = Date.now();
    return NextResponse.json({ links: (data ?? []).map((l) => ({ ...l, status: l.status === 'active' && new Date(l.expires_at).getTime() <= now ? 'expired' : l.status })) });
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null) as { po_id?: string; expires_in_hours?: number } | null;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const a = await requireInvoiceAccess(request, body);
    if (isInvoiceAccessError(a)) return a;
    if (!a.canGenerateLink) return forbidden('Only Purchase can generate invoice links.');
    if (tooManyRequests(`link:${a.userId}`, 30)) return NextResponse.json({ error: 'Too many links requested. Wait a minute.' }, { status: 429 });
    if (!isUuid(body.po_id)) return NextResponse.json({ error: 'po_id is required.' }, { status: 400 });

    const po = await checkPoForInvoicing(a.orgId, body.po_id);
    if (!po.ok) return NextResponse.json({ error: po.message }, { status: po.status });

    const hours = Math.min(720, Math.max(1, Math.round(Number(body.expires_in_hours) || a.settings.link_expiry_hours)));
    const expiresAt = new Date(Date.now() + hours * 3_600_000).toISOString();
    const { token, hash } = newLinkToken();
    const { data: link, error } = await supabaseAdmin.from('invoice_intake_links').insert({
        organization_id: a.orgId, po_id: po.po.id, token_hash: hash, created_by: a.userId, expires_at: expiresAt,
    }).select('id, status, expires_at').single();
    if (error || !link) return dbError(error ?? { message: 'Could not create the link.' });

    await logInvoiceEvent({ organizationId: a.orgId, linkId: link.id, poId: po.po.id, actorUserId: a.userId, actorRole: a.roles[0], eventType: 'link_created', details: { expires_at: expiresAt, po_number: po.po.po_number } });
    await syncDocumentationState(a.orgId, po.po.id);

    return NextResponse.json({
        link_id: link.id, status: link.status, expires_at: link.expires_at,
        upload_url: `${appOrigin(request)}/q/invoice/${token}`,
        po_number: po.po.po_number, vendor_name: po.po.vendor_name,
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}
