'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Plus, ChevronDown, MoreHorizontal, Pencil, Copy, Star, Trash2, Save, RotateCcw, Layers } from 'lucide-react';
import { CRMSavedView, SavedViewFilters } from '@/frontend/types/crm';
import { ResolvedView, ALL_LEADS_VIEW, resolveView, resolvePeriodPreset, liveStateToFilters } from '@/frontend/lib/crm/views';
import ViewBuilder from '@/frontend/components/crm/ViewBuilder';

interface LeadViewsProps {
    activeKey: string;                                    // 'all' or a saved view id
    liveState: ResolvedView | null;                       // table's current live filters
    onSelect: (resolved: ResolvedView, id: string) => void;
}

function sig(v: ResolvedView): string {
    return JSON.stringify({ s: v.scope, q: v.search, f: v.appliedFilters, sb: v.sortBy, so: v.sortOrder });
}

export default function LeadViews({ activeKey, liveState, onSelect }: LeadViewsProps) {
    const [views, setViews] = useState<CRMSavedView[]>([]);
    const [openMenu, setOpenMenu] = useState<string | null>(null);   // view id, or '+'
    // Menus render position:fixed (anchored to the trigger) so they escape the
    // tab row's horizontal-scroll container, which clips absolute children.
    const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
    const [builder, setBuilder] = useState<{ open: boolean; mode: 'create' | 'edit'; initial?: ViewBuilderInitial }>({ open: false, mode: 'create' });
    const didInit = useRef(false);

    const fetchViews = useCallback(async (): Promise<CRMSavedView[]> => {
        try {
            const res = await fetch('/api/crm/views');
            if (!res.ok) return [];
            const d = await res.json();
            const list: CRMSavedView[] = d.views || [];
            setViews(list);
            return list;
        } catch { return []; }
    }, []);

    // Initial load; auto-open the user's default view (once).
    useEffect(() => {
        (async () => {
            const list = await fetchViews();
            if (didInit.current) return;
            didInit.current = true;
            const def = list.find(v => v.is_default);
            if (def) onSelect(resolveView(def), def.id);
        })();
    // onSelect is stable enough for a one-shot init; intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchViews]);

    const activeView = useMemo(() => views.find(v => v.id === activeKey) || null, [views, activeKey]);

    // Has the user edited filters away from the active saved view?
    const drift = useMemo(() => {
        if (!activeView || !liveState) return false;
        return sig(resolveView(activeView)) !== sig(liveState);
    }, [activeView, liveState]);

    const selectSaved = (v: CRMSavedView) => { setOpenMenu(null); onSelect(resolveView(v), v.id); };
    const selectAll = () => { setOpenMenu(null); onSelect(ALL_LEADS_VIEW, 'all'); };

    const openCreate = (initial?: ViewBuilderInitial) => { setOpenMenu(null); setBuilder({ open: true, mode: 'create', initial }); };
    const openEdit = (v: CRMSavedView) => { setOpenMenu(null); setBuilder({ open: true, mode: 'edit', initial: { id: v.id, name: v.name, icon: v.icon, color: v.color, filters: v.filters, is_default: v.is_default } }); };

    const handleSaved = async (view: CRMSavedView) => {
        const list = await fetchViews();
        const fresh = list.find(v => v.id === view.id) || view;
        onSelect(resolveView(fresh), fresh.id);
    };

    const post = async (action: string, data: Record<string, unknown>) => {
        await fetch('/api/crm/views', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, data }),
        });
    };

    const handleDuplicate = async (v: CRMSavedView) => {
        setOpenMenu(null);
        await post('create_view', { name: `${v.name} (copy)`, icon: v.icon, color: v.color, filters: v.filters });
        await fetchViews();
    };
    const handleSetDefault = async (v: CRMSavedView) => { setOpenMenu(null); await post('set_default', { id: v.id }); await fetchViews(); };
    const handleDelete = async (v: CRMSavedView) => {
        setOpenMenu(null);
        if (!confirm(`Delete the “${v.name}” view? This only removes the tab — no leads are affected.`)) return;
        await post('delete_view', { id: v.id });
        await fetchViews();
        if (activeKey === v.id) selectAll();
    };

    // Save the current (drifted) filters back onto the active view.
    const handleSaveChanges = async () => {
        if (!activeView || !liveState) return;
        await post('update_view', { id: activeView.id, filters: liveStateToFilters(liveState) });
        const list = await fetchViews();
        const fresh = list.find(v => v.id === activeView.id);
        if (fresh) onSelect(resolveView(fresh), fresh.id);
    };
    const handleReset = () => { if (activeView) onSelect(resolveView(activeView), activeView.id); };

    // Toggle a menu open at the trigger's screen position (clamped on-screen).
    const openMenuAt = (key: string, el: HTMLElement) => {
        if (openMenu === key) { setOpenMenu(null); return; }
        const r = el.getBoundingClientRect();
        const width = key === '+' ? 248 : 208;
        setMenuPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), y: r.bottom + 4 });
        setOpenMenu(key);
    };

    // "Save current filters as a view" — seed the builder from the live table state.
    const saveCurrentAs = () => {
        const initialFilters: SavedViewFilters = liveState ? liveStateToFilters(liveState) : { scope: 'all', period: { mode: 'any' } };
        openCreate({ name: '', filters: initialFilters });
    };

    const templates = useMemo<{ name: string; icon: string; filters: SavedViewFilters }[]>(() => {
        const now = new Date();
        const monthLabel = now.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
        const tm = resolvePeriodPreset('this_month', now);
        return [
            { name: 'This Month', icon: '📅', filters: { scope: 'all', period: { mode: 'rolling', preset: 'this_month', date_field: 'created_at' } } },
            { name: 'This Week', icon: '📅', filters: { scope: 'all', period: { mode: 'rolling', preset: 'this_week', date_field: 'created_at' } } },
            { name: 'Last Month', icon: '📅', filters: { scope: 'all', period: { mode: 'rolling', preset: 'last_month', date_field: 'created_at' } } },
            { name: `${monthLabel} (frozen)`, icon: '📌', filters: { scope: 'all', period: { mode: 'fixed', date_from: tm.from, date_to: tm.to, date_field: 'created_at' } } },
        ];
    }, []);

    const tabBase = 'group relative shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold whitespace-nowrap border-b-2 transition-colors';
    const tabActive = 'border-primary text-primary';
    const tabIdle = 'border-transparent text-text-secondary hover:text-text-primary';

    return (
        <div className="flex items-center gap-2 border-b border-border" data-tour="lead-views">
            {/* Click-away backdrop for any open dropdown */}
            <span className="hidden sm:inline-flex items-center gap-1.5 pr-2 text-[11px] font-bold uppercase tracking-wide text-text-tertiary shrink-0">
                <Layers className="w-3.5 h-3.5" /> Views
            </span>

            {/* Scrollable tab row */}
            <div className="flex-1 flex items-center gap-0.5 overflow-x-auto">
                {/* Built-in All Leads */}
                <button onClick={selectAll} className={`${tabBase} ${activeKey === 'all' ? tabActive : tabIdle}`}>
                    <Star className="w-3.5 h-3.5" /> All Leads
                </button>

                {/* Saved views */}
                {views.map(v => {
                    const isActive = activeKey === v.id;
                    return (
                        <button key={v.id} onClick={() => selectSaved(v)} className={`${tabBase} ${isActive ? tabActive : tabIdle}`} style={isActive && v.color ? { borderColor: v.color, color: v.color } : undefined}>
                            {v.icon && <span className="text-[13px] leading-none">{v.icon}</span>}
                            {v.name}
                            {v.is_default && <Star className="w-3 h-3 fill-current opacity-70" />}
                            <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { e.stopPropagation(); openMenuAt(v.id, e.currentTarget); }}
                                className="ml-0.5 -mr-1 p-0.5 rounded hover:bg-muted opacity-60 hover:opacity-100 cursor-pointer"
                            >
                                <MoreHorizontal className="w-3.5 h-3.5" />
                            </span>
                        </button>
                    );
                })}

                {/* + New view */}
                <button onClick={(e) => openMenuAt('+', e.currentTarget)} className={`${tabBase} ${tabIdle} shrink-0`} title="New view">
                    <Plus className="w-4 h-4" /> <ChevronDown className="w-3 h-3 opacity-60" />
                </button>
            </div>

            {/* Fixed-position menus, portaled to <body> so they escape both the
                scroll container's clipping AND the page's framer-motion transform
                (which would otherwise offset position:fixed). */}
            {openMenu && typeof document !== 'undefined' && createPortal(
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                    <div
                        className="fixed z-50 bg-surface border border-border rounded-xl shadow-xl py-1 text-sm"
                        style={{ left: menuPos?.x ?? 0, top: menuPos?.y ?? 0, width: openMenu === '+' ? 248 : 208 }}
                    >
                        {openMenu === '+' ? (
                            <>
                                <MenuItem icon={Save} label="Save current filters as…" onClick={saveCurrentAs} />
                                <MenuItem icon={Plus} label="Build a new view…" onClick={() => openCreate()} />
                                <div className="my-1 border-t border-border" />
                                <p className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-text-tertiary">Quick templates</p>
                                {templates.map(t => (
                                    <button key={t.name} onClick={() => openCreate({ name: t.name, icon: t.icon, filters: t.filters })}
                                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-surface-elevated transition-colors">
                                        <span className="text-[13px] leading-none">{t.icon}</span> {t.name}
                                    </button>
                                ))}
                            </>
                        ) : (() => {
                            const v = views.find(x => x.id === openMenu);
                            if (!v) return null;
                            return (
                                <>
                                    <MenuItem icon={Pencil} label="Rename / edit" onClick={() => openEdit(v)} />
                                    <MenuItem icon={Copy} label="Duplicate" onClick={() => handleDuplicate(v)} />
                                    <MenuItem icon={Star} label={v.is_default ? 'Default view' : 'Set as default'} onClick={() => handleSetDefault(v)} disabled={v.is_default} />
                                    <div className="my-1 border-t border-border" />
                                    <MenuItem icon={Trash2} label="Delete view" danger onClick={() => handleDelete(v)} />
                                </>
                            );
                        })()}
                    </div>
                </>,
                document.body
            )}

            {/* Drift actions for the active saved view */}
            {drift && activeView && (
                <div className="flex items-center gap-1.5 shrink-0 pl-2">
                    <button onClick={handleReset} title="Discard changes" className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-text-secondary hover:text-text-primary rounded-lg hover:bg-surface-elevated transition-colors">
                        <RotateCcw className="w-3.5 h-3.5" /> Reset
                    </button>
                    <button onClick={handleSaveChanges} title="Save these filters onto this view" className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors">
                        <Save className="w-3.5 h-3.5" /> Save changes
                    </button>
                </div>
            )}

            <ViewBuilder
                open={builder.open}
                mode={builder.mode}
                initial={builder.initial}
                onClose={() => setBuilder(b => ({ ...b, open: false }))}
                onSaved={handleSaved}
            />
        </div>
    );
}

type ViewBuilderInitial = { id?: string; name?: string; icon?: string | null; color?: string | null; filters?: SavedViewFilters; is_default?: boolean };

function MenuItem({ icon: Icon, label, onClick, danger, disabled }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors disabled:opacity-40 disabled:cursor-default ${danger ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30' : 'text-text-primary hover:bg-surface-elevated'}`}
        >
            <Icon className="w-3.5 h-3.5" /> {label}
        </button>
    );
}
