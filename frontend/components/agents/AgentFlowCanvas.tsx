'use client';

/**
 * EDITABLE AGENT FLOW — drag, connect, rewire, save as a version.
 * -----------------------------------------------------------------------------
 * Replaces the read-only column layout. Three lessons taken from the POS
 * workflow builder rather than reinvented:
 *
 * 1. ONE REGISTRY, READ THREE TIMES. The palette, the model's vocabulary and the
 *    thing Save writes are the same lists — AGENT_TABLE_CATALOG and the tool
 *    registry — not three copies that drift. A table added to the catalog appears
 *    in the palette without touching this file.
 *
 * 2. SAVE CREATES A VERSION, IT DOES NOT APPLY. Saving writes the next
 *    oem_agent_bundles row. Existing versions and in-flight runs are untouched,
 *    and nothing about the agent's behaviour changes until a human promotes it.
 *
 * 3. DRAWN IS NOT ENFORCED — SAY SO. The POS builder draws Rule and Approval
 *    nodes that nothing checks at runtime. Ours has the same exposure: an
 *    `approve` step is a picture until an executor honours it. That is stated on
 *    the canvas rather than left for someone to discover in production.
 */

import { useCallback, useMemo, useState } from 'react';
import {
    Background, Controls, MiniMap, ReactFlow, addEdge, useEdgesState, useNodesState,
    type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Database, GitBranch, Globe, PenLine, Save, Send, ShieldCheck, Trash2, Wrench } from 'lucide-react';

import type { PlanStep, PlanStepKind, ToolBinding } from './AgentPlanCanvas';

/* ---- per-kind presentation, in the digest palette ------------------------ */

const KIND: Record<PlanStepKind, { label: string; Icon: typeof Database; tone: string }> = {
    resolve: { label: 'Resolve', Icon: GitBranch, tone: '#B07206' },
    search:  { label: 'Search',  Icon: Globe,     tone: '#3D5A8A' },
    fetch:   { label: 'Read',    Icon: Database,  tone: '#7A776E' },
    decide:  { label: 'Decide',  Icon: GitBranch, tone: '#6D5BA6' },
    draft:   { label: 'Draft',   Icon: PenLine,   tone: '#3D5A8A' },
    approve: { label: 'Approval',Icon: ShieldCheck,tone: '#B0442E' },
    write:   { label: 'Write',   Icon: Wrench,    tone: '#0B6E5F' },
    notify:  { label: 'Notify',  Icon: Send,      tone: '#0B6E5F' },
};

const LINE = '#E4E3DE', EDGE = '#D3D2CB', BRAND = '#16181C', MUTED = '#797E86';

type StepData = PlanStep & { onDelete?: (id: string) => void };

function StepNode({ data, selected }: NodeProps) {
    const d = data as unknown as StepData;
    const k = KIND[d.kind] ?? KIND.fetch;
    const Icon = k.Icon;
    return (
        <div style={{
            width: 216, background: '#fff', border: `1.5px solid ${selected ? k.tone : EDGE}`,
            borderRadius: 6, padding: '10px 12px', fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
            boxShadow: selected ? `0 0 0 3px ${k.tone}22` : 'none',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon size={13} color={k.tone} />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: k.tone }}>
                    {k.label}
                </span>
                {d.onDelete && (
                    <button
                        onClick={(e) => { e.stopPropagation(); d.onDelete?.(d.id); }}
                        title="Remove step"
                        style={{ marginLeft: 'auto', border: 0, background: 'none', cursor: 'pointer', color: MUTED, lineHeight: 0 }}
                    >
                        <Trash2 size={12} />
                    </button>
                )}
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: BRAND, marginTop: 5, lineHeight: 1.35 }}>{d.title}</div>
            <div style={{ fontSize: 10.5, color: MUTED, marginTop: 3 }}>{d.actor}</div>
            {d.tool && (
                <div style={{ fontSize: 10, color: MUTED, marginTop: 5, fontFamily: 'ui-monospace,monospace' }}>{d.tool}</div>
            )}
            {d.tables?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
                    {d.tables.slice(0, 3).map((t) => (
                        <span key={t} style={{
                            fontSize: 9, fontFamily: 'ui-monospace,monospace', color: MUTED,
                            background: '#F5F5F1', border: `1px solid ${LINE}`, borderRadius: 3, padding: '1px 4px',
                        }}>{t}</span>
                    ))}
                    {d.tables.length > 3 && <span style={{ fontSize: 9, color: MUTED }}>+{d.tables.length - 3}</span>}
                </div>
            )}
        </div>
    );
}

const nodeTypes = { step: StepNode };

/** Topological columns, so an imported plan opens already readable. */
function layout(steps: PlanStep[]): Record<string, { x: number; y: number }> {
    const depth = new Map<string, number>();
    steps.forEach((s) => depth.set(s.id, 0));
    for (let i = 0; i < 40; i++) {
        let moved = false;
        for (const s of steps) {
            const d = Math.max(0, ...s.needs.map((n) => (depth.has(n) ? (depth.get(n) ?? 0) + 1 : 0)));
            if (d !== depth.get(s.id)) { depth.set(s.id, d); moved = true; }
        }
        if (!moved) break;
    }
    const perCol = new Map<number, number>();
    const pos: Record<string, { x: number; y: number }> = {};
    for (const s of steps) {
        const c = depth.get(s.id) ?? 0;
        const row = perCol.get(c) ?? 0;
        perCol.set(c, row + 1);
        pos[s.id] = { x: c * 280, y: row * 150 };
    }
    return pos;
}

