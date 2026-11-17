import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { checkRateLimit } from '@/frontend/utils/rate-limiter';
import { loadActor } from '@/backend/lib/aiLayer';
import { brainGate, roleClass } from '@/backend/lib/aiLayer/brain/config';
import { brainHandled, runTurn } from '@/backend/lib/aiLayer/brain/loop/turn';
import { liveTurnDeps, loadAliases, loadBrainSettings, recordTurn, supabaseAttachmentStore, supabaseThreadStore } from '@/backend/lib/aiLayer/brain/server';
import { requireSession } from '../../ai-layer/_lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

const body = z.object({ organizationId: z.string().uuid(), message: z.string().trim().min(1).max(1500) }).strict();

const NOT_HANDLED = () => NextResponse.json({ handled: false }, { headers: { 'Cache-Control': 'private, no-store' } });

/**
 * In-app chat on the Unified Brain. The person is the logged-in session (no phone lookup). What they may see or do is
 * worked out from their memberships by loadActor(), narrowed by the org's brain settings, and checked again inside
 * every skill and again when a confirmed action runs.
 *
 * { handled: false } means the brain is not on for this person (or could not answer): the page then uses the AI
 * assistant that exists today, so nobody loses anything while the brain is off or in shadow.
 * The conversation lives on the server (one thread per person per org, shared with WhatsApp); the browser holds nothing.
 */
export async function POST(request: NextRequest) {
    if (process.env.AI_BRAIN_DISABLED === 'true') return NOT_HANDLED();
    const session = await requireSession();
    if (session.error) return session.error;

    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const { organizationId, message } = parsed.data;

    try {
        const { settings, tableMissing } = await loadBrainSettings(supabaseAdmin, organizationId);
        if (tableMissing || settings.mode !== 'live') return NOT_HANDLED(); // shadow has nothing to compare against in the app
        const actor = await loadActor(supabaseAdmin, session.user.id, organizationId);
        if (!actor || !brainGate(actor, settings, 'app_chat').ok) return NOT_HANDLED();

        const threads = supabaseThreadStore(supabaseAdmin);
        const [state, attachments, aliases] = await Promise.all([
            threads.load(organizationId, actor.userId, false),
            supabaseAttachmentStore(supabaseAdmin).listOpen(organizationId, actor.userId),
            loadAliases(supabaseAdmin, organizationId),
        ]);
        const out = await runTurn(
            liveTurnDeps(supabaseAdmin, {
                orgId: organizationId, userId: actor.userId, channel: 'app_chat', requestUrl: request.url,
                episodeDays: settings.memory.episodeDays, keyOrder: settings.keys.order,
                allowMessage: (key, perHour) => checkRateLimit(key, { maxRequests: perHour, windowMs: 3_600_000 }).allowed,
            }),
            { actor, settings, aliases, channel: 'app_chat', text: message, attachments, state },
        );
        // In the app there is nobody to pass a task request to, so that reply ("Tasks are handled by…") is shown.
        const answered = !!out.reply && (brainHandled(out) || out.handoffTo === 'tasks_assistant') && out.outcome !== 'unsupported';
        if (!answered) {
            if (out.outcome !== 'unsupported') await recordTurn(supabaseAdmin, { orgId: organizationId, userId: actor.userId, channel: 'app_chat', shadow: false, messageId: null, userText: message, hadFile: false, out, roleClass: roleClass(actor) });
            return NOT_HANDLED();
        }
        // The turn has run (an action may already be done), so its reply is returned whatever happens next. A thread
        // that could not be saved is logged; the page must never hand the same message to the other assistant now.
        await threads.save(organizationId, actor.userId, false, out.state)
            .catch(err => { console.error('[Brain] thread could not be saved', err instanceof Error ? err.message : err); });
        await recordTurn(supabaseAdmin, { orgId: organizationId, userId: actor.userId, channel: 'app_chat', shadow: false, messageId: null, userText: message, hadFile: false, out, roleClass: roleClass(actor) });
        return NextResponse.json({ handled: true, reply: out.reply }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (err) {
        console.error('[Brain] chat failed; the page falls back to the existing assistant', err instanceof Error ? err.message : err);
        return NOT_HANDLED();
    }
}
