/** Milestones Purchase has marked due, across the org: what Accounts needs to raise and align. GET ?org_id= */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError } from '@/backend/lib/invoices/access';
import { dbError } from '@/backend/lib/invoices/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const a = await requireInvoiceAccess(request);
    if (isInvoiceAccessError(a)) return a;
    const { data, error } = await supabaseAdmin.from('po_payment_milestones')
        .select('id, po_id, seq, label, percent, amount, basis, trigger, due_marked_at, due_note, due_early, po:zoho_purchase_orders(po_number, vendor_name, project_name), marker:users!po_payment_milestones_due_marked_by_fkey(full_name)')
        .eq('organization_id', a.orgId).eq('state', 'due').order('due_marked_at', { ascending: false }).limit(200);
    if (error) return dbError(error);
    return NextResponse.json({ items: (data ?? []).map((m) => ({ ...m, percent: Number(m.percent), amount: Number(m.amount) })) }, { headers: { 'Cache-Control': 'no-store' } });
}
