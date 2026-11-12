/**
 * The INSTANT path: a Zoho Books workflow rule (when a Purchase Order is approved, rejected or edited ->
 * Webhook) calls this the moment it happens. It does two things for that ONE PO:
 *   1. copies its live status from Zoho into the FMS, so the screen is right in seconds. This does
 *      not depend on the WhatsApp switch and never messages anyone;
 *   2. where the vendor message is switched on, runs the same check the scheduled job runs (safe
 *      alongside it: a PO is claimed before it is sent, and messaged once, ever).
 * Without this, a change reaches the FMS within about 2 minutes (the scheduled refresh).
 *
 * POST ?secret=<ZOHO_WEBHOOK_SECRET>   body: { "purchaseorder_id": "..." }  (or form-encoded)
 * Zoho sends no signature, so the secret in the URL is the credential. Refuses if it is unset.
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { zohoContext } from '@/backend/lib/accounts/poApproval';
import { handleApprovedPo, refreshOnePoStatus } from '@/backend/lib/accounts/poApprovalWatch';

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

    // 1. Everyone who holds this PO sees its true status now.
    const { data: holders } = await supabaseAdmin.from('zoho_purchase_orders').select('organization_id').eq('zoho_po_id', id);
    const refreshed: Record<string, unknown> = {};
    for (const h of [...new Set((holders ?? []).map((r) => r.organization_id as string))]) refreshed[h] = await refreshOnePoStatus(h, id).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

    // 2. The vendor message, where switched on.
    const { data: orgs } = await supabaseAdmin.from('po_notify_settings').select('organization_id, auto_mode, auto_since').in('auto_mode', ['test', 'live']);
    const results: Record<string, string> = {};
    for (const o of orgs ?? []) {
        const z = await zohoContext(o.organization_id);
        if (!z) { results[o.organization_id] = 'zoho_unavailable'; continue; }
        results[o.organization_id] = await handleApprovedPo(o.organization_id, z, id, o.auto_mode, o.auto_since);
    }
    return NextResponse.json({ ok: true, refreshed, results });
}
