/**
 * THE COUNCIL AS EIGHT REAL AGENTS.
 * -----------------------------------------------------------------------------
 * Until now the council lived in its own table and its own screen. Ira and
 * Pratiksha were "agents" — they had status, schedule, model, reliability,
 * runs, cost, a prompt editor — and Nair, who reviews Ira's work, had none of
 * that. Two classes of the same thing, configured in two different places.
 *
 * This provisions each council persona as a row in oem_agents, so every one of
 * them appears in the roster and gets the whole console: Configure, Delivery,
 * Activity, Uptime, Profile, Reinforcement, Credentials.
 *
 * ── WHICH COLUMN WINS ───────────────────────────────────────────────────────
 * The persona is now stored TWICE, so one of them has to be canonical or they
 * drift. The rule:
 *
 *     oem_agents.system_prompt   is canonical once the agent row exists.
 *     council_agents.persona     is the seed, and the fallback.
 *
 * loadAgents() reads the oem_agents prompt in preference (see runner.ts). That
 * is deliberate and it fixes a real complaint: everywhere else in this system
 * oem_agents.system_prompt is a SPEC a human implements, decorative at runtime.
 * For these eight it is the actual instruction the model receives. The
 * Reinforcement tab therefore genuinely changes how they think.
 *
 * ── WHAT LIVES WHERE ────────────────────────────────────────────────────────
 *   system_prompt          the persona the model runs on
 *   model_config.model     which model THIS member thinks with
 *   runtime.schedule_cron  when this member is convened
 *   runtime.reports_to     null — a specialist does not report to a specialist
 *   config                 council_key, colour, title, lens, avatar — display
 *
 * No migration: oem_agents.config, .runtime and .model_config are jsonb and
 * already exist. Re-running is safe; it never overwrites an operator's edits.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { loadAgents } from './runner';
import type { CouncilAgentDef } from './personas';

/** Prefix so a council member can never collide with an operational agent key. */
export const COUNCIL_AGENT_PREFIX = 'council-';

export const councilAgentKey = (councilKey: string) => `${COUNCIL_AGENT_PREFIX}${councilKey}`;
export const isCouncilAgentKey = (agentKey: string) => agentKey.startsWith(COUNCIL_AGENT_PREFIX);
export const councilKeyFromAgentKey = (agentKey: string) =>
    isCouncilAgentKey(agentKey) ? agentKey.slice(COUNCIL_AGENT_PREFIX.length) : null;

/** Default model per member. Cheap for routine lenses, stronger where the cost of a miss is high. */
const DEFAULT_MODEL_BY_KEY: Record<string, string> = {
    cto: 'glm-5.3',          // security misses are expensive
    compliance: 'glm-5.3',   // so are regulatory ones
    procurement: 'glm-5.3-flash',
    ops: 'glm-5.3-flash',
    qa: 'glm-5.3-flash',
    product: 'glm-5.3-flash',
    energy: 'glm-5.3-flash',
    tenant: 'glm-5.3-flash',
};

export interface ProvisionResult {
    created: string[];
    updated: string[];
    skipped: Array<{ key: string; why: string }>;
    error?: string;
}

/**
 * Create or refresh the eight agent rows. Idempotent.
 *
 * An existing row keeps everything an operator may have changed — status,
 * prompt, model, schedule. Only the display fields that mirror council_agents
 * (name, title, lens, colour) are refreshed, because those are still owned
 * there. Re-running after renaming a persona updates the roster; re-running
 * after editing a prompt does not clobber it.
 */
