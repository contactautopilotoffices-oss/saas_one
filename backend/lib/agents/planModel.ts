/**
 * MODEL-BACKED PLANNER — the plan comes from what the operator described.
 * -----------------------------------------------------------------------------
 * The rule-based planner in plan.ts keyword-matches a description onto one of two
 * fixed templates. That is fine for the case it models and wrong for everything
 * else: a request to "scan POs for anomalies every morning and mail the owner"
 * matched `procure_item` on the word "purchase orders" and came back asking
 * which property to buy a pedestal fan for. The questions never changed because
 * they were never derived.
 *
 * This derives them. The model reads the description and proposes the slots,
 * steps, actors and tools. Rules keep their job — grounding and refusal:
 *
 *   · every table the model names is re-checked against the org catalog and
 *     dropped if invented,
 *   · every tool is re-checked against the real registry and its
 *     connected/missing status comes from env, never from the model,
 *   · step ids and dependencies are normalised so the canvas cannot be handed a
 *     cycle or a dangling edge,
 *   · any failure falls back to the rule-based plan rather than returning
 *     nothing.
 *
 * The model proposes. It does not get to assert what exists.
 */

import { z } from 'zod';
import { councilChat, isMockLlm } from '@/backend/lib/council/llm';
import { extractJsonObject } from '@/backend/lib/agents/compose';
import {
    bindTools, composePlan, PLAN_STEP_KINDS,
    type AgentPlan, type PlanSlot, type PlanStep, type PlanStepKind,
} from '@/backend/lib/agents/plan';

const StepSchema = z.object({
    id: z.string().trim().min(1).max(12),
    title: z.string().trim().min(3).max(120),
    kind: z.string().trim(),
    needs: z.array(z.string().trim()).max(8).optional(),
    tool: z.string().trim().nullable().optional(),
    tables: z.array(z.string().trim()).max(8).optional(),
    actor: z.string().trim().max(60).optional(),
    produces: z.string().trim().max(240).optional(),
    blockedBy: z.array(z.string().trim()).max(8).optional(),
});

const SlotSchema = z.object({
    key: z.string().trim().min(1).max(40),
    question: z.string().trim().min(4).max(160),
    why: z.string().trim().min(4).max(400),
    from: z.string().trim().optional(),
    lookup: z.string().trim().nullable().optional(),
    options: z.array(z.string().trim().max(120)).max(30).nullable().optional(),
    required: z.boolean().optional(),
    allowAll: z.boolean().optional(),
    fanOut: z.boolean().optional(),
    multi: z.boolean().optional(),
});

const PlanSchema = z.object({
    summary: z.string().trim().max(300).optional(),
    module: z.string().trim().nullable().optional(),
    slots: z.array(SlotSchema).max(8),
    steps: z.array(StepSchema).min(2).max(16),
    roles: z.array(z.object({ name: z.string().trim().max(60), does: z.string().trim().max(200) })).max(8),
});

export interface ModelPlanInput {
    description: string;
    /** The org's real tables, with purpose so the model can choose sensibly. */
    tables: ReadonlyArray<{ name: string; domain: string; purpose: string }>;
    /** Module slugs the runtime understands. */
    modules: ReadonlyArray<string>;
    /** Tool slugs that exist. The model may not invent one. */
    toolSlugs: ReadonlyArray<string>;
}

function systemPrompt(input: ModelPlanInput): string {
    return `You turn an operator's description of a facility-management agent into a WORKFLOW PLAN.

TOOLS THAT EXIST. Use only these slugs, or null for a pure reasoning step:
${input.toolSlugs.join(', ')}

TABLES THAT EXIST. Never name one outside this list:
${input.tables.map((t) => '  ${t.name} [${t.domain}] — ${t.purpose}').join('\n')}

MODULES: ${input.modules.join(', ')}

STEP KINDS: ${PLAN_STEP_KINDS.join(', ')}
  resolve  pin down missing context      search   reach outside the org
  fetch    read our own tables           decide   branch on a rule
  draft    produce something unsent      approve  a human gate; the agent stops
  write    mutate a business record      notify   tell someone

RULES
1. The plan must match THIS description. Do not produce a generic procurement
   flow unless the operator actually described procuring something.
2. SLOTS are facts the request did not carry and the agent CANNOT SAFELY INFER.
   Each must be answerable and specific to this task. If the description already
   states something (a time, a cadence, a recipient), it is NOT a slot.
   Ask at most 5. Fewer is better. Zero is correct when the description is complete.
3. Every slot needs 'why': the concrete harm of acting without it. Not "it is
   needed" — what breaks.
4. 'from' is one of: operator, table, policy, catalog. When it is table or
   catalog, set 'lookup' to the exact table name so the UI can offer real values.
4b. Set 'multi': true whenever more than one option can honestly be chosen —
   which kinds of anomaly to look for, which sites, which categories. Only leave
   it false when the options are genuinely exclusive (one procurement route, one
   delivery channel). When in doubt, multi is the safer answer: a single-select
   forces a false choice and the operator has no way to say 'all of them'.
5. STEPS must be executable and ordered. 'needs' refers to earlier step ids.
   Put a human 'approve' step before anything irreversible leaves the system.
6. 'blockedBy' lists slot keys a step cannot start without.
7. Prefer few, meaty steps over many trivial ones. 4-11 is typical.

Return ONLY JSON:
{"summary":"one line","module":"slug or null",
 "slots":[{"key","question","why","from","lookup","options","required","allowAll","fanOut"}],
 "steps":[{"id":"s1","title","kind","needs":[],"tool":null,"tables":[],"actor","produces","blockedBy":[]}],
 "roles":[{"name","does"}]}`;
}

