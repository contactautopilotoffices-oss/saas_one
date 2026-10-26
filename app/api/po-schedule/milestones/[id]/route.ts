/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are untrusted JSON, checked field by field below */
/**
 * Click a milestone.
 *   mark_due {note?, override?}  Purchase says this payment is now due. Accounts is told. No payment is
 *                                created. If the work is not recorded as having reached that stage the
 *                                call is refused unless override is true with a written note.
 *   reopen                       take it back to pending
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError, forbidden } from '@/backend/lib/invoices/access';
import { isUuid } from '@/backend/lib/invoices/http';
import { loadPoForSchedule, reachedContext, reachedFor } from '@/backend/lib/accounts/poSchedule';
import { logPoActivity } from '@/backend/lib/accounts/activity';
import { notifyMilestoneDue } from '@/backend/lib/accounts/notify';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => null) as Record<string, any> | null;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const a = await requireInvoiceAccess(request, body);
    if (isInvoiceAccessError(a)) return a;
    if (!a.canGenerateLink && !(body.action === 'reopen' && a.canAlign)) return forbidden('Only Purchase can mark a milestone due.');
    if (!isUuid(id)) return NextResponse.json({ error: 'Milestone not found.' }, { status: 404 });

    const { data: m } = await supabaseAdmin.from('po_payment_milestones').select('*, schedule:po_payment_schedules(status)').eq('id', id).eq('organization_id', a.orgId).maybeSingle();
    if (!m) return NextResponse.json({ error: 'Milestone not found.' }, { status: 404 });
    const loaded = await loadPoForSchedule(a.orgId, m.po_id);
    if (!loaded) return NextResponse.json({ error: 'PO not found.' }, { status: 404 });
    const note = String(body.note ?? '').trim().slice(0, 300);

    if (body.action === 'reopen') {
        const { data: done } = await supabaseAdmin.from('po_payment_milestones').update({ state: 'pending', due_marked_by: null, due_marked_at: null, due_note: null, due_early: false }).eq('id', id).eq('state', 'due').select('id').maybeSingle();
        if (!done) return NextResponse.json({ error: 'That milestone is not marked due.' }, { status: 409 });
        await logPoActivity({ organizationId: a.orgId, poId: m.po_id, action: 'comment', actorId: a.userId, actorRole: a.roles[0], note: `Reopened milestone ${m.seq}: ${m.label}` });
        return NextResponse.json({ state: 'pending' });
    }

    if (body.action !== 'mark_due') return NextResponse.json({ error: 'action must be mark_due or reopen.' }, { status: 400 });
    const schedule = Array.isArray(m.schedule) ? m.schedule[0] : m.schedule;
    if (schedule?.status !== 'confirmed') return NextResponse.json({ error: 'Confirm the payment schedule first.' }, { status: 409 });
    if (m.state === 'due') return NextResponse.json({ error: 'This milestone is already marked due.' }, { status: 409 });

    const ctx = await reachedContext(a.orgId, loaded.po);
    const reached = reachedFor({ trigger: m.trigger, progress_pct: m.progress_pct }, ctx);
    const early = !reached.date;
    if (early && body.override !== true) {
        return NextResponse.json({ error: 'not_reached', message: reached.auto ? 'The work is not recorded as having reached this stage yet. Record it first, or mark it due anyway with a reason.' : 'Nothing in the system can confirm this stage (it is not tracked). Mark it due with a note saying what you checked.' }, { status: 409 });
    }
    if (early && note.length < 5) return NextResponse.json({ error: 'Give a reason (at least 5 characters) for marking it due early.' }, { status: 400 });

    const { data: done } = await supabaseAdmin.from('po_payment_milestones').update({
        state: 'due', due_marked_by: a.userId, due_marked_at: new Date().toISOString(), due_note: note || null, due_early: early,
    }).eq('id', id).eq('state', 'pending').select('id').maybeSingle();
    if (!done) return NextResponse.json({ error: 'This milestone was just changed by someone else.' }, { status: 409 });

    const { data: who } = await supabaseAdmin.from('users').select('full_name').eq('id', a.userId).maybeSingle();
    await logPoActivity({
        organizationId: a.orgId, poId: m.po_id, action: 'comment', actorId: a.userId, actorRole: a.roles[0],
        note: `Milestone ${m.seq} due: ${m.percent}% ${m.label} (${Number(m.amount).toLocaleString('en-IN')})${early ? ' — marked early' : ''}`,
        detail: { milestone_id: id, early, reached_on: reached.date },
    });
    notifyMilestoneDue({
        organization_id: a.orgId, po_number: loaded.po.po_number, vendor_name: loaded.po.vendor_name, label: m.label,
        percent: Number(m.percent), amount: Number(m.amount), marked_by_name: who?.full_name ?? null, note: note || null, early,
    }).catch(() => undefined);
    return NextResponse.json({ state: 'due', early });
}