export async function provisionCouncilAgents(orgId: string): Promise<ProvisionResult> {
    const out: ProvisionResult = { created: [], updated: [], skipped: [] };

    let personas: CouncilAgentDef[];
    try {
        // The SEED, not the merged view — provisioning from the override would
        // re-seed a prompt from itself and the seed would become unrecoverable.
        personas = await loadAgents(orgId, { applyOverrides: false });
    } catch (e) {
        out.error = `council roster unavailable: ${e instanceof Error ? e.message : e}`;
        return out;
    }
    if (!personas.length) { out.error = 'no council personas for this org'; return out; }

    const keys = personas.map((p) => councilAgentKey(p.key));
    const { data: existingRows, error: readErr } = await supabaseAdmin
        .from('oem_agents')
        .select('agent_key, system_prompt, system_prompt_version, model_config, runtime, status, config')
        .eq('organization_id', orgId)
        .in('agent_key', keys);
    if (readErr) { out.error = readErr.message; return out; }

    const existing = new Map((existingRows ?? []).map((r) => [String(r.agent_key), r]));

    for (const p of personas) {
        const agentKey = councilAgentKey(p.key);
        const prior = existing.get(agentKey);

        // Display fields mirror council_agents and are always refreshed.
        const config = {
            ...((prior?.config ?? {}) as Record<string, unknown>),
            module: 'council',
            council_key: p.key,
            title: p.title,
            lens: p.lens,
            color: p.color,
            email: p.email,
            sort: p.sort,
        };

        if (!prior) {
            const { error } = await supabaseAdmin.from('oem_agents').insert({
                organization_id: orgId,
                agent_key: agentKey,
                display_name: `${p.name} — ${p.title}`,
                department: 'council',
                role_description: p.lens,
                // Shadow, not live. A newly-provisioned agent has never been
                // observed under this console's own instrumentation, and the
                // lifecycle says prove it before it acts.
                status: 'shadow',
                system_prompt: p.persona,
                system_prompt_version: 1,
                prompt_generated_at: new Date().toISOString(),
                config,
                model_config: { provider: 'custom', model: DEFAULT_MODEL_BY_KEY[p.key] ?? 'glm-5.3-flash' },
                runtime: {
                    // Convened weekly with the rest of the council. An operator can
                    // move one member to a different cadence from the console.
                    schedule_cron: '30 1 * * 1',
                    timezone: 'Asia/Kolkata',
                    autonomy: 'suggest',
                    reports_to: null,
                },
            });
            if (error) { out.skipped.push({ key: agentKey, why: error.message }); continue; }
            out.created.push(agentKey);
            continue;
        }

        // Refresh display only. Prompt, model, schedule and status are the
        // operator's now — a re-provision must never undo their work.
        const patch: Record<string, unknown> = {
            display_name: `${p.name} — ${p.title}`,
            role_description: p.lens,
            config,
        };
        // A row provisioned before the persona existed can still be seeded once.
        if (!String(prior.system_prompt ?? '').trim()) {
            patch.system_prompt = p.persona;
            patch.system_prompt_version = 1;
            patch.prompt_generated_at = new Date().toISOString();
        }
        if (!(prior.model_config as { model?: string } | null)?.model) {
            patch.model_config = { provider: 'custom', model: DEFAULT_MODEL_BY_KEY[p.key] ?? 'glm-5.3-flash' };
        }
        const { error } = await supabaseAdmin
            .from('oem_agents').update(patch)
            .eq('organization_id', orgId).eq('agent_key', agentKey);
        if (error) { out.skipped.push({ key: agentKey, why: error.message }); continue; }
        out.updated.push(agentKey);
    }

    return out;
}

/**
 * The per-member overrides the council runtime should honour, keyed by council
 * key. Returns an empty map when the agents have not been provisioned, so every
 * caller degrades to the seeded persona and the global model.
 */
export async function councilAgentOverrides(orgId: string): Promise<Map<string, {
    prompt: string | null; model: string | null; status: string; scheduleCron: string | null;
}>> {
    const map = new Map<string, { prompt: string | null; model: string | null; status: string; scheduleCron: string | null }>();
    try {
        const { data } = await supabaseAdmin
            .from('oem_agents')
            .select('agent_key, system_prompt, model_config, status, runtime')
            .eq('organization_id', orgId)
            .like('agent_key', `${COUNCIL_AGENT_PREFIX}%`);
        for (const r of data ?? []) {
            const key = councilKeyFromAgentKey(String(r.agent_key));
            if (!key) continue;
            map.set(key, {
                prompt: String(r.system_prompt ?? '').trim() || null,
                model: (r.model_config as { model?: string } | null)?.model ?? null,
                status: String(r.status ?? 'draft'),
                scheduleCron: (r.runtime as { schedule_cron?: string } | null)?.schedule_cron ?? null,
            });
        }
    } catch { /* not provisioned; callers fall back */ }
    return map;
}
