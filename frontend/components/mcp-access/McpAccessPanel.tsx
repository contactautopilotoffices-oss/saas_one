'use client';

/**
 * MCP ACCESS — org super admin settings module.
 *
 * Issue a read-only connection token, see what it can read, revoke it, and
 * see the roles queued for later. Phase 1 enables org_super_admin only.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
    Plug, Plus, Copy, Check, Trash2, ShieldCheck, AlertTriangle, RefreshCw,
    Clock, Activity, Lock, KeyRound, Eye, BookOpen,
} from 'lucide-react';

interface Connection {
    id: string;
    name: string;
    token_prefix: string;
    scopes: string[];
    status: 'active' | 'revoked' | 'expired';
    expires_at: string;
    last_used_at: string | null;
    use_count: number;
    created_at: string;
    role_at_issue: string;
}

interface RoleEntry {
    role: string;
    label: string;
    status: 'available' | 'coming_soon';
    scopeNote: string;
    blockedBy?: string;
}

interface ToolEntry { name: string; title: string; description: string }

interface ActivityEntry {
    id: string;
    method: string;
    tool_name: string | null;
    outcome: string;
    row_count: number | null;
    latency_ms: number | null;
    error_message: string | null;
    created_at: string;
}

export default function McpAccessPanel() {
    const params = useParams();
    const orgId = params?.orgId as string;

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [connections, setConnections] = useState<Connection[]>([]);
    const [roles, setRoles] = useState<RoleEntry[]>([]);
    const [tools, setTools] = useState<ToolEntry[]>([]);
    const [activity, setActivity] = useState<ActivityEntry[]>([]);
    const [enabled, setEnabled] = useState(false);
    const [callerRole, setCallerRole] = useState<string | null>(null);

    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [newDays, setNewDays] = useState(90);
    const [issuedToken, setIssuedToken] = useState<string | null>(null);
    const [copied, setCopied] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const endpointUrl =
        typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : '/api/mcp';

    const load = useCallback(async () => {
        if (!orgId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/mcp-access/connections?orgId=${orgId}`);
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Failed to load');
            setConnections(json.connections ?? []);
            setRoles(json.role_registry ?? []);
            setTools(json.tools ?? []);
            setActivity(json.recent_activity ?? []);
            setEnabled(!!json.caller_enabled);
            setCallerRole(json.caller_role ?? null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, [orgId]);

    useEffect(() => { load(); }, [load]);

    const createConnection = async () => {
        if (!newName.trim()) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch('/api/mcp-access/connections', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organization_id: orgId, name: newName.trim(), expires_in_days: newDays }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Failed to create');
            setIssuedToken(json.token);
            setCreating(false);
            setNewName('');
            load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const revoke = async (id: string, name: string) => {
        if (!confirm(`Revoke "${name}"? Any client using this token stops working immediately.`)) return;
        setBusy(true);
        try {
            const res = await fetch(`/api/mcp-access/connections?orgId=${orgId}&id=${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error((await res.json()).error || 'Failed to revoke');
            load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const copy = (text: string, key: string) => {
        navigator.clipboard?.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 1800);
    };

    const configSnippet = (token: string) => JSON.stringify(
        { mcpServers: { 'autopilot-offices': { url: endpointUrl, headers: { Authorization: `Bearer ${token}` } } } },
        null, 2
    );

    const card = 'rounded-2xl border border-gray-200 dark:border-gray-700 p-5';
    const btn = 'inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 disabled:opacity-50';
    const btnPrimary = 'inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50';

    return (
        <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2 text-gray-900 dark:text-gray-50">
                        <Plug className="w-7 h-7 text-blue-600" /> MCP Access
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Connect Claude, or any MCP client, to read your organization&apos;s data. Read-only.
                    </p>
                </div>
                <button onClick={load} className={btn}>
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
                </button>
            </div>

            {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
                </div>
            )}

            {/* the token, shown exactly once */}
            {issuedToken && (
                <div className="rounded-2xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/40 p-5 space-y-3">
                    <div className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200">
                        <KeyRound className="w-5 h-5" /> Copy this token now — it is shown once and cannot be retrieved
                    </div>
                    <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs font-mono p-3 rounded-lg bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-800 break-all">
                            {issuedToken}
                        </code>
                        <button onClick={() => copy(issuedToken, 'token')} className={btnPrimary}>
                            {copied === 'token' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            {copied === 'token' ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                    <div>
                        <div className="text-xs font-medium text-amber-900 dark:text-amber-200 mb-1">
                            Client configuration
                        </div>
                        <div className="flex items-start gap-2">
                            <pre className="flex-1 text-xs font-mono p-3 rounded-lg bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-800 overflow-x-auto">
{configSnippet(issuedToken)}
                            </pre>
                            <button onClick={() => copy(configSnippet(issuedToken), 'cfg')} className={btn}>
                                {copied === 'cfg' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>
                    <button onClick={() => setIssuedToken(null)} className={btn}>I have saved it</button>
                </div>
            )}

            {/* endpoint */}
            <div className={card}>
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    <ShieldCheck className="w-4 h-4 text-green-600" /> Endpoint
                </div>
                <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono p-2.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 break-all">
                        {endpointUrl}
                    </code>
                    <button onClick={() => copy(endpointUrl, 'url')} className={btn}>
                        {copied === 'url' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    Streamable HTTP, stateless. Authenticate with <code>Authorization: Bearer &lt;token&gt;</code>.
                </p>
            </div>

            {/* connections */}
            <div className={card}>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Your connections</h2>
                    {enabled && !creating && (
                        <button onClick={() => setCreating(true)} className={btnPrimary}>
                            <Plus className="w-4 h-4" /> New connection
                        </button>
                    )}
                </div>

                {!enabled && !loading && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm text-gray-600 dark:text-gray-300">
                        <Lock className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>
                            MCP access is not yet enabled for your role
                            {callerRole ? <> (<code>{callerRole}</code>)</> : null}. See the roadmap below.
                        </span>
                    </div>
                )}

                {creating && (
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 space-y-3">
                        <div className="grid sm:grid-cols-2 gap-3">
                            <label className="block">
                                <span className="text-xs text-gray-500 dark:text-gray-400">Name</span>
                                <input
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    placeholder="Claude Desktop — my laptop"
                                    className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                                />
                            </label>
                            <label className="block">
                                <span className="text-xs text-gray-500 dark:text-gray-400">Expires in (days)</span>
                                <input
                                    type="number" min={1} max={365} value={newDays}
                                    onChange={(e) => setNewDays(Number(e.target.value))}
                                    className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                                />
                            </label>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={createConnection} disabled={busy || !newName.trim()} className={btnPrimary}>
                                Create connection
                            </button>
                            <button onClick={() => { setCreating(false); setNewName(''); }} className={btn}>Cancel</button>
                        </div>
                    </div>
                )}

                {connections.length === 0 && !loading && enabled && !creating && (
                    <p className="text-sm text-gray-400">No connections yet.</p>
                )}

                <div className="space-y-2">
                    {connections.map((c) => {
                        const expired = new Date(c.expires_at).getTime() < Date.now();
                        const live = c.status === 'active' && !expired;
                        return (
                            <div key={c.id} className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
                                <div className="flex-1 min-w-[200px]">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{c.name}</span>
                                        <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                                            live ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                                                 : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                                        }`}>
                                            {expired && c.status === 'active' ? 'expired' : c.status}
                                        </span>
                                    </div>
                                    <div className="text-xs text-gray-400 font-mono">{c.token_prefix}…</div>
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-3">
                                    <span className="inline-flex items-center gap-1">
                                        <Activity className="w-3.5 h-3.5" /> {c.use_count} calls
                                    </span>
                                    <span className="inline-flex items-center gap-1">
                                        <Clock className="w-3.5 h-3.5" />
                                        {c.last_used_at ? new Date(c.last_used_at).toLocaleDateString() : 'never used'}
                                    </span>
                                    <span>expires {new Date(c.expires_at).toLocaleDateString()}</span>
                                </div>
                                {c.status === 'active' && (
                                    <button
                                        onClick={() => revoke(c.id, c.name)}
                                        disabled={busy}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-red-200 dark:border-red-900 text-red-600 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" /> Revoke
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* what it can read */}
            <div className={card}>
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
                    <Eye className="w-4 h-4" /> What a connection can read
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    These are the only queries a token can run. There is no free-form SQL. Personal, contact,
                    salary and disciplinary fields are not registered, so they cannot be reached.
                </p>
                <div className="space-y-2">
                    {tools.map((t) => (
                        <div key={t.name} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900">
                            <div className="flex items-center gap-2">
                                <code className="text-xs font-mono text-blue-600 dark:text-blue-400">{t.name}</code>
                                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{t.title}</span>
                                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">
                                    read-only
                                </span>
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t.description}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* role roadmap */}
            <div className={card}>
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
                    <BookOpen className="w-4 h-4" /> Role availability
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Rolling out one role at a time. Each role is enabled only once its data access is
                    correctly scoped at the database level.
                </p>
                <div className="space-y-2">
                    {roles.map((r) => (
                        <div key={r.role} className="flex flex-wrap items-start gap-3 p-3 rounded-lg border border-gray-100 dark:border-gray-800">
                            <div className="flex-1 min-w-[220px]">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{r.label}</span>
                                    {r.status === 'available' ? (
                                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                                            Available
                                        </span>
                                    ) : (
                                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                            Coming soon
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{r.scopeNote}</p>
                                {r.blockedBy && (
                                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{r.blockedBy}</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* activity */}
            {activity.length > 0 && (
                <div className={card}>
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                        <Activity className="w-4 h-4" /> Recent activity
                    </div>
                    <div className="space-y-1 max-h-72 overflow-y-auto">
                        {activity.map((a) => (
                            <div key={a.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-gray-50 dark:border-gray-800 last:border-0">
                                <span className={`w-2 h-2 rounded-full shrink-0 ${
                                    a.outcome === 'ok' ? 'bg-green-500'
                                    : a.outcome === 'denied' ? 'bg-red-500'
                                    : a.outcome === 'rate_limited' ? 'bg-amber-500' : 'bg-gray-400'
                                }`} />
                                <code className="font-mono text-gray-700 dark:text-gray-300">{a.tool_name || a.method}</code>
                                <span className="text-gray-400">{a.outcome}</span>
                                {a.row_count != null && <span className="text-gray-400">{a.row_count} rows</span>}
                                {a.latency_ms != null && <span className="text-gray-400">{a.latency_ms}ms</span>}
                                <span className="ml-auto text-gray-400">{new Date(a.created_at).toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
