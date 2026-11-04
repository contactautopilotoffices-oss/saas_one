/**
 * Real dependencies for the WhatsApp channel (backend/lib/aiLayer/whatsapp.ts). Server only.
 */
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { findWhatsAppUser } from '@/backend/lib/whatsapp/assistant/access';
import { checkRateLimit } from '@/frontend/utils/rate-limiter';
import { loadActor } from './scope';
import { handleTurn } from './pipeline';
import { brainInterpretLlm, loadSettings, supabaseAuditStore, supabaseStateStore, whatsappAiData } from './server';
import { claimWhatsApp, type WhatsAppDeps, type WhatsAppInbound } from './whatsapp';

async function orgsForUser(userId: string): Promise<string[]> {
    const [orgs, props] = await Promise.all([
        supabaseAdmin.from('organization_memberships').select('organization_id').eq('user_id', userId).eq('is_active', true),
        supabaseAdmin.from('property_memberships').select('properties!inner(organization_id)').eq('user_id', userId).eq('is_active', true),
    ]);
    if (orgs.error) throw new Error(orgs.error.message);
    if (props.error) throw new Error(props.error.message);
    const ids = new Set<string>();
    for (const r of (orgs.data || []) as Array<{ organization_id: string | null }>) if (r.organization_id) ids.add(r.organization_id);
    for (const r of (props.data || []) as unknown as Array<{ properties: { organization_id: string } | { organization_id: string }[] | null }>) {
        const p = Array.isArray(r.properties) ? r.properties[0] : r.properties;
        if (p?.organization_id) ids.add(p.organization_id);
    }
    return [...ids];
}

export function liveWhatsAppDeps(): WhatsAppDeps {
    const state = supabaseStateStore(supabaseAdmin);
    return {
        env: process.env,
        findUser: phone => findWhatsAppUser(phone),
        orgsForUser,
        loadActor: (userId, orgId) => loadActor(supabaseAdmin, userId, orgId),
        loadSettings: async orgId => (await loadSettings(supabaseAdmin, orgId)).settings,
        loadState: (orgId, userId) => state.load(orgId, userId, 'whatsapp'),
        saveState: (orgId, userId, s) => state.save(orgId, userId, 'whatsapp', s),
        runTurn: (input, phone, userId) => handleTurn({
            data: whatsappAiData(supabaseAdmin, phone, userId),
            llm: brainInterpretLlm(),
            audit: supabaseAuditStore(supabaseAdmin),
            now: () => new Date(),
            allowMessage: (key, perHour) => checkRateLimit(key, { maxRequests: perHour, windowMs: 3_600_000 }).allowed,
        }, input),
        // The Task Manager's sender: honours its kill switches and "pretend" mode, exactly like the task bot's replies.
        sendReply: async (phone, text) => {
            const { TaskMessagingService } = await import('@/task-manager/TaskMessagingService');
            return TaskMessagingService.sendFreeformReply(phone, text);
        },
    };
}

/** Called by the AiSensy webhook. Never throws; { handled: false } = carry on exactly as before. */
export function claimAiLayerWhatsApp(input: WhatsAppInbound | null, givenSecret: string | null) {
    // Nothing is loaded or queried unless the secret is configured, so orgs without it pay nothing.
    if (!process.env.AISENSY_AI_LAYER_SECRET) return Promise.resolve({ handled: false as const, why: 'no_secret' });
    return claimWhatsApp(liveWhatsAppDeps(), input, givenSecret);
}
