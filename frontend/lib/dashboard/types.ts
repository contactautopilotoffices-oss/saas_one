import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * The widget contract.
 *
 * Every module on the ops dashboard is a widget: a self-contained card that fetches its
 * own data, reports its own urgency, and re-composes itself at four sizes.
 *
 * SIZE CLASSES follow Apple's widget guidance rather than a naive scale-up. Their rule is
 * that a larger widget shows MORE INFORMATION, not the same information larger — a small
 * widget answers one question, a large one answers the follow-up. So each widget renders a
 * genuinely different composition per size:
 *
 *   sm  1x1  One number and its severity. "Is this fine?"
 *   md  2x1  Number + comparison to the previous period + a compact visual. "Which way?"
 *   lg  2x2  Adds the breakdown — the ranked list or chart. "Where exactly?"
 *   xl  4x2  Adds detail rows and secondary metrics. "What do I do about it?"
 *
 * A widget declares only the sizes it can honestly fill. A tile with one number should not
 * offer `xl` and pad it with whitespace.
 */

export type WidgetSize = 'sm' | 'md' | 'lg' | 'xl';

/**
 * Severity ladder, rendered as the LED dot and the card's top hairline.
 *
 *   ok        Nothing to say. No colour.
 *   info      Worth noticing, including good news (consumption down, all bills settled).
 *   warn      Someone should act this week.
 *   critical  Someone should act today. The only rung that animates.
 */
export type Severity = 'ok' | 'info' | 'warn' | 'critical';

export const SEVERITY_RANK: Record<Severity, number> = { ok: 0, info: 1, warn: 2, critical: 3 };

export function maxSeverity(a: Severity, b: Severity): Severity {
    return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** Grid footprint per size class. Columns are of a 4-column desktop grid. */
export const SIZE_SPAN: Record<WidgetSize, { col: number; row: number }> = {
    sm: { col: 1, row: 1 },
    md: { col: 2, row: 1 },
    lg: { col: 2, row: 2 },
    xl: { col: 4, row: 2 },
};

export const SIZE_LABEL: Record<WidgetSize, string> = {
    sm: 'Small', md: 'Medium', lg: 'Large', xl: 'Wide',
};

/** Props every widget body receives from the grid. */
export interface WidgetProps {
    orgId: string;
    size: WidgetSize;
    /**
     * Report urgency up to the shell so it can paint the LED. Widgets must call this on
     * every data change, including back down to 'ok' — a stale 'critical' is worse than
     * none, because it teaches people the light is meaningless.
     */
    onSeverity: (s: Severity) => void;
    /** Surface a one-line "so what" in the card header area. */
    onHeadline?: (text: string | null) => void;
    /**
     * Report when this widget's data was last fetched, so the shell can render the
     * "synced 4m ago" stamp. The widget owns this because only it knows which endpoint it
     * reads — the grid has no idea.
     */
    onFetchedAt?: (ts: number | null) => void;
}

export interface WidgetDef {
    id: string;
    title: string;
    /** Shown in the add-widget picker, not on the card. */
    description: string;
    icon: LucideIcon;
    /**
     * Roles permitted to see this widget. The grid filters the picker by this, but it is a
     * UX filter only — every widget's API enforces its own access. Notably the mail digest
     * is procurement + super admin, narrower than the rest of this dashboard.
     */
    roles: string[];
    sizes: WidgetSize[];
    defaultSize: WidgetSize;
    /** Deep link to the full module, rendered as the card's "open" affordance. */
    href?: (orgId: string) => string;
    /** Lazy-loaded so 14 widgets do not all ship in the first bundle. */
    load: () => Promise<{ default: ComponentType<WidgetProps> }>;
    /** Default position for a user who has never customised. Lower sorts first. */
    defaultOrder: number;
    /** false = registered but not in the default layout; users can add it. */
    defaultVisible?: boolean;
}

/** One card's persisted state. */
export interface WidgetLayoutItem {
    widget_id: string;
    size: WidgetSize;
    position: number;
    is_visible: boolean;
    /** User explicitly placed this. Pinned cards are never auto-reshuffled. */
    is_pinned?: boolean;
}
