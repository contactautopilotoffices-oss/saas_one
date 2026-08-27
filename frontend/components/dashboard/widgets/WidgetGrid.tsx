'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    DndContext, DragEndEvent, DragOverlay, DragStartEvent, KeyboardSensor,
    PointerSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core';
import {
    SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, LayoutGrid, Plus, RotateCcw, X } from 'lucide-react';

import {
    SIZE_SPAN, SIZE_LABEL, type Severity, type WidgetDef, type WidgetLayoutItem, type WidgetSize,
} from '@/frontend/lib/dashboard/types';
import { invalidateWidgetData } from '@/frontend/lib/dashboard/useWidgetData';
import WidgetShell from './WidgetShell';

/**
 * The customizable widget board.
 *
 * Cards behave like apps on a home screen: drag to reorder, drag the corner to resize, add
 * and remove from a picker. Layout persists per user.
 *
 * TWO DESIGN DECISIONS WORTH KNOWING
 *
 * 1. RESIZE IS NOT CONTINUOUS. Dragging the corner snaps to the four declared size classes
 *    rather than to arbitrary pixels. Free resizing produces ragged rows and widgets that
 *    have to render at sizes nobody designed for; snapping keeps every card on the grid and
 *    lets each widget ship exactly four hand-composed layouts.
 *
 * 2. AUTO-RESHUFFLE NEVER MOVES A CARD UNDER THE CURSOR. Usage-ranked reordering is applied
 *    only on mount, never mid-session, and never to a card the user has explicitly placed
 *    or resized. A board that rearranges itself while you are reading it is hostile — the
 *    ranking is a starting position, not a live animation.
 */

interface Props {
    orgId: string;
    widgets: WidgetDef[];
    layout: WidgetLayoutItem[];
    onLayoutChange: (next: WidgetLayoutItem[]) => void;
    onResetLayout?: () => void;
    /** Fired when a card is opened/interacted with, so usage ranking can learn. */
    onWidgetUsed?: (widgetId: string) => void;
}

const COL_CLASS: Record<number, string> = {
    1: 'col-span-1',
    2: 'col-span-1 sm:col-span-2',
    4: 'col-span-1 sm:col-span-2 xl:col-span-4',
};
const ROW_CLASS: Record<number, string> = { 1: 'row-span-1', 2: 'row-span-2' };

/** Next size in the cycle, used by the keyboard-accessible resize control. */
function nextSize(current: WidgetSize, allowed: WidgetSize[]): WidgetSize {
    const order: WidgetSize[] = ['sm', 'md', 'lg', 'xl'];
    const ring = order.filter(s => allowed.includes(s));
    if (ring.length < 2) return current;
    return ring[(ring.indexOf(current) + 1) % ring.length];
}

/** Map a pointer drag delta onto the nearest allowed size class. */
function sizeFromDrag(start: WidgetSize, dx: number, dy: number, allowed: WidgetSize[]): WidgetSize {
    const base = SIZE_SPAN[start];
    // ~230px per column, ~110px per row — close enough that the snap feels direct.
    const targetCol = Math.max(1, Math.min(4, Math.round(base.col + dx / 230)));
    const targetRow = Math.max(1, Math.min(2, Math.round(base.row + dy / 110)));

    let best = start;
    let bestCost = Infinity;
    for (const s of allowed) {
        const span = SIZE_SPAN[s];
        const cost = Math.abs(span.col - targetCol) + Math.abs(span.row - targetRow);
        if (cost < bestCost) { bestCost = cost; best = s; }
    }
    return best;
}

interface CardProps {
    def: WidgetDef;
    item: WidgetLayoutItem;
    orgId: string;
    editing: boolean;
    /** True on exactly one card board-wide — the severity arbiter's pick. */
    lead: boolean;
    onSize: (id: string, size: WidgetSize) => void;
    onRemove: (id: string) => void;
    onUsed?: (id: string) => void;
    onReportSeverity?: (id: string, sev: Severity) => void;
}

