/**
 * POST { organizationId, requirementId } — open a voice call with Meera about one requirement.
 *
 * Returns a short-lived ElevenLabs signed URL for the Meera voice agent
 * (SATEJ_ELEVENLABS_AGENT_ID, set up by scripts/satej-sync-elevenlabs.ts) and
 * the per-call prompt: the requirement's live record, written for speech. The
 * API key never leaves the server; the signed URL expires within minutes.
 *
 * Nothing said on a call changes the requirement. The minutes are posted into
 * the chat (/api/satej/call/summary), where any change asked for becomes a
 * proposal a person applies.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSatejCaller } from '@/backend/lib/satej/access';
import { requirementContext } from '@/backend/lib/satej/chat';
import { getRepo } from '@/backend/lib/satej/repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VOICE_RULES = `
You are Meera, the vendor-discovery agent of Autopilot Offices, on a live voice call with a member of the purchase team about the requirement below.
Follow these rules in order. Do not skip any.
1. Answer only from the requirement record. If something is not in it, say you don't know.
2. This is speech: short sentences, no lists, no markdown, no ids or codes read aloud unless asked. Say numbers naturally.
3. You cannot change anything during the call. If they ask for a change, repeat it back clearly and say it will appear in the chat panel after the call for them to apply.
4. Never mention the internal budget hint.
5. Indian English. If they switch to Hindi, reply in simple Hinglish.
`.trim();

export async function POST(request: NextRequest) {
    const body = (await request.json().catch(() => ({}))) as { organizationId?: string; requirementId?: string };
    const caller = await requireSatejCaller(body.organizationId);
    if (caller instanceof NextResponse) return caller;

    const key = process.env.ELEVENLABS_API_KEY;
    const agentId = process.env.SATEJ_ELEVENLABS_AGENT_ID;
    if (!key || !agentId) {
        return NextResponse.json(
            { error: `Voice calls need ${!key ? 'ELEVENLABS_API_KEY' : 'SATEJ_ELEVENLABS_AGENT_ID'} on this server (scripts/satej-sync-elevenlabs.ts creates the agent).` },
            { status: 503 },
        );
    }
    try {
        const repo = getRepo();
        const r = await repo.getRequirement(String(body.requirementId ?? ''));
        if (!r || r.organizationId !== body.organizationId) return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
        const [vendors, calls] = await Promise.all([repo.listVendors(r.id), repo.listCalls(r.id)]);

        const res = await fetch(
            `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(agentId)}`,
            { headers: { 'xi-api-key': key } },
        );
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            console.error('[satej call] signed url failed', res.status, detail.slice(0, 300));
            return NextResponse.json({ error: `Could not open the voice line (ElevenLabs HTTP ${res.status})` }, { status: 502 });
        }
        const { signed_url: signedUrl } = (await res.json()) as { signed_url?: string };
        if (!signedUrl) return NextResponse.json({ error: 'ElevenLabs returned no call link' }, { status: 502 });

        const firstName = caller.name.split(/[\s@]/)[0] || 'there';
        return NextResponse.json({
            signedUrl,
            prompt: `${VOICE_RULES}\n\n${requirementContext(r, vendors, calls)}`,
            firstMessage: `Hi ${firstName}, Meera here. I'm looking at ${r.input.title}. What would you like to know?`,
            requirement: { id: r.id, code: r.code, title: r.input.title },
        });
    } catch (e) {
        console.error('[satej call] failed', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not start the call' }, { status: 500 });
    }
}