export interface FlowPaletteItem { kind: PlanStepKind; label: string; tool: string | null }

export default function AgentFlowCanvas({
    steps, tools, onSave, saving,
}: {
    steps: PlanStep[];
    tools: ToolBinding[];
    onSave?: (steps: PlanStep[]) => void;
    saving?: boolean;
}) {
    const pos = useMemo(() => layout(steps), [steps]);
    const [seq, setSeq] = useState(1000);

    const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
        steps.map((s) => ({ id: s.id, type: 'step', position: pos[s.id], data: s as unknown as Record<string, unknown> })),
    );
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
        steps.flatMap((s) => s.needs.map((n) => ({
            id: `${n}->${s.id}`, source: n, target: s.id, animated: false,
            style: { stroke: EDGE, strokeWidth: 1.5 },
        }))),
    );

    const removeNode = useCallback((id: string) => {
        setNodes((ns) => ns.filter((n) => n.id !== id));
        setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    }, [setNodes, setEdges]);

    const onConnect = useCallback((c: Connection) => {
        // Self-edges would render a loop nothing can execute.
        if (c.source === c.target) return;
        setEdges((es) => addEdge({ ...c, style: { stroke: EDGE, strokeWidth: 1.5 } }, es));
    }, [setEdges]);

    const addStep = (kind: PlanStepKind, tool: string | null) => {
        const id = `n${seq}`;
        setSeq((n) => n + 1);
        setNodes((ns) => ns.concat({
            id, type: 'step',
            position: { x: 40 + (ns.length % 4) * 60, y: 40 + ns.length * 24 },
            data: {
                id, title: `New ${KIND[kind].label.toLowerCase()} step`, kind, needs: [],
                tool, tables: [], actor: 'agent', produces: '', blockedBy: [],
                onDelete: removeNode,
            } as unknown as Record<string, unknown>,
        }));
    };

    /** Read the canvas back out as steps — edges are the source of `needs`. */
    const collect = (): PlanStep[] =>
        nodes.map((n) => {
            const d = n.data as unknown as PlanStep;
            return { ...d, needs: edges.filter((e) => e.target === n.id).map((e) => e.source) };
        });

    const withDelete = useMemo(
        () => nodes.map((n) => ({ ...n, data: { ...(n.data as object), onDelete: removeNode } })),
        [nodes, removeNode],
    );

    const palette: FlowPaletteItem[] = [
        { kind: 'fetch', label: 'Read a table', tool: 'db_read' },
        { kind: 'search', label: 'Search the web', tool: 'web_search' },
        { kind: 'decide', label: 'Decide', tool: null },
        { kind: 'draft', label: 'Draft', tool: 'llm' },
        { kind: 'approve', label: 'Human approval', tool: null },
        { kind: 'write', label: 'Write a record', tool: 'db_write' },
        { kind: 'notify', label: 'Email', tool: 'email' },
    ];

    const drawnApproval = nodes.some((n) => (n.data as unknown as PlanStep).kind === 'approve');

    return (
        <div className="flex flex-col gap-3">
            {/* palette — derived from the tool registry, not hardcoded elsewhere */}
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mr-1">Add step</span>
                {palette.map((p) => {
                    const t = p.tool ? tools.find((x) => x.slug === p.tool) : null;
                    const missing = t?.status === 'missing';
                    return (
                        <button key={p.label} type="button" onClick={() => addStep(p.kind, p.tool)}
                            title={missing ? `${t?.label} is not configured — the step will draw but cannot run` : undefined}
                            className={`rounded-md border px-2.5 py-1 text-[11.5px] font-medium ${missing ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-border bg-card hover:border-primary/40'}`}>
                            {p.label}{missing ? ' ·' : ''}
                        </button>
                    );
                })}
            </div>

            <div style={{ height: 460 }} className="rounded-[10px] border border-border bg-[#FBFBF9] overflow-hidden">
                <ReactFlow
                    nodes={withDelete}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    nodeTypes={nodeTypes}
                    fitView
                    proOptions={{ hideAttribution: false }}
                >
                    <Background color="#E4E3DE" gap={18} />
                    <Controls showInteractive={false} />
                    <MiniMap pannable zoomable style={{ background: '#F5F5F1' }} />
                </ReactFlow>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <button type="button" disabled={saving} onClick={() => onSave?.(collect())}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-[12px] font-semibold text-background disabled:opacity-40">
                    <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save as next version'}
                </button>
                <span className="text-[11.5px] text-text-secondary">
                    Saving creates the next version. Existing versions and in-flight runs are untouched,
                    and nothing changes about how the agent behaves until it is promoted.
                </span>
            </div>

            {drawnApproval && (
                <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-800">
                    <strong>Drawn is not enforced.</strong> The approval step saves and renders, but nothing
                    checks it at run time yet — an executor has to honour it. Treat it as intent, not a control.
                </div>
            )}
        </div>
    );
}
