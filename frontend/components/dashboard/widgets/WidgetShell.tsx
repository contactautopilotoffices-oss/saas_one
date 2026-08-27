'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight, GripVertical, Sparkles, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { Severity, WidgetSize } from '@/frontend/lib/dashboard/types';
import { relativeTime } from '@/frontend/lib/dashboard/useWidgetData';

/**
 * The card chrome every widget renders inside.
 *
 * Holds the glass surface, the severity LED, the title, the freshness stamp and the
 * drag/resize affordances, so individual widgets only ever describe their own content.
 * Keeping the chrome in one place is what lets 14 different modules look like one board.
 */

interface Props {
    title: string;
    icon: React.ReactNode;
    severity: Severity;
    size: WidgetSize;
    /** The one-line "so what" — rendered as the insight strip. Hidden at sm. */
    headline?: string | null;
    href?: string;
    fetchedAt?: number | null;
    /** Older than this many ms and the stamp turns amber. */
    staleAfterMs?: number;
    /**
     * Set by the grid's severity arbiter. At most ONE card on the board is the
     * lead — it is the only element allowed to loop an animation (the calm-tech
     * rule: a second looping signal and neither means "act now").
     */
    lead?: boolean;
    /** 'ink' renders the opaque dark anchor card instead of glass. One per board. */
    tone?: 'glass' | 'ink';
    dragHandleProps?: React.HTMLAttributes<HTMLElement>;
    isDragging?: boolean;
    onResize?: (e: React.PointerEvent) => void;
    children: React.ReactNode;
}

const SEVERITY_LABEL: Record<Severity, string> = {
    ok: 'No action needed',
    info: 'Worth a look',
    warn: 'Needs attention this week',
    critical: 'Needs attention today',
};

export default function WidgetShell({
    title, icon, severity, size, headline, href, fetchedAt,
    staleAfterMs = 15 * 60_000, lead = false, tone = 'glass',
    dragHandleProps, isDragging, onResize, children,
}: Props) {
    const stale = fetchedAt ? Date.now() - fetchedAt > staleAfterMs : false;
    const showHeadline = size !== 'sm' && !!headline;

    return (
        <div
            className="w-card h-full"
            data-sev={severity}
            data-size={size}
            data-lead={lead ? 'true' : 'false'}
            data-tone={tone}
            data-dragging={isDragging ? 'true' : 'false'}
        >
            <div className="w-head">
                <span
                    className="w-led"
                    data-sev={severity}
                    role="status"
                    aria-label={`${title}: ${SEVERITY_LABEL[severity]}`}
                />
                <span className="text-text-tertiary flex-none [&>svg]:w-3.5 [&>svg]:h-3.5">{icon}</span>
                <span className="w-title flex-1">{title}</span>

                {fetchedAt && size !== 'sm' && (
                    <span className="w-stamp" data-stale={stale ? 'true' : 'false'} title="Last synced">
                        {relativeTime(fetchedAt)}
                    </span>
                )}

                {href && (
                    <Link
                        href={href}
                        aria-label={`Open ${title}`}
                        className="text-text-tertiary hover:text-primary transition-colors flex-none"
                    >
                        <ArrowUpRight className="w-3.5 h-3.5" />
                    </Link>
                )}

                {dragHandleProps && (
                    <span
                        {...dragHandleProps}
                        className="w-grip text-text-tertiary hover:text-text-secondary flex-none"
                        role="button"
                        tabIndex={0}
                        aria-label={`Move ${title}`}
                    >
                        <GripVertical className="w-3.5 h-3.5" />
                    </span>
                )}
            </div>

            {showHeadline && (
                <p className="w-insight line-clamp-2">
                    <Sparkles aria-hidden="true" />
                    <span>{headline}</span>
                </p>
            )}

            <div className="w-body">{children}</div>

            {onResize && (
                <span
                    className="w-resize"
                    onPointerDown={onResize}
                    role="button"
                    tabIndex={0}
                    aria-label={`Resize ${title}`}
                >
                    <svg viewBox="0 0 18 18" className="w-full h-full text-text-tertiary" aria-hidden="true">
                        <path d="M16 8 L8 16 M16 13 L13 16" stroke="currentColor" strokeWidth="1.5"
                            strokeLinecap="round" fill="none" />
                    </svg>
                </span>
            )}
        </div>
    );
}

/* --------------------------------------------------------------------------
   Shared widget primitives. Kept here so every card formats a number, a delta
   and an empty state identically — inconsistency across tiles is what makes a
   dashboard feel assembled rather than designed.
   -------------------------------------------------------------------------- */

/** The headline number. Scales by size class, never by content length.
 *  Re-keyed on value change so the tick animation fires exactly once per
 *  update — data moves when it CHANGES, the only motion that carries
 *  information. */
