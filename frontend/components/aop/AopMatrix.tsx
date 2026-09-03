'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search, Zap, X } from 'lucide-react';
import AopCellEditor from './AopCellEditor';
import {
    AOP_GROUPS, cellKey, formatByUnit, varianceToneForKind, TONE_COLOR, TONE_TINT, toneLabel,
    type AopCell, type AopKind, type AopLineItem, type AopSite, type AopSummaryMatrix,
    type AopTotals,
} from '@/frontend/lib/aop/types';

/**
 * The AOP grid: 16 sites across, 43 line items down.
 *
 * A 700-cell table is the hard problem in this module, and the fixes are all about
 * removing things rather than adding them:
 *
 *  1. GROUPED, COLLAPSIBLE ROWS. The 43 rows are five different kinds of number that must
 *     never be added together. Grouping by kind makes that rule visible in the layout, and
 *     collapsing everything except operating cost takes the resting grid from 43 rows to
 *     34. Rent, revenue, metrics and the workbook's own roll-ups are one click away.
 *  2. BOTH AXES FROZEN. The line item stays pinned left and the site name pinned top, so
 *     a cell in the far column is still identifiable. A third frozen column on the right
 *     carries the pan-India figure for the row, which is the comparison a reader actually
 *     wants while scrolling sideways.
 *  3. ONE NUMBER PER CELL. Budget, actual and variance are a mode switch, not three
 *     columns. Three columns per site is 48 columns and unreadable; the switch keeps the
 *     grid at 16 and matches how the sheet is read anyway — one question at a time.
 *  4. RESTRAINED VARIANCE. Two tints, at 7-9% alpha, and only when a cell deviates by more
 *     than 2% of its own budget. A per-cell colour ramp would light up all 700 cells and
 *     tell you nothing about where to look. The digits themselves stay text-primary.
 *  5. COMPACT BY DEFAULT. Rs 13.31L fits a 108px column; Rs 13,31,355 does not. Full
 *     precision is a toggle, and the drawer always shows the exact figure.
 *
 * Horizontal scrolling lives on the grid container. The page body never scrolls sideways.
 */

interface Props {
    orgId: string;
    data: AopSummaryMatrix;
    /** Merges an edited cell into the parent's copy of the matrix. */
    onApplyCell: (cell: AopCell) => void;
    /** Fired once a correction is confirmed, so the parent can refresh the roll-ups. */
    onCommitted: () => void;
    onOpenSite: (siteId: string) => void;
}

type ValueMode = 'actual' | 'budget' | 'variance';

const MODES: { key: ValueMode; label: string }[] = [
    { key: 'actual', label: 'Actual' },
    { key: 'budget', label: 'Budget' },
    { key: 'variance', label: 'Variance' },
];

const LABEL_W = 224;
const TOTAL_W = 124;

/** Per-line row totals are nonsense for a rate. Summing "₹/seat" across sites means nothing. */
const isRate = (unit: string) => unit === 'INR_per_seat' || unit === 'INR_per_sqft';

