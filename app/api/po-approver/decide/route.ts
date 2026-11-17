/** POST /api/po-approver/decide { org_id, po_id, decision: approve|reject|question, reason? } — org super admin only. */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireApprover, isApproverError } from '@/backend/lib/accounts/poApproverAccess';
import { decidePo } from '@/backend/lib/accounts/poApprover';
import { isUuid } from '@/backend/lib/invoices/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null) as { org_id?: string; po_id?: string; decision?: string; reason?: string } | null;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const a = await requireApprover(request, body);
    if (isApproverError(a)) return a;
    if (!isUuid(body.po_id)) return NextResponse.json({ error: 'po_id is required.' }, { status: 400 });
    if (!['approve', 'reject', 'question'].includes(String(body.decision))) return NextResponse.json({ error: 'decision must be approve, reject or question.' }, { status: 400 });
    const { data: me } = await supabaseAdmin.from('users').select('full_name').eq('id', a.user.id).maybeSingle();
    const r = await decidePo({ orgId: a.organizationId, poId: body.po_id!, userId: a.user.id, userName: me?.full_name ?? a.user.email ?? null, decision: body.decision as 'approve' | 'reject' | 'question', reason: body.reason });
    return NextResponse.json(r, { status: r.ok ? 200 : r.status ?? 400 });
}
