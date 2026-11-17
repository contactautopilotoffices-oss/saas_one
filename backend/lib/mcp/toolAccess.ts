import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { effectiveTools } from './toolCatalog';

/**
 * Which MCP tools one person may use. Set by an organisation super admin on the settings screen
 * (Settings > Claude tools) and stored in mcp_tool_access, one row per person.
 *
 *   no row, or mode 'all'   -> every tool (how the MCP behaved before this screen existed)
 *   mode 'selected'         -> only the saved list, plus whoami, plus confirm_action when the list
 *                              has any create or update tool (see toolCatalog.effectiveTools)
 *
 * This only narrows what the assistant can call. It never grants anything: every tool still runs
 * as the person through the app's own routes, which keep their role and property checks.
 */
export type McpToolAccess = { mode: 'all' } | { mode: 'selected'; tools: Set<string> };

export const ALL_TOOLS: McpToolAccess = { mode: 'all' };

export type McpToolAccessRow = {
    user_id: string;
    organization_id: string | null;
    mode: 'all' | 'selected';
    tools: string[];
    updated_by: string | null;
    updated_at: string;
};

/** Is the table there? A missing table (migration not run yet) means "all tools", as before. */
export function isMissingTable(message: string | undefined | null): boolean {
    return /relation .* does not exist|schema cache|Could not find the table/i.test(message || '');
}

export function accessFromRow(row: Pick<McpToolAccessRow, 'mode' | 'tools'> | null | undefined): McpToolAccess {
    if (!row || row.mode !== 'selected') return ALL_TOOLS;
    return { mode: 'selected', tools: effectiveTools(Array.isArray(row.tools) ? row.tools : []) };
}

export function isToolAllowed(access: McpToolAccess | undefined, name: string): boolean {
    if (!access || access.mode === 'all') return true;
    return access.tools.has(name);
}

/**
 * Read one person's tool access. Never throws: if the row cannot be read the person gets every
 * tool (the behaviour before this setting existed) and the problem is reported on the console.
 */
export async function loadToolAccess(userId: string): Promise<McpToolAccess> {
    try {
        const { data, error } = await supabaseAdmin
            .from('mcp_tool_access')
            .select('mode, tools')
            .eq('user_id', userId)
            .maybeSingle();
        if (error) {
            if (!isMissingTable(error.message)) console.error('[mcp] tool access read failed:', error.message);
            return ALL_TOOLS;
        }
        return accessFromRow(data as Pick<McpToolAccessRow, 'mode' | 'tools'> | null);
    } catch (e) {
        console.error('[mcp] tool access read failed:', e instanceof Error ? e.message : e);
        return ALL_TOOLS;
    }
}
