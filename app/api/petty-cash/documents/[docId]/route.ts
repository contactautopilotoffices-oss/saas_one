import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { pcRequest, pcError, isUuid } from '@/backend/lib/pettyCash/api';
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
    const body = await request.json().catch(() => null);
    const access = await resolvePettyCashAccess(request, readOrgId(request, body));
    if (isPettyCashAccessError(access)) return access;
    const { docId } = await params;
    if (!isUuid(docId) || !body) return NextResponse.json({ error: 'Invalid bill' }, { status: 400 });
    const { data: doc } = await supabaseAdmin.from('petty_cash_documents').select('request_id').eq('id', docId).eq('organization_id', access.organizationId).maybeSingle();
    if (!doc || !await pcRequest(access, doc.request_id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { data, error } = await supabaseAdmin.rpc('pc_review_bill', { actor: access.user.id, did: docId, result: body.review_status, remark: body.remark || body.review_remarks || '' });
    return error ? pcError(error) : NextResponse.json({ document: data });
}
