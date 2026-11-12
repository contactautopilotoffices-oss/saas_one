/**
 * GET /api/po-approver/po/[id]?org_id= — what the approver needs to judge one PO: its lines with the
 * vendor's rate on their previous PO beside each, the terms, and the raiser's note. Read-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireApprover, isApproverError } from '@/backend/lib/accounts/poApproverAccess';

export const dynamic = 'force-dynamic';
const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const a = await requireApprover(request);
    if (isApproverError(a)) return a;

    const { data: po } = await supabaseAdmin.from('zoho_purchase_orders').select('id, vendor_id, po_date, detail').eq('id', id).eq('organization_id', a.organizationId).maybeSingle();
    if (!po) return NextResponse.json({ error: 'PO not found' }, { status: 404 });
    const { data: lines } = await supabaseAdmin.from('zoho_po_line_items').select('id, name, description, unit, quantity, rate, tax_percentage, item_total').eq('po_id', id).order('item_order').limit(300);

    // The same vendor's earlier POs: the most recent rate for an item with the same name.
    const last = new Map<string, { rate: number; po_number: string; po_date: string | null }>();
    if (po.vendor_id) {
        const { data: prev } = await supabaseAdmin.from('zoho_purchase_orders').select('id, po_number, po_date').eq('organization_id', a.organizationId).eq('vendor_id', po.vendor_id).neq('id', id).not('status', 'in', '(draft,cancelled,void,rejected,pending_approval)').order('po_date', { ascending: false }).limit(25);
        const ids = (prev ?? []).map((p) => p.id);
        if (ids.length) {
            const { data: pl } = await supabaseAdmin.from('zoho_po_line_items').select('po_id, name, rate').in('po_id', ids).limit(2000);
            const order = new Map((prev ?? []).map((p, i) => [p.id, i]));
            for (const l of [...(pl ?? [])].sort((x, y) => (order.get(x.po_id) ?? 99) - (order.get(y.po_id) ?? 99))) {
                const k = norm(l.name); if (!k || last.has(k) || num(l.rate) == null) continue;
                const p = (prev ?? []).find((x) => x.id === l.po_id);
                last.set(k, { rate: Number(l.rate), po_number: p?.po_number ?? '', po_date: p?.po_date ?? null });
            }
        }
    }
    const d = (po.detail ?? {}) as { terms?: string; notes?: string; note_to_approver?: string };
    return NextResponse.json({
        lines: (lines ?? []).map((l) => {
            const prior = last.get(norm(l.name)) ?? null; const rate = num(l.rate);
            return { id: l.id, name: l.name, description: l.description, unit: l.unit, quantity: num(l.quantity), rate, tax_percentage: num(l.tax_percentage), item_total: num(l.item_total),
                previous: prior, change_pct: prior && rate != null && prior.rate > 0 ? Math.round(((rate - prior.rate) / prior.rate) * 1000) / 10 : null };
        }),
        terms: d.terms?.trim() || null, notes: d.notes?.trim() || null, note_to_approver: d.note_to_approver?.trim() || null,
    }, { headers: { 'Cache-Control': 'no-store' } });
}
