/**
 * Brain settings: one row per org in ai_brain_settings, edited in the Brain Console. Pure (no database here).
 *
 * The rule that keeps settings safe is the same as the AI Access settings: a setting can only NARROW what a person may
 * do. After every check here, each skill's own allowed(actor) (the app's access rule) still runs, at propose time and
 * again at execute time. A wrong setting can switch something off; it can never show someone data the app would not.
 */
import { z } from 'zod';
import type { ActorContext } from '../types';
import { BRAIN_MODULES, type BrainChannel, type BrainModule, type GridLevel, type SkillMode } from './types';

const level = z.enum(['off', 'questions', 'questions_actions']);
const skillMode = z.enum(['off', 'shadow', 'live']);
const moduleGrid = z.object(Object.fromEntries(BRAIN_MODULES.map(m => [m, level.optional()])) as Record<BrainModule, z.ZodOptional<typeof level>>).strict();
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const brainSettingsSchema = z.object({
    /**
     * off    = the brain does nothing; every message goes to the bots that exist today.
     * shadow = the brain reads the same messages and records what it WOULD have said and done. It sends nothing and
     *          changes nothing; the existing bots answer as before.
     * live   = the brain answers the people in `audience`. Everyone else is untouched.
     */
    mode: skillMode.default('off'),
    audience: z.enum(['pilot', 'everyone']).default('pilot'),
    pilotUserIds: z.array(z.string().uuid()).max(500).default([]),
    blockedUserIds: z.array(z.string().uuid()).max(500).default([]),
    channels: z.object({ whatsapp: z.boolean().default(false), app_chat: z.boolean().default(false) }).strict().default({ whatsapp: false, app_chat: false }),
    /** role → module → level. A role with no row here gets the default for its kind of role (see defaultLevel). */
    grid: z.record(z.string().min(1).max(64), moduleGrid).default({}),
    /** skill id → off / shadow / live. Missing = the skill's own default. */
    skillModes: z.record(z.string().min(1).max(64), skillMode).default({}),
    limits: z.object({
        perUserPerHour: z.number().int().min(1).max(1000).default(30),
        actionsPerUserPerDay: z.number().int().min(1).max(1000).default(50),
        /** Read skills the model may call in one turn before it must answer (doctrine L5: tool efficiency). */
        maxToolCalls: z.number().int().min(1).max(8).default(4),
        /** Questions in a row before the conversation is handed to a person. */
        maxQuestionsInRow: z.number().int().min(1).max(5).default(2),
    }).strict().default({ perUserPerHour: 30, actionsPerUserPerDay: 50, maxToolCalls: 4, maxQuestionsInRow: 2 }),
    model: z.object({
        effort: z.enum(['low', 'medium', 'high']).default('low'),
        maxTokens: z.number().int().min(300).max(8000).default(2000),
        /** Show a photo to the model on the turn it arrives (Claude models only). */
        vision: z.boolean().default(true),
    }).strict().default({ effort: 'low', maxTokens: 2000, vision: true }),
    memory: z.object({
        enabled: z.boolean().default(true),
        profileDays: z.number().int().min(7).max(730).default(180),
        episodeDays: z.number().int().min(7).max(730).default(90),
    }).strict().default({ enabled: true, profileDays: 180, episodeDays: 90 }),
    /**
     * Learning. lessons = turns the Tech team judged in the console are shown to the brain as examples when a similar
     * message arrives. OFF by default: a lesson can only steer which of the person's own skills is used; it can never
     * add a skill, skip a confirmation or change an access rule (those are code).
     */
    learning: z.object({
        lessons: z.boolean().default(false),
        maxLessons: z.number().int().min(1).max(6).default(4),
    }).strict().default({ lessons: false, maxLessons: 4 }),
    /** Claude keys: which is tried first, when each plan's monthly credit resets, and how much it is. */
    keys: z.object({
        order: z.array(z.union([z.literal(1), z.literal(2)])).min(1).max(2).default([1, 2]),
        cycleEnd: z.object({ k1: isoDay.nullable().default(null), k2: isoDay.nullable().default(null) }).strict().default({ k1: null, k2: null }),
        monthlyCreditUsd: z.object({ k1: z.number().min(0).max(100000).default(100), k2: z.number().min(0).max(100000).default(100) }).strict().default({ k1: 100, k2: 100 }),
    }).strict().default({ order: [1, 2], cycleEnd: { k1: null, k2: null }, monthlyCreditUsd: { k1: 100, k2: 100 } }),
    /** Days the words of a conversation are kept for review. After that only counts and labels remain. */
    textRetentionDays: z.number().int().min(1).max(365).default(30),
}).strict();

export type BrainSettings = z.infer<typeof brainSettingsSchema>;
export const DEFAULT_BRAIN_SETTINGS: BrainSettings = brainSettingsSchema.parse({});

