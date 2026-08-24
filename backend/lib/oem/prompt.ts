/**
 * System-prompt generator — the "agnostic layer".
 *
 * Every agent's system prompt is GENERATED from three sources of truth:
 *   1. its registry row (identity, department, status, config)
 *   2. the goals bound to it (agent_key on oem_goals) + their parent chain
 *   3. its active data bundle (the only tables it may read)
 *
 * Nobody hand-edits a prompt. When goals or bundles change, the prompt is
 * regenerated, the version bumps, and the change lands in the council log.
 * That is what makes agents self-evolving without becoming self-inventing.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { getActiveBundle, describeBundle } from './bundle';
import type { OemAgent, OemGoal } from './types';

function fmtGoal(g: OemGoal, chain: string[]): string {
    const dir = g.direction === 'up' ? 'increase' : 'decrease';
    const base = g.baseline_value != null ? `${g.baseline_value}` : 'not yet frozen';
    const guard = (g.guardrails ?? [])
        .map((x) => `${x.metric_key} must not ${x.must_not === 'rise_above' ? 'rise above' : 'fall below'} ${x.threshold}`)
        .join('; ');
    return [
        `GOAL: ${g.title} [${g.cadence}]`,
        `  Metric: ${g.metric_key} (${dir} toward ${g.target_value}${g.unit ? ' ' + g.unit : ''}; baseline ${base})`,
        g.expected_rate != null ? `  Expected improvement per ${g.cadence.replace('ly', '')}: ${g.expected_rate}${g.unit ? ' ' + g.unit : ''}` : null,
        guard ? `  Guardrails: ${guard}` : null,
        chain.length ? `  Chain upward: ${chain.join(' -> ')}` : null,
    ]
        .filter(Boolean)
        .join('\n');
}

/** Walk parent_goal_id upward and return the titles (employee -> dept -> tech -> org). */
async function goalChain(goal: OemGoal, all: Map<string, OemGoal>): Promise<string[]> {
    const chain: string[] = [];
    let cur = goal.parent_goal_id;
    let hops = 0;
    while (cur && hops < 6) {
        const parent = all.get(cur);
        if (!parent) break;
        chain.push(`${parent.title} (${parent.level})`);
        cur = parent.parent_goal_id;
        hops++;
    }
    return chain;
}

export async function generateSystemPrompt(
    organizationId: string,
    agentKey: string
): Promise<{ prompt: string; goalCount: number; bundleVersion: number | null }> {
    const { data: agentRow } = await supabaseAdmin
        .from('oem_agents')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('agent_key', agentKey)
        .maybeSingle();

    if (!agentRow) throw new Error(`Agent '${agentKey}' is not registered.`);
    const agent = agentRow as OemAgent;

    const { data: goalRows } = await supabaseAdmin
        .from('oem_goals')
        .select('*')
        .eq('organization_id', organizationId)
        .in('status', ['active']);

    const allGoals = new Map<string, OemGoal>((goalRows ?? []).map((g) => [g.id, g as OemGoal]));
    const bound = (goalRows ?? []).filter((g) => g.agent_key === agentKey) as OemGoal[];

    const active = await getActiveBundle(organizationId, agentKey);

    const goalBlocks: string[] = [];
    for (const g of bound) {
        goalBlocks.push(fmtGoal(g, await goalChain(g, allGoals)));
    }

    const prompt = [
        `You are ${agent.display_name}, an operations agent for the ${agent.department ?? 'organization'} department.`,
        agent.role_description ?? '',
        '',
        '== YOUR GOALS ==',
        goalBlocks.length ? goalBlocks.join('\n\n') : 'No goals bound yet. Observe only; take no action.',
        '',
        '== YOUR DATA (the only tables you may read) ==',
        active ? describeBundle(active.bundle) : 'No data bundle assigned. You may not read any data.',
        '',
        '== RULES ==',
        '1. Never read or reference data outside the tables listed above. If a question requires other data, say so and stop.',
        '2. Every number you report must come from a query on your tables — never estimate a metric.',
        '3. A task counts as done only with system or artifact proof. A claim without proof is reported as unverified.',
        '4. If a guardrail metric is moving the wrong way, report it in the same breath as the goal progress.',
        '5. Respect the goal chain: your work serves the employee goal, which serves the department, tech, and org goals above it.',
        '6. When blocked or uncertain, escalate to the Agent Council log instead of guessing.',
        agent.status === 'shadow' ? '7. SHADOW MODE: log what you would do; send no messages and take no actions.' : '',
    ]
        .filter((l) => l !== '')
        .join('\n');

    return { prompt, goalCount: bound.length, bundleVersion: active?.version ?? null };
}

/** Regenerate + persist the prompt, bump the version, log to the council. */
export async function regenerateAndStorePrompt(
    organizationId: string,
    agentKey: string,
    actorUid: string | null
): Promise<{ version: number; prompt: string }> {
    const { prompt, goalCount, bundleVersion } = await generateSystemPrompt(organizationId, agentKey);

    const { data: agent } = await supabaseAdmin
        .from('oem_agents')
        .select('id, system_prompt_version')
        .eq('organization_id', organizationId)
        .eq('agent_key', agentKey)
        .single();

    const nextVersion = (agent?.system_prompt_version ?? 0) + 1;

    await supabaseAdmin
        .from('oem_agents')
        .update({
            system_prompt: prompt,
            system_prompt_version: nextVersion,
            prompt_generated_at: new Date().toISOString(),
        })
        .eq('id', agent!.id);

    await supabaseAdmin.from('oem_council_log').insert({
        organization_id: organizationId,
        agent_key: agentKey,
        review_type: 'prompt_change',
        summary: `System prompt regenerated to v${nextVersion} from ${goalCount} bound goal(s), bundle v${bundleVersion ?? 'none'}.`,
        decision: 'approved',
        decided_by: actorUid ? 'human' : 'council',
        details: { goal_count: goalCount, bundle_version: bundleVersion },
        created_by: actorUid,
    });

    return { version: nextVersion, prompt };
}
