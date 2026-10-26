'use client';

import React from 'react';
import { AlertTriangle, CloudOff, FlaskConical, Inbox, RotateCw } from 'lucide-react';
import { PRIORITY_META, RED, RED_BG, RED_TEXT, STATUS_META } from './status';
import type { Priority, SlaInfo, TicketStatus } from './types';
import { initials } from './format';

/**
 * Small building blocks shared by the six designs. They read the active design's tokens from
 * CSS variables (--lab-*) that DesignFrame sets, so each design restyles them for free.
 */

export const v = {
    text: 'var(--lab-text)',
    text2: 'var(--lab-text2)',
    text3: 'var(--lab-text3)',
    surface: 'var(--lab-surface)',
    tile: 'var(--lab-tile)',
    border: 'var(--lab-border)',
    primary: 'var(--lab-primary)',
    onPrimary: 'var(--lab-on-primary)',
    tint: 'var(--lab-tint)',
    ramp: (i: number) => `var(--lab-ramp-${i})`,
};

/**
 * Heading without an h1-h6 tag. The app's global base layer forces heading weights with
 * !important, which would flatten every design's type scale; role="heading" keeps the
 * semantics without inheriting that rule.
 */
export function H({ level, className, style, children, id }: { level: 1 | 2 | 3; className?: string; style?: React.CSSProperties; children: React.ReactNode; id?: string }) {
    return <div role="heading" aria-level={level} id={id} className={className} style={style}>{children}</div>;
}

export function cx(...parts: (string | false | null | undefined)[]): string {
    return parts.filter(Boolean).join(' ');
}

export function StatusChip({ status, dark, size = 'md', className }: { status: TicketStatus; dark?: boolean; size?: 'sm' | 'md'; className?: string }) {
    const meta = STATUS_META[status];
    const Icon = meta.icon;
    const ramp = v.ramp(meta.ramp);
    return (
        <span
            className={cx(
                'inline-flex items-center gap-1.5 whitespace-nowrap font-medium leading-none',
                size === 'sm' ? 'h-6 px-2 text-[11.5px]' : 'h-7 px-2.5 text-[12.5px]',
                className,
            )}
            style={{
                borderRadius: 'var(--lab-chip-radius)',
                background: dark ? 'rgba(255,255,255,0.14)' : `color-mix(in srgb, ${ramp} 13%, transparent)`,
                color: dark ? '#FFFFFF' : v.text,
            }}
        >
            <Icon aria-hidden className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} style={{ color: dark ? '#FFFFFF' : ramp }} strokeWidth={2.4} />
            {meta.label}
        </span>
    );
}

export function PriorityChip({ priority, dark, size = 'md', className }: { priority: Priority; dark?: boolean; size?: 'sm' | 'md'; className?: string }) {
    const meta = PRIORITY_META[priority];
    const Icon = meta.icon;
    const critical = priority === 'critical';
    return (
        <span
            className={cx(
                'inline-flex items-center gap-1.5 whitespace-nowrap font-medium leading-none',
                size === 'sm' ? 'h-6 px-2 text-[11.5px]' : 'h-7 px-2.5 text-[12.5px]',
                className,
            )}
            style={{
                borderRadius: 'var(--lab-chip-radius)',
                background: critical ? RED_BG : dark ? 'rgba(255,255,255,0.14)' : v.tile,
                color: critical ? RED_TEXT : dark ? '#FFFFFF' : v.text,
            }}
        >
            <Icon aria-hidden className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} style={{ color: critical ? RED : dark ? '#FFFFFF' : v.text2 }} strokeWidth={2.4} />
            {meta.label}
        </span>
    );
}

