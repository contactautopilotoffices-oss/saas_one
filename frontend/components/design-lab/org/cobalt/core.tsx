'use client';

import { createContext, useContext, type CSSProperties } from 'react';
import type { LabTheme } from '../../lab/frame';
import type { LabTicket, Priority, TicketStatus } from '../../lab/types';
import type { Feed, OrgModel, OrgSite } from '../useOrgModel';
import type { ApprovalItem, Notice, QueueId } from './sample';

/**
 * Tokens, routes and the app state every Cobalt screen reads.
 *
 * The app ships in two palettes that share every screen: Cobalt (light page, white cards,
 * one blue accent) and Slate (deep navy built from #06141B, #11212D, #253745, #4A5C6A,
 * #9BA8AB and #CCD0CF, with white as its primary colour), plus Slate Light, its bright version. Components read colours as CSS variables
 * through `C`, so a palette is one set of variables on the app root. Red stays reserved for
 * SLA breaches and late rounds in both.
 */

export type PaletteName = 'cobalt' | 'slate' | 'slateLight';

interface PaletteValues {
    page: string; card: string; tint: string; accent: string; accentDeep: string; bar: string; barWarn: string;
    text: string; text2: string; text3: string; border: string; track: string; muted: string; scrim: string;
    /** Text and icons on an accent fill, and on an ink (C.text) fill. */
    onAccent: string; onInk: string; onInkSoft: string;
    /** Fill for active pills, ink tags, the snackbar and the selection bar. */
    ink: string;
    topBar: string; dot: string; placeholder: string; shadowTab: string; shadowAccent: string; shadowSheet: string;
    red: string; redText: string; redBg: string; onRed: string;
    /** Site score bars with the name printed inside them, and the text on each. */
    siteBar: string; siteBarWarn: string; onSiteBar: string; onSiteBarWarn: string;
    q0: string; q1: string; q2: string; q3: string;
    heroBg: string; heroText: string; heroSoft: string; heroLine: string; heroGrid: string; heroBtn: string; heroChip: string; heroChipText: string;
}

export interface Palette {
    name: PaletteName;
    values: PaletteValues;
    /** The hero card is dark (light text) in Cobalt and light (dark text) in Slate. */
    heroDark: boolean;
    /** Native controls (select menus, scrollbars) follow the page. */
    scheme: 'light' | 'dark';
    theme: LabTheme;
}

const FONT = 'var(--font-lab-jakarta), "Plus Jakarta Sans", system-ui, sans-serif';

const COBALT: PaletteValues = {
    page: '#F2F4F9', card: '#FFFFFF', tint: '#E7EDFD', accent: '#2B59E8', accentDeep: '#1E44C2', bar: '#C7D5FA', barWarn: '#93AEF6',
    text: '#0E1424', text2: '#485069', text3: '#5F677C', border: '#E2E6EF', track: '#EEF1F7', muted: '#D5DAE5', scrim: 'rgba(14,20,36,0.42)',
    onAccent: '#FFFFFF', onInk: '#FFFFFF', onInkSoft: 'rgba(255,255,255,0.72)', ink: '#0E1424',
    topBar: 'rgba(242,244,249,0.92)', dot: '#C3CAD9', placeholder: '#7A8197',
    shadowTab: '0 -8px 24px rgba(14,20,36,0.06)', shadowAccent: '0 10px 24px rgba(43,89,232,0.38)', shadowSheet: '0 -12px 40px rgba(14,20,36,0.18)',
    red: '#E5484D', redText: '#C8282E', redBg: '#FDECEC', onRed: '#FFFFFF',
    siteBar: '#C7D5FA', siteBarWarn: '#93AEF6', onSiteBar: '#0E1424', onSiteBarWarn: '#0E1424',
    q0: '#1E44C2', q1: '#2B59E8', q2: '#7D9BF2', q3: '#C7D5FA',
    heroBg: 'linear-gradient(150deg, #3D6BF0 0%, #2B59E8 45%, #1E44C2 100%)', heroText: '#FFFFFF', heroSoft: 'rgba(255,255,255,0.85)',
    heroLine: '#FFFFFF', heroGrid: 'rgba(255,255,255,0.18)', heroBtn: 'rgba(255,255,255,0.16)', heroChip: '#FFFFFF', heroChipText: '#C8282E',
};

