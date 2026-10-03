/**
 * POST { organizationId, requirementId, transcript: [{role:'you'|'satej', text}], duration_s }
 *
 * Minutes of a voice call with Satej, posted into the requirement's chat. If
 * the caller asked for a change on the call, it is attached as a PROPOSAL —
 * the same Apply/Dismiss card as a typed request. Summarised from the
 * transcript only; a thin call gives thin minutes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { councilChat } from '@/backend/lib/council/llm';
import { requireSatejCaller } from '@/backend/lib/satej/access';
import { addMessage, allowedActions } from '@/backend/lib/satej/chat';
import { getRepo } from '@/backend/lib/satej/repo';
import type { SatejAction } from '@/backend/lib/satej/types';
import { parseJsonLoose } from '@/backend/lib/satej/util';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const EDIT_KEYS = ['title', 'itemDescription', 'quantity', 'unit', 'scope', 'locationCity', 'locationArea', 'siteName', 'timeline', 'notes', 'vendorTarget'];

export async function POST(request: NextRequest) {
    const body = (await request.json().catch(() => ({}))) as {
        organizationId?: string; requirementId?: string; transcript?: { role?: string; text?: string }[]; duration_s?: number;
    };
    const caller = await requireSatejCaller(body.organizationId);
    if (caller instanceof NextResponse) return caller;

    const lines = (Array.isArray(body.transcript) ? body.transcript : [])
        .filter((l) => (l.role === 'you' || l.role === 'satej') && typeof l.text === 'string' && l.text.trim())
        .slice(-300)
        .map((l) => `${l.role === 'you' ? caller.name.toUpperCase() : 'SATEJ'}: ${String(l.text).trim()}`);
    if (!lines.length) return NextResponse.json({ error: 'Nothing to summarise — the call had no words' }, { status: 400 });

    try {
        const r = await getRepo().getRequirement(String(body.requirementId ?? ''));
        if (!r || r.organizationId !== body.organizationId) return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
        const allowed = allowedActions(r).filter((a) => a === 'edit' || a === 'find_more' || a === 'cancel');
        const mins = Math.max(1, Math.round((Number(body.duration_s) || 0) / 60));

        const raw = await councilChat(
            [
                {
                    role: 'system',
                    content: `You write minutes of a ${mins}-minute voice call between ${caller.name} and Satej about requirement ${r.code}. `
                        + 'Use ONLY what the transcript says. Return ONLY JSON: '
                        + '{ "minutes": string (markdown: 2-6 bullet points of what was discussed and decided), '
                        + `"action": null | { "type": one of ${JSON.stringify(allowed)}, "summary": string, "changes"?: object } }. `
                        + `Propose an action only if the caller clearly asked for that change. "changes" may contain only: ${EDIT_KEYS.join(', ')}.`,
                },
                { role: 'user', content: lines.join('\n') },
            ],
            'procure',
        );
        const parsed = parseJsonLoose(raw) as { minutes?: unknown; action?: Record<string, unknown> | null } | undefined;
        const minutes = String(parsed?.minutes ?? '').trim() || raw.trim().slice(0, 2000);

        let action: SatejAction | null = null;
        const a = parsed?.action;
        if (a && typeof a === 'object' && allowed.includes(String(a.type) as never)) {
            const summary = String(a.summary ?? '').slice(0, 200) || String(a.type);
            if (a.type === 'edit') {
                const src = (a.changes && typeof a.changes === 'object' ? a.changes : {}) as Record<string, unknown>;
                const changes = Object.fromEntries(Object.entries(src).filter(([k, v]) => EDIT_KEYS.includes(k) && v != null).map(([k, v]) => [k, k === 'vendorTarget' ? Number(v) : String(v)]));
                if (Object.keys(changes).length) action = { type: 'edit', summary, changes };
            } else {
                action = { type: a.type as SatejAction['type'], summary };
            }
        }

        const message = await addMessage(r, {
            role: 'satej', kind: 'call_minutes', body: `**Call with ${caller.name} · ~${mins} min**\n${minutes}`, action,
        });
        return NextResponse.json({ message });
    } catch (e) {
        console.error('[satej call summary] failed', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not write the minutes' }, { status: 500 });
    }
}
