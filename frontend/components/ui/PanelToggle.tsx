'use client';

import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

/**
 * The collapse / expand button for side panels (owner 2026-11-09). Each console has one look, and its sidebar and the
 * Candidate Search filters inside it use the same one:
 *   "panel"   : the Tech console's sidebar button (panel icon)
 *   "chevron" : the shared (HR) sidebar's button (chevron in a soft rounded box)
 * The caller passes the display and position classes (e.g. "inline-flex", or "hidden lg:flex lg:absolute lg:right-3").
 */
export type PanelToggleVariant = 'panel' | 'chevron';

/** The look of each variant, also used where the whole strip is the button (FilterStrip) and cannot hold another. */
export const PANEL_TOGGLE_LOOK: Record<PanelToggleVariant, string> = {
    panel: 'h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-muted hover:text-text-primary',
    chevron: 'shrink-0 items-center justify-center p-1.5 rounded-xl bg-slate-100/90 hover:bg-slate-200 dark:bg-slate-800/90 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-all border border-slate-200/80 dark:border-slate-700/80 shadow-2xs cursor-pointer group',
};

export function PanelToggleIcon({ variant, collapsed }: { variant: PanelToggleVariant; collapsed: boolean }) {
    if (variant === 'chevron') {
        return collapsed
            ? <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" aria-hidden />
            : <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" aria-hidden />;
    }
    return collapsed ? <PanelLeftOpen className="h-5 w-5" aria-hidden /> : <PanelLeftClose className="h-5 w-5" aria-hidden />;
}

export default function PanelToggle({ collapsed, onToggle, label, variant = 'panel', className = 'inline-flex' }: {
    collapsed: boolean;
    onToggle: () => void;
    /** What a click does, e.g. "Collapse sidebar". Used as the tooltip and the accessible name. */
    label: string;
    variant?: PanelToggleVariant;
    className?: string;
}) {
    return (
        <button type="button" onClick={onToggle} aria-label={label} title={label} aria-expanded={!collapsed} className={`${PANEL_TOGGLE_LOOK[variant]} ${className}`}>
            <PanelToggleIcon variant={variant} collapsed={collapsed} />
        </button>
    );
}
