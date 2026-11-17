/**
 * "Check this person": every condition the WhatsApp AI needs for one person, in the order the webhook checks them, each
 * with a plain-language explanation. Read-only. Uses the SAVED settings (unsaved changes on the page are not included).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActorContext } from './types';
import type { AiSettings } from './settings';
import { gate } from './settings';
import { catalogFor } from './catalog';
import { canonicalPhone } from '@/backend/lib/whatsapp/assistant/protocol.mjs';

export interface CheckLine { ok: boolean; label: string; detail: string }

export interface CheckInputs {
    tableMissing: boolean;
    settings: AiSettings;
    userId: string;
    name: string;
    phone: string | null;
    isMasterAdmin: boolean;
    /** Who the AI's exact phone lookup finds for this person's number (null = nobody, or more than one account). */
    phoneOwnerId: string | null;
    actor: ActorContext | null;
    /** Orgs where WhatsApp is on for this person (the AI refuses to guess between two). */
    whatsappOrgCount: number;
}

/** Pure: turn the facts into ✓ / ✗ lines. Stops explaining at nothing: every line is shown so all problems are visible. */
export function checkLines(i: CheckInputs): CheckLine[] {
    const s = i.settings;
    const lines: CheckLine[] = [];
    const add = (ok: boolean, label: string, detail: string) => lines.push({ ok, label, detail });

    add(!i.tableMissing, 'Database set up', i.tableMissing
        ? 'The AI tables are missing. Run the migration 20261104000002_ai_action_layer.sql.'
        : 'The AI tables exist.');
    add(s.enabled, 'AI assistant switched on', s.enabled
        ? 'The organization switch is on.'
        : 'The box "AI assistant for this organization" is not ticked (or not saved).');
    add(s.channels.whatsapp, 'WhatsApp ticked', s.channels.whatsapp
        ? 'WhatsApp is on for this organization.'
        : 'The box "WhatsApp" is not ticked (or not saved).');

    const blocked = s.blockedUserIds.includes(i.userId);
    add(!blocked, 'Not blocked', blocked ? `${i.name} is in the blocked list.` : `${i.name} is not blocked.`);

    add(!i.isMasterAdmin, 'Not a master admin', i.isMasterAdmin
        ? 'Master admin accounts are never answered on WhatsApp by the AI (they reach every organization).'
        : 'Normal account.');

    const phoneOk = !!i.phone && i.phoneOwnerId === i.userId;
    add(phoneOk, 'Phone number recognised', !i.phone
        ? `${i.name} has no phone number on their profile.`
        : i.phoneOwnerId === i.userId
            ? `+${canonicalPhone(i.phone)} belongs only to ${i.name}.`
            : i.phoneOwnerId
                ? `+${canonicalPhone(i.phone)} is matched to a different account. Each number must be on one account only.`
                : `+${canonicalPhone(i.phone)} is not recognised: it is on more than one account, or the account is not approved.`);

    add(!!i.actor, 'Active membership', i.actor
        ? `Roles in this organization: ${i.actor.roles.join(', ')}.`
        : `${i.name} has no active, approved membership in this organization.`);

    if (i.actor) {
        const g = gate(i.actor, { ...s, channels: { ...s.channels, whatsapp: true }, enabled: true }, 'whatsapp');
        const selected = !g.ok && g.reason === 'not_selected' ? false : true;
        add(selected, 'Selected in "Who can use it"', selected
            ? `${i.name} is allowed by the "Who can use it" setting.`
            : `${i.name} is not allowed by "Who can use it" (mode: ${s.access.mode.replace(/_/g, ' ')}).`);
        const buildingsOk = g.ok || g.reason !== 'no_properties';
        add(buildingsOk, 'Has a building', buildingsOk
            ? `Buildings in scope: ${(g.ok ? g.actor : i.actor).propertyIds.length}.`
            : 'None of their buildings is in the selected buildings.');
        const entries = g.ok ? catalogFor(g.actor, s) : [];
        add(entries.length > 0, 'Something switched on for their role', entries.length
            ? `Can use: ${entries.map(e => `${e.entry.abilities.en}${e.mode === 'shadow' ? ' (test mode)' : ''}`).join(', ')}.`
            : `None of ${i.name}'s roles (${i.actor.roles.join(', ')}) has anything switched on in "What each role can use". Set one of these rows.`);
    }

    add(i.whatsappOrgCount <= 1, 'Only one organization', i.whatsappOrgCount > 1
        ? `WhatsApp AI is on for ${i.name} in ${i.whatsappOrgCount} organizations, so the AI can't tell which one a message is for.`
        : 'Fine.');
    return lines;
}

/** Load the facts for checkLines (reads only). */
export async function loadCheckInputs(
    admin: SupabaseClient,
    orgId: string,
    userId: string,
    deps: {
        settings: AiSettings; tableMissing: boolean;
        findUser(phone: string): Promise<{ id: string } | null>;
        loadActor(userId: string, orgId: string): Promise<ActorContext | null>;
        whatsappOrgCount(userId: string): Promise<number>;
    },
): Promise<CheckInputs> {
    const { data, error } = await admin.from('users').select('full_name, phone, is_master_admin').eq('id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    const phone = (data?.phone as string | null) || null;
    const owner = phone ? await deps.findUser(phone).catch(() => null) : null;
    return {
        tableMissing: deps.tableMissing,
        settings: deps.settings,
        userId,
        name: (data?.full_name as string | null) || 'This person',
        phone,
        isMasterAdmin: data?.is_master_admin === true,
        phoneOwnerId: owner?.id ?? null,
        actor: await deps.loadActor(userId, orgId),
        whatsappOrgCount: await deps.whatsappOrgCount(userId).catch(() => 0),
    };
}