/**
 * Derive a plan with the model, grounded and validated. Falls back to the
 * rule-based plan on any failure — a plan is better than an error page.
 */
export async function composePlanWithModel(input: ModelPlanInput): Promise<AgentPlan> {
    const fallback = () =>
        composePlan({ description: input.description, availableTables: input.tables.map((t) => t.name) });

    if (isMockLlm()) return fallback();

    let parsed: z.infer<typeof PlanSchema>;
    try {
        const raw = await councilChat(
            [
                { role: 'system', content: systemPrompt(input) },
                { role: 'user', content: input.description },
            ],
            'opinion' as never,
        );
        const env = extractJsonObject(raw);
        parsed = PlanSchema.parse(env);
    } catch {
        return fallback();
    }

    // --- grounding, applied AFTER parsing; the model is not trusted ----------
    const knownTables = new Set(input.tables.map((t) => t.name.toLowerCase()));
    const knownTools = new Set(input.toolSlugs);
    const rejected: string[] = [];

    const ids = new Set(parsed.steps.map((s) => s.id));
    const steps: PlanStep[] = parsed.steps.map((s) => {
        const tables = (s.tables ?? []).filter((t) => {
            if (knownTables.has(t.toLowerCase())) return true;
            rejected.push(t);
            return false;
        });
        const tool = s.tool && knownTools.has(s.tool) ? s.tool : null;
        if (s.tool && !tool) rejected.push(`tool:${s.tool}`);
        return {
            id: s.id,
            title: s.title,
            kind: (PLAN_STEP_KINDS as readonly string[]).includes(s.kind) ? (s.kind as PlanStepKind) : 'fetch',
            // Dangling edges would draw a broken canvas; drop them.
            needs: (s.needs ?? []).filter((n) => ids.has(n) && n !== s.id),
            tool,
            tables,
            actor: s.actor || 'agent',
            produces: s.produces || '',
            blockedBy: s.blockedBy ?? [],
        };
    });

    const slotKeys = new Set<string>();
    const slots: PlanSlot[] = parsed.slots
        .filter((s) => (slotKeys.has(s.key) ? false : (slotKeys.add(s.key), true)))
        .map((s) => ({
            key: s.key,
            question: s.question,
            why: s.why,
            from: (['operator', 'table', 'policy', 'catalog'].includes(s.from ?? '')
                ? s.from
                : 'operator') as PlanSlot['from'],
            lookup: s.lookup && knownTables.has(s.lookup.toLowerCase()) ? s.lookup : null,
            options: s.options ?? null,
            required: s.required ?? true,
            allowAll: s.allowAll,
            fanOut: s.fanOut,
            multi: s.multi ?? false,
        }));

    // A step may only wait on a slot that exists.
    for (const st of steps) st.blockedBy = st.blockedBy.filter((k) => slotKeys.has(k));

    const tools = bindTools(steps.map((s) => s.tool).filter((t): t is string => Boolean(t)));
    const notes: string[] = [];
    if (parsed.summary) notes.push(parsed.summary);

    const missing = tools.filter((t) => t.status === 'missing');
    if (missing.length) {
        notes.push(
            `${missing.length} tool${missing.length > 1 ? 's are' : ' is'} not configured: ` +
            missing.map((t) => `${t.label} (needs ${t.requires.map((r) => r.split('|').join(' or ')).join(', ')})`).join('; ') + '.',
        );
    }
    if (rejected.length) {
        notes.push(`Dropped ${[...new Set(rejected)].length} reference this org does not have: ${[...new Set(rejected)].join(', ')}.`);
    }
    const required = slots.filter((s) => s.required).length;
    if (required) {
        notes.push(`${required} question${required > 1 ? 's' : ''} must be answered before this agent can act. They are questions of fact, not preference.`);
    }

    return {
        intent: input.description,
        module: (parsed.module && input.modules.includes(parsed.module) ? parsed.module : null) as AgentPlan['module'],
        source: 'model',
        slots,
        steps,
        tools,
        roles: parsed.roles.map((r) => ({ name: r.name, does: r.does })),
        notes,
    };
}
