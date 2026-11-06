/**
 * GET /api/accounts/po/[id]/lines — what the PO orders: its line items and its terms/notes,
 * as synced from Zoho Books. Read-only, for anyone who can see the Payment Tracker.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;

    const { data: po, error } = await supabaseAdmin.from('zoho_purchase_orders')
        .select('id, detail').eq('id', id).eq('organization_id', access.organizationId).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!po) return NextResponse.json({ error: 'PO not found' }, { status: 404 });

    const { data: lines, error: lineErr } = await supabaseAdmin.from('zoho_po_line_items')
        .select('id, name, description, hsn_or_sac, unit, quantity, rate, tax_percentage, item_total')
        .eq('po_id', id).order('item_order').limit(500);
    if (lineErr) return NextResponse.json({ error: lineErr.message }, { status: 500 });

    const d = (po.detail ?? {}) as { terms?: string | null; notes?: string | null; delivery_date?: string | null; reference_number?: string | null };
    const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
    return NextResponse.json({
        lines: (lines ?? []).map((l) => ({ ...l, quantity: num(l.quantity), rate: num(l.rate), tax_percentage: num(l.tax_percentage), item_total: num(l.item_total) })),
        terms: d.terms?.trim() || null,
        notes: d.notes?.trim() || null,
        delivery_date: d.delivery_date ?? null,
        reference: d.reference_number ?? null,
    }, { headers: { 'Cache-Control': 'no-store' } });
}
