import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { checkRateLimit } from '@/frontend/utils/rate-limiter';
import { gate, handleTurn, loadActor, stateSchema, t, detectLang } from '@/backend/lib/aiLayer';
import { brainInterpretLlm, loadSettings, supabaseAiData, supabaseAuditStore, supabaseLearning } from '@/backend/lib/aiLayer/server';
import { requireOrgSuperAdmin, requireSession } from '../_lib/auth';
import { trainingSettings } from '@/backend/lib/aiLayer/settings';

export const runtime = 'nodejs';
export const maxDuration = 60;

const body = z.object({
    organizationId: z.string().uuid(),
    message: z.string().trim().min(1).max(1500),
    state: stateSchema.nullish(),
    /** Training chat (Settings → AI Assistant → Training chat): org super admins only. */
    training: z.boolean().optional(),
}).strict();

/**
 * In-app AI chat. The person is the logged-in session (no phone lookup). Everything they may see or do is worked out
 * from their memberships by loadActor(), narrowed by the org's AI Access settings, and re-checked inside each entry.
 */
export async function POST(request: NextRequest) {
    // Global kill switch (platform staff): set AI_LAYER_DISABLED=true to stop the layer for every org at once.
    if (process.env.AI_LAYER_DISABLED === 'true') {
        return NextResponse.json({ reply: { text: 'The AI assistant is paused right now. Please use the app screens.' }, state: {} });
    }
    const session = await requireSession();
    if (session.error) return session.error;

    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const { organizationId, message } = parsed.data;
    const lang = detectLang(message);
    const notEnabled = () => NextResponse.json({ reply: { text: t('not_enabled', lang) }, state: {} });

    try {
        const actor = await loadActor(supabaseAdmin, session.user.id, organizationId);
        if (!actor) return notEnabled();
        const training = parsed.data.training === true;
        if (training) {
            const admin = await requireOrgSuperAdmin(organizationId);
            if (admin.error) return admin.error;
        }
        const saved = (await loadSettings(supabaseAdmin, organizationId)).settings;
        const settings = training ? trainingSettings(saved, actor.roles, actor.userId) : saved;
        const g = gate(actor, settings, 'app_chat');
        if (!g.ok) return notEnabled(); // the person is told only that it's off, not why or what others can do
        const learningStore = supabaseLearning(supabaseAdmin);

        const out = await handleTurn({
            data: supabaseAiData(supabaseAdmin, request.url),
            llm: brainInterpretLlm(),
            audit: supabaseAuditStore(supabaseAdmin),
            learning: { load: orgId => learningStore.load(orgId, training), flag: f => learningStore.flag(f) },
            now: () => new Date(),
            allowMessage: (key, perHour) => checkRateLimit(key, { maxRequests: perHour, windowMs: 3_600_000 }).allowed,
        }, { actor: g.actor, settings, channel: 'app_chat', message, state: parsed.data.state ?? null });
        return NextResponse.json(out, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (err) {
        console.error('[AiLayer] chat failed', err instanceof Error ? err.message : err);
        // Keep the conversation: the person can simply try again.
        return NextResponse.json({ reply: { text: t('failed', lang) }, state: parsed.data.state ?? {} }, { status: 500 });
    }
}