/** A row that does not parse means OFF (fail closed), never "default on". */
export function parseBrainSettings(raw: unknown): BrainSettings {
    const parsed = brainSettingsSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : DEFAULT_BRAIN_SETTINGS;
}

/** Platform ceilings: an org's own limits are clamped to these (the model bill is the platform's). */
export const BRAIN_PLATFORM_LIMITS = { perUserPerHour: 60, actionsPerUserPerDay: 100 } as const;

export function effectiveBrainLimits(s: BrainSettings) {
    return {
        ...s.limits,
        perUserPerHour: Math.min(s.limits.perUserPerHour, BRAIN_PLATFORM_LIMITS.perUserPerHour),
        actionsPerUserPerDay: Math.min(s.limits.actionsPerUserPerDay, BRAIN_PLATFORM_LIMITS.actionsPerUserPerDay),
    };
}

// ── Who gets the brain ────────────────────────────────────────────────────────────────────────────────────────────

export type BrainGate = { ok: true; mode: 'shadow' | 'live' } | { ok: false; reason: 'kill_switch' | 'org_off' | 'channel_off' | 'blocked' | 'not_in_pilot' };

/** env.AI_BRAIN_DISABLED=true stops the brain for every org at once (platform staff). */
export function brainGate(actor: Pick<ActorContext, 'userId'>, s: BrainSettings, channel: BrainChannel, env: Record<string, string | undefined> = process.env): BrainGate {
    if (env.AI_BRAIN_DISABLED === 'true') return { ok: false, reason: 'kill_switch' };
    if (s.mode === 'off') return { ok: false, reason: 'org_off' };
    if (!s.channels[channel]) return { ok: false, reason: 'channel_off' };
    if (s.blockedUserIds.includes(actor.userId)) return { ok: false, reason: 'blocked' };
    if (s.audience === 'pilot' && !s.pilotUserIds.includes(actor.userId)) return { ok: false, reason: 'not_in_pilot' };
    return { ok: true, mode: s.mode };
}

// ── What each kind of role gets ───────────────────────────────────────────────────────────────────────────────────

export type RoleClass = 'staff' | 'client' | 'vendor';

/**
 * Clients (tenant, super tenant) and vendors only ever see their own records; loadActor() already says so through
 * ownRecordsOnly and recordRule. Staff are everyone else with an active membership.
 */
export function roleClass(actor: Pick<ActorContext, 'ownRecordsOnly' | 'recordRule'>): RoleClass {
    if (!actor.ownRecordsOnly) return 'staff';
    return actor.recordRule === 'assigned_to_me' ? 'vendor' : 'client';
}

/** What a role gets when the org has not written a row for it. Skills still apply their own allowed(actor). */
const CLASS_DEFAULT: Record<RoleClass, Record<BrainModule, GridLevel>> = {
    staff: { tickets: 'questions_actions', rooms: 'questions_actions', tasks: 'questions_actions', electricity: 'questions', knowledge: 'questions', memory: 'questions_actions' },
    client: { tickets: 'questions_actions', rooms: 'questions_actions', tasks: 'off', electricity: 'off', knowledge: 'off', memory: 'questions_actions' },
    vendor: { tickets: 'questions', rooms: 'off', tasks: 'off', electricity: 'off', knowledge: 'off', memory: 'questions_actions' },
};
export const defaultLevel = (cls: RoleClass, module: BrainModule): GridLevel => CLASS_DEFAULT[cls][module];

const RANK: Record<GridLevel, number> = { off: 0, questions: 1, questions_actions: 2 };

/**
 * The level this person has for a module: the highest level among their roles that the org wrote a value for; when none
 * of their roles has a value for this module, the default for their kind of role.
 */
export function brainLevelFor(actor: ActorContext, s: BrainSettings, module: BrainModule): GridLevel {
    let best: GridLevel | null = null;
    for (const role of actor.roles) {
        const set = s.grid[role]?.[module];
        if (set && (best === null || RANK[set] > RANK[best])) best = set;
    }
    return best ?? defaultLevel(roleClass(actor), module);
}

export function skillModeFor(s: BrainSettings, skillId: string, fallback: SkillMode): SkillMode {
    return s.skillModes[skillId] ?? fallback;
}

/**
 * A short fingerprint of what the person may do. Stored with a proposal; if it differs when they say Yes (role changed,
 * a building was removed, the skill was switched off), the proposal is cancelled instead of run.
 */
export function scopeFingerprint(actor: ActorContext, skillIds: string[]): string {
    return [actor.userId, actor.orgId, [...actor.roles].sort().join(','), actor.orgWide ? 'org' : [...actor.propertyIds].sort().join(','), actor.recordRule, [...skillIds].sort().join(',')].join('|');
}
