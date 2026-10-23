/**
 * OPTIONAL instant path: a Zoho Books workflow rule ("when a Purchase Order is approved" ->
 * Webhook) calls this the moment the founder approves, instead of waiting up to 10 minutes for the
 * scheduled check. It does exactly what the scheduled check does for ONE PO, and is safe alongside
 * it: a PO is claimed before it is sent, and a PO is messaged once, ever.
 *
 * POST ?secret=<ZOHO_WEBHOOK_SECRET>   body: { "purchaseorder_id": "..." }  (or form-encoded)
 * Zoho sends no signature, so the secret in the URL is the credential. Refuses if it is unset.
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { zohoContext } from '@/backend/lib/accounts/poApproval';
import { handleApprovedPo } from '@/backend/lib/accounts/poApprovalWatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(request: NextRequest) {
    const secret = process.env.ZOHO_WEBHOOK_SECRET;
    const given = new URL(request.url).searchParams.get('secret') ?? '';
    if (!secret || !same(given, secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let id = '';
    const type = request.headers.get('content-type') ?? '';
    if (type.includes('json')) id = String(((await request.json().catch(() => ({}))) as { purchaseorder_id?: string }).purchaseorder_id ?? '');
    else { const f = await request.formData().catch(() => null); id = String(f?.get('purchaseorder_id') ?? ''); }
    if (!/^\d{10,25}$/.test(id)) return NextResponse.json({ error: 'purchaseorder_id is required.' }, { status: 400 });

    const { data: orgs } = await supabaseAdmin.from('po_notify_settings').select('organization_id, auto_mode, auto_since').in('auto_mode', ['test', 'live']);
    const results: Record<string, string> = {};
    for (const o of orgs ?? []) {
        const z = await zohoContext(o.organization_id);
        if (!z) { results[o.organization_id] = 'zoho_unavailable'; continue; }
        results[o.organization_id] = await handleApprovedPo(o.organization_id, z, id, o.auto_mode, o.auto_since);
    }
    return NextResponse.json({ ok: true, results });
}
