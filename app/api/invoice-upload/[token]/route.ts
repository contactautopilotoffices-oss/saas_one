/**
 * PUBLIC — vendor upload link, step 0: "is this link good?"
 *
 * No login. The 256-bit token in the URL is the only credential, and it is looked up by
 * its SHA-256. Every way a link can be unusable (unknown, expired, used, revoked) gets
 * the same answer, so the endpoint cannot be used to learn anything about POs or vendors.
 * What a valid link reveals: the company name, the PO number, the limits. Nothing else.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { clientKey, hashToken, looksLikeToken, tooManyRequests } from '@/backend/lib/invoices/links';
import { loadInvoiceSettings } from '@/backend/lib/invoices/settings';
import { ALLOWED_CONTENT_TYPES } from '@/backend/lib/invoices/types';

export const dynamic = 'force-dynamic';

const UNAVAILABLE = () => NextResponse.json({ valid: false, error: 'This link is not available.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    if (tooManyRequests(clientKey(request, 'inv-info'))) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
    const { token } = await params;
    if (!looksLikeToken(token)) return UNAVAILABLE();

    const { data: link } = await supabaseAdmin.from('invoice_intake_links')
        .select('id, organization_id, po_id, status, expires_at, submission_count').eq('token_hash', hashToken(token)).maybeSingle();
    if (!link || link.status !== 'active' || link.submission_count >= 1 || new Date(link.expires_at).getTime() <= Date.now()) return UNAVAILABLE();

    const [{ data: po }, { data: org }, settings] = await Promise.all([
        supabaseAdmin.from('zoho_purchase_orders').select('po_number').eq('id', link.po_id).maybeSingle(),
        supabaseAdmin.from('organizations').select('name').eq('id', link.organization_id).maybeSingle(),
        loadInvoiceSettings(link.organization_id),
    ]);
    if (!po) return UNAVAILABLE();

    return NextResponse.json({
        valid: true,
        organization_name: org?.name ?? null,
        po_reference: po.po_number,
        expires_at: link.expires_at,
        allowed_content_types: ALLOWED_CONTENT_TYPES,
        max_file_bytes: settings.max_file_mb * 1024 * 1024,
    }, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
