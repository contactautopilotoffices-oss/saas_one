'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, CircleCheck, Moon, Search, Wrench, X } from 'lucide-react';
import type { LabNavItem } from './nav';
import type { ScreenId } from './types';
import type { LabModel } from './useLabModel';
import type { Period, Technician } from './types';
import { SAMPLE_TEAM } from './sample';
import { Avatar, SampleBadge, cx } from './ui';

/** Design tokens each design hands to DesignFrame. Shared components read them as CSS variables. */
export interface LabTheme {
    font: string;
    page: string;
    surface: string;
    tile: string;
    border: string;
    borderStrong: string;
    grid: string;
    text: string;
    text2: string;
    text3: string;
    primary: string;
    onPrimary: string;
    tint: string;
    ramp: [string, string, string, string];
    radius: string;
    radiusSm: string;
    chipRadius: string;
    btnRadius: string;
    focus: string;
    skeletonA: string;
    skeletonB: string;
    tooltipBg: string;
    tooltipFg: string;
}

export function themeVars(t: LabTheme): React.CSSProperties {
    return {
        '--lab-text': t.text,
        '--lab-text2': t.text2,
        '--lab-text3': t.text3,
        '--lab-surface': t.surface,
        '--lab-tile': t.tile,
        '--lab-border': t.border,
        '--lab-border-strong': t.borderStrong,
        '--lab-grid': t.grid,
        '--lab-primary': t.primary,
        '--lab-on-primary': t.onPrimary,
        '--lab-tint': t.tint,
        '--lab-ramp-0': t.ramp[0],
        '--lab-ramp-1': t.ramp[1],
        '--lab-ramp-2': t.ramp[2],
        '--lab-ramp-3': t.ramp[3],
        '--lab-radius': t.radius,
        '--lab-radius-sm': t.radiusSm,
        '--lab-chip-radius': t.chipRadius,
        '--lab-btn-radius': t.btnRadius,
        '--lab-focus': t.focus,
        '--lab-skel-a': t.skeletonA,
        '--lab-skel-b': t.skeletonB,
        '--lab-tooltip-bg': t.tooltipBg,
        '--lab-tooltip-fg': t.tooltipFg,
        fontFamily: t.font,
        background: t.page,
        color: t.text,
    } as React.CSSProperties;
}

export interface DrawerSkin {
    panel: React.CSSProperties;
    overlay?: React.CSSProperties;
    titleClass?: string;
    confirm: React.CSSProperties;
    radio: string;
    tabActive: React.CSSProperties;
    tabIdle?: React.CSSProperties;
    input?: React.CSSProperties;
    row?: React.CSSProperties;
    rowSelected?: React.CSSProperties;
}

export function DesignFrame({ theme, lab, drawer, children, className }: {
    theme: LabTheme; lab: LabModel; drawer: DrawerSkin; children: React.ReactNode; className?: string;
}) {
    return (
        <div className={cx('lab-root relative min-h-[calc(100vh-var(--lab-bar-h))]', className)} style={themeVars(theme)}>
            {children}
            <AssignDrawer lab={lab} skin={drawer} />
            <Toast message={lab.toastMessage} />
        </div>
    );
}

function Toast({ message }: { message: string | null }) {
    return (
        <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4">
            {message && (
                <div className="pointer-events-auto max-w-[520px] px-4 py-3 text-[13.5px] font-medium shadow-2xl"
                    style={{ background: 'var(--lab-tooltip-bg)', color: 'var(--lab-tooltip-fg)', borderRadius: 'var(--lab-radius-sm)' }}>
                    {message}
                </div>
            )}
        </div>
    );
}

const SHIFT_META: Record<Technician['shift'], { label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }> = {
    on_a_ticket: { label: 'On a ticket', icon: Wrench },
    free: { label: 'Free', icon: CircleCheck },
    off_shift: { label: 'Off shift', icon: Moon },
};

