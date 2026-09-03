'use client';

/**
 * AGENT TRI-VIEW — Canvas | List | JSON
 * -----------------------------------------------------------------------------
 * One object, three ways of looking at it. The object is the agent's DATA
 * BUNDLE: the only set of tables this agent is allowed to touch.
 *
 *   Canvas  the graph — bound sources on the left, the agent in the middle,
 *           the channels it can act through on the right. Read links in
 *           --primary, write links in --secondary, on a light ground.
 *   List    the same bundle as an editable table: table, access, why.
 *           "Add from real config" pulls the org's ACTUAL tables (?discover=1);
 *           nothing here is ever invented.
 *   JSON    read-only, the exact object that will execute. The escape hatch for
 *           the person who does not trust either of the other two views.
 *
 * SAVING IS APPEND-ONLY. POST /api/agents/bundles never edits a version, it
 * writes the next one and retires the previous. That promise is printed next to
 * the Save button, because a containment change an operator misunderstands is
 * the same as a containment change they did not make.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    Boxes,
    Check,
    ChevronRight,
    Clipboard,
    ClipboardCheck,
    Database,
    Eye,
    History,
    Loader2,
    MessageSquare,
    Mail,
    Network,
    Phone,
    Plus,
    RefreshCw,
    Save,
    Search,
    Ticket,
    Trash2,
    Undo2,
    Bell,
    ListTree,
    Braces,
    Bot,
} from 'lucide-react';
import { AGENT_RUNTIME_MIGRATION } from '@/frontend/types/agentRuntime';
import type { BundleTableEntry, ConsoleAgent } from './AgentRosterCard';

/* ==========================================================================
 * API shapes
 * ========================================================================== */

interface BundleVersionRow {
    id?: string;
    version: number;
    is_active: boolean;
    bundle: { tables?: BundleTableEntry[]; notes?: string } | null;
    notes?: string | null;
    created_at: string;
    table_count?: number;
    table_names?: string[];
    write_count?: number;
}

interface BundleDiff {
    version: number;
    added: string[];
    removed: string[];
}

interface DiscoveredTableRow {
    name: string;
    domain: string;
    rows_estimate: number | null;
    suggested_access: 'read' | 'write';
    org_scoped: boolean;
    has_data: boolean;
    purpose: string;
}

interface DiscoverPayload {
    provisioned: boolean;
    tables: DiscoveredTableRow[];
    modules: Array<{ key: string; label: string; description: string; table_count: number; populated_count: number }>;
    summary?: { tables_present: number; tables_with_data: number; modules_present: number };
    note?: string;
}

export type TriViewMode = 'canvas' | 'list' | 'json';

export interface AgentTriViewProps {
    orgId: string;
    agentKey: string;
    /** Identity + runtime, for the centre node and the JSON view. */
    agent?: ConsoleAgent | null;
    /** Fired after a successful save, with the new version number. */
    onSaved?: (version: number) => void;
}

/* ==========================================================================
 * Output inference — what can this agent actually DO with write access?
 * ========================================================================== */

type OutputKind = 'ticket' | 'whatsapp' | 'voice' | 'email' | 'notify' | 'task' | 'record' | 'proposal';

interface OutputNode {
    id: OutputKind;
    label: string;
    detail: string;
    /** The bundle tables that justify this channel. */
    sources: string[];
}

const OUTPUT_ICON: Record<OutputKind, React.ElementType> = {
    ticket: Ticket,
    whatsapp: MessageSquare,
    voice: Phone,
    email: Mail,
    notify: Bell,
    task: Check,
    record: Database,
    proposal: Eye,
};

const CHANNEL_RULES: Array<{ kind: OutputKind; test: RegExp; label: string }> = [
    { kind: 'ticket', test: /ticket|complaint|escalation/, label: 'Ticket' },
    { kind: 'whatsapp', test: /whatsapp|message|chat|conversation/, label: 'WhatsApp' },
    { kind: 'voice', test: /call|voice|bolna|plivo|telephony/, label: 'Voice call' },
    { kind: 'email', test: /mail|inbox|thread/, label: 'Email' },
    { kind: 'notify', test: /notification|alert|digest|reminder|nudge/, label: 'Notification' },
    { kind: 'task', test: /task|checklist|action|assignment/, label: 'Task' },
];

function inferOutputs(tables: BundleTableEntry[], agent?: ConsoleAgent | null): OutputNode[] {
    const byKind = new Map<OutputKind, OutputNode>();

    const push = (kind: OutputKind, label: string, detail: string, source?: string) => {
        const existing = byKind.get(kind);
        if (existing) {
            if (source && !existing.sources.includes(source)) existing.sources.push(source);
            return;
        }
        byKind.set(kind, { id: kind, label, detail, sources: source ? [source] : [] });
    };

    // 1. Channels the operator declared on the agent itself win over inference.
    const declared = agent?.config?.channels ?? agent?.config?.outputs;
    if (Array.isArray(declared)) {
        for (const raw of declared) {
            if (typeof raw !== 'string') continue;
            const rule = CHANNEL_RULES.find((r) => r.test.test(raw.toLowerCase()));
            if (rule) push(rule.kind, rule.label, `Declared on the agent config as "${raw}".`);
        }
    }

    // 2. Everything the bundle grants write access to.
    const writes = tables.filter((t) => t.access === 'write');
    const plainWrites: string[] = [];
    for (const t of writes) {
        const rule = CHANNEL_RULES.find((r) => r.test.test(t.name));
        if (rule) push(rule.kind, rule.label, `Write access to ${t.name}.`, t.name);
        else plainWrites.push(t.name);
    }
    if (plainWrites.length) {
        push(
            'record',
            'Database write',
            `Writes rows directly into ${plainWrites.length} table${plainWrites.length === 1 ? '' : 's'}.`,
        );
        const node = byKind.get('record');
        if (node) node.sources = plainWrites;
    }

    // 3. suggest-mode, or nothing to write at all: the only output is a proposal.
    const suggestOnly = agent?.runtime?.autonomy === 'suggest';
    if (suggestOnly || byKind.size === 0) {
        push(
            'proposal',
            'Proposal for a human',
            suggestOnly
                ? 'Autonomy is set to "suggest": every action is proposed and waits for a person.'
                : 'No write access in the bundle — this agent can only observe and report.',
        );
    }

    return Array.from(byKind.values());
}

