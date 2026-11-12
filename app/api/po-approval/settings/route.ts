/**
 * Approved-PO WhatsApp settings.
 * GET -> { has_phone, last4, auto_mode, auto_since, last_run_at, last_run_summary, can_edit }   (the full number is never returned)
 * PUT {org_id, test_phone?, auto_mode?}     super admins only
 *   auto_mode: off | test | live. Turning it on from off records auto_since: only POs created after
 *   that, or seen waiting for approval by the 10-minute job, can ever be messaged.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError, forbidden } from '@/backend/lib/invoices/access';
import { dbError } from '@/backend/lib/invoices/http';
import { normalisePhone } from '@/backend/lib/accounts/poApproval';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const a = await requireInvoiceAccess(request);
    if (isInvoiceAccessError(a)) return a;
    const { data, error } = await supabaseAdmin.from('po_notify_settings').select('test_phone, auto_mode, auto_since, last_run_at, last_run_summary').eq('organization_id', a.orgId).maybeSingle();
    if (error) return dbError(error);
    return NextResponse.json({
        has_phone: !!data?.test_phone, last4: data?.test_phone?.slice(-4) ?? null, auto_mode: data?.auto_mode ?? 'off', auto_since: data?.auto_since ?? null,
        last_run_at: data?.last_run_at ?? null, last_run_summary: data?.last_run_summary ?? null, can_edit: a.canConfigure,
    });
}

export async function PUT(request: NextRequest) {
    const body = await request.json().catch(() => null) as { test_phone?: string; auto_mode?: string } | null;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const a = await requireInvoiceAccess(request, body);
    if (isInvoiceAccessError(a)) return a;
    if (!a.canConfigure) return forbidden('Only super admins can change this.');

    const { data: current, error: readErr } = await supabaseAdmin.from('po_notify_settings').select('test_phone, auto_mode').eq('organization_id', a.orgId).maybeSingle();
    if (readErr) return dbError(readErr);

    const patch: Record<string, unknown> = { organization_id: a.orgId, updated_by: a.userId, updated_at: new Date().toISOString() };
    let phone = current?.test_phone ?? null;
    if (body.test_phone !== undefined) {
        const p = normalisePhone(String(body.test_phone));
        if (!p) return NextResponse.json({ error: 'That does not look like a phone number. Use the country code, e.g. 91 98123 45678.' }, { status: 400 });
        patch.test_phone = p; phone = p;
    }
    if (body.auto_mode !== undefined) {
        if (!['off', 'test', 'live'].includes(body.auto_mode)) return NextResponse.json({ error: 'auto_mode must be off, test or live.' }, { status: 400 });
        if (body.auto_mode === 'test' && !phone) return NextResponse.json({ error: 'Set the test phone number before choosing Test.' }, { status: 400 });
        patch.auto_mode = body.auto_mode;
        // Turning it on from off draws the line: nothing created before now is eligible unless it is seen waiting.
        if ((current?.auto_mode ?? 'off') === 'off' && body.auto_mode !== 'off') patch.auto_since = new Date().toISOString();
    }
    const { error } = await supabaseAdmin.from('po_notify_settings').upsert(patch, { onConflict: 'organization_id' });
    if (error) return dbError(error);
    return NextResponse.json({ has_phone: !!phone, last4: phone?.slice(-4) ?? null, auto_mode: (patch.auto_mode as string) ?? current?.auto_mode ?? 'off' });
}