export function Metric({ value, sub, size = 'md' }: { value: React.ReactNode; sub?: string; size?: WidgetSize }) {
    const cls = size === 'sm' ? 'text-[26px]' : size === 'xl' ? 'text-[40px]' : 'text-[32px]';
    return (
        <div className="min-w-0">
            <div key={String(value)} className={`w-metric w-tick ${cls} truncate`}>{value}</div>
            {sub && <div className="w-sub mt-1 truncate">{sub}</div>}
        </div>
    );
}

/**
 * Comparison-to-previous-period chip.
 *
 * `higherIsBetter` matters: +12% revenue is green, +12% electricity is red. Encoding
 * direction without encoding meaning is how dashboards end up celebrating overspend.
 */
export function Delta({ pct, higherIsBetter = false, suffix = '' }:
    { pct: number | null | undefined; higherIsBetter?: boolean; suffix?: string }) {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
    const dir = Math.abs(pct) < 0.5 ? 'flat' : pct > 0 ? 'up' : 'down';
    const Icon = dir === 'flat' ? Minus : dir === 'up' ? TrendingUp : TrendingDown;
    return (
        <span className="w-delta" data-dir={dir} data-good={higherIsBetter ? 'true' : 'false'}>
            <Icon className="w-2.5 h-2.5" />
            {dir === 'flat' ? 'flat' : `${Math.abs(pct).toFixed(1)}%`}{suffix}
        </span>
    );
}

export function WidgetEmpty({ children }: { children: React.ReactNode }) {
    return (
        <div className="h-full flex items-center justify-center text-center">
            <p className="text-[11px] font-semibold text-text-tertiary max-w-[22ch] leading-snug">{children}</p>
        </div>
    );
}

/**
 * "This needs setting up" — distinct from empty.
 *
 * A widget whose backing table does not exist yet is not the same as one with no data, and
 * rendering a bare paragraph across a 2x2 card makes the whole board look broken rather
 * than pending. This keeps the card visually quiet: a dashed placeholder that reads as a
 * slot waiting to be filled, with the action that fills it.
 */
export function WidgetSetup({ label, hint }: { label: string; hint?: string }) {
    return (
        <div className="h-full min-h-[56px] flex flex-col items-center justify-center gap-1.5 text-center
                        rounded-xl border border-dashed border-border bg-muted/30 px-3 py-3">
            <span className="text-[11px] font-black text-text-secondary">{label}</span>
            {hint && (
                <span className="text-[10px] font-semibold text-text-tertiary leading-snug max-w-[26ch]">
                    {hint}
                </span>
            )}
        </div>
    );
}

export function WidgetSkeleton({ lines = 2 }: { lines?: number }) {
    return (
        <div className="space-y-2 animate-pulse pt-1" aria-hidden="true">
            <div className="h-7 w-24 rounded-lg bg-muted" />
            {Array.from({ length: lines }).map((_, i) => (
                <div key={i} className="h-2.5 rounded bg-muted" style={{ width: `${70 - i * 15}%` }} />
            ))}
        </div>
    );
}

/**
 * Horizontal proportion bar — the encoding for budget-vs-actual and any part-of-whole.
 * Cleveland & McGill rank position-along-a-common-scale above angle, so this beats a
 * donut for "how much of the budget is gone".
 */
export function ProgressBar({ pct, tone = 'primary' }: { pct: number; tone?: 'primary' | 'warn' | 'danger' | 'success' }) {
    const clamped = Math.max(0, Math.min(100, pct));
    const bg = tone === 'danger' ? 'var(--error)'
        : tone === 'warn' ? 'var(--warning)'
            : tone === 'success' ? 'var(--success)'
                : 'var(--primary)';
    return (
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden" role="presentation">
            <div className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${clamped}%`, background: bg }} />
        </div>
    );
}

/** Compact ranked row used by most `lg`/`xl` breakdowns. */
export function RankRow({ label, value, hint, tone }:
    { label: string; value: React.ReactNode; hint?: string; tone?: 'danger' | 'warn' | 'muted' }) {
    const valueCls = tone === 'danger' ? 'text-[var(--error)]'
        : tone === 'warn' ? 'text-[var(--warning)]'
            : 'text-text-primary';
    return (
        <div className="flex items-center gap-2 py-1 min-w-0">
            <span className="text-[11px] font-bold text-text-secondary truncate flex-1 min-w-0">{label}</span>
            {hint && <span className="text-[10px] font-semibold text-text-tertiary flex-none tabular-nums">{hint}</span>}
            <span className={`text-[11px] font-black tabular-nums flex-none ${valueCls}`}>{value}</span>
        </div>
    );
}