export default function AopMatrix({ orgId, data, onApplyCell, onCommitted, onOpenSite }: Props) {
    const [mode, setMode] = useState<ValueMode>('actual');
    const [compact, setCompact] = useState(true);
    const [exceptionsOnly, setExceptionsOnly] = useState(false);
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState<Record<string, boolean>>(
        () => Object.fromEntries(AOP_GROUPS.map(g => [g.kind, g.defaultOpen])),
    );
    const [hoverCol, setHoverCol] = useState<string | null>(null);
    const [editing, setEditing] = useState<{ site: AopSite; lineItem: AopLineItem } | null>(null);

    const colW = compact ? 112 : 148;
    const { sites, line_items: lineItems, cells, site_totals: siteTotals, line_totals: lineTotals, grand } = data;

    const search = query.trim().toLowerCase();

    const groups = useMemo(() => {
        const toneOf = (li: AopLineItem, site: AopSite) => {
            const cell = cells[cellKey(site.id, li.id)];
            return varianceToneForKind(li.kind, cell?.budget, cell?.actual);
        };

        return AOP_GROUPS.map(group => {
            let rows = lineItems.filter(li => li.kind === group.kind);
            if (search) rows = rows.filter(li => li.name.toLowerCase().includes(search));
            if (exceptionsOnly) {
                rows = rows.filter(li => sites.some(s => toneOf(li, s) !== 'flat'));
            }
            return { ...group, rows };
        }).filter(g => g.rows.length > 0);
    }, [lineItems, sites, cells, search, exceptionsOnly]);

    // Searching implies "show me what matched" — leaving a section collapsed would hide
    // the very row the user just typed the name of.
    const isOpen = (kind: AopKind) => (search || exceptionsOnly ? true : open[kind]);

    const subtotalFor = (kind: AopKind, siteId: string): AopTotals | null => {
        const t = siteTotals[siteId];
        if (!t) return null;
        if (kind === 'cost') return t.cost;
        if (kind === 'rent') return t.rent;
        if (kind === 'revenue') return t.revenue;
        return null;
    };

    const grandFor = (kind: AopKind): AopTotals | null => {
        if (kind === 'cost') return grand.cost;
        if (kind === 'rent') return grand.rent;
        if (kind === 'revenue') return grand.revenue;
        return null;
    };

    const pick = (t: { budget: number | null; actual: number | null; saving: number | null } | undefined | null) => {
        if (!t) return null;
        if (mode === 'budget') return t.budget;
        if (mode === 'variance') return t.saving;
        return t.actual;
    };

    const tableW = LABEL_W + sites.length * colW + TOTAL_W;

    // Shared sticky styling. border-separate is required — with border-collapse the
    // borders on a sticky cell are painted by the table, not the cell, and vanish on scroll.
    const stickyLeft: React.CSSProperties = {
        position: 'sticky', left: 0, zIndex: 2, width: LABEL_W, minWidth: LABEL_W, maxWidth: LABEL_W,
    };
    const stickyRight: React.CSSProperties = {
        position: 'sticky', right: 0, zIndex: 2, width: TOTAL_W, minWidth: TOTAL_W,
    };
    const cellBase = 'px-2 py-1.5 text-right text-[11px] font-bold tabular-nums whitespace-nowrap';

    return (
        <div className="rounded-2xl border border-border bg-surface overflow-hidden">
            {/* ---- Controls ---------------------------------------------------- */}
            <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-border">
                <div className="inline-flex rounded-xl bg-muted p-0.5">
                    {MODES.map(m => (
                        <button
                            key={m.key}
                            onClick={() => setMode(m.key)}
                            className={`px-3 py-1.5 rounded-[10px] text-[11px] font-bold transition-colors ${
                                mode === m.key ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
                            }`}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>

                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Filter categories"
                        className="w-44 pl-8 pr-7 py-1.5 rounded-xl border border-border bg-surface text-[11px] font-semibold text-text-primary outline-none focus:border-primary transition-colors"
                    />
                    {query && (
                        <button
                            onClick={() => setQuery('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
                            aria-label="Clear filter"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    )}
                </div>

                <button
                    onClick={() => setExceptionsOnly(v => !v)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-colors ${
                        exceptionsOnly
                            ? 'border-primary text-primary bg-primary/5'
                            : 'border-border text-text-secondary hover:text-text-primary'
                    }`}
                    title="Hide every row that is within 2% of plan at every site"
                >
                    <Zap className="w-3.5 h-3.5" />
                    Exceptions only
                </button>

                <button
                    onClick={() => setCompact(v => !v)}
                    className="px-3 py-1.5 rounded-xl text-[11px] font-bold border border-border text-text-secondary hover:text-text-primary transition-colors"
                >
                    {compact ? 'Full figures' : 'Compact'}
                </button>

                <div className="ml-auto flex items-center gap-3 text-[10px] font-bold text-text-tertiary">
                    <span className="inline-flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded" style={{ background: TONE_TINT.under, border: '1px solid var(--border)' }} />
                        Under plan
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded" style={{ background: TONE_TINT.over, border: '1px solid var(--border)' }} />
                        Over plan
                    </span>
                </div>
            </div>

            {/* ---- Grid -------------------------------------------------------- */}
            <div
                className="overflow-auto touch-scroll"
                style={{ maxHeight: 'min(72vh, 720px)' }}
                onMouseLeave={() => setHoverCol(null)}
            >
                <table className="border-separate" style={{ borderSpacing: 0, width: tableW, tableLayout: 'fixed' }}>
                    <thead>
                        <tr>
                            <th
                                style={{ ...stickyLeft, zIndex: 4, top: 0, background: 'var(--surface)' }}
                                className="sticky text-left px-3 py-2 border-b border-r border-border"
                            >
                                <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">
                                    Cost category
                                </span>
                            </th>

                            {sites.map(site => {
                                const t = siteTotals[site.id];
                                const util = t?.utilisation_pct ?? null;
                                const over = (t?.cost.saving ?? 0) < 0;
                                return (
                                    <th
                                        key={site.id}
                                        onMouseEnter={() => setHoverCol(site.id)}
                                        onClick={() => onOpenSite(site.id)}
                                        title={`${site.name}${site.city ? ` · ${site.city}` : ''} — open site detail`}
                                        style={{
                                            position: 'sticky', top: 0, zIndex: 3, width: colW, minWidth: colW,
                                            background: hoverCol === site.id ? 'var(--surface-elevated)' : 'var(--surface)',
                                        }}
                                        className="px-2 py-2 border-b border-border text-right cursor-pointer align-bottom transition-colors"
                                    >
                                        <span className="block text-[10px] font-extrabold text-text-primary truncate leading-tight">
                                            {site.name}
                                        </span>
                                        <span
                                            className="block text-[10px] font-bold tabular-nums mt-0.5"
                                            style={{ color: over ? 'var(--error)' : 'var(--text-tertiary)' }}
                                        >
                                            {util === null ? '—' : `${util.toFixed(0)}%`}
                                        </span>
                                    </th>
                                );
                            })}

                            <th
                                style={{ ...stickyRight, zIndex: 4, top: 0, background: 'var(--surface-elevated)' }}
                                className="sticky px-2 py-2 border-b border-l border-border text-right align-bottom"
                            >
                                <span className="block text-[10px] font-black uppercase tracking-[0.1em] text-text-tertiary">
                                    All sites
                                </span>
                                <span className="block text-[10px] font-bold tabular-nums text-text-tertiary mt-0.5">
                                    {grand.utilisation_pct == null ? '—' : `${grand.utilisation_pct.toFixed(0)}%`}
                                </span>
                            </th>
                        </tr>
                    </thead>

                    <tbody>
                        {groups.map(group => {
                            const expanded = isOpen(group.kind);
                            const subtotalRow = grandFor(group.kind);

                            return (
                                <React.Fragment key={group.kind}>
                                    {/* Section heading — doubles as the collapse control. */}
                                    <tr>
                                        <td
                                            style={{ ...stickyLeft, background: 'var(--muted)' }}
                                            className="px-2 py-1.5 border-y border-r border-border"
                                        >
                                            <button
                                                onClick={() => setOpen(o => ({ ...o, [group.kind]: !o[group.kind] }))}
                                                className="flex items-center gap-1.5 w-full text-left"
                                            >
                                                {expanded
                                                    ? <ChevronDown className="w-3.5 h-3.5 text-text-secondary shrink-0" />
                                                    : <ChevronRight className="w-3.5 h-3.5 text-text-secondary shrink-0" />}
                                                <span className="text-[10px] font-black uppercase tracking-[0.1em] text-text-secondary truncate">
                                                    {group.label}
                                                </span>
                                                <span className="text-[10px] font-bold text-text-tertiary tabular-nums">
                                                    {group.rows.length}
                                                </span>
                                            </button>
                                        </td>
                                        <td
                                            colSpan={sites.length + 1}
                                            className="px-3 py-1.5 border-y border-border text-[10px] font-semibold text-text-tertiary truncate"
                                            style={{ background: 'var(--muted)' }}
                                        >
                                            {group.note}
                                        </td>
                                    </tr>

                                    {expanded && group.rows.map(li => {
                                        const rowTotal = lineTotals[li.id];
                                        return (
                                            <tr key={li.id} className="group">
                                                <td
                                                    style={stickyLeft}
                                                    className="px-3 py-1.5 border-b border-r border-border bg-surface group-hover:bg-[var(--surface-elevated)] transition-colors"
                                                >
                                                    <span className="block text-[11px] font-bold text-text-primary truncate" title={li.name}>
                                                        {li.name}
                                                    </span>
                                                </td>

                                                {sites.map(site => {
                                                    const cell = cells[cellKey(site.id, li.id)];
                                                    const tone = varianceToneForKind(li.kind, cell?.budget, cell?.actual);
                                                    const value = pick(cell);
                                                    const empty = value === null || value === undefined;
                                                    return (
                                                        <td
                                                            key={site.id}
                                                            onMouseEnter={() => setHoverCol(site.id)}
                                                            onClick={() => setEditing({ site, lineItem: li })}
                                                            title={
                                                                `${site.name} · ${li.name}\n` +
                                                                `Budget ${formatByUnit(cell?.budget, li.unit)} · ` +
                                                                `Actual ${formatByUnit(cell?.actual, li.unit)}\n` +
                                                                `${toneLabel(tone)}` +
                                                                (cell?.remarks ? `\n“${cell.remarks}”` : '')
                                                            }
                                                            className={`${cellBase} border-b border-border cursor-pointer transition-colors group-hover:bg-[var(--surface-elevated)]`}
                                                            style={{
                                                                // The tint rides as an inset shadow rather than a
                                                                // background, so the row- and column-hover backgrounds
                                                                // still show through underneath it. A background here
                                                                // would swallow the crosshair on every tinted cell.
                                                                boxShadow: tone === 'flat'
                                                                    ? undefined
                                                                    : `inset 0 0 0 9999px ${TONE_TINT[tone]}`,
                                                                background: hoverCol === site.id ? 'var(--surface-elevated)' : undefined,
                                                                color: empty ? 'var(--text-tertiary)' : 'var(--text-primary)',
                                                            }}
                                                        >
                                                            {empty ? '—' : formatByUnit(value, li.unit, compact)}
                                                            {cell?.remarks && (
                                                                <span
                                                                    className="inline-block w-1 h-1 rounded-full ml-1 align-middle"
                                                                    style={{ background: 'var(--secondary)' }}
                                                                />
                                                            )}
                                                        </td>
                                                    );
                                                })}

                                                <td
                                                    style={{ ...stickyRight, background: 'var(--surface-elevated)' }}
                                                    className={`${cellBase} border-b border-l border-border text-text-primary`}
                                                >
                                                    {isRate(li.unit) || !rowTotal
                                                        ? <span className="text-text-tertiary">—</span>
                                                        : formatByUnit(pick(rowTotal), li.unit, compact)}
                                                </td>
                                            </tr>
                                        );
                                    })}

                                    {/* Subtotal. Recomputed from the cells above, never lifted
                                        from the workbook's own TOTAL row. */}
                                    {expanded && subtotalRow && (
                                        <tr>
                                            <td
                                                style={{ ...stickyLeft, background: 'var(--surface-elevated)' }}
                                                className="px-3 py-1.5 border-b-2 border-r border-border"
                                            >
                                                <span className="text-[11px] font-extrabold text-text-primary">
                                                    {group.label} total
                                                </span>
                                            </td>
                                            {sites.map(site => {
                                                const t = subtotalFor(group.kind, site.id);
                                                const tone = varianceToneForKind(group.kind, t?.budget, t?.actual);
                                                return (
                                                    <td
                                                        key={site.id}
                                                        onMouseEnter={() => setHoverCol(site.id)}
                                                        className={`${cellBase} border-b-2 border-border`}
                                                        style={{
                                                            background: 'var(--surface-elevated)',
                                                            color: mode === 'variance' ? TONE_COLOR[tone] : 'var(--text-primary)',
                                                            fontWeight: 800,
                                                        }}
                                                    >
                                                        {t ? formatByUnit(pick(t), 'INR', compact) : '—'}
                                                    </td>
                                                );
                                            })}
                                            <td
                                                style={{ ...stickyRight, background: 'var(--muted)' }}
                                                className={`${cellBase} border-b-2 border-l border-border`}
                                            >
                                                <span
                                                    style={{
                                                        color: mode === 'variance'
                                                            ? TONE_COLOR[varianceToneForKind(group.kind, subtotalRow.budget, subtotalRow.actual)]
                                                            : 'var(--text-primary)',
                                                        fontWeight: 800,
                                                    }}
                                                >
                                                    {formatByUnit(pick(subtotalRow), 'INR', compact)}
                                                </span>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}

                        {groups.length === 0 && (
                            <tr>
                                <td colSpan={sites.length + 2} className="px-4 py-10 text-center text-xs font-semibold text-text-tertiary">
                                    {exceptionsOnly
                                        ? 'Every category is within 2% of plan at every site.'
                                        : 'No category matches that filter.'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {editing && data.month && (
                <AopCellEditor
                    orgId={orgId}
                    month={data.month}
                    site={editing.site}
                    lineItem={editing.lineItem}
                    cell={cells[cellKey(editing.site.id, editing.lineItem.id)] ?? null}
                    canEdit={data.can_edit}
                    onApply={onApplyCell}
                    onCommitted={onCommitted}
                    onClose={() => setEditing(null)}
                />
            )}
        </div>
    );
}
