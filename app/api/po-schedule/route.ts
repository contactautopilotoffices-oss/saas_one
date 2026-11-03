/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are untrusted JSON, checked field by field below */
/**
 * A PO's payment schedule.
 *
 * GET ?org_id=&po_id=   the saved schedule, or (when none is saved) the reader's PROPOSAL from
 *                       the PO's terms text. Nothing is written by a GET.
 * PUT {org_id, po_id, milestones[], confirm, source}
 *                       save it as a draft, or confirm it. The percentages must add to 100.
 *
 * A confirmed schedule is Purchase vouching for it. It never creates a payment.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError, forbidden } from '@/backend/lib/invoices/access';
import { dbError, isUuid } from '@/backend/lib/invoices/http';
import { parsePaymentTerms, SCHEDULE_PRESETS } from '@/backend/lib/accounts/paymentSchedule';
import { loadPoForSchedule, reachedContext, reachedFor, validateMilestones } from '@/backend/lib/accounts/poSchedule';
import { logPoActivity } from '@/backend/lib/accounts/activity';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const a = await requireInvoiceAccess(request);
    if (isInvoiceAccessError(a)) return a;
    const poId = new URL(request.url).searchParams.get('po_id');
    if (!isUuid(poId)) return NextResponse.json({ error: 'po_id is required.' }, { status: 400 });

    const loaded = await loadPoForSchedule(a.orgId, poId);
    if (!loaded) return NextResponse.json({ error: 'PO not found.' }, { status: 404 });
    const { po, text, basic } = loaded;

    const { data: schedule, error } = await supabaseAdmin.from('po_payment_schedules').select('*').eq('po_id', poId).eq('organization_id', a.orgId).maybeSingle();
    if (error) return dbError(error);
    const { data: ms } = schedule
        ? await supabaseAdmin.from('po_payment_milestones').select('*').eq('schedule_id', schedule.id).order('seq')
        : { data: null };

    const ctx = await reachedContext(a.orgId, po);
    const withReached = <T extends { trigger: any; progress_pct: number | null }>(rows: T[]) => rows.map((m) => ({ ...m, reached: reachedFor(m, ctx) }));

    const proposal = schedule ? null : parsePaymentTerms(text, { basic, total: po.po_amount });
    return NextResponse.json({
        po,
        basic_value: basic,
        schedule: schedule ? { ...schedule } : null,
        milestones: withReached((ms ?? []).map((m) => ({ ...m, percent: Number(m.percent), amount: Number(m.amount) }))),
        proposal: proposal ? { ...proposal, milestones: withReached(proposal.milestones) } : null,
        presets: SCHEDULE_PRESETS,
        progress: ctx.logRows,
        terms_text: text.slice(0, 4000),
        can_edit: a.canGenerateLink,
    }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: NextRequest) {
    const body = await request.json().catch(() => null) as Record<string, any> | null;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const a = await requireInvoiceAccess(request, body);
    if (isInvoiceAccessError(a)) return a;
    if (!a.canGenerateLink) return forbidden('Only Purchase can set a payment schedule.');
    if (!isUuid(body.po_id)) return NextResponse.json({ error: 'po_id is required.' }, { status: 400 });

    const loaded = await loadPoForSchedule(a.orgId, body.po_id);
    if (!loaded) return NextResponse.json({ error: 'PO not found.' }, { status: 404 });
    const v = validateMilestones(body.milestones);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 422 });

    const { data: existing } = await supabaseAdmin.from('po_payment_schedules').select('id').eq('po_id', body.po_id).eq('organization_id', a.orgId).maybeSingle();
    if (existing) {
        const { count } = await supabaseAdmin.from('po_payment_milestones').select('id', { count: 'exact', head: true }).eq('schedule_id', existing.id).eq('state', 'due');
        if ((count ?? 0) > 0) return NextResponse.json({ error: 'A milestone is already marked due. Reopen it before changing the schedule.' }, { status: 409 });
    }

    const confirm = body.confirm === true;
    const read = parsePaymentTerms(loaded.text, { basic: loaded.basic, total: loaded.po.po_amount });
    const now = new Date().toISOString();
    const head = {
        organization_id: a.orgId, po_id: body.po_id, status: confirm ? 'confirmed' : 'draft', source: body.source === 'manual' ? 'manual' : 'parsed',
        parse_status: read.status, warnings: read.warnings, notes: read.notes, basic_value: loaded.basic, total_value: loaded.po.po_amount,
        confirmed_by: confirm ? a.userId : null, confirmed_at: confirm ? now : null, created_by: a.userId, updated_at: now,
    };
    const { data: sched, error } = await supabaseAdmin.from('po_payment_schedules').upsert(head, { onConflict: 'po_id' }).select('id').single();
    if (error || !sched) return dbError(error ?? { message: 'Could not save the schedule.' });

    await supabaseAdmin.from('po_payment_milestones').delete().eq('schedule_id', sched.id);
    const { error: insErr } = await supabaseAdmin.from('po_payment_milestones').insert(v.rows.map((m, i) => ({
        organization_id: a.orgId, schedule_id: sched.id, po_id: body.po_id, seq: i + 1, ...m,
    })));
    if (insErr) return dbError(insErr);

    await logPoActivity({
        organizationId: a.orgId, poId: body.po_id, action: 'comment', actorId: a.userId, actorRole: a.roles[0],
        note: `${confirm ? 'Confirmed' : 'Saved as draft'} the payment schedule: ${v.rows.map((m) => `${m.percent}% ${m.label}`).join('; ')}`.slice(0, 480),
        detail: { schedule_id: sched.id, source: head.source, milestones: v.rows.length },
    });
    return NextResponse.json({ status: head.status, schedule_id: sched.id });
}
