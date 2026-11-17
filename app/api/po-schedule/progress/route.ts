/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are untrusted JSON, checked field by field below */
/**
 * Record what has happened on site: "25% done on 12 Oct", or "material delivered".
 * POST {org_id, po_id, kind: 'progress'|'delivery', progress_pct?, recorded_on, note?}
 * Append-only. A correction is a new entry; the log is the evidence behind each milestone.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError, forbidden } from '@/backend/lib/invoices/access';
import { isUuid } from '@/backend/lib/invoices/http';
import { logPoActivity } from '@/backend/lib/accounts/activity';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null) as Record<string, any> | null;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const a = await requireInvoiceAccess(request, body);
    if (isInvoiceAccessError(a)) return a;
    if (!a.canGenerateLink) return forbidden('Only Purchase can record progress.');
    if (!isUuid(body.po_id)) return NextResponse.json({ error: 'po_id is required.' }, { status: 400 });

    const kind = body.kind === 'delivery' ? 'delivery' : 'progress';
    const pct = kind === 'progress' ? Math.round(Number(body.progress_pct)) : null;
    if (kind === 'progress' && (!Number.isFinite(pct) || pct! < 0 || pct! > 100)) return NextResponse.json({ error: 'Progress must be between 0 and 100.' }, { status: 400 });
    const on = String(body.recorded_on ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || Number.isNaN(Date.parse(on))) return NextResponse.json({ error: 'Give the date as YYYY-MM-DD.' }, { status: 400 });
    if (on > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) return NextResponse.json({ error: 'The date cannot be in the future.' }, { status: 400 });

    const { data: po } = await supabaseAdmin.from('zoho_purchase_orders').select('id, po_number').eq('id', body.po_id).eq('organization_id', a.orgId).maybeSingle();
    if (!po) return NextResponse.json({ error: 'PO not found.' }, { status: 404 });

    const { error } = await supabaseAdmin.from('po_progress_log').insert({
        organization_id: a.orgId, po_id: body.po_id, kind, progress_pct: pct, recorded_on: on,
        note: String(body.note ?? '').trim().slice(0, 300) || null, recorded_by: a.userId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logPoActivity({
        organizationId: a.orgId, poId: body.po_id, action: 'comment', actorId: a.userId, actorRole: a.roles[0],
        note: kind === 'delivery' ? `Material delivered on ${on}` : `Work ${pct}% complete on ${on}`, detail: { kind, progress_pct: pct, recorded_on: on },
    });
    return NextResponse.json({ ok: true }, { status: 201 });
}