export function CategoryChip({ label, dark, size = 'md' }: { label: string | null; dark?: boolean; size?: 'sm' | 'md' }) {
    if (!label) return null;
    return (
        <span
            className={cx('inline-flex items-center whitespace-nowrap font-medium leading-none', size === 'sm' ? 'h-6 px-2 text-[11.5px]' : 'h-7 px-2.5 text-[12.5px]')}
            style={{
                borderRadius: 'var(--lab-chip-radius)',
                border: `1px solid ${dark ? 'rgba(255,255,255,0.35)' : 'var(--lab-border)'}`,
                color: dark ? '#FFFFFF' : v.text2,
            }}
        >
            {label}
        </span>
    );
}

/** Marks a widget that shows section 8 sample data because no data hook wires it up yet. */
export function SampleBadge({ dark, className }: { dark?: boolean; className?: string }) {
    return (
        <span
            title="Sample data. This module is not wired to a data hook yet."
            className={cx('inline-flex h-5 items-center gap-[4px] whitespace-nowrap rounded-full px-2 text-[10.5px] font-semibold uppercase tracking-[0.06em]', className)}
            style={{
                border: `1px dashed ${dark ? 'rgba(255,255,255,0.55)' : 'var(--lab-text3)'}`,
                color: dark ? 'rgba(255,255,255,0.9)' : v.text2,
            }}
        >
            <FlaskConical aria-hidden className="h-3 w-3" />
            Sample
        </span>
    );
}