function SortableCard({ def, item, orgId, editing, lead, onSize, onRemove, onUsed, onReportSeverity }: CardProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: item.widget_id, disabled: !editing });

    const [severity, setSeverity] = useState<Severity>('ok');
    const [headline, setHeadline] = useState<string | null>(null);
    const [fetchedAt, setFetchedAt] = useState<number | null>(null);
    const resizeRef = useRef<{ x: number; y: number; from: WidgetSize } | null>(null);

    const Body = useMemo(() => React.lazy(def.load), [def]);
    const span = SIZE_SPAN[item.size];

    const handleSeverity = useCallback((sev: Severity) => {
        setSeverity(sev);
        onReportSeverity?.(item.widget_id, sev);
    }, [item.widget_id, onReportSeverity]);

    const onResizeStart = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        resizeRef.current = { x: e.clientX, y: e.clientY, from: item.size };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

        const move = (ev: PointerEvent) => {
            const s = resizeRef.current;
            if (!s) return;
            const next = sizeFromDrag(s.from, ev.clientX - s.x, ev.clientY - s.y, def.sizes);
            if (next !== item.size) onSize(item.widget_id, next);
        };
        const up = () => {
            resizeRef.current = null;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    }, [item.size, item.widget_id, def.sizes, onSize]);

    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 40 : undefined }}
            className={`${COL_CLASS[span.col]} ${ROW_CLASS[span.row]} relative min-h-0`}
            onClick={() => onUsed?.(def.id)}
        >
            <WidgetShell
                title={def.title}
                icon={<def.icon />}
                severity={severity}
                size={item.size}
                headline={headline}
                href={def.href?.(orgId)}
                fetchedAt={fetchedAt}
                lead={lead}
                isDragging={isDragging}
                dragHandleProps={editing ? { ...attributes, ...listeners } as React.HTMLAttributes<HTMLElement> : undefined}
                onResize={editing && def.sizes.length > 1 ? onResizeStart : undefined}
            >
                <React.Suspense fallback={<div className="h-full rounded-lg bg-muted/50 animate-pulse" />}>
                    <Body orgId={orgId} size={item.size} onSeverity={handleSeverity}
                        onHeadline={setHeadline} onFetchedAt={setFetchedAt} />
                </React.Suspense>
            </WidgetShell>

            {editing && (
                <div className="absolute -top-2 -right-2 flex items-center gap-1 z-10">
                    {def.sizes.length > 1 && (
                        <button
                            type="button"
                            onClick={() => onSize(item.widget_id, nextSize(item.size, def.sizes))}
                            className="w-6 h-6 rounded-full bg-surface border border-border shadow-sm
                                       flex items-center justify-center text-[9px] font-black text-text-secondary
                                       hover:text-primary hover:border-primary transition-colors"
                            aria-label={`Change size of ${def.title} (currently ${SIZE_LABEL[item.size]})`}
                            title={`Size: ${SIZE_LABEL[item.size]}`}
                        >
                            {item.size.toUpperCase()}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => onRemove(item.widget_id)}
                        className="w-6 h-6 rounded-full bg-surface border border-border shadow-sm
                                   flex items-center justify-center text-text-tertiary
                                   hover:text-[var(--error)] hover:border-[var(--error)] transition-colors"
                        aria-label={`Remove ${def.title}`}
                    >
                        <X className="w-3 h-3" />
                    </button>
                </div>
            )}
        </div>
    );
}

