/**
 * MEETINGS — the meeting agent's own endpoint. Not for browsers.
 *
 * The agent runs on LiveKit Cloud, outside Vercel. Rather than giving it the
 * database's service key, it talks to FMS through this one route with a shared
 * secret (MEETING_AGENT_SECRET), and FMS stays the only thing that writes.
 *
 * GET  ?room=<room name>                       the meeting and its agenda
 * POST { room, type: 'joined' }                the agent arrived
 * POST { room, type: 'lines', lines: [...] }   transcript turns
 * POST { room, type: 'item', item_id, status, reason? }
 * POST { room, type: 'decision', item_id, decision, owner_name?, due_text?, note?, said_by? }
 * POST { room, type: 'rule', note, said_by? }
 *
 * Every write is checked against the meeting the room belongs to: an item id
 * from another meeting is refused, not quietly accepted.
 */

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const DECISIONS = new Set(['approve', 'cancel', 'needs_info', 'hold', 'reassign']);
const ITEM_STATES = new Set(['current', 'discussed', 'parked']);
const clip = (v: unknown, n: number) => {
    const s = String(v ?? '').trim();
    return s ? s.slice(0, n) : null;
};

function authorised(request: NextRequest): boolean {
    // Fails CLOSED: no secret configured means nobody gets in.
    const secret = (process.env.MEETING_AGENT_SECRET ?? '').trim();
    if (!secret) return false;
    const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const a = Buffer.from(given);
    const b = Buffer.from(secret);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function meetingFor(room: string | null) {
    if (!room) return null;
    const { data } = await supabaseAdmin
        .from('meetings')
        .select('id, organization_id, title, topic, agent_slug, status, ended_at')
        .eq('room_name', room).maybeSingle();
    return data;
}

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET(request: NextRequest) {
    if (!authorised(request)) return bad('Unauthorized', 401);
    const meeting = await meetingFor(new URL(request.url).searchParams.get('room'));
    if (!meeting) return bad('No meeting for this room', 404);
    // A late join must not bring the agent back into a meeting the host closed.
    if (meeting.status === 'ended') return bad('This meeting has ended', 409);

    const { data: items, error } = await supabaseAdmin
        .from('meeting_agenda_items')
        .select('id, position, label, facts, status')
        .eq('meeting_id', meeting.id)
        .order('position', { ascending: true });
    if (error) return bad(error.message, 500);
    return NextResponse.json({ meeting, items: items ?? [] });
}

export async function POST(request: NextRequest) {
    if (!authorised(request)) return bad('Unauthorized', 401);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return bad('JSON body required');

    const meeting = await meetingFor(clip(body.room, 200));
    if (!meeting) return bad('No meeting for this room', 404);
    const type = String(body.type ?? '');
    const now = new Date().toISOString();

    // The transcript may still be flushing for a couple of minutes after the host
    // ends the meeting; everything else stops the moment it is ended.
    if (meeting.status === 'ended') {
        const endedFor = Date.now() - Date.parse(String(meeting.ended_at ?? ''));
        if (type !== 'lines' || !(endedFor < 120_000)) return bad('This meeting has ended', 409);
    }

    const itemOf = async (id: unknown) => {
        const itemId = clip(id, 64);
        if (!itemId) return null;
        const { data } = await supabaseAdmin.from('meeting_agenda_items')
            .select('id').eq('id', itemId).eq('meeting_id', meeting.id).maybeSingle();
        return data?.id ?? null;
    };

    if (type === 'joined') {
        const { error } = await supabaseAdmin.from('meetings').update({ agent_joined_at: now }).eq('id', meeting.id);
        if (error) return bad(error.message, 500);
        return NextResponse.json({ ok: true });
    }

    if (type === 'lines') {
        const lines = Array.isArray(body.lines) ? body.lines.slice(0, 100) : [];
        const rows = lines
            .map((l: Record<string, unknown>) => ({
                meeting_id: meeting.id,
                organization_id: meeting.organization_id,
                speaker_identity: clip(l.identity, 100) ?? 'unknown',
                speaker_name: clip(l.name, 120),
                is_agent: Boolean(l.is_agent),
                text: clip(l.text, 4000),
                spoken_at: typeof l.at === 'string' && !Number.isNaN(Date.parse(l.at)) ? l.at : now,
            }))
            .filter((r: { text: string | null }) => r.text);
        if (!rows.length) return NextResponse.json({ ok: true, saved: 0 });
        const { error } = await supabaseAdmin.from('meeting_lines').insert(rows);
        if (error) return bad(error.message, 500);
        return NextResponse.json({ ok: true, saved: rows.length });
    }

    if (type === 'item') {
        const itemId = await itemOf(body.item_id);
        if (!itemId) return bad('item_id is not on this meeting\'s agenda');
        const status = String(body.status ?? '');
        if (!ITEM_STATES.has(status)) return bad('status must be current, discussed or parked');
        const { error } = await supabaseAdmin.from('meeting_agenda_items')
            .update({ status, parked_reason: status === 'parked' ? clip(body.reason, 500) : null })
            .eq('id', itemId);
        if (error) return bad(error.message, 500);
        return NextResponse.json({ ok: true });
    }

    if (type === 'decision') {
        const itemId = await itemOf(body.item_id);
        if (!itemId) return bad('item_id is not on this meeting\'s agenda');
        const decision = String(body.decision ?? '');
        if (!DECISIONS.has(decision)) return bad(`decision must be one of: ${[...DECISIONS].join(', ')}`);
        // Insert first, then retire OLDER proposals for the item. If the insert fails the
        // earlier proposal survives; if two arrive together, only the newest stays proposed.
        const { data, error } = await supabaseAdmin.from('meeting_decisions').insert({
            meeting_id: meeting.id,
            organization_id: meeting.organization_id,
            item_id: itemId,
            kind: 'item',
            decision,
            owner_name: clip(body.owner_name, 120),
            due_text: clip(body.due_text, 120),
            note: clip(body.note, 1000),
            said_by: clip(body.said_by, 120),
        }).select('id, created_at').single();
        if (error) return bad(error.message, 500);
        const { error: supErr } = await supabaseAdmin.from('meeting_decisions')
            .update({ state: 'superseded' })
            .eq('meeting_id', meeting.id).eq('item_id', itemId).eq('state', 'proposed')
            .lt('created_at', data.created_at);
        // The new decision IS saved and the page shows the newest per item, so this is
        // reported rather than failed.
        if (supErr) console.error('[meetings/agent] supersede failed', meeting.id, supErr.message);
        return NextResponse.json({ ok: true, id: data.id });
    }

    if (type === 'rule') {
        const note = clip(body.note, 1000);
        if (!note) return bad('note is required');
        const { error } = await supabaseAdmin.from('meeting_decisions').insert({
            meeting_id: meeting.id,
            organization_id: meeting.organization_id,
            kind: 'rule',
            note,
            said_by: clip(body.said_by, 120),
        });
        if (error) return bad(error.message, 500);
        return NextResponse.json({ ok: true });
    }

    return bad('type must be joined, lines, item, decision or rule');
}
