'use client';

import React from 'react';
import Link from 'next/link';
import { MoreVertical, TrendingDown, TrendingUp, Minus } from 'lucide-react';

/**
 * The card every Command Center tile renders inside, plus the small primitives
 * those tiles share.
 *
 * Keeping the chrome and the number formatting in one place is what lets
 * sixteen different modules read as a single board rather than sixteen
 * separately-designed cards.
 *
 * Visual values live in the COMMAND CENTER block of app/globals.css and are
 * sourced from docs/design-references — Vercel for the stacked elevation
 * ladder, Binance for the numeric scale and dense-row geometry.
 */

export type Tone = 'ok' | 'info' | 'warn' | 'bad' | 'neutral';

const TONE_VAR: Record<Tone, string> = {
    ok: 'var(--success)',
    info: 'var(--info)',
    warn: 'var(--warning)',
    bad: 'var(--error)',
    neutral: 'var(--primary)',
};

interface CardProps {
    title: string;
    icon: React.ReactNode;
    /** Tints the icon chip. Semantic colour is confined to that 24px square —
     *  Binance's rule is that status colour belongs on text, not as a card fill. */
    accent?: Tone;
    badge?: { label: string; tone: Tone };
    /** Rendered at the right of the header, before the menu (e.g. "Synced 2 min ago"). */
    note?: React.ReactNode;
    href?: string;
    linkLabel?: string;
    /** 'gradient' is reserved for the single hero card. */
    tone?: 'plain' | 'gradient';
    elevation?: 2 | 3 | 4;
    onMenu?: () => void;
    className?: string;
    children: React.ReactNode;
}

export default function CommandCard({
    title, icon, accent = 'neutral', badge, note, href, linkLabel,
    tone = 'plain', elevation = 3, onMenu, className = '', children,
}: CardProps) {
    return (
        <section
            className={`cc-card ${className}`}
            data-tone={tone === 'gradient' ? 'gradient' : undefined}
            data-elev={elevation}
            style={{ ['--cc-accent' as string]: TONE_VAR[accent] }}
            aria-label={title}
        >
            <header className="cc-head">
                <span className="cc-icon" aria-hidden="true">{icon}</span>
                <h3 className="cc-title">{title}</h3>

                {badge && (
                    <span className="cc-badge ml-1" data-tone={badge.tone}>{badge.label}</span>
                )}

                {note && <span className="ml-auto text-[10px] font-semibold text-text-tertiary whitespace-nowrap">{note}</span>}

                {href && (
                    <Link
                        href={href}
                        className={`${note ? '' : 'ml-auto'} text-[10px] font-bold text-primary hover:underline whitespace-nowrap`}
                    >
                        {linkLabel ?? 'View'}
                    </Link>
                )}

                {onMenu && (
                    <button
                        type="button"
                        onClick={onMenu}
                        className={`cc-menu ${note || href || badge ? '' : 'ml-auto'}`}
                        aria-label={`${title} options`}
                    >
                        <MoreVertical className="w-3.5 h-3.5" />
                    </button>
                )}
            </header>

            <div className="cc-body">{children}</div>
        </section>
    );
}

/* -------------------------------------------------------------------------- */

/** A figure on the numeric scale. `size` maps to the Binance-derived ramp. */
export function Num({ value, size = 'lg', tone, className = '' }: {
    value: React.ReactNode;
    size?: 'hero' | 'xl' | 'lg' | 'md' | 'sm';
    tone?: Tone;
    className?: string;
}) {
    return (
        <span
            className={`cc-num cc-num-${size} ${className}`}
            style={tone ? { color: TONE_VAR[tone] } : undefined}
        >
            {value}
        </span>
    );
}

export function Label({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <div className={`cc-label ${className}`}>{children}</div>;
}

/**
 * Comparison against a previous period.
 *
 * `higherIsBetter` is required rather than defaulted because getting it wrong
 * is silent and expensive: +12% revenue is good, +12% electricity is not, and
 * a dashboard that colours both green is actively misleading.
 */
export function Delta({ pct, higherIsBetter, label }: {
    pct: number | null | undefined;
    higherIsBetter: boolean;
    label?: string;
}) {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
    const flat = Math.abs(pct) < 0.5;
    const rising = pct > 0;
    const tone = flat ? 'flat' : (rising === higherIsBetter ? 'good' : 'bad');
    const Icon = flat ? Minus : rising ? TrendingUp : TrendingDown;

    return (
        <span className="inline-flex items-baseline gap-1.5 min-w-0">
            <span className="cc-delta" data-tone={tone}>
                <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
                {flat ? 'flat' : `${Math.abs(pct).toFixed(0)}%`}
            </span>
            {label && <span className="cc-sub truncate">{label}</span>}
        </span>
    );
}

/** The hairline-separated label/value footer most cards end with. */
export function MetaStrip({ cols = 3, items }: {
    cols?: 2 | 3 | 4;
    items: Array<{ label: string; value: React.ReactNode; tone?: Tone }>;
}) {
    return (
        <div className={`cc-meta cc-meta-${cols}`}>
            {items.map((it) => (
                <div key={it.label} className="cc-meta-cell">
                    <Label>{it.label}</Label>
                    <div className="cc-meta-val" style={it.tone ? { color: TONE_VAR[it.tone] } : undefined}>
                        {it.value}
                    </div>
                </div>
            ))}
        </div>
    );
}

/** One column of the health-score inset panel: icon, big figure, wrapped caption. */
export function StatColumn({ icon, value, label, tone = 'neutral' }: {
    icon: React.ReactNode; value: React.ReactNode; label: string; tone?: Tone;
}) {
    return (
        <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5" style={{ color: TONE_VAR[tone] }}>
                <span className="[&>svg]:w-3.5 [&>svg]:h-3.5" aria-hidden="true">{icon}</span>
                <Num value={value} size="lg" tone={tone} />
            </span>
            <div className="cc-sub mt-0.5 leading-tight">{label}</div>
        </div>
    );
}

export function ActionButton({ children, href, onClick, block }: {
    children: React.ReactNode; href?: string; onClick?: () => void; block?: boolean;
}) {
    const cls = 'cc-action';
    if (href) {
        return <Link href={href} className={cls} {...(block ? { 'data-block': '' } : {})}>{children}</Link>;
    }
    return (
        <button type="button" onClick={onClick} className={cls} {...(block ? { 'data-block': '' } : {})}>
            {children}
        </button>
    );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
    return (
        <div className="space-y-2" aria-busy="true">
            <div className="cc-skel h-7 w-24" />
            {Array.from({ length: lines }).map((_, i) => (
                <div key={i} className="cc-skel h-3" style={{ width: `${88 - i * 14}%` }} />
            ))}
        </div>
    );
}

/**
 * Shown when a card's backing table or route does not exist yet.
 *
 * Deliberately distinct from "no data": a dashed slot reads as pending, where a
 * bare sentence across a large card reads as broken. Never substitute plausible
 * numbers for a missing source.
 */
export function CardSetup({ label, hint }: { label: string; hint?: string }) {
    return (
        <div className="h-full min-h-[80px] flex flex-col items-center justify-center gap-1.5 text-center
                        rounded-xl border border-dashed border-border bg-muted/30 px-4 py-5">
            <span className="text-[11px] font-black text-text-secondary">{label}</span>
            {hint && <span className="text-[10px] font-semibold text-text-tertiary max-w-[28ch] leading-snug">{hint}</span>}
        </div>
    );
}

export { TONE_VAR };
