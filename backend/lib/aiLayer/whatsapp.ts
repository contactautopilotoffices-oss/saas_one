/**
 * WhatsApp channel for the AI Action Layer.
 *
 * Runs in the AiSensy webhook AFTER the Task Manager brain, so task messages keep going where they go today. It takes a
 * message only when ALL of these hold; otherwise it returns { handled: false } and the existing bot answers exactly as
 * before:
 *   1. the platform kill switch is off (no webhook secret: owner decision 2026-11-04, see settings.ts);
 *   2. it is a plain text message (no photo, voice or file);
 *   3. the phone matches exactly ONE approved user (never a master admin);
 *   4. exactly one org has WhatsApp switched on for this person in AI Access settings (people, roles, buildings, grid);
 *   5. the layer has something to offer: a question or action it understood, a refusal it must give, or a draft in
 *      progress. A message it doesn't understand goes back to the old bot.
 * Any error inside returns { handled: false }: this channel can never break the existing WhatsApp flows.
 */
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
    /** Optional cached version of resolveWhatsAppPerson (live: 60 s per phone, so every WhatsApp message stays cheap). */
    resolvePerson?(phone: string): Promise<WhatsAppPerson>;
}

/**
 * Short replies that belong to whatever the Task Manager AI or the old bot just asked ("yes", "2", "done 3", "undo").
 * When this layer has no conversation of its own going, these skip it entirely: no AI call, no delay for task replies.
 */
const SHORT_REPLY = /^(y|yes|n|no|ok|okay|haan|han|ha|ji|nahi|nahin|cancel|undo|menu|help|tasks?|my tasks|\d{1,2}|done( all| \d{1,2}([ ,&and]+\d{1,2})*)?)[\s.!]*$/i;

export type WhatsAppClaim = { handled: false; why: string } | { handled: true; background: () => Promise<void> };

export type WhatsAppPerson =
    | { ok: true; userId: string; orgId: string; actor: ActorContext; settings: AiSettings }
    | { ok: false; why: string };

/**
 * Is the AI layer switched on for this phone on WhatsApp? Exactly one approved user (never a master admin) and exactly
 * one org whose AI Access settings let them in. Also used by the Task Manager brain: the same switch turns the task AI
 * on for that person (owner decision 2026-11-04, "one switch").
 */
export async function resolveWhatsAppPerson(deps: Pick<WhatsAppDeps, 'findUser' | 'orgsForUser' | 'loadActor' | 'loadSettings'>, phone: string): Promise<WhatsAppPerson> {
    const user = await deps.findUser(phone);
    if (!user || user.is_master_admin) return { ok: false, why: 'unknown_sender' };
    const candidates: Array<{ orgId: string; actor: ActorContext; settings: AiSettings }> = [];
    for (const orgId of await deps.orgsForUser(user.id)) {
        const actor = await deps.loadActor(user.id, orgId);
        if (!actor) continue;
        const settings = await deps.loadSettings(orgId);
        const g = gate(actor, settings, 'whatsapp');
        if (g.ok) candidates.push({ orgId, actor: g.actor, settings });
    }
    // Two or more orgs: don't guess.
    if (candidates.length !== 1) return { ok: false, why: candidates.length ? 'several_orgs' : 'not_enabled' };
    return { ok: true, userId: user.id, ...candidates[0] };
}

export async function claimWhatsApp(deps: WhatsAppDeps, input: WhatsAppInbound | null): Promise<WhatsAppClaim> {
    try {
        if (deps.env.AI_LAYER_DISABLED === 'true') return { handled: false, why: 'kill_switch' };
        if (!input?.phone || !input.text?.trim() || input.mediaUrl) return { handled: false, why: 'not_text' };

        const person = deps.resolvePerson ? await deps.resolvePerson(input.phone) : await resolveWhatsAppPerson(deps, input.phone);
        if (!person.ok) return { handled: false, why: person.why };
        const { orgId, actor, settings } = person;
        const user = { id: person.userId };

        const saved = stateSchema.safeParse(await deps.loadState(orgId, user.id) ?? {});
        const state = saved.success ? saved.data : null;
        if (!state?.draft && SHORT_REPLY.test(input.text.trim())) return { handled: false, why: 'short_reply' };
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