/**
 * Slate: the six palette colours for surfaces, text and charts, with white as the primary colour
 * for every action (buttons, active pills, the + button, the active tab, the hero card and the
 * main chart series). text2 sits between the two lightest greys for a third step of hierarchy.
 */
const SLATE: PaletteValues = {
    page: '#06141B', card: '#11212D', tint: '#253745', accent: '#FFFFFF', accentDeep: '#FFFFFF', bar: '#4A5C6A', barWarn: '#9BA8AB',
    text: '#CCD0CF', text2: '#B0BABC', text3: '#9BA8AB', border: '#253745', track: '#253745', muted: '#4A5C6A', scrim: 'rgba(0,0,0,0.6)',
    onAccent: '#06141B', onInk: '#06141B', onInkSoft: 'rgba(6,20,27,0.7)', ink: '#FFFFFF',
    topBar: 'rgba(6,20,27,0.9)', dot: '#4A5C6A', placeholder: '#8A979B',
    shadowTab: '0 -1px 0 #253745', shadowAccent: '0 10px 24px rgba(0,0,0,0.55)', shadowSheet: '0 -12px 40px rgba(0,0,0,0.5)',
    red: '#FF8B8E', redText: '#FF9C9F', redBg: 'rgba(255,139,142,0.14)', onRed: '#06141B',
    siteBar: '#4A5C6A', siteBarWarn: '#9BA8AB', onSiteBar: '#DCDFDE', onSiteBarWarn: '#06141B',
    q0: '#FFFFFF', q1: '#9BA8AB', q2: '#4A5C6A', q3: '#253745',
    heroBg: 'linear-gradient(160deg, #FFFFFF 0%, #F3F4F4 55%, #CCD0CF 100%)', heroText: '#06141B', heroSoft: 'rgba(6,20,27,0.72)',
    heroLine: '#06141B', heroGrid: 'rgba(6,20,27,0.14)', heroBtn: 'rgba(6,20,27,0.1)', heroChip: '#06141B', heroChipText: '#FF9C9F',
};

/**
 * Slate Light: the bright version of Slate. White page and cards, the same six colours for text,
 * bars and borders, deep navy #11212D as the primary colour, and a navy hero card for contrast.
 */
const SLATE_LIGHT: PaletteValues = {
    page: '#F3F4F4', card: '#FFFFFF', tint: '#E6E8E8', accent: '#11212D', accentDeep: '#253745', bar: '#9BA8AB', barWarn: '#4A5C6A',
    text: '#06141B', text2: '#4A5C6A', text3: '#5A6B77', border: '#E1E4E4', track: '#ECEEEE', muted: '#CCD0CF', scrim: 'rgba(6,20,27,0.42)',
    onAccent: '#FFFFFF', onInk: '#FFFFFF', onInkSoft: 'rgba(255,255,255,0.72)', ink: '#06141B',
    topBar: 'rgba(243,244,244,0.92)', dot: '#CCD0CF', placeholder: '#62727D',
    shadowTab: '0 -8px 24px rgba(6,20,27,0.06)', shadowAccent: '0 10px 24px rgba(17,33,45,0.35)', shadowSheet: '0 -12px 40px rgba(6,20,27,0.18)',
    red: '#E5484D', redText: '#C8282E', redBg: '#FDECEC', onRed: '#FFFFFF',
    siteBar: '#CCD0CF', siteBarWarn: '#9BA8AB', onSiteBar: '#06141B', onSiteBarWarn: '#06141B',
    q0: '#11212D', q1: '#4A5C6A', q2: '#9BA8AB', q3: '#CCD0CF',
    heroBg: 'linear-gradient(150deg, #253745 0%, #11212D 50%, #06141B 100%)', heroText: '#FFFFFF', heroSoft: 'rgba(255,255,255,0.8)',
    heroLine: '#FFFFFF', heroGrid: 'rgba(255,255,255,0.16)', heroBtn: 'rgba(255,255,255,0.14)', heroChip: '#FFFFFF', heroChipText: '#C8282E',
};

