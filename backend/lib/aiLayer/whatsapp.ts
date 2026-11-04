/**
 * WhatsApp channel for the AI Action Layer.
 *
 * Runs in the AiSensy webhook AFTER the Task Manager brain, so task messages keep going where they go today. It takes a
 * message only when ALL of these hold; otherwise it returns { handled: false } and the existing bot answers exactly as
 * before:
 *   1. the platform kill switch is off and the webhook carried the right secret (proves the call came from AiSensy);
 *   2. it is a plain text message (no photo, voice or file);
 *   3. the phone matches exactly ONE approved user (never a master admin);
 *   4. exactly one org has WhatsApp switched on for this person in AI Access settings (people, roles, buildings, grid);
 *   5. the layer has something to offer: a question or action it understood, a refusal it must give, or a draft in
 *      progress. A message it doesn't understand goes back to the old bot.
 * Any error inside returns { handled: false }: this channel can never break the existing WhatsApp flows.
 */
import { timingSafeEqual } from 'node:crypto';
import type { ActorContext } from './types';
import type { AiSettings } from './settings';
import { gate } from './settings';
import { stateSchema, type TurnInput, type TurnOutput } from './pipeline';

export interface WhatsAppInbound { phone: string; text: string; mediaUrl?: string | null; messageId?: string | null }

export interface WhatsAppDeps {
    env: Record<string, string | undefined>;
    findUser(phone: string): Promise<{ id: string; is_master_admin?: boolean | null } | null>;
    /** Org ids where this person holds an active membership. */
    orgsForUser(userId: string): Promise<string[]>;
    loadActor(userId: string, orgId: string): Promise<ActorContext | null>;
    loadSettings(orgId: string): Promise<AiSettings>;
    loadState(orgId: string, userId: string): Promise<unknown | null>;
    saveState(orgId: string, userId: string, state: unknown): Promise<void>;
    runTurn(input: TurnInput, phone: string, userId: string): Promise<TurnOutput>;
    sendReply(phone: string, text: string): Promise<boolean>;
}

export type WhatsAppClaim = { handled: false; why: string } | { handled: true; background: () => Promise<void> };

/** The secret AiSensy sends: `?ai_layer_secret=...` on the webhook URL, or the `x-ai-layer-secret` header. */
export function secretMatches(expected: string | undefined, given: string | null | undefined): boolean {
    const e = String(expected ?? '').trim();
    const g = String(given ?? '').trim();
    if (e.length < 24 || !g) return false;
    const a = Buffer.from(e); const b = Buffer.from(g);
    return a.length === b.length && timingSafeEqual(a, b);
}

export async function claimWhatsApp(deps: WhatsAppDeps, input: WhatsAppInbound | null, givenSecret: string | null): Promise<WhatsAppClaim> {
    try {
        if (deps.env.AI_LAYER_DISABLED === 'true') return { handled: false, why: 'kill_switch' };
        if (!secretMatches(deps.env.AISENSY_AI_LAYER_SECRET, givenSecret)) return { handled: false, why: 'no_secret' };
        if (!input?.phone || !input.text?.trim() || input.mediaUrl) return { handled: false, why: 'not_text' };

        const user = await deps.findUser(input.phone);
        if (!user || user.is_master_admin) return { handled: false, why: 'unknown_sender' };

        // Exactly one org where WhatsApp is on for this person. Two or more: don't guess, leave it to the old bot.
        const candidates: Array<{ orgId: string; actor: ActorContext; settings: AiSettings }> = [];
        for (const orgId of await deps.orgsForUser(user.id)) {
            const actor = await deps.loadActor(user.id, orgId);
            if (!actor) continue;
            const settings = await deps.loadSettings(orgId);
            const g = gate(actor, settings, 'whatsapp', deps.env);
            if (g.ok) candidates.push({ orgId, actor: g.actor, settings });
        }
        if (candidates.length !== 1) return { handled: false, why: candidates.length ? 'several_orgs' : 'not_enabled' };
        const { orgId, actor, settings } = candidates[0];

        const saved = stateSchema.safeParse(await deps.loadState(orgId, user.id) ?? {});
        const state = saved.success ? saved.data : null;
        const out = await deps.runTurn({ actor, settings, channel: 'whatsapp', message: input.text, state }, input.phone, user.id);
        if (out.outcome === 'unsupported') return { handled: false, why: 'unsupported' };

        // WhatsApp shows plain text: building choices are already numbered in it, and the confirmation card already says
        // "Reply Yes / Change / Cancel", so the UI-only options list is not needed.
        const text = out.reply.text;
        return {
            handled: true,
            background: async () => {
                await deps.saveState(orgId, user.id, out.state);
                await deps.sendReply(input.phone, text);
            },
        };
    } catch (err) {
        console.error('[AiLayer] WhatsApp claim failed; the existing bot will answer', err instanceof Error ? err.message : err);
        return { handled: false, why: 'error' };
    }
}