export default function WidgetGrid({
    orgId, widgets, layout, onLayoutChange, onResetLayout, onWidgetUsed,
}: Props) {
    const [editing, setEditing] = useState(false);
    const [picking, setPicking] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [severities, setSeverities] = useState<Record<string, Severity>>({});

    const byId = useMemo(() => new Map(widgets.map(w => [w.id, w])), [widgets]);

    const visible = useMemo(
        () => layout.filter(l => l.is_visible && byId.has(l.widget_id))
            .sort((a, b) => a.position - b.position),
        [layout, byId],
    );

    /* Severity arbitration (glass-ambient.md B1/B2 — "Arbitration"): at most
       ONE element on the board may loop an animation. The lead is the
       highest-severity card; ties break by board position. Every other signal
       is static, so a looping rim always means "this one, now". */
    const reportSeverity = useCallback((id: string, sev: Severity) => {
        setSeverities(prev => (prev[id] === sev ? prev : { ...prev, [id]: sev }));
    }, []);

    const SEV_RANK: Record<Severity, number> = { ok: 0, info: 1, warn: 2, critical: 3 };
    const leadId = useMemo(() => {
        let best: { id: string; rank: number; pos: number } | null = null;
        for (const item of visible) {
            const rank = SEV_RANK[severities[item.widget_id] ?? 'ok'];
            if (rank === 0) continue;
            if (!best || rank > best.rank || (rank === best.rank && item.position < best.pos)) {
                best = { id: item.widget_id, rank, pos: item.position };
            }
        }
        return best?.id ?? null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, severities]);

    const hidden = useMemo(
        () => widgets.filter(w => !visible.some(v => v.widget_id === w.id)),
        [widgets, visible],
    );

    const sensors = useSensors(
        // 6px activation distance so a click on a card link is never read as a drag.
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const handleDragEnd = useCallback((e: DragEndEvent) => {
        setActiveId(null);
        const { active, over } = e;
        if (!over || active.id === over.id) return;

        const ids = visible.map(v => v.widget_id);
        const from = ids.indexOf(String(active.id));
        const to = ids.indexOf(String(over.id));
        if (from < 0 || to < 0) return;

        const reordered = arrayMove(visible, from, to);
        const positions = new Map(reordered.map((v, i) => [v.widget_id, i]));

        onLayoutChange(layout.map(l =>
            positions.has(l.widget_id)
                // Moving a card pins it: the user has expressed an opinion, so usage
                // ranking must never override it on a later visit.
                ? { ...l, position: positions.get(l.widget_id)!, is_pinned: true }
                : l,
        ));
    }, [visible, layout, onLayoutChange]);

    const setSize = useCallback((id: string, size: WidgetSize) => {
        onLayoutChange(layout.map(l => l.widget_id === id ? { ...l, size, is_pinned: true } : l));
    }, [layout, onLayoutChange]);

    const remove = useCallback((id: string) => {
        onLayoutChange(layout.map(l => l.widget_id === id ? { ...l, is_visible: false } : l));
    }, [layout, onLayoutChange]);

    const add = useCallback((def: WidgetDef) => {
        const maxPos = layout.reduce((m, l) => Math.max(m, l.position), -1);
        const existing = layout.find(l => l.widget_id === def.id);
        onLayoutChange(existing
            ? layout.map(l => l.widget_id === def.id
                ? { ...l, is_visible: true, position: maxPos + 1, is_pinned: true } : l)
            : [...layout, {
                widget_id: def.id, size: def.defaultSize,
                position: maxPos + 1, is_visible: true, is_pinned: true,
            }]);
        setPicking(false);
    }, [layout, onLayoutChange]);

    // Leaving edit mode should not strand the picker open.
    useEffect(() => { if (!editing) setPicking(false); }, [editing]);

    const activeDef = activeId ? byId.get(activeId) : null;

    return (
        <section aria-label="Dashboard widgets">
            <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                    <LayoutGrid className="w-4 h-4 text-text-tertiary flex-none" />
                    <h2 className="text-sm font-black text-text-primary truncate">Operations board</h2>
                    {editing && (
                        <span className="text-[10px] font-bold text-text-tertiary hidden sm:inline">
                            Drag to reorder · drag a corner or tap the size badge to resize
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-1.5 flex-none">
                    <button
                        type="button"
                        onClick={() => { invalidateWidgetData('/api/'); }}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-text-secondary
                                   hover:bg-muted transition-colors flex items-center gap-1.5"
                        aria-label="Refresh all widgets"
                    >
                        <RotateCcw className="w-3 h-3" /> Refresh
                    </button>

                    {editing && hidden.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setPicking(p => !p)}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-primary
                                       hover:bg-primary/10 transition-colors flex items-center gap-1.5"
                        >
                            <Plus className="w-3 h-3" /> Add widget
                        </button>
                    )}

                    {editing && onResetLayout && (
                        <button
                            type="button"
                            onClick={onResetLayout}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-text-secondary
                                       hover:bg-muted transition-colors"
                        >
                            Reset
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={() => setEditing(e => !e)}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-colors flex items-center gap-1.5
                            ${editing
                                ? 'bg-primary text-white'
                                : 'text-text-secondary hover:bg-muted'}`}
                    >
                        {editing ? <><Check className="w-3 h-3" /> Done</> : 'Customise'}
                    </button>
                </div>
            </div>

            {picking && (
                <div className="mb-3 p-3 rounded-2xl border border-border bg-surface-elevated">
                    <p className="text-[10px] font-black uppercase tracking-widest text-text-tertiary mb-2">
                        Add a widget
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                        {hidden.map(def => (
                            <button
                                key={def.id}
                                type="button"
                                onClick={() => add(def)}
                                className="flex items-start gap-2 p-2.5 rounded-xl border border-border bg-surface
                                           text-left hover:border-primary hover:bg-primary/5 transition-colors"
                            >
                                <def.icon className="w-3.5 h-3.5 text-primary mt-0.5 flex-none" />
                                <span className="min-w-0">
                                    <span className="block text-[11px] font-black text-text-primary truncate">
                                        {def.title}
                                    </span>
                                    <span className="block text-[10px] font-medium text-text-tertiary line-clamp-2">
                                        {def.description}
                                    </span>
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
                onDragEnd={handleDragEnd}
                onDragCancel={() => setActiveId(null)}
            >
                <SortableContext items={visible.map(v => v.widget_id)} strategy={rectSortingStrategy}>
                    <div
                        className="ops-grid-canvas grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 auto-rows-[152px]"
                        style={{ gridAutoFlow: 'row dense' }}
                    >
                        {visible.map(item => {
                            const def = byId.get(item.widget_id);
                            if (!def) return null;
                            return (
                                <SortableCard
                                    key={item.widget_id}
                                    def={def}
                                    item={item}
                                    orgId={orgId}
                                    editing={editing}
                                    lead={item.widget_id === leadId}
                                    onSize={setSize}
                                    onRemove={remove}
                                    onUsed={onWidgetUsed}
                                    onReportSeverity={reportSeverity}
                                />
                            );
                        })}
                    </div>
                </SortableContext>

                <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.22,1,0.36,1)' }}>
                    {activeDef && (
                        <div className="w-card h-full opacity-90 p-4" data-dragging="true">
                            <div className="flex items-center gap-2">
                                <activeDef.icon className="w-3.5 h-3.5 text-primary" />
                                <span className="w-title">{activeDef.title}</span>
                            </div>
                        </div>
                    )}
                </DragOverlay>
            </DndContext>

            {visible.length === 0 && (
                <div className="py-16 text-center">
                    <p className="text-sm font-bold text-text-secondary">Your board is empty.</p>
                    <button
                        type="button"
                        onClick={() => { setEditing(true); setPicking(true); }}
                        className="mt-2 text-[11px] font-black text-primary hover:underline"
                    >
                        Add a widget
                    </button>
                </div>
            )}
        </section>
    );
}
