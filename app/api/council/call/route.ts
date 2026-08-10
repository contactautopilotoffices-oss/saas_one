import { NextRequest, NextResponse } from 'next/server';
import { requireMasterAdmin, isCouncilAccessError, resolveCouncilOrgId } from '@/backend/lib/council/guard';
import { gatherDataPack } from '@/backend/lib/council/dataPack';
import { FOUNDING_AGENTS } from '@/backend/lib/council/personas';
import { loadAgents } from '@/backend/lib/council/runner';
import { AGENT_VOICES, DEFAULT_VOICE, buildCallInstructions, sliceDataPackForCall } from '@/backend/lib/council/call';

/**
 * POST /api/council/call { agent_key } — "dial" a council member.
 *
 * Mints an ephemeral OpenAI Realtime client secret whose session carries the
 * member's persona + a live per-lens data slice. The browser then opens the
 * WebRTC leg directly with OpenAI using that short-lived secret — the real
 * API key never leaves the server, and the secret expires in ~2 minutes if
 * the call is never connected.
 *
 * Master-admin only, same guard as the rest of the council playground.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// gpt-realtime-2.1: the newest full-size speech-to-speech model on this key
// (verified via /v1/models). The -mini variants are cheaper and audibly worse;
// a council member's presence is the product, so the flagship is the default.
const REALTIME_MODEL = process.env.COUNCIL_REALTIME_MODEL || 'gpt-realtime-2.1';

export async function POST(request: NextRequest) {
    const access = await requireMasterAdmin();
    if (isCouncilAccessError(access)) return access;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return NextResponse.json(
            { error: 'Voice calls need OPENAI_API_KEY — the realtime line has no mock mode.' },
            { status: 503 },
        );
    }

    let body: { agent_key?: string; org_id?: string } = {};
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const agentKey = String(body.agent_key || '');
    const orgId = await resolveCouncilOrgId(access, request, body);

    // Same roster the rest of the council uses (active members only, DB rows
    // winning over founding personas, failures logged) — so /call can never
    // dial a member that GET /api/council/agents doesn't list.
    const roster = await loadAgents(orgId);
    let agent = roster.find((a) => a.key === agentKey) ?? null;
    if (!agent) {
        return NextResponse.json({ error: `Unknown council member: ${agentKey}` }, { status: 400 });
    }
    if (!agent.persona?.trim()) {
        // A DB-only member whose persona was never filled in: real, but mute.
        const founding = FOUNDING_AGENTS.find((a) => a.key === agentKey);
        if (!founding) {
            return NextResponse.json(
                { error: `Council member "${agentKey}" exists but has no persona configured — a call needs a voice to speak in.` },
                { status: 422 },
            );
        }
        agent = { ...agent, persona: founding.persona };
    }

    // Live data slice — the member walks onto the call already briefed.
    const pack = await gatherDataPack(orgId);
    const dataSlice = sliceDataPackForCall(agentKey, pack);
    const instructions = buildCallInstructions({
        name: agent.name,
        title: agent.title,
        persona: agent.persona,
        dataSlice,
        generatedAt: pack.generated_at,
    });

    const voice = AGENT_VOICES[agentKey] ?? DEFAULT_VOICE;

    const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            session: {
                type: 'realtime',
                model: REALTIME_MODEL,
                instructions,
                audio: {
                    input: {
                        // language pinned: auto-detect mislabels short bursts of
                        // Indian-accented English as Arabic and the captions drift.
                        transcription: { model: 'gpt-4o-transcribe', language: 'en' },
                        // eagerness low: default semantic VAD treats any mic noise
                        // (including speaker echo of the agent's own voice) as an
                        // interruption and chops the reply mid-sentence.
                        turn_detection: { type: 'semantic_vad', eagerness: 'low' },
                    },
                    output: { voice },
                },
            },
        }),
    });

    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.error('[council/call] client_secrets failed:', res.status, detail.slice(0, 500));
        return NextResponse.json(
            { error: 'Could not open the realtime line', status: res.status, details: detail.slice(0, 300) },
            { status: 502 },
        );
    }

    const secret = await res.json();
    return NextResponse.json({
        client_secret: secret.value ?? secret.client_secret?.value,
        expires_at: secret.expires_at ?? secret.client_secret?.expires_at ?? null,
        model: REALTIME_MODEL,
        voice,
        agent: { key: agent.key, name: agent.name, title: agent.title, email: agent.email, color: agent.color },
        context_chars: dataSlice.length,
        data_generated_at: pack.generated_at,
    });
}