export function ShiftLabel({ shift, since, dark }: { shift: Technician['shift']; since?: string | null; dark?: boolean }) {
    const meta = SHIFT_META[shift];
    const Icon = meta.icon;
    return (
        <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: dark ? 'rgba(255,255,255,0.8)' : 'var(--lab-text2)' }}>
            <Icon className="h-3.5 w-3.5" style={{ color: dark ? '#FFFFFF' : shift === 'off_shift' ? 'var(--lab-text3)' : 'var(--lab-primary)' }} />
            {meta.label}{since && shift !== 'off_shift' ? ` since ${since}` : ''}
        </span>
    );
}

/** Assign technician drawer. Slides in from the right. Confirming is preview only. */
function AssignDrawer({ lab, skin }: { lab: LabModel; skin: DrawerSkin }) {
    const open = lab.drawerOpen;
    const { closeDrawer } = lab;
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, closeDrawer]);

    return (
        <div aria-hidden={!open} className={cx('fixed inset-0 z-[70] overflow-hidden', open ? '' : 'pointer-events-none')}>
            <div
                className="absolute inset-0 transition-opacity duration-300"
                style={{ background: 'rgba(10,12,16,0.36)', opacity: open ? 1 : 0, ...skin.overlay }}
                onClick={closeDrawer}
            />
            <aside
                role="dialog"
                aria-modal="true"
                aria-label="Assign technician"
                className="absolute bottom-0 right-0 top-0 flex w-full max-w-[440px] flex-col transition-transform duration-300 ease-out"
                style={{ transform: open ? 'translateX(0)' : 'translateX(104%)', ...skin.panel }}
            >
                <DrawerBody key={lab.drawerKey} lab={lab} skin={skin} open={open} />
            </aside>
        </div>
    );
}

