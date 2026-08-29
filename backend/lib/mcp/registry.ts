/**
 * The read-only query registry — the core guardrail.
 *
 * Every MCP tool is a NAMED, PARAMETERISED query. There is deliberately no
 * free-form SQL tool: "read-only SQL" is still an exfiltration tool. A caller
 * can only run what is registered here, with the arguments declared here.
 *
 * organization_id is ALWAYS injected from the authenticated connection and is
 * never accepted as a tool argument. That is what stops one organization
 * reading another's data.
 *
 * Phase 1 exposes the Org Efficiency data only — goals, tasks, measurements,
 * progress, agents. No personal, contact, salary or disciplinary fields are
 * registered anywhere, so they cannot be reached however the tool is prompted.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export interface McpToolDef {
    name: string;
    title: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
        additionalProperties: false;
    };
    /** Runs the query. orgId comes from the token, never from args. */
    run: (orgId: string, args: Record<string, unknown>) => Promise<unknown[]>;
}

const MAX_ROWS = 200;

function clampLimit(v: unknown, fallback = 50): number {
    const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, MAX_ROWS);
}

function str(v: unknown): string | undefined {
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export const MCP_TOOLS: McpToolDef[] = [
    {
        name: 'list_goals',
        title: 'List goals',
        description:
            'List goals in the organization with current value, target, progress percentage, ' +
            'expected vs actual improvement rate, and whether fresh measurement data exists. ' +
            'Optionally filter by level, department or cadence.',
        inputSchema: {
            type: 'object',
            properties: {
                level: { type: 'string', enum: ['agent', 'employee', 'department', 'tech', 'org'], description: 'Goal level' },
                department: { type: 'string', description: 'Department name' },
                cadence: { type: 'string', enum: ['weekly', 'monthly', 'quarterly'] },
                limit: { type: 'number', description: `Max rows (default 50, max ${MAX_ROWS})` },
            },
            additionalProperties: false,
        },
        run: async (orgId, args) => {
            let q = supabaseAdmin
                .from('v_oem_goal_progress')
                .select('goal_id, level, title, department, agent_key, cadence, metric_key, unit, baseline_value, target_value, current_value, progress_pct, expected_rate, actual_rate, last_measured_on, data_in_chain, status')
                .eq('organization_id', orgId);
            const level = str(args.level);
            const dept = str(args.department);
            const cadence = str(args.cadence);
            if (level) q = q.eq('level', level);
            if (dept) q = q.eq('department', dept);
            if (cadence) q = q.eq('cadence', cadence);
            const { data, error } = await q.limit(clampLimit(args.limit));
            if (error) throw new Error(error.message);
            return data ?? [];
        },
    },
    {
        name: 'get_goal_measurements',
        title: 'Get goal measurement history',
        description:
            'Return the measurement time series for one goal — the period values behind its ' +
            'progress figure. Use this to explain why a goal moved.',
        inputSchema: {
            type: 'object',
            properties: {
                goal_id: { type: 'string', description: 'The goal id from list_goals' },
                limit: { type: 'number', description: `Max periods (default 50, max ${MAX_ROWS})` },
            },
            required: ['goal_id'],
            additionalProperties: false,
        },
        run: async (orgId, args) => {
            const goalId = str(args.goal_id);
            if (!goalId) throw new Error('goal_id is required');
            const { data, error } = await supabaseAdmin
                .from('oem_measurements')
                .select('goal_id, period_start, period_end, value, expected_value, sample_size, source, notes, created_at')
                .eq('organization_id', orgId)          // scope first
                .eq('goal_id', goalId)
                .order('period_end', { ascending: true })
                .limit(clampLimit(args.limit));
            if (error) throw new Error(error.message);
            return data ?? [];
        },
    },
    {
        name: 'list_tasks',
        title: 'List tasks',
        description:
            'List tasks attached to goals, with status and how completion was proven ' +
            '(system timestamp, artifact, or unverified claim). Filter by date range, status or goal.',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Start date, YYYY-MM-DD' },
                to: { type: 'string', description: 'End date, YYYY-MM-DD' },
                status: { type: 'string', enum: ['pending', 'done', 'missed', 'blocked', 'cancelled'] },
                goal_id: { type: 'string' },
                limit: { type: 'number', description: `Max rows (default 50, max ${MAX_ROWS})` },
            },
            additionalProperties: false,
        },
        run: async (orgId, args) => {
            let q = supabaseAdmin
                .from('oem_tasks')
                .select('id, goal_id, title, scheduled_on, due_at, status, proof_type, blocked_reason, source, completed_at')
                .eq('organization_id', orgId);
            const from = str(args.from);
            const to = str(args.to);
            const status = str(args.status);
            const goalId = str(args.goal_id);
            if (from) q = q.gte('scheduled_on', from);
            if (to) q = q.lte('scheduled_on', to);
            if (status) q = q.eq('status', status);
            if (goalId) q = q.eq('goal_id', goalId);
            const { data, error } = await q.order('scheduled_on', { ascending: false }).limit(clampLimit(args.limit));
            if (error) throw new Error(error.message);
            return data ?? [];
        },
    },
    {
        name: 'org_progress_summary',
        title: 'Organization progress summary',
        description:
            'Per-level progress across the organization (agent, employee, department, tech, org): ' +
            'goal counts, how many are measured, and average progress. Levels with no fresh ' +
            'measurement are reported as unmeasured rather than counted as zero.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        run: async (orgId) => {
            const { data, error } = await supabaseAdmin
                .from('v_oem_goal_progress')
                .select('level, progress_pct, data_in_chain')
                .eq('organization_id', orgId)
                .eq('status', 'active');
            if (error) throw new Error(error.message);
            const rows = data ?? [];
            const levels = ['agent', 'employee', 'department', 'tech', 'org'];
            return levels.map((level) => {
                const at = rows.filter((r) => r.level === level);
                const measured = at.filter((r) => r.progress_pct != null);
                return {
                    level,
                    goal_count: at.length,
                    measured_count: measured.length,
                    missing_data_count: at.filter((r) => !r.data_in_chain).length,
                    progress_pct: measured.length
                        ? Math.round(measured.reduce((s, r) => s + Number(r.progress_pct ?? 0), 0) / measured.length)
                        : null,
                };
            });
        },
    },
    {
        name: 'list_agents',
        title: 'List registered agents',
        description:
            'List the AI agents registered in this organization, their department, status ' +
            '(draft, shadow, live, paused, retired) and system prompt version.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        run: async (orgId) => {
            const { data, error } = await supabaseAdmin
                .from('oem_agents')
                .select('agent_key, display_name, department, status, system_prompt_version, prompt_generated_at')
                .eq('organization_id', orgId)
                .order('agent_key');
            if (error) throw new Error(error.message);
            return data ?? [];
        },
    },
];

export function findTool(name: string): McpToolDef | undefined {
    return MCP_TOOLS.find((t) => t.name === name);
}

/** The wire shape of tools/list. readOnlyHint is a hint to the model; the real
 *  guarantee is that no write query is registered at all. */
export function toolsListPayload() {
    return MCP_TOOLS.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }));
}
