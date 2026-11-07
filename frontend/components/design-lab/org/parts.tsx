'use client';

import React from 'react';
import { AlertTriangle, Building2, FileText, Home, ListChecks, Menu, PackageSearch, RotateCw, ShieldAlert, Ticket, Wallet, type LucideIcon } from 'lucide-react';
import { SampleBadge, Skeleton, cx } from '../lab/ui';
import type { Approval, Feed } from './useOrgModel';

/**
 * Renders one feed: a skeleton while loading, an inline error with Retry, an honest
 * "not set up" line, or the content. Every design uses it so the four stay comparable.
 */
export function Fed<T>({ feed, children, rows = 2, height = 16, dark, compact, className }: {
    feed: Feed<T>; children: (d: T) => React.ReactNode; rows?: number; height?: number; dark?: boolean; compact?: boolean; className?: string;
}) {
    if (feed.state === 'loading') {
        return (
            <div className={cx('flex flex-col gap-[8px]', className)} role="status" aria-label="Loading">
                {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} style={{ height, opacity: 1 - i * 0.15 }} />)}
            </div>
        );
    }
    if (feed.state === 'error') return <InlineError onRetry={feed.retry} dark={dark} compact={compact} className={className} />;
    if (feed.state === 'off' || feed.data === null) {
        return <p className={cx('text-[12.5px]', className)} style={{ color: dark ? 'rgba(255,255,255,0.6)' : 'var(--lab-text2)' }}>{feed.offReason ?? 'Nothing to show yet'}</p>;
    }
    return <>{children(feed.data)}</>;
}

/** Error with Retry. `compact` keeps the message for screen readers only, for small tiles. */
export function InlineError({ onRetry, dark, compact, className }: { onRetry: () => void; dark?: boolean; compact?: boolean; className?: string }) {
    return (
        <div role="alert" className={cx('flex items-center text-[13px]', compact ? 'gap-[6px]' : 'gap-[10px]', className)} style={{ color: dark ? '#FFFFFF' : 'var(--lab-text)' }}>
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden style={{ color: dark ? 'rgba(255,255,255,0.7)' : 'var(--lab-text2)' }} />
            <span className={compact ? 'sr-only' : 'flex-1'}>Could not load this.</span>
            <button type="button" onClick={onRetry} className="inline-flex h-10 items-center gap-[6px] rounded-full px-[12px] text-[12.5px] font-semibold"
                style={{ border: `1px solid ${dark ? 'rgba(255,255,255,0.3)' : 'var(--lab-border-strong)'}` }}>
                <RotateCw className="h-3.5 w-3.5" aria-hidden />Retry
            </button>
        </div>
    );
}

/** A Sample badge, only when the feed is sample data. */
export function Sample({ feed, dark, size = 'xs' }: { feed: { sample: boolean }; dark?: boolean; size?: 'xs' | 'sm' }) {
    return feed.sample ? <SampleBadge dark={dark} size={size} /> : null;
}

/** Bottom tab bar items for the org super admin app. */
export const ORG_TABS: { label: string; icon: LucideIcon }[] = [
    { label: 'Home', icon: Home }, { label: 'Approvals', icon: ListChecks }, { label: 'Sites', icon: Building2 },
    { label: 'Tickets', icon: Ticket }, { label: 'More', icon: Menu },
];

export const APPROVAL_ICONS: Record<Approval['id'], LucideIcon> = {
    po: FileText, mr: PackageSearch, petty: Wallet, escalation: ShieldAlert,
};