/** Thin SLA progress bar. Red only for a breach, or a critical ticket under an hour. */
export function SlaBar({ sla, height = 4, fill, track, className }: { sla: SlaInfo; height?: number; fill?: string; track?: string; className?: string }) {
    const pct = Math.min(100, Math.max(3, sla.used * 100));
    return (
        <div
            className={cx('w-full overflow-hidden', className)}
            style={{ height, borderRadius: height, background: track ?? 'var(--lab-border)' }}
            role="progressbar"
            aria-label="SLA used"
            aria-valuenow={Math.round(sla.used * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <div style={{ width: `${pct}%`, height: '100%', borderRadius: height, background: sla.danger ? RED : fill ?? v.primary }} />
        </div>
    );
}

/** SLA time left as text, red only when the SLA is in danger. */
export function SlaText({ sla, className, style }: { sla: SlaInfo; className?: string; style?: React.CSSProperties }) {
    return (
        <span className={cx('tabular-nums', className)} style={{ ...style, color: sla.danger ? RED_TEXT : style?.color ?? v.text }}>
            {sla.label}
        </span>
    );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
    return <div aria-hidden className={cx('lab-skeleton', className)} style={{ borderRadius: 'var(--lab-radius-sm)', ...style }} />;
}

export function SkeletonRows({ rows = 4, height = 56, gap = 10 }: { rows?: number; height?: number; gap?: number }) {
    return (
        <div className="flex flex-col" style={{ gap }} role="status" aria-label="Loading">
            {Array.from({ length: rows }).map((_, i) => (
                <Skeleton key={i} style={{ height, opacity: 1 - i * 0.12 }} />
            ))}
        </div>
    );
}

export function EmptyState({
    title, body, actionLabel, onAction, icon: Icon = Inbox, dark, compact,
}: {
    title: string; body?: string; actionLabel: string; onAction: () => void; icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; dark?: boolean; compact?: boolean;
}) {
    return (
        <div className={cx('flex flex-col items-center justify-center text-center', compact ? 'gap-[8px] py-6' : 'gap-[12px] py-12')}>
            <span className="grid h-11 w-11 place-items-center rounded-full" style={{ background: dark ? 'rgba(255,255,255,0.12)' : v.tile }}>
                <Icon className="h-5 w-5" style={{ color: dark ? '#FFFFFF' : v.text2 }} />
            </span>
            <div className="text-[15px] font-semibold" style={{ color: dark ? '#FFFFFF' : v.text }}>{title}</div>
            {body && <p className="max-w-[320px] text-[13px] leading-relaxed" style={{ color: dark ? 'rgba(255,255,255,0.75)' : v.text2 }}>{body}</p>}
            <button
                type="button"
                onClick={onAction}
                className="mt-1 inline-flex h-10 items-center px-4 text-[13.5px] font-semibold"
                style={{ borderRadius: 'var(--lab-btn-radius)', background: dark ? '#FFFFFF' : v.primary, color: dark ? '#0B0B0C' : v.onPrimary }}
            >
                {actionLabel}
            </button>
        </div>
    );
}

export function ErrorState({ message, onRetry, dark, compact }: { message: string; onRetry: () => void; dark?: boolean; compact?: boolean }) {
    return (
        <div className={cx('flex flex-col items-center justify-center text-center', compact ? 'gap-[8px] py-6' : 'gap-[12px] py-12')} role="alert">
            <span className="grid h-11 w-11 place-items-center rounded-full" style={{ background: dark ? 'rgba(255,255,255,0.12)' : v.tile }}>
                <AlertTriangle className="h-5 w-5" style={{ color: dark ? '#FFFFFF' : v.text2 }} />
            </span>
            <div className="text-[15px] font-semibold" style={{ color: dark ? '#FFFFFF' : v.text }}>{message}</div>
            <p className="max-w-[300px] text-[13px]" style={{ color: dark ? 'rgba(255,255,255,0.75)' : v.text2 }}>Check your connection and try again.</p>
            <button
                type="button"
                onClick={onRetry}
                className="mt-1 inline-flex h-10 items-center gap-[8px] px-4 text-[13.5px] font-semibold"
                style={{ borderRadius: 'var(--lab-btn-radius)', border: `1px solid ${dark ? 'rgba(255,255,255,0.5)' : 'var(--lab-border-strong)'}`, color: dark ? '#FFFFFF' : v.text }}
            >
                <RotateCw className="h-4 w-4" />
                Retry
            </button>
        </div>
    );
}

export function OfflineBanner({ online, className, style }: { online: boolean; className?: string; style?: React.CSSProperties }) {
    if (online) return null;
    return (
        <div
            role="status"
            className={cx('flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium', className)}
            style={{ background: 'var(--lab-tile)', color: 'var(--lab-text)', borderRadius: 'var(--lab-radius-sm)', ...style }}
        >
            <CloudOff className="h-4 w-4 shrink-0" style={{ color: 'var(--lab-text2)' }} />
            You are offline. Showing the last data we loaded. Changes will sync when you reconnect.
        </div>
    );
}

export function Avatar({ name, size = 32, className, style }: { name: string | null | undefined; size?: number; className?: string; style?: React.CSSProperties }) {
    return (
        <span
            aria-hidden
            className={cx('inline-grid shrink-0 place-items-center font-semibold', className)}
            style={{ width: size, height: size, borderRadius: '50%', fontSize: Math.round(size * 0.36), background: v.tile, color: v.text, ...style }}
        >
            {initials(name)}
        </span>
    );
}

/** Rows that open on click or Enter. Arrow keys move between rows via listKeys on the parent. */
export function rowProps(onOpen: () => void, label?: string) {
    return {
        role: 'button' as const,
        tabIndex: 0,
        'data-lab-item': '',
        'aria-label': label,
        onClick: onOpen,
        onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
            if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                e.preventDefault();
                onOpen();
            }
        },
    };
}

export function listKeys(e: React.KeyboardEvent<HTMLElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-lab-item]'));
    if (items.length === 0) return;
    const current = items.findIndex(el => el === document.activeElement || el.contains(document.activeElement));
    let next = current;
    if (e.key === 'ArrowDown') next = current < 0 ? 0 : Math.min(items.length - 1, current + 1);
    if (e.key === 'ArrowUp') next = current < 0 ? 0 : Math.max(0, current - 1);
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = items.length - 1;
    e.preventDefault();
    items[next]?.focus();
}

/** Stops a click inside a clickable row from also opening the row. */
export function stop<E extends React.SyntheticEvent>(fn: () => void) {
    return (e: E) => {
        e.stopPropagation();
        fn();
    };
}
