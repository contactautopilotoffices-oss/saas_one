import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export type McpLogEntry = {
    userId: string;
    clientId: string | null;
    tool: string;
    endpoint?: string | null;
    args?: unknown;
    httpStatus?: number | null;
    ok: boolean;
    error?: string | null;
    durationMs?: number | null;
};

const SECRET_KEY = /token|secret|password|passwd|api[_-]?key|authorization|cookie/i;

/** Copy the arguments for the log, dropping anything that looks like a secret and capping size. */
export function sanitiseArgs(args: unknown): unknown {
    if (args === null || args === undefined) return null;
    try {
        const cleaned = JSON.parse(
            JSON.stringify(args, (key, value) => (key && SECRET_KEY.test(key) ? '[removed]' : value)),
        );
        const s = JSON.stringify(cleaned);
        return s.length > 4000 ? { truncated: s.slice(0, 4000) } : cleaned;
    } catch {
        return null;
    }
}

/**
 * Append one row to mcp_call_log. Never throws: a logging failure must not break the
 * user's request, but it is reported on the server console.
 */
export async function logMcpCall(entry: McpLogEntry): Promise<void> {
    try {
        const { error } = await supabaseAdmin.from('mcp_call_log').insert({
            user_id: entry.userId,
            client_id: entry.clientId,
            tool: entry.tool,
            endpoint: entry.endpoint ?? null,
            args: sanitiseArgs(entry.args),
            http_status: entry.httpStatus ?? null,
            ok: entry.ok,
            error: entry.error ? String(entry.error).slice(0, 1000) : null,
            duration_ms: entry.durationMs ?? null,
        });
        if (error) console.error('[mcp] call log write failed:', error.message);
    } catch (e) {
        console.error('[mcp] call log write failed:', e instanceof Error ? e.message : e);
    }
}