function labTheme(v: PaletteValues, extra: Pick<LabTheme, 'borderStrong' | 'grid' | 'skeletonA' | 'skeletonB' | 'tooltipBg' | 'tooltipFg' | 'focus'>): LabTheme {
    return {
        font: FONT, page: v.page, surface: v.card, tile: v.track, border: v.border, text: v.text, text2: v.text2, text3: v.text3,
        primary: v.accent, onPrimary: v.onAccent, tint: v.tint, ramp: [v.q0, v.q1, v.q2, v.q3],
        radius: '22px', radiusSm: '14px', chipRadius: '999px', btnRadius: '999px', ...extra,
    };
}

export const PALETTES: Record<PaletteName, Palette> = {
    cobalt: {
        name: 'cobalt', values: COBALT, heroDark: true, scheme: 'light',
        theme: labTheme(COBALT, { borderStrong: '#CDD3E0', grid: '#EBEEF5', skeletonA: '#EEF1F7', skeletonB: '#E1E6F0', tooltipBg: '#0E1424', tooltipFg: '#FFFFFF', focus: '#1E44C2' }),
    },
    slate: {
        name: 'slate', values: SLATE, heroDark: false, scheme: 'dark',
        theme: labTheme(SLATE, { borderStrong: '#4A5C6A', grid: '#253745', skeletonA: '#1A2B38', skeletonB: '#253745', tooltipBg: '#FFFFFF', tooltipFg: '#06141B', focus: '#FFFFFF' }),
    },
    slateLight: {
        name: 'slateLight', values: SLATE_LIGHT, heroDark: true, scheme: 'light',
        theme: labTheme(SLATE_LIGHT, { borderStrong: '#CCD0CF', grid: '#ECEEEE', skeletonA: '#ECEEEE', skeletonB: '#E0E3E3', tooltipBg: '#06141B', tooltipFg: '#FFFFFF', focus: '#253745' }),
    },
};

