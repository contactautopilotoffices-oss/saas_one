'use client';

import React from 'react';
import { ChevronDown, Search } from 'lucide-react';

/*
 * The page kit of the Recruitment screens (owner 2026-11-25, after the owner's reference HR screens): a page header with
 * real counts, white bordered 8px buttons and a solid teal primary, toolbars (search, pill dropdowns, segmented
 * controls), tables in white 12px cards with light grey headers, status pills with a dot, KPI tiles. Token classes only,
 * so the same screens follow the workspace skin, the rest of the app (the Hiring requests page) and dark mode.
 */

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export const K_BTN = `inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3.5 text-sm font-semibold text-text-primary transition-colors hover:bg-surface-elevated disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const K_BTN_PRIMARY = `inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-primary bg-primary px-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const K_BTN_DANGER = `inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-red-700 bg-red-700 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const K_BTN_DANGER_OUTLINE = `inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-red-200 bg-surface px-3.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10 ${FOCUS}`;
export const K_BTN_GHOST = `inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const K_BTN_GHOST_DANGER = `inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10 ${FOCUS}`;
export const K_ICON_BTN = `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`;
export const K_ICON_BTN_DANGER = `inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-500/10 dark:hover:text-red-400 ${FOCUS}`;

/** A white card with a hairline border and a 12px radius. */
export const K_CARD_BASE = 'rounded-xl border bg-surface';
export const K_CARD = `${K_CARD_BASE} border-border`;
/** A light grey inset inside a card. */
export const K_WELL = 'rounded-lg bg-surface-elevated';
const FIELD_BASE = 'rounded-lg border border-border bg-surface text-base text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60 sm:text-sm';
export const K_FIELD = `h-9 px-3 ${FIELD_BASE}`;
/** A text area: the field's look without its fixed height. */
export const K_AREA = `w-full resize-y px-3 py-2 leading-relaxed ${FIELD_BASE}`;
export const K_SECTION_TITLE = 'text-[15px] font-semibold text-text-primary';
export const K_LABEL = 'text-xs font-semibold text-text-secondary';

/* Tables: put <table className={K_TABLE}> inside <div className={K_TABLE_WRAP}> inside a K_CARD with overflow-hidden. */
export const K_TABLE_WRAP = 'overflow-x-auto';
export const K_TABLE = 'w-full border-collapse text-sm';
const TH = 'h-10 whitespace-nowrap bg-surface-elevated px-4 text-xs font-semibold text-text-tertiary';
export const K_TH = `${TH} text-left`;
export const K_TH_R = `${TH} text-right`;
export const K_TR = 'border-t border-border transition-colors hover:bg-surface-elevated/70';
export const K_TD = 'h-[52px] px-4 py-2 align-middle';

export type PillTone = 'green' | 'amber' | 'blue' | 'red' | 'grey' | 'teal';
const PILL: Record<PillTone, [string, string]> = {
    green: ['bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30', 'bg-emerald-500'],
    amber: ['bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30', 'bg-amber-500'],
    blue: ['bg-blue-50 text-blue-800 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30', 'bg-blue-500'],
    red: ['bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30', 'bg-red-500'],
    grey: ['bg-surface-elevated text-text-secondary ring-border', 'bg-text-tertiary'],
    teal: ['bg-primary/10 text-primary-dark ring-primary/25 dark:text-primary-light', 'bg-primary'],
};

/** A rounded status pill with a dot. */
export function StatusPill({ tone, title, children }: { tone: PillTone; title?: string; children: React.ReactNode }) {
    const [box, dot] = PILL[tone];
    return (
        <span title={title} className={`inline-flex h-6 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset ${box}`}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
            <span className="truncate">{children}</span>
        </span>
    );
}

/** The page header: a title, a grey line of real counts, actions on the right. */
export function PageHeader({ title, sub, actions, as: Tag = 'h2' }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; as?: 'h1' | 'h2' }) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
                <Tag className="text-xl font-semibold tracking-[-0.01em] text-text-primary">{title}</Tag>
                {sub && <p className="mt-0.5 text-sm text-text-tertiary">{sub}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
    );
}

/** A KPI tile: an icon, a big number and a grey label (and an optional note). */
export function KpiTile({ icon: Icon, label, value, note }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; note?: React.ReactNode }) {
    return (
        <div className={`${K_CARD} flex items-start gap-3 px-4 py-4`}>
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden><Icon className="h-5 w-5" /></span>
            <div className="min-w-0">
                <p className="text-2xl font-semibold leading-tight tabular-nums text-text-primary">{value}</p>
                <p className="mt-0.5 text-sm text-text-tertiary">{label}</p>
                {note && <p className="mt-1 text-xs text-text-tertiary">{note}</p>}
            </div>
        </div>
    );
}

/** A segmented control: the selected segment is white on a light grey track. */
export function Segmented<T extends string>({ value, options, onChange, label, className = '' }: {
    value: T; options: Array<{ value: T; label: React.ReactNode }>; onChange: (v: T) => void; label: string; className?: string;
}) {
    return (
        <div role="group" aria-label={label} className={`inline-flex max-w-full flex-wrap gap-0.5 rounded-lg bg-muted p-0.5 ring-1 ring-inset ring-border ${className}`}>
            {options.map(o => {
                const on = o.value === value;
                return (
                    <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(o.value)}
                        className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors ${FOCUS} ${on ? 'bg-surface text-text-primary shadow-[0_1px_2px_rgba(16,24,40,0.08)] ring-1 ring-border' : 'text-text-secondary hover:text-text-primary'}`}>
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

/** A search box with an icon. */
export function SearchBox({ value, onChange, placeholder, label, className = '', maxLength }: {
    value: string; onChange: (v: string) => void; placeholder: string; label: string; className?: string; maxLength?: number;
}) {
    return (
        <div className={`relative min-w-0 ${className}`}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
            <input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={label} maxLength={maxLength}
                className={`h-9 w-full pl-9 pr-3 ${FIELD_BASE}`} />
        </div>
    );
}

/** A native select dressed as a white bordered pill with a caret. */
export function SelectPill({ value, onChange, label, children, className = '', disabled }: {
    value: string; onChange: (v: string) => void; label: string; children: React.ReactNode; className?: string; disabled?: boolean;
}) {
    return (
        <div className={`relative inline-flex min-w-0 ${className}`}>
            <select value={value} onChange={e => onChange(e.target.value)} aria-label={label} disabled={disabled}
                className={`h-9 w-full min-w-0 cursor-pointer appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm font-medium text-text-primary outline-none transition-colors hover:bg-surface-elevated focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60`}>
                {children}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
        </div>
    );
}

/** Centred empty state: an icon, a title and a one-line hint. */
export function EmptyBlock({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children?: React.ReactNode }) {
    return (
        <div className="flex flex-col items-center px-4 py-12 text-center">
            <span className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface-elevated ring-1 ring-inset ring-border" aria-hidden>
                <Icon className="h-5 w-5 text-text-tertiary" />
            </span>
            <p className="text-[15px] font-semibold text-text-primary">{title}</p>
            {children && <div className="mt-1 max-w-md text-sm text-text-tertiary">{children}</div>}
        </div>
    );
}

/** A loading line. */
export function Loading({ children = 'Loading' }: { children?: React.ReactNode }) {
    return <p className="flex items-center gap-x-2 py-6 text-sm text-text-tertiary" role="status"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-primary" aria-hidden />{children}</p>;
}
