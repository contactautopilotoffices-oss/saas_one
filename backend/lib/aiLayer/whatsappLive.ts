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

/**
 * Is WhatsApp switched on for ANY org? Checked once a minute (cached), so until an org super admin turns WhatsApp on,
 * the webhook does no lookups at all for the AI layer and every message goes straight on to the existing bot.
 */
let anyOn: { value: boolean; at: number } | null = null;
async function anyOrgHasWhatsApp(): Promise<boolean> {
    if (anyOn && Date.now() - anyOn.at < 60_000) return anyOn.value;
    const { data, error } = await supabaseAdmin.from('ai_access_settings').select('organization_id')
        .eq('config->>enabled', 'true').eq('config->channels->>whatsapp', 'true').limit(1);
    const value = !error && (data || []).length > 0; // a missing table means "off"
    anyOn = { value, at: Date.now() };
    return value;
}

/** Called by the AiSensy webhook. Never throws; { handled: false } = carry on exactly as before. */
export async function claimAiLayerWhatsApp(input: WhatsAppInbound | null) {
    try {
        if (process.env.AI_LAYER_DISABLED === 'true' || !(await anyOrgHasWhatsApp())) return { handled: false as const, why: 'off' };
    } catch {
        return { handled: false as const, why: 'error' };
    }
    return claimWhatsApp(liveWhatsAppDeps(), input);
}