function DrawerBody({ lab, skin, open }: { lab: LabModel; skin: DrawerSkin; open: boolean }) {
    const [tab, setTab] = useState<'shift' | 'all'>('shift');
    const [query, setQuery] = useState('');
    const [chosen, setChosen] = useState<string | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const ticket = lab.selected;

    useEffect(() => {
        if (!open) return;
        const id = window.setTimeout(() => searchRef.current?.focus(), 60);
        return () => window.clearTimeout(id);
    }, [open]);

    const people = useMemo(() => {
        const q = query.trim().toLowerCase();
        return SAMPLE_TEAM
            .filter(p => (tab === 'shift' ? p.shift !== 'off_shift' : true))
            .filter(p => !q || `${p.name} ${p.skill}`.toLowerCase().includes(q));
    }, [tab, query]);

    const chosenPerson = SAMPLE_TEAM.find(p => p.id === chosen) ?? null;
    const onShiftCount = SAMPLE_TEAM.filter(p => p.shift !== 'off_shift').length;

    return (
        <>
            <div className="flex items-start justify-between gap-[12px] px-6 pb-4 pt-6">
                <div className="min-w-0">
                    <div className={cx('text-[20px] font-bold tracking-tight', skin.titleClass)}>Assign technician</div>
                    {ticket && (
                        <div className="mt-1 truncate text-[13px]" style={{ color: 'var(--lab-text2)' }}>
                            {ticket.number} · {ticket.title}
                        </div>
                    )}
                </div>
                <button type="button" onClick={lab.closeDrawer} aria-label="Close" className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: 'var(--lab-tile)' }}>
                    <X className="h-4.5 w-4.5" />
                </button>
            </div>
            <div className="px-6">
                <label className="flex h-11 items-center gap-[8px] px-3.5" style={{ border: '1px solid var(--lab-border)', borderRadius: 'var(--lab-radius-sm)', ...skin.input }}>
                    <Search className="h-4 w-4" style={{ color: 'var(--lab-text3)' }} aria-hidden />
                    <input
                        ref={searchRef}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search by name or skill"
                        aria-label="Search technicians"
                        className="h-full w-full bg-transparent text-[14px] outline-none placeholder:text-[var(--lab-text3)]"
                    />
                </label>
                <div role="tablist" className="mt-4 flex gap-[4px] p-[4px]" style={{ background: 'var(--lab-tile)', borderRadius: 'var(--lab-chip-radius)' }}>
                    {([['shift', `On shift (${onShiftCount})`], ['all', `All members (${SAMPLE_TEAM.length})`]] as const).map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={tab === id}
                            onClick={() => setTab(id)}
                            className="h-10 flex-1 text-[13.5px] font-semibold"
                            style={{ borderRadius: 'var(--lab-chip-radius)', ...(tab === id ? skin.tabActive : { color: 'var(--lab-text2)', ...skin.tabIdle }) }}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <div className="mt-3 flex items-center justify-between">
                    <span className="text-[12px] font-medium" style={{ color: 'var(--lab-text3)' }}>{people.length} people</span>
                    <SampleBadge />
                </div>
            </div>
            <div role="radiogroup" aria-label="Technicians" className="mt-2 flex-1 overflow-y-auto px-4 pb-4">
                {people.length === 0 && (
                    <div className="px-2 py-10 text-center text-[13.5px]" style={{ color: 'var(--lab-text2)' }}>No one matches “{query}”.</div>
                )}
                {people.map(p => {
                    const selected = chosen === p.id;
                    return (
                        <button
                            key={p.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setChosen(p.id)}
                            className="mb-1 flex min-h-[64px] w-full items-center gap-[12px] px-3 py-2.5 text-left transition-colors"
                            style={{ borderRadius: 'var(--lab-radius-sm)', ...(selected ? skin.rowSelected : skin.row) }}
                        >
                            <Avatar name={p.name} size={40} />
                            <span className="min-w-0 flex-1">
                                <span className="block text-[14.5px] font-semibold">{p.name}</span>
                                <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                                    <span className="text-[12.5px]" style={{ color: 'var(--lab-text2)' }}>{p.skill}</span>
                                    <ShiftLabel shift={p.shift} since={p.since} />
                                </span>
                            </span>
                            <span className="text-right text-[12px] leading-tight" style={{ color: 'var(--lab-text2)' }}>
                                <span className="block text-[15px] font-semibold tabular-nums" style={{ color: 'var(--lab-text)' }}>{p.openTickets}</span>
                                open
                            </span>
                            <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-full"
                                style={{ border: `2px solid ${selected ? skin.radio : 'var(--lab-border-strong)'}` }}>
                                {selected && <span className="h-2.5 w-2.5 rounded-full" style={{ background: skin.radio }} />}
                            </span>
                        </button>
                    );
                })}
            </div>
            <div className="px-6 pb-6 pt-3" style={{ borderTop: '1px solid var(--lab-border)' }}>
                <button
                    type="button"
                    disabled={!chosenPerson}
                    onClick={() => {
                        if (!chosenPerson) return;
                        lab.closeDrawer();
                        lab.toast(`Preview only. In the app this assigns ${chosenPerson.name}. Nothing was saved.`);
                    }}
                    className="flex h-12 w-full items-center justify-center gap-[8px] text-[15px] font-semibold transition-opacity disabled:opacity-40"
                    style={skin.confirm}
                >
                    <Check className="h-4.5 w-4.5" aria-hidden />
                    {chosenPerson ? `Assign ${chosenPerson.name}` : 'Choose a technician'}
                </button>
            </div>
        </>
    );
}

/** Today / Month / All switch. Styling is passed in by the design. */
export function PeriodSwitch({ lab, track, thumb, idleText, activeText, counts, className, size = 'md' }: {
    lab: LabModel; track: React.CSSProperties; thumb: React.CSSProperties; idleText: string; activeText: string; counts?: boolean; className?: string; size?: 'sm' | 'md';
}) {
    const opts: { id: Period; label: string }[] = [
        { id: 'today', label: 'Today' }, { id: 'month', label: 'Month' }, { id: 'all', label: 'All' },
    ];
    return (
        <div role="radiogroup" aria-label="Period" className={cx('inline-flex items-center p-[4px]', className)} style={track}>
            {opts.map(o => {
                const on = lab.period === o.id;
                return (
                    <button
                        key={o.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => lab.setPeriod(o.id)}
                        className={cx('inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-colors', size === 'sm' ? 'h-8 px-3 text-[12.5px]' : 'h-10 px-4 text-[13.5px]')}
                        style={on ? { ...thumb, color: activeText } : { color: idleText }}
                    >
                        {o.label}
                        {counts && <span className="tabular-nums opacity-70">{lab.periodCounts[o.id].toLocaleString('en-IN')}</span>}
                    </button>
                );
            })}
        </div>
    );
}

