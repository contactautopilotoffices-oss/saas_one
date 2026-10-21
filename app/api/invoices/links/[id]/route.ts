/** PATCH {action:'revoke'} — kill a link at once. A used or already-dead link is left as it is. */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError, forbidden } from '@/backend/lib/invoices/access';
import { logInvoiceEvent } from '@/backend/lib/invoices/audit';
import { syncDocumentationState } from '@/backend/lib/invoices/docState';
import { isUuid } from '@/backend/lib/invoices/http';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => null) as { action?: string } | null;
    const a = await requireInvoiceAccess(request, body);
    if (isInvoiceAccessError(a)) return a;
    if (!a.canGenerateLink) return forbidden('Only Purchase can revoke invoice links.');
    if (!isUuid(id) || body?.action !== 'revoke') return NextResponse.json({ error: 'action must be revoke.' }, { status: 400 });

    const { data: link } = await supabaseAdmin.from('invoice_intake_links')
        .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: a.userId })
        .eq('id', id).eq('organization_id', a.orgId).eq('status', 'active').select('id, po_id').maybeSingle();
    if (!link) return NextResponse.json({ error: 'That link is not active.' }, { status: 409 });

    await logInvoiceEvent({ organizationId: a.orgId, linkId: id, poId: link.po_id, actorUserId: a.userId, actorRole: a.roles[0], eventType: 'link_revoked' });
    await syncDocumentationState(a.orgId, link.po_id);
    return NextResponse.json({ status: 'revoked' });
}
