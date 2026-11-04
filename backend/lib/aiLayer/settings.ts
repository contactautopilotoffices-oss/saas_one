/**
 * AI Access settings: who may use the AI layer and what for. One row per org in ai_access_settings.
 *
 * The one rule that keeps settings safe: settings can only NARROW access, never widen it. After every check here, the
 * catalog entry's own allowed(actor) check (the app's access rules) still runs. A wrong setting can switch the AI off
 * for someone; it can never show them data the app would not.
 */
import { z } from 'zod';
import type { ActorContext, Channel, EntryMode, GridLevel, ModuleId } from './types';
import { AI_TENANT_ROLES, AI_VENDOR_ROLES } from './scope';

const gridLevel = z.enum(['off', 'questions', 'questions_actions']);
const entryMode = z.enum(['off', 'shadow', 'live']);
const moduleGrid = z.object({ tickets: gridLevel.default('off'), electricity_readings: gridLevel.default('off') }).strict();

export const settingsSchema = z.object({
    enabled: z.boolean().default(false),
    channels: z.object({
        app_chat: z.boolean().default(true),
        whatsapp: z.boolean().default(false),
        app_voice: z.boolean().default(false),
    }).strict().default({ app_chat: true, whatsapp: false, app_voice: false }),
    access: z.object({
        mode: z.enum(['selected_people', 'selected_roles', 'people_and_roles', 'all_staff']).default('selected_people'),
        userIds: z.array(z.string().uuid()).max(500).default([]),
        roles: z.array(z.string().min(1).max(64)).max(50).default([]),
    }).strict().default({ mode: 'selected_people', userIds: [], roles: [] }),
    blockedUserIds: z.array(z.string().uuid()).max(500).default([]),
    /** null = every property of the org. */
    propertyIds: z.array(z.string().uuid()).max(500).nullable().default(null),
    /** role → module → level. A role missing here gets 'off' for every module. */
    grid: z.record(z.string().min(1).max(64), moduleGrid).default({}),
    /** catalog entry id → off / shadow / live. Missing = the entry's default (writes start in shadow). */
    entryModes: z.record(z.string().min(1).max(64), entryMode).default({}),
    /** Learning loop (owner 2026-11-04): flag likely mistakes for review, so an org super admin can teach the AI. */
    learning: z.object({ enabled: z.boolean().default(false) }).strict().default({ enabled: false }),
    /** Property nicknames: property id → other names people use for it ("DMC", "Mafatlal"). */
    aliases: z.record(z.string().uuid(), z.array(z.string().trim().min(2).max(40)).max(10)).default({}),
    limits: z.object({
        perUserPerHour: z.number().int().min(1).max(1000).default(30),
        actionsPerUserPerDay: z.number().int().min(1).max(1000).default(50),
    }).strict().default({ perUserPerHour: 30, actionsPerUserPerDay: 50 }),
}).strict();

export type AiSettings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: AiSettings = settingsSchema.parse({});

/** Platform ceiling: an org's own limits are clamped to these, whatever it saves (the AI bill is the platform's). */
export const PLATFORM_LIMITS = { perUserPerHour: 60, actionsPerUserPerDay: 100 } as const;

/**
 * Owner decision 2026-11-04: WhatsApp needs no webhook secret. The channel is controlled only by the org's AI Access
 * settings (WhatsApp switched on + the person selected). Known, accepted risk: the AiSensy webhook does not verify its
 * sender, so anyone who knows the webhook URL and a selected person's number can pretend to be that person and get the
 * answers that person would get. Keep the WhatsApp selection small (docs/AI_ACTION_LAYER_PLAN.md, gap S1).
 */

export function parseSettings(raw: unknown): AiSettings {
    const parsed = settingsSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export function effectiveLimits(s: AiSettings) {
    return {
        perUserPerHour: Math.min(s.limits.perUserPerHour, PLATFORM_LIMITS.perUserPerHour),
        actionsPerUserPerDay: Math.min(s.limits.actionsPerUserPerDay, PLATFORM_LIMITS.actionsPerUserPerDay),
    };
}

export type GateRefusal = 'org_off' | 'channel_off' | 'blocked' | 'not_selected' | 'no_properties';

const isStaffRole = (r: string) => !(AI_TENANT_ROLES as readonly string[]).includes(r) && !(AI_VENDOR_ROLES as readonly string[]).includes(r);

/**
 * Checks 2 to 6 of the plan (the global kill switch is the AI_LAYER_DISABLED env var, checked by the route).
 * Returns the actor narrowed to the enabled properties, or the reason for refusing.
 */
export function gate(actor: ActorContext, s: AiSettings, channel: Channel): { ok: true; actor: ActorContext } | { ok: false; reason: GateRefusal } {
    if (!s.enabled) return { ok: false, reason: 'org_off' };
    if (!s.channels[channel]) return { ok: false, reason: 'channel_off' };
    if (s.blockedUserIds.includes(actor.userId)) return { ok: false, reason: 'blocked' };

    const byPerson = s.access.userIds.includes(actor.userId);
    const byRole = actor.roles.some(r => s.access.roles.includes(r));
    const selected =
        s.access.mode === 'selected_people' ? byPerson :
        s.access.mode === 'selected_roles' ? byRole :
        s.access.mode === 'people_and_roles' ? byPerson || byRole :
        // all_staff: every staff role. Tenant and vendor roles must be picked one by one.
        byPerson || byRole || actor.roles.some(isStaffRole);
    if (!selected) return { ok: false, reason: 'not_selected' };

    const propertyIds = s.propertyIds === null ? actor.propertyIds : actor.propertyIds.filter(id => s.propertyIds!.includes(id));
    if (!propertyIds.length) return { ok: false, reason: 'no_properties' };
    const propertyNames = Object.fromEntries(propertyIds.map(id => [id, actor.propertyNames[id]]));
    return { ok: true, actor: { ...actor, propertyIds, propertyNames } };
}

const RANK: Record<GridLevel, number> = { off: 0, questions: 1, questions_actions: 2 };

/** The highest grid level any of the actor's roles has for a module. */
export function gridLevelFor(actor: ActorContext, s: AiSettings, module: ModuleId): GridLevel {
    let best: GridLevel = 'off';
    for (const role of actor.roles) {
        const level = s.grid[role]?.[module] ?? 'off';
        if (RANK[level] > RANK[best]) best = level;
    }
    return best;
}

export function entryModeFor(s: AiSettings, entryId: string, fallback: EntryMode): EntryMode {
    return s.entryModes[entryId] ?? fallback;
}