/** Property switcher. Org-wide roles also get "All properties". */
export function PropertySwitcher({ lab, className, style, menuAlign = 'left', compact }: {
    lab: LabModel; className?: string; style?: React.CSSProperties; menuAlign?: 'left' | 'right'; compact?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [open]);
    const options = [...(lab.canAllProperties ? [{ id: 'all', name: 'All properties' }] : []), ...lab.properties];
    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                className={cx('inline-flex h-10 max-w-[260px] items-center gap-[8px] font-semibold', className)}
                style={style}
            >
                <Building2 className="h-4 w-4 shrink-0" style={{ opacity: 0.8 }} aria-hidden />
                <span className={cx('truncate', compact && 'hidden sm:inline')}>{lab.propertyName}</span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
            </button>
            {open && (
                <div role="listbox" aria-label="Property"
                    className={cx('absolute top-[calc(100%+6px)] z-50 min-w-[240px] p-1.5 shadow-xl', menuAlign === 'right' ? 'right-0' : 'left-0')}
                    style={{ background: 'var(--lab-surface)', border: '1px solid var(--lab-border)', borderRadius: 'var(--lab-radius-sm)', color: 'var(--lab-text)' }}>
                    {options.map(o => (
                        <button key={o.id} type="button" role="option" aria-selected={o.id === lab.propertyId}
                            onClick={() => { lab.setPropertyId(o.id); setOpen(false); }}
                            className="flex min-h-10 w-full items-center justify-between gap-[12px] rounded-lg px-3 text-left text-[13.5px] hover:bg-[var(--lab-tile)]">
                            {o.name}
                            {o.id === lab.propertyId && <Check className="h-4 w-4" aria-hidden />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/** Phone layout: every module the role can use, in a bottom sheet behind a "More" button. */
export function MobileNavSheet({ lab, open, onClose, screen, setScreen, panelStyle, activeStyle }: {
    lab: LabModel; open: boolean; onClose: () => void; screen: ScreenId; setScreen: (s: ScreenId) => void;
    panelStyle?: React.CSSProperties; activeStyle: React.CSSProperties;
}) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onClose]);
    if (!open) return null;
    const go = (item: LabNavItem) => {
        onClose();
        if (item.screen) setScreen(item.screen);
        else lab.previewAction(`Open ${item.label}`);
    };
    return (
        <div className="fixed inset-0 z-[65] md:hidden">
            <div className="absolute inset-0 bg-black/35" onClick={onClose} />
            <div role="dialog" aria-modal="true" aria-label="All modules" className="absolute inset-x-0 bottom-0 max-h-[78vh] overflow-y-auto p-[16px] pb-8"
                style={{ background: 'var(--lab-surface)', borderRadius: '24px 24px 0 0', color: 'var(--lab-text)', ...panelStyle }}>
                <div className="mb-3 flex items-center justify-between">
                    <span className="text-[16px] font-bold">All modules</span>
                    <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'var(--lab-tile)' }}>
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="grid grid-cols-3 gap-[8px]">
                    {lab.nav.map(item => {
                        const Icon = item.icon;
                        const on = !!item.screen && (item.screen === screen || (item.screen === 'tickets' && screen === 'detail'));
                        return (
                            <button key={item.id} type="button" onClick={() => go(item)} aria-current={on ? 'page' : undefined}
                                className="flex min-h-[76px] flex-col items-center justify-center gap-1.5 px-2 text-center text-[12.5px] font-medium"
                                style={{ borderRadius: 'var(--lab-radius-sm)', background: 'var(--lab-tile)', ...(on ? activeStyle : {}) }}>
                                <Icon className="h-5 w-5" aria-hidden />
                                {item.label}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
