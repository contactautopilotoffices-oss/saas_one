/**
 * ONE MEETING
 *
 * GET   ?after=<line id>      the meeting, agenda, decisions and transcript lines
 *                             after `after` (the room page polls this)
 * PATCH { action: 'end' }                          hosts: close the room for everyone
 * PATCH { action: 'confirm' | 'reject', decision_id }
 *                                                  hosts: settle a proposed decision
 *
 * Confirming a decision records that a person agreed with it. It does NOT
 * approve or cancel anything in Zoho; that stays a human step.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { meetingViewer, isViewerError } from '@/backend/lib/meetings/access';
import { closeRoom, liveKitConfig, setupGaps } from '@/backend/lib/meetings/livekit';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string) {
    if (!UUID_RE.test(id)) return { meeting: null, error: null };
    const { data, error } = await supabaseAdmin
        .from('meetings')
        .select('id, organization_id, title, topic, agent_slug, criteria, status, room_name, host_id, started_at, ended_at, agent_joined_at, created_at')
        .eq('id', id).maybeSingle();
    return { meeting: data, error };
}

/** A database failure is a 500, not "not found". */
function notLoaded(error: { message: string } | null) {
    return error
        ? NextResponse.json({ error: `Could not load the meeting: ${error.message}` }, { status: 500 })
        : NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { meeting, error: loadErr } = await load(id);
    if (!meeting) return notLoaded(loadErr);
    const viewer = await meetingViewer(meeting.organization_id);
    if (isViewerError(viewer)) return viewer;

    const rawAfter = Number(new URL(request.url).searchParams.get('after') ?? 0);
    const after = Number.isSafeInteger(rawAfter) && rawAfter > 0 ? rawAfter : 0;
    const [items, decisions, lines, host] = await Promise.all([
        supabaseAdmin.from('meeting_agenda_items')
            .select('id, position, label, facts, status, parked_reason')
            .eq('meeting_id', id).order('position', { ascending: true }),
        supabaseAdmin.from('meeting_decisions')
            .select('id, item_id, kind, decision, owner_name, due_text, note, said_by, state, reviewed_at, created_at')
            .eq('meeting_id', id).order('created_at', { ascending: true }),
        supabaseAdmin.from('meeting_lines')
            .select('id, speaker_name, is_agent, text, spoken_at')
            .eq('meeting_id', id).gt('id', after).order('id', { ascending: true }).limit(300),
        supabaseAdmin.from('users').select('full_name').eq('id', meeting.host_id).maybeSingle(),
    ]);
    const failed = [items, decisions, lines].find((r) => r.error);
    if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });

    return NextResponse.json({
        meeting: { ...meeting, room_name: undefined, host_name: host.data?.full_name ?? null },
        items: items.data ?? [],
        decisions: decisions.data ?? [],
        lines: lines.data ?? [],
        viewer: { can_host: viewer.canHost, name: viewer.name },
        livekit_ready: Boolean(liveKitConfig()),
        setup: setupGaps(),
    });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { meeting, error: loadErr } = await load(id);
    if (!meeting) return notLoaded(loadErr);
    const viewer = await meetingViewer(meeting.organization_id);
    if (isViewerError(viewer)) return viewer;
    if (!viewer.canHost) return NextResponse.json({ error: 'Only approvers can do this.' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const action = String(body?.action ?? '');

    if (action === 'end') {
        if (meeting.status === 'ended') return NextResponse.json({ ok: true });
        try {
            await closeRoom(meeting.room_name);
        } catch (e) {
            return NextResponse.json({ error: `Could not close the room: ${e instanceof Error ? e.message : e}` }, { status: 502 });
        }
        const { error } = await supabaseAdmin.from('meetings')
            .update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
    }

    if (action === 'confirm' || action === 'reject') {
        const decisionId = String(body?.decision_id ?? '');
        if (!UUID_RE.test(decisionId)) return NextResponse.json({ error: 'decision_id required' }, { status: 400 });
        const { data, error } = await supabaseAdmin.from('meeting_decisions')
            .update({
                state: action === 'confirm' ? 'confirmed' : 'rejected',
                reviewed_by: viewer.userId,
                reviewed_at: new Date().toISOString(),
            })
            .eq('id', decisionId).eq('meeting_id', id).eq('state', 'proposed')
            .select('id');
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!data?.length) return NextResponse.json({ error: 'That decision is not waiting for review.' }, { status: 409 });
        return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'action must be end, confirm or reject' }, { status: 400 });
}
