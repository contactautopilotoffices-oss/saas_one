/**
 * POST /api/accounts/po/[id]/refresh — ask Zoho for this PO's status now and update the FMS.
 * Called when a PO page is opened, so a change made in Zoho a moment ago is already true on screen.
 * Read-only against Zoho. Returns { status, changed }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';
import { refreshOnePoStatus } from '@/backend/lib/accounts/poApprovalWatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;
    const { data: po } = await supabaseAdmin.from('zoho_purchase_orders').select('zoho_po_id').eq('id', id).eq('organization_id', access.organizationId).maybeSingle();
    if (!po) return NextResponse.json({ error: 'PO not found' }, { status: 404 });
    if (!po.zoho_po_id) return NextResponse.json({ status: null, changed: false });
    return NextResponse.json(await refreshOnePoStatus(access.organizationId, po.zoho_po_id), { headers: { 'Cache-Control': 'no-store' } });
}
