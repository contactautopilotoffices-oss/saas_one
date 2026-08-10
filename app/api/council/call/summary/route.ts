import { NextRequest, NextResponse } from 'next/server';
import { requireMasterAdmin, isCouncilAccessError } from '@/backend/lib/council/guard';
import { councilChat } from '@/backend/lib/council/llm';
import { FOUNDING_AGENTS } from '@/backend/lib/council/personas';

/**
 * POST /api/council/call/summary — minutes of a voice call.
 *
 * Takes the live-caption transcript the browser accumulated during the call
 * and turns it into structured minutes: key points, decisions, action items
 * with owners. Summarised from the transcript ONLY — nothing the call didn't
 * actually say can appear here (FP-01 applies to minutes too).
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface TranscriptLine { role: 'you' | 'agent'; text: string }

export async function POST(request: NextRequest) {
    const access = await requireMasterAdmin();
    if (isCouncilAccessError(access)) return access;

    let body: { agent_key?: string; transcript?: TranscriptLine[]; duration_s?: number } = {};
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const transcript = Array.isArray(body.transcript)
        ? body.transcript.filter(
              (l) => l && (l.role === 'you' || l.role === 'agent') && typeof l.text === 'string' && l.text.trim(),
          )
        : [];
    if (!transcript.length) {
        return NextResponse.json({ error: 'Nothing to summarise — the transcript is empty' }, { status: 400 });
    }

    const agent = FOUNDING_AGENTS.find((a) => a.key === body.agent_key);
    const agentName = agent ? `${agent.name} (${agent.title})` : 'a council member';
    const mins = Math.max(1, Math.round((Number(body.duration_s) || 0) / 60));

    const lines = transcript
        .slice(-400) // a hard cap so a marathon call can't blow the prompt
        .map((l) => `${l.role === 'you' ? 'CALLER' : 'AGENT'}: ${l.text.trim()}`)
        .join('\n');

    let summary: string;
    try {
        summary = await councilChat(
        [
            {
                role: 'system',
                content: `You write minutes for a 1:1 voice call between the master admin of Autopilot Offices and ${agentName}, an AI council member. Summarise ONLY what the transcript actually says — no additions, no invented numbers, no inferred commitments. If the transcript is thin, the minutes are thin; that is correct behaviour.

Return markdown in exactly this shape:

# Call minutes — ${agent?.name ?? 'Council member'}
_~${mins} min call_

## Key points
- (3-6 bullets, each one thing that was actually discussed)

## Decisions
- (only decisions explicitly reached; write "None taken on the call." if none)

## Action items
- **Owner — action** (only actions someone explicitly took on; write "None." if none)

## Worth a follow-up
- (open questions or data the agent said was "not in front of me", if any)`,
            },
            { role: 'user', content: `TRANSCRIPT:\n${lines}` },
        ],
        'email',
        );
    } catch (e) {
        console.error('[council/call/summary] minutes failed:', e instanceof Error ? e.message : e);
        return NextResponse.json(
            { error: 'The minutes writer was unreachable — the captions remain the record of the call.' },
            { status: 500 },
        );
    }

    return NextResponse.json({ summary });
}
