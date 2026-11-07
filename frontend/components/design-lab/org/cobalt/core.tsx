'use client';

import { createContext, useContext, type CSSProperties } from 'react';
import type { LabTheme } from '../../lab/frame';
import type { Feed, OrgModel, OrgSite } from '../useOrgModel';
import type { ApprovalItem, Notice, QueueId } from './sample';

/**
 * Cobalt's tokens, routes and the app state every screen reads. Light page, white cards,
 * one blue accent. Red stays reserved for SLA breaches and late rounds.
 */

export const C = {
    page: '#F2F4F9',
    card: '#FFFFFF',
    tint: '#E7EDFD',
    accent: '#2B59E8',
    accentDeep: '#1E44C2',
    bar: '#C7D5FA',
    barWarn: '#93AEF6',
    text: '#0E1424',
    text2: '#485069',
    text3: '#5F677C',
    border: '#E2E6EF',
    track: '#EEF1F7',
    muted: '#D5DAE5',
    scrim: 'rgba(14,20,36,0.42)',
};

export const theme: LabTheme = {
    font: 'var(--font-lab-jakarta), "Plus Jakarta Sans", system-ui, sans-serif',
    page: C.page, surface: C.card, tile: C.track, border: C.border, borderStrong: '#CDD3E0', grid: '#EBEEF5',
    text: C.text, text2: C.text2, text3: C.text3, primary: C.accent, onPrimary: '#FFFFFF', tint: C.tint,
    ramp: ['#1E44C2', '#2B59E8', '#7D9BF2', '#C7D5FA'], radius: '22px', radiusSm: '14px', chipRadius: '999px', btnRadius: '999px',
    focus: C.accentDeep, skeletonA: '#EEF1F7', skeletonB: '#E1E6F0', tooltipBg: '#0E1424', tooltipFg: '#FFFFFF',
};

/** Figures: bold, tight and tabular so columns of numbers line up. */
export const fig: CSSProperties = { fontWeight: 700, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums' };

export const QUEUES: QueueId[] = ['po', 'mr', 'petty', 'escalation'];
export const QUEUE_COLORS: Record<QueueId, string> = { po: '#1E44C2', mr: '#2B59E8', petty: '#7D9BF2', escalation: '#C7D5FA' };
export const QUEUE_SHORT: Record<QueueId, string> = { po: 'Purchase orders', mr: 'Materials', petty: 'Petty cash', escalation: 'Escalations' };

export type SiteSort = 'score' | 'active' | 'name';
export type SiteFilter = 'all' | 'attention' | 'over';

export type Route =
    | { name: 'home' }
    | { name: 'approvals'; queue?: QueueId }
    | { name: 'sites'; sort?: SiteSort; filter?: SiteFilter }
    | { name: 'more' }
    | { name: 'site'; id: string }
    | { name: 'money' }
    | { name: 'people' }
    | { name: 'compliance' }
    | { name: 'notifications' }
    | { name: 'search' };

export type TabName = 'home' | 'approvals' | 'sites' | 'more';
export const TAB_ROOTS: TabName[] = ['home', 'approvals', 'sites', 'more'];

export type Sheet = { kind: 'create' } | { kind: 'approval'; id: string; reject?: boolean };
export type Decision = 'approved' | 'rejected';

/** Where a screen is opened from when it is not a tab of its own, so Back has somewhere to go. */
export function stackFor(r: Route): Route[] {
    if ((TAB_ROOTS as string[]).includes(r.name)) return [r];
    if (r.name === 'site') return [{ name: 'sites' }, r];
    if (r.name === 'money' || r.name === 'people' || r.name === 'compliance') return [{ name: 'more' }, r];
    return [{ name: 'home' }, r];
}

export interface CobaltApp {
    m: OrgModel;
    route: Route;
    /** Screens below this one; 0 on a tab. */
    depth: number;
    /** Switch tab, or open a screen from scratch (clears Back). */
    go: (r: Route) => void;
    push: (r: Route) => void;
    back: () => void;
    sheet: Sheet | null;
    openSheet: (s: Sheet) => void;
    closeSheet: () => void;
    /** Items still waiting, after what you approved or rejected here. */
    items: Feed<ApprovalItem[]>;
    /** Count per queue after local decisions; null while unknown. */
    pending: Record<QueueId, number | null>;
    pendingTotal: number | null;
    decide: (ids: string[], d: Decision, reason?: string) => void;
    notices: Feed<(Notice & { unread: boolean })[]>;
    unread: number;
    markRead: (ids: string[] | 'all') => void;
    refresh: () => void;
    refreshing: boolean;
    updatedLabel: string;
    siteByName: (name: string) => OrgSite | null;
}

export const AppCtx = createContext<CobaltApp | null>(null);

export function useApp(): CobaltApp {
    const app = useContext(AppCtx);
    if (!app) throw new Error('Cobalt screens must render inside CobaltOrg');
    return app;
}

export function waitedLabel(days: number): string {
    return days === 0 ? 'Sent today' : days === 1 ? 'Waiting 1 day' : `Waiting ${days} days`;
}

/** "9 min ago" or "2 h ago" today; the clock time for an earlier day (the list groups by day). */
export function agoLabel(now: Date, minutes: number): string {
    if (minutes < 60) return `${minutes} min ago`;
    const at = new Date(now.getTime() - minutes * 60_000);
    if (at.toDateString() === now.toDateString()) return `${Math.floor(minutes / 60)} h ago`;
    return at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}