/* ==========================================================================
 * Small utilities
 * ========================================================================== */

function truncate(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function whyOf(t: BundleTableEntry): string {
    return t.why ?? t.purpose ?? '';
}

function sameBundle(a: BundleTableEntry[], b: BundleTableEntry[]): boolean {
    if (a.length !== b.length) return false;
    const key = (t: BundleTableEntry) => `${t.name}:${t.access}`;
    const sa = a.map(key).sort();
    const sb = b.map(key).sort();
    return sa.every((v, i) => v === sb[i]);
}

/* ==========================================================================
 * Component
 * ========================================================================== */

export default function AgentTriView({ orgId, agentKey, agent, onSaved }: AgentTriViewProps) {
    const [view, setView] = useState<TriViewMode>('canvas');

    const [loading, setLoading] = useState(true);
    const [provisioned, setProvisioned] = useState(true);
    const [migration, setMigration] = useState<string>(AGENT_RUNTIME_MIGRATION);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [versions, setVersions] = useState<BundleVersionRow[]>([]);
    const [diffs, setDiffs] = useState<BundleDiff[]>([]);
    const [activeVersion, setActiveVersion] = useState<number | null>(null);

    /** The editable bundle. */
    const [draft, setDraft] = useState<BundleTableEntry[]>([]);
    /** What the draft is compared against for the dirty check. */
    const [baseline, setBaseline] = useState<BundleTableEntry[]>([]);
    const [notes, setNotes] = useState('');

    /** Non-null while an OLD version is being read. Everything is locked then. */
    const [viewingVersion, setViewingVersion] = useState<number | null>(null);
    const [historyOpen, setHistoryOpen] = useState(false);

    const [discover, setDiscover] = useState<DiscoverPayload | null>(null);
    const [discovering, setDiscovering] = useState(false);
    const [discoverOpen, setDiscoverOpen] = useState(false);
    const [discoverQuery, setDiscoverQuery] = useState('');

    const [selectedNode, setSelectedNode] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveNote, setSaveNote] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

    /* ---------------------------------------------------------------- load */

    const loadVersions = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await fetch(
                `/api/agents/bundles?orgId=${encodeURIComponent(orgId)}&agentKey=${encodeURIComponent(agentKey)}`,
                { cache: 'no-store' },
            );
            const json = (await res.json()) as {
                provisioned?: boolean;
                migration?: string;
                versions?: BundleVersionRow[];
                diffs?: BundleDiff[];
                active_version?: number | null;
                error?: string;
            };

            setProvisioned(json.provisioned !== false);
            if (json.migration) setMigration(json.migration);
            if (json.error) setLoadError(json.error);

            const rows = json.versions ?? [];
            setVersions(rows);
            setDiffs(json.diffs ?? []);
            setActiveVersion(json.active_version ?? null);

            const activeRow = rows.find((v) => v.is_active) ?? rows[0] ?? null;
            const fallback = agent?.active_bundle?.bundle?.tables ?? [];
            const tables = (activeRow?.bundle?.tables ?? fallback).map((t) => ({
                ...t,
                access: t.access === 'write' ? ('write' as const) : ('read' as const),
            }));
            setDraft(tables);
            setBaseline(tables);
            setNotes(activeRow?.bundle?.notes ?? activeRow?.notes ?? '');
            setViewingVersion(null);
        } catch (e) {
            setLoadError((e as Error).message);
        } finally {
            setLoading(false);
        }
        // `agent` is intentionally excluded: it only supplies a first-paint
        // fallback and re-running on every registry refresh would stomp an edit.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orgId, agentKey]);

    useEffect(() => {
        void loadVersions();
    }, [loadVersions]);

    const runDiscovery = useCallback(async () => {
        if (discovering) return;
        setDiscovering(true);
        try {
            const res = await fetch(`/api/agents/bundles?orgId=${encodeURIComponent(orgId)}&discover=1`, {
                cache: 'no-store',
            });
            const json = (await res.json()) as DiscoverPayload;
            setDiscover(json);
        } catch (e) {
            setDiscover({ provisioned: false, tables: [], modules: [], note: (e as Error).message });
        } finally {
            setDiscovering(false);
        }
    }, [orgId, discovering]);

    const openDiscover = useCallback(() => {
        setDiscoverOpen(true);
        if (!discover) void runDiscovery();
    }, [discover, runDiscovery]);

    /* ------------------------------------------------------------- derived */

    const readOnly = viewingVersion !== null;

    const shownTables = useMemo<BundleTableEntry[]>(() => {
        if (viewingVersion === null) return draft;
        const row = versions.find((v) => v.version === viewingVersion);
        return row?.bundle?.tables ?? [];
    }, [viewingVersion, versions, draft]);

    const dirty = !readOnly && !sameBundle(draft, baseline);
    const nextVersion = (versions[0]?.version ?? 0) + 1;

    const outputs = useMemo(() => inferOutputs(shownTables, agent), [shownTables, agent]);
    const reads = useMemo(() => shownTables.filter((t) => t.access !== 'write'), [shownTables]);
    const writes = useMemo(() => shownTables.filter((t) => t.access === 'write'), [shownTables]);

    /** The exact object the runtime executes — the JSON view, and the copy target. */
    const executable = useMemo(() => {
        return {
            agent_key: agentKey,
            display_name: agent?.display_name ?? agentKey,
            department: agent?.department ?? null,
            status: agent?.status ?? 'draft',
            system_prompt_version: agent?.system_prompt_version ?? 0,
            runtime: agent?.runtime ?? null,
            model_config: agent?.model_config ?? null,
            bundle: {
                version: readOnly ? viewingVersion : dirty ? `${nextVersion} (unsaved)` : (activeVersion ?? nextVersion - 1),
                tables: shownTables.map((t) => ({
                    name: t.name,
                    access: t.access,
                    ...(t.columns?.length ? { columns: t.columns } : {}),
                    ...(whyOf(t) ? { purpose: whyOf(t) } : {}),
                })),
                ...(notes ? { notes } : {}),
            },
            outputs: outputs.map((o) => ({ channel: o.id, label: o.label, from: o.sources })),
        };
    }, [
        agentKey, agent, readOnly, viewingVersion, dirty, nextVersion, activeVersion, shownTables, notes, outputs,
    ]);

    const executableJson = useMemo(() => JSON.stringify(executable, null, 2), [executable]);

    /* --------------------------------------------------------------- edits */

    const setAccess = (name: string, access: 'read' | 'write') => {
        setDraft((prev) => prev.map((t) => (t.name === name ? { ...t, access } : t)));
    };

    const removeTable = (name: string) => {
        setDraft((prev) => prev.filter((t) => t.name !== name));
        setSelectedNode((s) => (s === `source:${name}` ? null : s));
    };

    const addTables = (rows: DiscoveredTableRow[]) => {
        setDraft((prev) => {
            const have = new Set(prev.map((t) => t.name));
            const additions = rows
                .filter((r) => !have.has(r.name))
                .map<BundleTableEntry>((r) => ({
                    name: r.name,
                    access: r.suggested_access,
                    purpose: r.purpose,
                }));
            return [...prev, ...additions];
        });
    };

    const revert = () => {
        setDraft(baseline);
        setSaveError(null);
        setSaveNote(null);
    };

    /* ---------------------------------------------------------------- save */

    const save = async () => {
        if (saving || readOnly) return;
        setSaving(true);
        setSaveError(null);
        setSaveNote(null);
        try {
            const res = await fetch(`/api/agents/bundles?orgId=${encodeURIComponent(orgId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orgId,
                    agentKey,
                    tables: draft.map((t) => ({
                        name: t.name,
                        access: t.access,
                        ...(t.columns?.length ? { columns: t.columns } : {}),
                        ...(whyOf(t) ? { purpose: whyOf(t) } : {}),
                    })),
                    notes: notes || undefined,
                }),
            });
            const json = (await res.json()) as {
                provisioned?: boolean;
                version?: number;
                note?: string;
                migration?: string;
                uncatalogued?: string[];
                error?: string;
            };

            if (json.error) {
                setSaveError(json.error);
                return;
            }
            if (json.provisioned === false) {
                setProvisioned(false);
                if (json.migration) setMigration(json.migration);
                return;
            }

            setSaveNote(
                `Version ${json.version} is now active.` +
                    (json.uncatalogued?.length ? ` Uncatalogued tables kept: ${json.uncatalogued.join(', ')}.` : ''),
            );
            await loadVersions();
            if (json.version) onSaved?.(json.version);
        } catch (e) {
            setSaveError((e as Error).message);
        } finally {
            setSaving(false);
        }
    };

    /* ==================================================================== */
    /* Render                                                               */
    /* ==================================================================== */

    if (!provisioned) {
        return (
            <NotProvisioned migration={migration} onRetry={() => void loadVersions()} />
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {/* ---- toolbar --------------------------------------------------- */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <ViewSwitch view={view} onChange={setView} />
                    {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary" />}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setHistoryOpen((v) => !v)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:border-primary/30 hover:text-foreground"
                    >
                        <History className="h-3.5 w-3.5" />
                        {activeVersion != null ? `v${activeVersion} active` : 'No version yet'}
                        <ChevronRight className={`h-3 w-3 transition-transform ${historyOpen ? 'rotate-90' : ''}`} />
                    </button>

                    {dirty && (
                        <button
                            type="button"
                            onClick={revert}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:text-foreground"
                        >
                            <Undo2 className="h-3.5 w-3.5" />
                            Revert
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={() => void save()}
                        disabled={!dirty || saving || readOnly}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-text-inverse transition-colors hover:bg-primary-dark transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        Save bundle
                    </button>
                </div>
            </div>

            {/* The promise, stated before the button is pressed rather than after. */}
            <p className="text-[11.5px] leading-relaxed text-text-tertiary">
                Saving creates version {nextVersion}. Existing versions and in-flight runs are untouched.
            </p>

            {/* ---- read-only banner ------------------------------------------ */}
            <AnimatePresence initial={false}>
                {readOnly && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="flex items-center justify-between gap-3 rounded-[14px] border border-secondary/30 bg-secondary/5 px-3.5 py-2.5">
                            <span className="text-[12px] text-text-secondary">
                                Viewing <strong className="font-semibold text-foreground">v{viewingVersion}</strong> read-only.
                                This is what the agent was allowed to see at the time.
                            </span>
                            <button
                                type="button"
                                onClick={() => setViewingVersion(null)}
                                className="shrink-0 rounded-lg border border-border bg-card px-2.5 py-1 text-[11.5px] font-medium text-foreground"
                            >
                                Back to current
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ---- version history ------------------------------------------- */}
            <AnimatePresence initial={false}>
                {historyOpen && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                    >
                        <VersionHistory
                            versions={versions}
                            diffs={diffs}
                            viewingVersion={viewingVersion}
                            onView={(v) => {
                                setViewingVersion(v);
                                setSelectedNode(null);
                            }}
                            onBackToCurrent={() => setViewingVersion(null)}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ---- messages --------------------------------------------------- */}
            {loadError && <Notice tone="warn" text={loadError} />}
            {saveError && <Notice tone="error" text={saveError} />}
            {saveNote && <Notice tone="ok" text={saveNote} />}

            {/* ---- the three views -------------------------------------------- */}
            {view === 'canvas' && (
                <CanvasView
                    reads={reads}
                    writes={writes}
                    outputs={outputs}
                    agent={agent}
                    agentKey={agentKey}
                    selected={selectedNode}
                    onSelect={setSelectedNode}
                    onAddTables={openDiscover}
                    readOnly={readOnly}
                />
            )}

            {view === 'list' && (
                <ListView
                    tables={shownTables}
                    readOnly={readOnly}
                    onAccess={setAccess}
                    onRemove={removeTable}
                    onAddClick={openDiscover}
                    notes={notes}
                    onNotes={setNotes}
                />
            )}

            {view === 'json' && (
                <JsonView
                    json={executableJson}
                    copied={copied}
                    onCopy={() => {
                        void navigator.clipboard?.writeText(executableJson).then(
                            () => {
                                setCopied(true);
                                if (copyTimer.current) clearTimeout(copyTimer.current);
                                copyTimer.current = setTimeout(() => setCopied(false), 1600);
                            },
                            () => setCopied(false),
                        );
                    }}
                />
            )}

            {/* ---- discovery drawer ------------------------------------------- */}
            <AnimatePresence>
                {discoverOpen && (
                    <DiscoverPanel
                        payload={discover}
                        loading={discovering}
                        query={discoverQuery}
                        onQuery={setDiscoverQuery}
                        alreadyBound={new Set(draft.map((t) => t.name))}
                        onAdd={(rows) => {
                            addTables(rows);
                            setDiscoverOpen(false);
                        }}
                        onRefresh={() => void runDiscovery()}
                        onClose={() => setDiscoverOpen(false)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}

/* ==========================================================================
 * View switch
 * ========================================================================== */

const VIEW_META: Array<{ key: TriViewMode; label: string; Icon: React.ElementType }> = [
    { key: 'canvas', label: 'Canvas', Icon: Network },
    { key: 'list', label: 'List', Icon: ListTree },
    { key: 'json', label: 'JSON', Icon: Braces },
];

function ViewSwitch({ view, onChange }: { view: TriViewMode; onChange: (v: TriViewMode) => void }) {
    return (
        <div role="tablist" aria-label="Bundle view" className="inline-flex rounded-lg border border-border bg-muted p-0.5">
            {VIEW_META.map(({ key, label, Icon }) => {
                const on = view === key;
                return (
                    <button
                        key={key}
                        role="tab"
                        aria-selected={on}
                        type="button"
                        onClick={() => onChange(key)}
                        className={`relative inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                            on ? 'text-foreground' : 'text-text-tertiary hover:text-text-secondary'
                        }`}
                    >
                        {on && (
                            <motion.span
                                layoutId="triview-switch"
                                className="absolute inset-0 rounded-[7px] bg-card shadow-sm"
                                transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                            />
                        )}
                        <Icon className="relative h-3.5 w-3.5" />
                        <span className="relative">{label}</span>
                    </button>
                );
            })}
        </div>
    );
}

/* ==========================================================================
 * CANVAS
 * ========================================================================== */

const NODE_W = 232;
const NODE_H = 54;
const GAP = 14;
const CANVAS_W = 960;
const LEFT_X = 16;
const CENTRE_W = 236;
const CENTRE_H = 116;
const CENTRE_X = (CANVAS_W - CENTRE_W) / 2;
const RIGHT_X = CANVAS_W - NODE_W - 16;

function stackTop(count: number, canvasH: number, nodeH: number, index: number) {
    const total = count * nodeH + (count - 1) * GAP;
    return canvasH / 2 - total / 2 + index * (nodeH + GAP);
}

function bezier(x1: number, y1: number, x2: number, y2: number): string {
    const dx = Math.max(48, (x2 - x1) * 0.45);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

interface CanvasViewProps {
    reads: BundleTableEntry[];
    writes: BundleTableEntry[];
    outputs: OutputNode[];
    agent?: ConsoleAgent | null;
    agentKey: string;
    selected: string | null;
    onSelect: (id: string | null) => void;
    onAddTables: () => void;
    readOnly: boolean;
}

function CanvasView({ reads, writes, outputs, agent, agentKey, selected, onSelect, onAddTables, readOnly }: CanvasViewProps) {
    const sources = useMemo(() => [...reads, ...writes], [reads, writes]);
    const live = agent?.status === 'live';

    const leftCount = Math.max(sources.length, 1);
    const rightCount = Math.max(outputs.length, 1);
    const contentH = Math.max(
        leftCount * NODE_H + (leftCount - 1) * GAP,
        rightCount * NODE_H + (rightCount - 1) * GAP,
        CENTRE_H,
    );
    const H = contentH + 56;
    const centreY = H / 2;

    const selectedDetail = useMemo(() => {
        if (!selected) return null;
        if (selected === 'agent') {
            return {
                title: agent?.display_name ?? agentKey,
                body:
                    agent?.role_description ??
                    'No role description yet. Describe what this agent is for in the Configure box above.',
                meta: [
                    `status: ${agent?.status ?? 'draft'}`,
                    `autonomy: ${agent?.runtime?.autonomy ?? 'suggest'}`,
                    `model: ${agent?.model_config?.model ?? 'default'}`,
                    `prompt: v${agent?.system_prompt_version ?? 0}`,
                ],
            };
        }
        if (selected.startsWith('source:')) {
            const name = selected.slice(7);
            const t = sources.find((s) => s.name === name);
            if (!t) return null;
            return {
                title: t.name,
                body: whyOf(t) || 'No stated purpose. Add one in the List view so the next operator knows why it is here.',
                meta: [`access: ${t.access}`, ...(t.columns?.length ? [`columns: ${t.columns.join(', ')}`] : [])],
            };
        }
        if (selected.startsWith('output:')) {
            const id = selected.slice(7);
            const o = outputs.find((x) => x.id === id);
            if (!o) return null;
            return {
                title: o.label,
                body: o.detail,
                meta: o.sources.length ? [`from: ${o.sources.join(', ')}`] : ['inferred from the agent configuration'],
            };
        }
        return null;
    }, [selected, sources, outputs, agent, agentKey]);

    return (
        <div className="rounded-[18px] border border-border bg-card-tint p-3">
            <div className="overflow-x-auto">
                <svg
                    viewBox={`0 0 ${CANVAS_W} ${H}`}
                    width="100%"
                    style={{ minWidth: 760, height: H }}
                    role="group"
                    aria-label="Agent data-flow canvas"
                >
                    <defs>
                        <filter id="apx-glow" x="-30%" y="-30%" width="160%" height="160%">
                            <feGaussianBlur stdDeviation="4" result="b" />
                            <feMerge>
                                <feMergeNode in="b" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>

                    {/* Flow only animates for a LIVE agent — motion here is state,
                        not decoration. Reduced-motion users get a static line. */}
                    <style>{`
                        .apx-flow { stroke-dasharray: 5 10; animation: apx-dash 1.8s linear infinite; }
                        @keyframes apx-dash { to { stroke-dashoffset: -30; } }
                        @media (prefers-reduced-motion: reduce) { .apx-flow { animation: none; } }
                        .apx-node:focus { outline: none; }
                    `}</style>

                    {/* ---- links: source -> agent ---- */}
                    {sources.map((t, i) => {
                        const y = stackTop(sources.length, H, NODE_H, i) + NODE_H / 2;
                        const spread = sources.length > 1 ? (i / (sources.length - 1) - 0.5) * (CENTRE_H * 0.55) : 0;
                        const d = bezier(LEFT_X + NODE_W, y, CENTRE_X, centreY + spread);
                        const colour = t.access === 'write' ? 'var(--secondary)' : 'var(--primary)';
                        const on = selected === `source:${t.name}`;
                        return (
                            <g key={`link-${t.name}`}>
                                <path d={d} fill="none" stroke={colour} strokeWidth={on ? 10 : 7} opacity={on ? 0.2 : 0.11} filter="url(#apx-glow)" />
                                <path
                                    d={d}
                                    fill="none"
                                    stroke={colour}
                                    strokeWidth={on ? 2.2 : 1.4}
                                    opacity={on ? 0.95 : 0.6}
                                    className={live ? 'apx-flow' : undefined}
                                />
                            </g>
                        );
                    })}

                    {/* ---- links: agent -> output (always a write) ---- */}
                    {outputs.map((o, i) => {
                        const y = stackTop(outputs.length, H, NODE_H, i) + NODE_H / 2;
                        const spread = outputs.length > 1 ? (i / (outputs.length - 1) - 0.5) * (CENTRE_H * 0.55) : 0;
                        const d = bezier(CENTRE_X + CENTRE_W, centreY + spread, RIGHT_X, y);
                        const on = selected === `output:${o.id}`;
                        const colour = o.id === 'proposal' ? 'var(--primary)' : 'var(--secondary)';
                        return (
                            <g key={`olink-${o.id}`}>
                                <path d={d} fill="none" stroke={colour} strokeWidth={on ? 10 : 7} opacity={on ? 0.2 : 0.11} filter="url(#apx-glow)" />
                                <path
                                    d={d}
                                    fill="none"
                                    stroke={colour}
                                    strokeWidth={on ? 2.2 : 1.4}
                                    opacity={on ? 0.95 : 0.6}
                                    strokeDasharray={o.id === 'proposal' ? '4 5' : undefined}
                                    className={live && o.id !== 'proposal' ? 'apx-flow' : undefined}
                                />
                            </g>
                        );
                    })}

                    {/* ---- source nodes ---- */}
                    {sources.length === 0 && (
                        <EmptyColumnNode
                            x={LEFT_X}
                            y={centreY - NODE_H / 2}
                            label="No data bound"
                            sub="Add from real config"
                        />
                    )}
                    {sources.map((t, i) => {
                        const y = stackTop(sources.length, H, NODE_H, i);
                        return (
                            <CanvasNode
                                key={`src-${t.name}`}
                                id={`source:${t.name}`}
                                x={LEFT_X}
                                y={y}
                                w={NODE_W}
                                h={NODE_H}
                                title={truncate(t.name, 28)}
                                subtitle={t.access === 'write' ? 'write access' : 'read access'}
                                accent={t.access === 'write' ? 'var(--secondary)' : 'var(--primary)'}
                                selected={selected === `source:${t.name}`}
                                onSelect={onSelect}
                                ariaLabel={`Data source ${t.name}, ${t.access} access`}
                            />
                        );
                    })}

                    {/* ---- the agent ---- */}
                    <CanvasNode
                        id="agent"
                        x={CENTRE_X}
                        y={centreY - CENTRE_H / 2}
                        w={CENTRE_W}
                        h={CENTRE_H}
                        title={truncate(agent?.display_name ?? agentKey, 24)}
                        subtitle={`${agent?.status ?? 'draft'} · ${agent?.runtime?.autonomy ?? 'suggest'}`}
                        third={`${sources.length} table${sources.length === 1 ? '' : 's'} · ${outputs.length} channel${outputs.length === 1 ? '' : 's'}`}
                        accent="var(--primary)"
                        selected={selected === 'agent'}
                        onSelect={onSelect}
                        emphasis
                        ariaLabel={`Agent ${agent?.display_name ?? agentKey}`}
                    />

                    {/* ---- output nodes ---- */}
                    {outputs.map((o, i) => {
                        const y = stackTop(outputs.length, H, NODE_H, i);
                        return (
                            <CanvasNode
                                key={`out-${o.id}`}
                                id={`output:${o.id}`}
                                x={RIGHT_X}
                                y={y}
                                w={NODE_W}
                                h={NODE_H}
                                title={o.label}
                                subtitle={o.sources.length ? truncate(o.sources.join(', '), 30) : 'inferred'}
                                accent={o.id === 'proposal' ? 'var(--primary)' : 'var(--secondary)'}
                                selected={selected === `output:${o.id}`}
                                onSelect={onSelect}
                                Icon={OUTPUT_ICON[o.id]}
                                ariaLabel={`Output channel ${o.label}`}
                            />
                        );
                    })}
                </svg>
            </div>

            {/* ---- legend + selected node detail ---- */}
            <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-border pt-3">
                <div className="flex flex-wrap items-center gap-4 text-[11px] text-text-secondary">
                    <LegendSwatch colour="var(--primary)" label="Read access" />
                    <LegendSwatch colour="var(--secondary)" label="Write access" />
                    <LegendSwatch colour="var(--primary)" label="Proposal — waits for a human" dashed />
                    <span className="text-text-tertiary">
                        {live ? 'Flowing links mean this agent is live.' : 'Static links: this agent is not live.'}
                    </span>
                </div>
                {!readOnly && (
                    <button
                        type="button"
                        onClick={onAddTables}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] font-medium text-text-secondary transition-colors hover:border-primary/30 hover:text-foreground"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Add from real config
                    </button>
                )}
            </div>

            <AnimatePresence initial={false}>
                {selectedDetail && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="mt-3 rounded-[14px] border border-border bg-card px-3.5 py-3"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="font-mono text-[12.5px] font-semibold text-foreground">{selectedDetail.title}</p>
                                <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">{selectedDetail.body}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => onSelect(null)}
                                className="shrink-0 text-[11px] text-text-tertiary hover:text-foreground"
                            >
                                Close
                            </button>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {selectedDetail.meta.map((m) => (
                                <span key={m} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-text-tertiary">
                                    {m}
                                </span>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function LegendSwatch({ colour, label, dashed }: { colour: string; label: string; dashed?: boolean }) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden>
                <path
                    d="M 1 4 C 8 4, 14 4, 21 4"
                    stroke={colour}
                    strokeWidth="1.8"
                    fill="none"
                    strokeDasharray={dashed ? '3 3' : undefined}
                />
            </svg>
            {label}
        </span>
    );
}

interface CanvasNodeProps {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    title: string;
    subtitle: string;
    third?: string;
    accent: string;
    selected: boolean;
    emphasis?: boolean;
    /** Rendered as a nested SVG glyph on the right edge of the node. */
    Icon?: React.ElementType;
    ariaLabel: string;
    onSelect: (id: string | null) => void;
}

function CanvasNode({ id, x, y, w, h, title, subtitle, third, accent, selected, emphasis, Icon, ariaLabel, onSelect }: CanvasNodeProps) {
    const [focused, setFocused] = useState(false);
    const ring = selected || focused;
    return (
        <g
            className="apx-node"
            tabIndex={0}
            role="button"
            aria-label={ariaLabel}
            aria-pressed={selected}
            style={{ cursor: 'pointer' }}
            onClick={() => onSelect(selected ? null : id)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(selected ? null : id);
                }
            }}
        >
            {ring && (
                <rect
                    x={x - 3}
                    y={y - 3}
                    width={w + 6}
                    height={h + 6}
                    rx={17}
                    fill="none"
                    stroke={accent}
                    strokeWidth={1.5}
                    opacity={0.35}
                />
            )}
            <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={14}
                fill="var(--card)"
                stroke={ring ? accent : 'var(--border)'}
                strokeWidth={ring ? 1.4 : 1}
            />
            {/* accent rail — which side of the contract this node is on */}
            <rect x={x} y={y + 12} width={3} height={h - 24} rx={1.5} fill={accent} opacity={0.8} />

            <text
                x={x + 16}
                y={emphasis ? y + h / 2 - 12 : y + 22}
                style={{ fill: 'var(--text-primary)', fontSize: emphasis ? 15 : 12.5, fontWeight: 600 }}
            >
                {title}
            </text>
            <text
                x={x + 16}
                y={emphasis ? y + h / 2 + 8 : y + 38}
                style={{ fill: 'var(--text-secondary)', fontSize: 11 }}
            >
                {subtitle}
            </text>
            {third && (
                <text x={x + 16} y={y + h / 2 + 26} style={{ fill: 'var(--text-tertiary)', fontSize: 10.5 }}>
                    {third}
                </text>
            )}
            {Icon && (
                <Icon
                    x={x + w - 34}
                    y={y + h / 2 - 9}
                    width={18}
                    height={18}
                    stroke={accent}
                    strokeWidth={1.6}
                    fill="none"
                    aria-hidden
                />
            )}
        </g>
    );
}

function EmptyColumnNode({ x, y, label, sub }: { x: number; y: number; label: string; sub: string }) {
    return (
        <g>
            <rect
                x={x}
                y={y}
                width={NODE_W}
                height={NODE_H}
                rx={14}
                fill="none"
                stroke="var(--border)"
                strokeWidth={1}
                strokeDasharray="5 5"
            />
            <text x={x + 16} y={y + 22} style={{ fill: 'var(--text-tertiary)', fontSize: 12.5, fontWeight: 600 }}>
                {label}
            </text>
            <text x={x + 16} y={y + 38} style={{ fill: 'var(--text-tertiary)', fontSize: 11 }}>
                {sub}
            </text>
        </g>
    );
}

/* ==========================================================================
 * LIST
 * ========================================================================== */

interface ListViewProps {
    tables: BundleTableEntry[];
    readOnly: boolean;
    onAccess: (name: string, access: 'read' | 'write') => void;
    onRemove: (name: string) => void;
    onAddClick: () => void;
    notes: string;
    onNotes: (v: string) => void;
}

function ListView({ tables, readOnly, onAccess, onRemove, onAddClick, notes, onNotes }: ListViewProps) {
    return (
        <div className="rounded-[18px] border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
                    <Boxes className="h-4 w-4 text-primary" />
                    Bound tables
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-normal text-text-tertiary">
                        {tables.length}
                    </span>
                </div>
                {!readOnly && (
                    <button
                        type="button"
                        onClick={onAddClick}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] font-medium text-text-secondary transition-colors hover:border-primary/30 hover:text-foreground"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Add from real config
                    </button>
                )}
            </div>

            {tables.length === 0 ? (
                <div className="px-4 py-10 text-center">
                    <p className="text-[13px] font-medium text-foreground">This agent is bound to nothing.</p>
                    <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-text-tertiary">
                        A bundle is the whole of what an agent may read or write. An empty bundle is a safe
                        agent that cannot do anything. Add tables from the org&apos;s real config to give it a job.
                    </p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left">
                        <thead>
                            <tr className="border-b border-border text-[10.5px] uppercase tracking-wide text-text-tertiary">
                                <th className="px-4 py-2 font-semibold">Table</th>
                                <th className="px-3 py-2 font-semibold">Access</th>
                                <th className="px-3 py-2 font-semibold">Why</th>
                                <th className="px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {tables.map((t) => (
                                <tr key={t.name} className="border-b border-border/60 last:border-0 align-top">
                                    <td className="px-4 py-2.5">
                                        <span className="font-mono text-[12px] font-medium text-foreground">{t.name}</span>
                                        {t.columns?.length ? (
                                            <p className="mt-0.5 font-mono text-[10.5px] text-text-tertiary">
                                                {t.columns.length} column{t.columns.length === 1 ? '' : 's'} scoped
                                            </p>
                                        ) : null}
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <AccessToggle
                                            value={t.access}
                                            disabled={readOnly}
                                            onChange={(v) => onAccess(t.name, v)}
                                        />
                                    </td>
                                    <td className="max-w-[360px] px-3 py-2.5 text-[12px] leading-relaxed text-text-secondary">
                                        {whyOf(t) || <span className="text-text-tertiary">—</span>}
                                    </td>
                                    <td className="px-3 py-2.5 text-right">
                                        {!readOnly && (
                                            <button
                                                type="button"
                                                onClick={() => onRemove(t.name)}
                                                aria-label={`Remove ${t.name} from the bundle`}
                                                className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-rose-50 hover:text-rose-600"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <div className="border-t border-border px-4 py-3">
                <label htmlFor="bundle-notes" className="text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary">
                    Notes on this version
                </label>
                <textarea
                    id="bundle-notes"
                    value={notes}
                    disabled={readOnly}
                    onChange={(e) => onNotes(e.target.value)}
                    rows={2}
                    placeholder="Why does this version differ from the last one?"
                    className="mt-1.5 w-full resize-y rounded-lg border border-border bg-card-tint px-3 py-2 text-[12px] text-foreground placeholder:text-text-tertiary focus:border-primary/40 focus:outline-none disabled:opacity-60"
                />
            </div>
        </div>
    );
}

function AccessToggle({
    value,
    disabled,
    onChange,
}: {
    value: 'read' | 'write';
    disabled?: boolean;
    onChange: (v: 'read' | 'write') => void;
}) {
    return (
        <div className="inline-flex rounded-md border border-border bg-muted p-0.5" role="group" aria-label="Access level">
            {(['read', 'write'] as const).map((mode) => {
                const on = value === mode;
                const tone = mode === 'write' ? 'text-secondary' : 'text-primary';
                return (
                    <button
                        key={mode}
                        type="button"
                        disabled={disabled}
                        aria-pressed={on}
                        onClick={() => onChange(mode)}
                        className={`rounded-[5px] px-2 py-0.5 text-[11px] font-semibold capitalize transition-colors disabled:cursor-not-allowed ${
                            on ? `bg-card ${tone} shadow-sm` : 'text-text-tertiary hover:text-text-secondary'
                        }`}
                    >
                        {mode}
                    </button>
                );
            })}
        </div>
    );
}

/* ==========================================================================
 * JSON
 * ========================================================================== */

function JsonView({ json, copied, onCopy }: { json: string; copied: boolean; onCopy: () => void }) {
    return (
        <div className="rounded-[18px] border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                <p className="text-[11.5px] text-text-secondary">
                    Read-only. This is the exact object the runtime executes.
                </p>
                <button
                    type="button"
                    onClick={onCopy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] font-medium text-text-secondary transition-colors hover:border-primary/30 hover:text-foreground"
                >
                    {copied ? <ClipboardCheck className="h-3.5 w-3.5 text-emerald-600" /> : <Clipboard className="h-3.5 w-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </div>
            <pre className="max-h-[520px] overflow-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed text-text-primary">
                {json}
            </pre>
        </div>
    );
}

/* ==========================================================================
 * Version history
 * ========================================================================== */

function VersionHistory({
    versions,
    diffs,
    viewingVersion,
    onView,
    onBackToCurrent,
}: {
    versions: BundleVersionRow[];
    diffs: BundleDiff[];
    viewingVersion: number | null;
    onView: (v: number) => void;
    onBackToCurrent: () => void;
}) {
    const diffByVersion = useMemo(() => new Map(diffs.map((d) => [d.version, d])), [diffs]);

    if (!versions.length) {
        return (
            <div className="rounded-[14px] border border-border bg-card px-3.5 py-3 text-[12px] text-text-tertiary">
                No bundle versions yet. The first save will create v1.
            </div>
        );
    }

    return (
        <ul className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card">
            {versions.map((v) => {
                const d = diffByVersion.get(v.version);
                const viewing = viewingVersion === v.version;
                return (
                    <li key={v.version} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
                        <span className="font-mono text-[12px] font-semibold text-foreground">v{v.version}</span>
                        {v.is_active && (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                                Active
                            </span>
                        )}
                        <span className="text-[11.5px] text-text-secondary">
                            {v.table_count ?? v.bundle?.tables?.length ?? 0} tables
                            {v.write_count ? ` · ${v.write_count} write` : ''}
                        </span>
                        {d && (d.added.length > 0 || d.removed.length > 0) && (
                            <span className="text-[11px] text-text-tertiary">
                                {d.added.length > 0 && <span className="text-emerald-600">+{d.added.join(', ')}</span>}
                                {d.added.length > 0 && d.removed.length > 0 && ' · '}
                                {d.removed.length > 0 && <span className="text-rose-600">−{d.removed.join(', ')}</span>}
                            </span>
                        )}
                        <span className="ml-auto flex items-center gap-2">
                            <span className="text-[11px] text-text-tertiary">
                                {new Date(v.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                            </span>
                            <button
                                type="button"
                                onClick={() => (viewing ? onBackToCurrent() : onView(v.version))}
                                className="rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-primary/30 hover:text-foreground"
                            >
                                {viewing ? 'Close' : 'View'}
                            </button>
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}

/* ==========================================================================
 * Discovery panel — "Add from real config"
 * ========================================================================== */

function DiscoverPanel({
    payload,
    loading,
    query,
    onQuery,
    alreadyBound,
    onAdd,
    onRefresh,
    onClose,
}: {
    payload: DiscoverPayload | null;
    loading: boolean;
    query: string;
    onQuery: (v: string) => void;
    alreadyBound: Set<string>;
    onAdd: (rows: DiscoveredTableRow[]) => void;
    onRefresh: () => void;
    onClose: () => void;
}) {
    const [picked, setPicked] = useState<Set<string>>(new Set());

    const moduleLabel = useMemo(() => {
        const map = new Map<string, string>();
        for (const m of payload?.modules ?? []) map.set(m.key, m.label);
        return map;
    }, [payload]);

    const grouped = useMemo(() => {
        const q = query.trim().toLowerCase();
        const rows = (payload?.tables ?? []).filter(
            (t) => !q || t.name.includes(q) || t.purpose.toLowerCase().includes(q) || t.domain.includes(q),
        );
        const by = new Map<string, DiscoveredTableRow[]>();
        for (const t of rows) {
            const list = by.get(t.domain) ?? [];
            list.push(t);
            by.set(t.domain, list);
        }
        return Array.from(by.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    }, [payload, query]);

    const toggle = (name: string) => {
        setPicked((prev) => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    };

    const addPicked = () => {
        const rows = (payload?.tables ?? []).filter((t) => picked.has(t.name));
        onAdd(rows);
        setPicked(new Set());
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/30 p-0 sm:items-center sm:p-6"
            onClick={onClose}
        >
            <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 12, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Add tables from real config"
                className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[24px] border border-border bg-card shadow-2xl sm:rounded-[24px]"
            >
                <div className="border-b border-border px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h3 className="text-[14px] font-semibold text-foreground">Build from real config</h3>
                            <p className="mt-0.5 text-[12px] text-text-secondary">
                                The tables this organization actually has. Nothing here is invented.
                                {payload?.summary
                                    ? ` ${payload.summary.tables_with_data} of ${payload.summary.tables_present} hold data.`
                                    : ''}
                            </p>
                        </div>
                        <button type="button" onClick={onClose} className="text-[12px] text-text-tertiary hover:text-foreground">
                            Close
                        </button>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
                            <input
                                value={query}
                                onChange={(e) => onQuery(e.target.value)}
                                placeholder="Filter by table, module or purpose"
                                className="w-full rounded-lg border border-border bg-card-tint py-2 pl-8 pr-3 text-[12.5px] text-foreground placeholder:text-text-tertiary focus:border-primary/40 focus:outline-none"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={onRefresh}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2 text-[11.5px] font-medium text-text-secondary hover:text-foreground"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                            Rescan
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-3">
                    {loading && !payload && (
                        <p className="py-10 text-center text-[12.5px] text-text-tertiary">Scanning this organization&apos;s schema…</p>
                    )}
                    {!loading && payload && payload.tables.length === 0 && (
                        <p className="py-10 text-center text-[12.5px] text-text-tertiary">
                            {payload.note ?? 'No catalogued tables were reachable for this organization.'}
                        </p>
                    )}
                    {grouped.map(([domain, rows]) => (
                        <section key={domain} className="mb-4">
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                                    {moduleLabel.get(domain) ?? domain}
                                </h4>
                                <button
                                    type="button"
                                    onClick={() => onAdd(rows.filter((r) => r.has_data && !alreadyBound.has(r.name)))}
                                    className="text-[11px] font-medium text-primary hover:underline"
                                >
                                    Add populated tables
                                </button>
                            </div>
                            <ul className="overflow-hidden rounded-[12px] border border-border">
                                {rows.map((r) => {
                                    const bound = alreadyBound.has(r.name);
                                    const on = picked.has(r.name);
                                    return (
                                        <li
                                            key={r.name}
                                            className={`flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-0 ${
                                                bound ? 'bg-muted/60' : on ? 'bg-primary/5' : 'bg-card'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={on}
                                                disabled={bound}
                                                onChange={() => toggle(r.name)}
                                                aria-label={`Add ${r.name}`}
                                                className="h-3.5 w-3.5 accent-[var(--primary)]"
                                            />
                                            <div className="min-w-0 flex-1">
                                                <p className="font-mono text-[12px] font-medium text-foreground">{r.name}</p>
                                                <p className="truncate text-[11px] text-text-tertiary">{r.purpose}</p>
                                            </div>
                                            <span className="shrink-0 text-[10.5px] text-text-tertiary">
                                                {r.rows_estimate != null ? `~${r.rows_estimate.toLocaleString()} rows` : 'no count'}
                                            </span>
                                            <span
                                                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                                                    r.suggested_access === 'write'
                                                        ? 'bg-secondary/10 text-secondary'
                                                        : 'bg-primary/10 text-primary'
                                                }`}
                                            >
                                                {r.suggested_access}
                                            </span>
                                            {bound && <span className="shrink-0 text-[10.5px] text-text-tertiary">bound</span>}
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    ))}
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
                    <span className="text-[11.5px] text-text-tertiary">
                        {picked.size} selected · added to the draft, not saved until you press Save bundle.
                    </span>
                    <button
                        type="button"
                        onClick={addPicked}
                        disabled={picked.size === 0}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-text-inverse transition-colors hover:bg-primary-dark disabled:opacity-40"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Add to bundle
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
}

/* ==========================================================================
 * Shared small pieces
 * ========================================================================== */

function Notice({ tone, text }: { tone: 'ok' | 'warn' | 'error'; text: string }) {
    const cls =
        tone === 'ok'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : tone === 'warn'
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-rose-200 bg-rose-50 text-rose-700';
    return <div className={`rounded-[12px] border px-3.5 py-2 text-[12px] leading-relaxed ${cls}`}>{text}</div>;
}

export function NotProvisioned({ migration, onRetry }: { migration: string; onRetry?: () => void }) {
    return (
        <div className="rounded-[18px] border border-border bg-card-tint px-5 py-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <Bot className="h-5 w-5 text-text-tertiary" />
            </div>
            <p className="mt-3 text-[13px] font-semibold text-foreground">Not provisioned yet</p>
            <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-text-secondary">
                The agent runtime tables are not in this database yet. Run migration{' '}
                <span className="font-mono text-text-primary">{migration}</span> and this panel fills in on its own.
            </p>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-text-secondary hover:text-foreground"
                >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Check again
                </button>
            )}
        </div>
    );
}