const KEYS = Object.keys(COBALT) as (keyof PaletteValues)[];
const varName = (k: string) => `--cb-${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;

/** Every token as a CSS variable reference, so one component styles itself for either palette. */
export const C = Object.fromEntries(KEYS.map(k => [k, `var(${varName(k)})`])) as Record<keyof PaletteValues, string>;

/** The CSS variables (Cobalt's own, plus the lab's) that put a palette on the app root. */
export function paletteVars(p: Palette): CSSProperties {
    return Object.fromEntries(KEYS.map(k => [varName(k), p.values[k]])) as CSSProperties;
}

/** The lab variables inside a light hero card, so badges, skeletons and errors read dark on light there. */
export function heroLabVars(p: Palette): CSSProperties {
    if (p.heroDark) return {};
    return {
        '--lab-text': p.values.heroText, '--lab-text2': p.values.heroSoft, '--lab-text3': p.values.heroSoft,
        '--lab-border-strong': 'rgba(6,20,27,0.35)', '--lab-skel-a': 'rgba(6,20,27,0.08)', '--lab-skel-b': 'rgba(6,20,27,0.16)',
    } as CSSProperties;
}

/** Figures: bold, tight and tabular so columns of numbers line up. */
export const fig: CSSProperties = { fontWeight: 700, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums' };

export const QUEUES: QueueId[] = ['po', 'mr', 'petty', 'escalation'];
export const QUEUE_COLORS: Record<QueueId, string> = { po: C.q0, mr: C.q1, petty: C.q2, escalation: C.q3 };
export const QUEUE_SHORT: Record<QueueId, string> = { po: 'Purchase orders', mr: 'Materials', petty: 'Petty cash', escalation: 'Escalations' };

export type SiteSort = 'score' | 'active' | 'name';
export type SiteFilter = 'all' | 'attention' | 'over';
export type TicketView = 'active' | 'sla' | 'urgent' | 'unassigned' | 'waitlist' | 'resolved';

export type Route =
    | { name: 'home' }
    | { name: 'tickets'; view?: TicketView; site?: string }
    | { name: 'ticket'; id: string }
    | { name: 'newTicket'; site?: string }
    | { name: 'approvals'; queue?: QueueId }
    | { name: 'sites'; sort?: SiteSort; filter?: SiteFilter }
    | { name: 'more' }
    | { name: 'site'; id: string }
    | { name: 'money' }
    | { name: 'people' }
    | { name: 'compliance' }
    | { name: 'notifications' }
    | { name: 'search' };

export type TabName = 'home' | 'tickets' | 'approvals' | 'sites';
export const TAB_ROOTS: TabName[] = ['home', 'tickets', 'approvals', 'sites'];

export type Sheet =
    | { kind: 'create' }
    | { kind: 'approval'; id: string; reject?: boolean }
    | { kind: 'assign'; id: string };
export type Decision = 'approved' | 'rejected';

/** Where a screen is opened from when it is not a tab of its own, so Back has somewhere to go. */
export function stackFor(r: Route): Route[] {
    if ((TAB_ROOTS as string[]).includes(r.name)) return [r];
    if (r.name === 'site') return [{ name: 'sites' }, r];
    if (r.name === 'ticket' || r.name === 'newTicket') return [{ name: 'tickets' }, r];
    if (r.name === 'money' || r.name === 'people' || r.name === 'compliance') return [{ name: 'home' }, { name: 'more' }, r];
    return [{ name: 'home' }, r];
}

/** An org wide ticket: the lab's ticket shape plus the site it belongs to. */
export interface OrgTicket extends LabTicket {
    site: string;
    /** Notes you added here (preview only). */
    notes: { at: Date; text: string }[];
    /** Raised here in this preview. */
    local?: boolean;
}

export interface TicketDraft {
    site: string;
    category: string;
    priority: Priority;
    title: string;
    location: string;
    description: string;
    assignee: string | null;
}

export interface CobaltApp {
    m: OrgModel;
    p: Palette;
    route: Route;
    /** Screens below this one; 0 on a tab. */
    depth: number;
    /** Switch tab, or open a screen from scratch (clears Back). */
    go: (r: Route) => void;
    push: (r: Route) => void;
    /** Swap the current screen for another, so Back skips it (after a form is sent). */
    replace: (r: Route) => void;
    back: () => void;
    sheet: Sheet | null;
    openSheet: (s: Sheet) => void;
    closeSheet: () => void;
    /** A short message above the tab bar, with Undo when one is given. */
    notify: (text: string, undo?: () => void) => void;
    /** Items still waiting, after what you approved or rejected here. */
    items: Feed<ApprovalItem[]>;
    /** Count per queue after local decisions; null while unknown. */
    pending: Record<QueueId, number | null>;
    pendingTotal: number | null;
    decide: (ids: string[], d: Decision, reason?: string) => void;
    /** Org wide tickets with what you changed or raised here applied. */
    tickets: Feed<OrgTicket[]>;
    updateTicket: (id: string, patch: { status?: TicketStatus; assignee?: string | null; priority?: Priority }, message: string) => void;
    addNote: (id: string, text: string) => void;
    raiseTicket: (d: TicketDraft) => string;
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

/** "Just now", "40 min ago", "3 h ago", "2 days ago". */
export function sinceLabel(now: Date, at: Date): string {
    const min = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60000));
    if (min < 1) return 'Just now';
    if (min < 60) return `${min} min ago`;
    if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`;
    const d = Math.floor(min / (24 * 60));
    return d === 1 ? '1 day ago' : `${d} days ago`;
}
