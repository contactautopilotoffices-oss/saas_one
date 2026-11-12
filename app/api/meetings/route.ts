/**
 * MEETINGS
 *
 * GET  ?org_id=                         the organisation's meetings, newest first
 * POST { org_id, min_days?, limit?, title? }
 *                                       hosts only: build an agenda of POs stuck at
 *                                       "pending approval" and create the meeting
 */

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { meetingViewer, isViewerError } from '@/backend/lib/meetings/access';
import { buildPoApprovalAgenda } from '@/backend/lib/meetings/agenda';
import { setupGaps } from '@/backend/lib/meetings/livekit';

export const dynamic = 'force-dynamic';

const missingTable = (e: { code?: string; message?: string } | null) =>
    Boolean(e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist/i.test(e.message ?? '')));
const MIGRATION = 'Apply supabase/migrations/20261006000003_meetings.sql.';

export async function GET(request: NextRequest) {
    const viewer = await meetingViewer(new URL(request.url).searchParams.get('org_id'));
    if (isViewerError(viewer)) return viewer;

    const { data, error } = await supabaseAdmin
        .from('meetings')
        .select('id, title, topic, agent_slug, status, created_at, started_at, ended_at, host_id, criteria')
        .eq('organization_id', viewer.orgId)
        .order('created_at', { ascending: false })
        .limit(50);
    if (missingTable(error)) return NextResponse.json({ provisioned: false, meetings: [], note: MIGRATION, setup: setupGaps(), can_host: viewer.canHost });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const ids = (data ?? []).map((s) => s.id);
    const counts = new Map<string, number>();
    if (ids.length) {
        // 50 meetings × 30 items passes PostgREST's 1000-row default; ask for all of them.
        const { data: items, error: itemsErr } = await supabaseAdmin.from('meeting_agenda_items')
            .select('meeting_id').in('meeting_id', ids).range(0, 4999);
        if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });
        for (const i of items ?? []) counts.set(i.meeting_id, (counts.get(i.meeting_id) ?? 0) + 1);
    }
    return NextResponse.json({
        provisioned: true,
        can_host: viewer.canHost,
        setup: setupGaps(),
        meetings: (data ?? []).map((s) => ({ ...s, items: counts.get(s.id) ?? 0 })),
    });
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const viewer = await meetingViewer(body?.org_id);
    if (isViewerError(viewer)) return viewer;
    if (!viewer.canHost) return NextResponse.json({ error: 'Only approvers can start a PO review meeting.' }, { status: 403 });

    const num = (v: unknown, fallback: number) => {
        const n = Number(v ?? fallback);
        return Number.isFinite(n) ? Math.round(n) : fallback;
    };
    const minDays = Math.min(365, Math.max(0, num(body?.min_days, 30)));
    const limit = Math.min(30, Math.max(1, num(body?.limit, 15)));

    let agenda;
    try {
        agenda = await buildPoApprovalAgenda(viewer.orgId, { minDays, limit });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
    if (!agenda.length) {
        return NextResponse.json({ error: `No purchase order has been pending approval for more than ${minDays} days.` }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const title = String(body?.title ?? '').trim().slice(0, 120)
        || `PO approvals waiting ${minDays}+ days — ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`;

    const { error } = await supabaseAdmin.from('meetings').insert({
        id,
        organization_id: viewer.orgId,
        title,
        topic: 'po_approvals',
        agent_slug: 'ira',
        criteria: { min_days: minDays, limit, sorted_by: 'value' },
        room_name: `rs-${id}`,
        host_id: viewer.userId,
    });
    if (missingTable(error)) return NextResponse.json({ error: MIGRATION }, { status: 503 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { error: itemsErr } = await supabaseAdmin.from('meeting_agenda_items').insert(agenda.map((a, i) => ({
        meeting_id: id,
        organization_id: viewer.orgId,
        position: i + 1,
        kind: 'po',
        ref_id: a.ref_id,
        label: a.label,
        facts: a.facts,
    })));
    if (itemsErr) {
        // A meeting with no agenda is useless; do not leave one behind.
        const { error: delErr } = await supabaseAdmin.from('meetings').delete().eq('id', id);
        const leftover = delErr ? ` An empty meeting ${id} was left behind (${delErr.message}).` : '';
        return NextResponse.json({ error: itemsErr.message + leftover }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id, items: agenda.length });
}
