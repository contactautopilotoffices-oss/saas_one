'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Copy, LoaderCircle, X } from 'lucide-react';
import ModalPortal from '@/frontend/components/ui/ModalPortal';
import { STATUS_LABELS, RECORD_STATUSES, type RecordStatus } from '@/backend/lib/candidates/types';
import { STATUS_DOT } from './format';
import type { ApiFailure } from './api';

/*
 * Design values for the Candidate Search tab. Sources (quoted verbatim in docs/DASHBOARD_REDESIGN_RCA.md and
 * docs/DESIGN_AUDIT_OPS_BOARD.md; the awesome-design-md library they quote is not on disk in this checkout):
 *
 *  - Elevation: Vercel's stacked-shadow ladder with the 1px hairline ring on every level, "never a single 8-px-blur
 *    generic drop". Reused from the existing :root tokens in app/globals.css: --w-shadow (L2, rest), --w-shadow-hover
 *    (L3), --w-shadow-drag (L5, overlays; the hairline ring is added back here because that token omits it).
 *  - Surface ladder: Linear's 4 steps, "avoid skipping levels": page white -> recessed bg-surface-elevated (L1: tracks,
 *    filter bars, card wells) -> white card at L2 -> overlay at L5.
 *  - Spacing: Vercel "large gaps + tight interior, never the other way around": 8px inside stacks, 16px between cards,
 *    24px between sections. Card padding 16px on phones, 24px from sm up (Binance: 24px card padding).
 *  - Numbers: Binance's separate numeric scale: number-md 16/500/1.4, number-sm 14/500/1.4; the headline figure uses the
 *    repo's --w-num-lg (32/700/1.1) with Binance's -0.3px display tracking. tabular-nums on every figure.
 *  - Rows: Binance row geometry: 12px vertical row padding, transparent rows, hairline divider between rows.
 *  - Semantic colour: Binance "applied as text colour rather than badge background ... don't use them as background
 *    fills on cards". Status = neutral pill + coloured dot + label, so shape/text is the redundant channel
 *    (glass-ambient B0, via the Ops Board audit).
 *  - Labels: small and quiet (monopo design.md: small labels "label everything else with confident minimalism"), but
 *    sentence case at weight 500: app/globals.css forces `label { text-transform: none !important; font-weight: 500 }`
 *    ("Kill all caps permanently"), so every label here follows that house rule for consistency.
 *  - Warning amber (#F59E0B) is never a text colour: 2.07:1 on light (app/globals.css, glass-ambient note). Icons only.
 *  - Motion: monopo's cubic-bezier(0.19, 1, 0.22, 1) (repo token --w-ease-patient) at the Ops Board's UI durations
 *    (220ms entry, 360ms hover glide), not monopo's 0.8-1.25s marketing durations.
 *  - Exact spacing (owner 2026-11-11, redesign): app/globals.css redefines Tailwind's .p-1 … .p-6 and .gap-1 … .gap-6
 *    on an 8px scale (p-4 = 32px, gap-2 = 16px). In this folder use the two-axis utilities instead (px-4 py-4,
 *    gap-x-2 gap-y-2): globals.css does not touch them, so a class means its standard size. Variants (sm:p-6) are safe.
 *  - Glass: none. Ops Board audit: "surfaces are essentially opaque; sharpness comes from a hairline edge + tight stacked
 *    shadow, not blur", and glass-ambient: blur is a no-op on our near-white canvas.
 */

export const EASE_PATIENT = [0.19, 1, 0.22, 1] as const;

export const CARD = 'rounded-2xl bg-surface shadow-[var(--w-shadow)]';
export const CARD_HOVER = 'transition-shadow duration-[360ms] ease-[var(--w-ease-patient)] hover:shadow-[var(--w-shadow-hover)]';
export const OVERLAY = 'bg-surface shadow-[0_0_0_1px_rgba(0,0,0,0.08),var(--w-shadow-drag)]';
export const WELL = 'rounded-xl bg-surface-elevated';

/** Owner 2026-11-11: small labels are in the secondary text colour; the tertiary one (42% ink) read as washed out and is kept for placeholders and dashes. */
export const LABEL = 'text-xs font-medium text-text-secondary';
export const NUM_LG = 'font-display text-[32px] font-bold leading-[1.1] tracking-[-0.3px] tabular-nums';
export const NUM_MD = 'font-display text-base font-medium leading-[1.4] tabular-nums';
export const NUM_SM = 'font-display text-sm font-medium leading-[1.4] tabular-nums';

export const BTN_PRIMARY =
    'inline-flex h-10 shrink-0 items-center justify-center gap-x-2 gap-y-2 rounded-xl bg-primary px-4 text-sm font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50';
export const BTN_SECONDARY =
    'inline-flex h-10 shrink-0 items-center justify-center gap-x-2 gap-y-2 rounded-xl bg-surface px-4 text-sm font-bold text-text-primary shadow-[var(--w-shadow)] transition-shadow duration-[360ms] ease-[var(--w-ease-patient)] hover:shadow-[var(--w-shadow-hover)] disabled:cursor-not-allowed disabled:opacity-50';
export const BTN_GHOST =
    'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-text-secondary transition-colors hover:bg-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50';
export const BTN_DANGER_GHOST =
    'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-error transition-colors hover:bg-error/[.08] disabled:cursor-not-allowed disabled:opacity-50';
/**
 * 16px text below sm so iOS Safari does not zoom the page on focus. INPUT fills its row; FIELD is the same box at its
 * own width, for a select or a date that sits beside others (adding `w-auto` to INPUT does not win over its `w-full`).
 */
export const FIELD =
    'h-10 min-w-0 rounded-xl border border-border bg-surface px-3 text-base text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60 sm:text-sm';
export const INPUT = `w-full ${FIELD}`;

/* ------------------------------------------------------------------------------------------------------------------ */

interface UiApi {
    notify: (message: string, type?: 'success' | 'error' | 'info') => void;
    /** Shows a failed call: 401/403 switches the whole tab to the no-access panel, anything else is a toast. */
    reportError: (failure: ApiFailure) => void;
}

const UiContext = createContext<UiApi>({ notify: () => {}, reportError: () => {} });
export const UiProvider = UiContext.Provider;
export const useUi = () => useContext(UiContext);

/* ------------------------------------------------------------------------------------------------------------------ */

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
    return <LoaderCircle className={`${className} animate-spin`} aria-hidden />;
}

export function StatusBadge({ status }: { status: RecordStatus }) {
    return (
        <span className="inline-flex h-6 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-elevated px-2.5 text-xs font-semibold text-text-primary ring-1 ring-inset ring-border">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
            {STATUS_LABELS[status]}
        </span>
    );
}

/** Native select (best on phones) dressed as the status pill. */
export function StatusSelect({
    value, onChange, disabled, busy, label = 'Status',
}: { value: RecordStatus; onChange: (s: RecordStatus) => void; disabled?: boolean; busy?: boolean; label?: string }) {
    return (
        <label className="relative inline-flex h-8 items-center rounded-full bg-surface-elevated ring-1 ring-inset ring-border focus-within:ring-2 focus-within:ring-primary/40">
            <span className="sr-only">{label}</span>
            <span className="pointer-events-none absolute left-2.5 flex items-center">
                {busy ? <Spinner className="h-3 w-3 text-text-tertiary" /> : <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[value]}`} aria-hidden />}
            </span>
            <select
                value={value}
                disabled={disabled || busy}
                onChange={e => onChange(e.target.value as RecordStatus)}
                className="h-full cursor-pointer appearance-none rounded-full bg-transparent py-0 pl-6 pr-7 text-xs font-semibold text-text-primary outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
                {RECORD_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <svg className="pointer-events-none absolute right-2.5 h-3 w-3 text-text-tertiary" viewBox="0 0 12 12" aria-hidden>
                <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        </label>
    );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
    return (
        <label className="inline-flex h-10 cursor-pointer select-none items-center gap-2.5 text-sm font-semibold text-text-secondary">
            <input type="checkbox" className="peer sr-only" checked={checked} onChange={e => onChange(e.target.checked)} />
            <span className="relative h-5 w-9 shrink-0 rounded-full bg-border transition-colors duration-200 peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 peer-checked:after:translate-x-4" aria-hidden />
            {label}
        </label>
    );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const t = setTimeout(() => setCopied(false), 1500);
        return () => clearTimeout(t);
    }, [copied]);
    return (
        <button
            type="button"
            aria-label={copied ? 'Copied' : `Copy ${label}`}
            title={copied ? 'Copied' : `Copy ${label}`}
            onClick={() => { void navigator.clipboard?.writeText(value).then(() => setCopied(true)).catch(() => {}); }}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-muted hover:text-text-primary"
        >
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
    );
}

/* ---- Redesign (owner 2026-11-11): the pieces the denser screens share ------------------------------------------- */

/** "Asha Rao" -> "AR", "asha" -> "A", "" -> "?". */
export function initials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const first = words[0][0] ?? '';
    const last = words.length > 1 ? words[words.length - 1][0] ?? '' : '';
    return (first + last).toUpperCase();
}

const AVATAR_SIZE = { sm: 'h-8 w-8 rounded-lg text-xs', md: 'h-10 w-10 rounded-xl text-sm', lg: 'h-12 w-12 rounded-xl text-base' } as const;

/** Initials on a recessed tile (surface ladder L1), so rows are told apart at a glance without a photo. */
export function Avatar({ name, size = 'md' }: { name: string; size?: keyof typeof AVATAR_SIZE }) {
    return (
        <span aria-hidden className={`${AVATAR_SIZE[size]} inline-flex shrink-0 select-none items-center justify-center bg-surface-elevated font-display font-semibold text-primary-dark ring-1 ring-inset ring-border-subtle`}>
            {initials(name)}
        </span>
    );
}

/**
 * A small label. Tones follow the tags the result card already used: a light tint with dark text of the same family
 * (never the status colours as a fill, never amber as a text colour).
 */
const TAG_TONE = {
    success: 'bg-success/15 text-emerald-800',
    info: 'bg-info/10 text-blue-800',
    warn: 'bg-warning/15 text-amber-800',
    neutral: 'bg-muted text-text-secondary',
} as const;

export function Tag({ tone = 'neutral', icon: Icon, title, children }: {
    tone?: keyof typeof TAG_TONE; icon?: React.ComponentType<{ className?: string }>; title?: string; children: React.ReactNode;
}) {
    return (
        <span title={title} className={`inline-flex h-[22px] max-w-full items-center gap-x-1 gap-y-1 whitespace-nowrap rounded-full px-2 text-xs font-semibold ${TAG_TONE[tone]}`}>
            {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden />}
            <span className="truncate">{children}</span>
        </span>
    );
}

/** Text with the search keywords marked (the brand's sand tint; the weight change is the second cue). */
export function Marked({ parts }: { parts: { text: string; hit?: true }[] }) {
    return (
        <>
            {parts.map((part, i) => (part.hit
                ? <mark key={i} className="rounded-[3px] bg-secondary/25 px-0.5 font-semibold text-text-primary">{part.text}</mark>
                : <React.Fragment key={i}>{part.text}</React.Fragment>))}
        </>
    );
}

/** Closes on Escape. */
function useEscape(open: boolean, onClose: () => void) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);
}

/** Centred dialog. Below sm it docks to the bottom edge as a sheet. */
export function Dialog({
    open, onClose, title, description, children, footer, size = 'md', labelId,
}: {
    open: boolean; onClose: () => void; title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode;
    footer?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; labelId: string;
}) {
    useEscape(open, onClose);
    const width = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size];
    return (
        <ModalPortal>
            <AnimatePresence>
                {open && (
                    <motion.div
                        key="backdrop"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}
                        className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4"
                        onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
                    >
                        <motion.div
                            role="dialog" aria-modal="true" aria-labelledby={labelId}
                            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
                            transition={{ duration: 0.22, ease: EASE_PATIENT }}
                            className={`${OVERLAY} flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl ${width}`}
                        >
                            <div className="flex items-start gap-x-3 gap-y-3 px-4 pb-2 pt-4 sm:px-6 sm:pt-6">
                                <div className="min-w-0 flex-1">
                                    <h2 id={labelId} className="font-display text-lg font-semibold leading-snug text-text-primary">{title}</h2>
                                    {description && <div className="mt-1 text-sm text-text-secondary">{description}</div>}
                                </div>
                                <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-tertiary hover:bg-muted hover:text-text-primary">
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            {children && <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2 sm:px-6">{children}</div>}
                            {footer && <div className="flex flex-col-reverse gap-x-2 gap-y-2 border-t border-border-subtle px-4 py-3 sm:flex-row sm:justify-end sm:px-6 sm:py-4">{footer}</div>}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </ModalPortal>
    );
}

/**
 * Right-hand drawer on sm and up, full screen on phones. `wide` is the candidate's workspace (owner 2026-11-11): room
 * for the resume beside the details; its body does not scroll, so each pane inside can scroll on its own.
 */
export function Drawer({
    open, onClose, title, children, footer, labelId, wide = false, subtitle,
}: {
    open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; labelId: string;
    wide?: boolean; subtitle?: React.ReactNode;
}) {
    useEscape(open, onClose);
    return (
        <ModalPortal>
            <AnimatePresence>
                {open && (
                    <motion.div
                        key="drawer"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}
                        className="fixed inset-0 z-[90] flex justify-end bg-slate-900/40"
                        onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
                    >
                        <motion.aside
                            role="dialog" aria-modal="true" aria-labelledby={labelId}
                            initial={{ x: 48, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 48, opacity: 0 }}
                            transition={{ duration: 0.36, ease: EASE_PATIENT }}
                            className={`${OVERLAY} flex h-[100dvh] w-full flex-col sm:rounded-l-2xl ${wide ? 'sm:max-w-xl lg:max-w-[min(1360px,calc(100vw-4rem))]' : 'sm:max-w-xl'}`}
                        >
                            <div className="flex min-h-14 shrink-0 items-center gap-x-3 gap-y-3 border-b border-border-subtle px-4 py-2 sm:min-h-16 sm:px-6">
                                <div className="min-w-0 flex-1">
                                    <h2 id={labelId} className="truncate font-display text-lg font-semibold text-text-primary">{title}</h2>
                                    {subtitle && <div className="truncate text-sm text-text-secondary">{subtitle}</div>}
                                </div>
                                <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-tertiary hover:bg-muted hover:text-text-primary">
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <div className={wide ? 'flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6'}>{children}</div>
                            {footer && <div className="flex shrink-0 gap-x-2 gap-y-2 border-t border-border-subtle px-4 py-3 sm:justify-end sm:px-6">{footer}</div>}
                        </motion.aside>
                    </motion.div>
                )}
            </AnimatePresence>
        </ModalPortal>
    );
}

/** Slides its content open and shut. Content overflows only once open, so a dropdown inside it is not cut off. */
export function Reveal({ open, children }: { open: boolean; children: React.ReactNode }) {
    const [settled, setSettled] = useState(open);
    useEffect(() => {
        const t = setTimeout(() => setSettled(open), open ? 300 : 0);
        return () => clearTimeout(t);
    }, [open]);
    return (
        <div className={`grid transition-[grid-template-rows,opacity,visibility] duration-300 ease-[var(--w-ease-patient)] motion-reduce:transition-none ${open ? 'visible grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0'}`}>
            <div className={`min-h-0 ${open && settled ? 'overflow-visible' : 'overflow-hidden'}`}>{children}</div>
        </div>
    );
}

const watchPointer = (notify: () => void) => {
    const media = window.matchMedia('(pointer: coarse)');
    media.addEventListener('change', notify);
    return () => media.removeEventListener('change', notify);
};
const useCoarsePointer = () => useSyncExternalStore(watchPointer, () => window.matchMedia('(pointer: coarse)').matches, () => false);

export interface DropdownOption<T extends string> {
    value: T;
    label: string;
    /** A background class for the status dot. */
    dot?: string;
}

/** Tallest a dropdown's menu gets before it scrolls: nine rows, so the eight ways to sort the list show at once. */
const MENU_MAX = 340;

const DROPDOWN_TRIGGER = {
    field: 'h-10 w-full rounded-xl pl-3 pr-2.5 text-sm font-medium',
    compact: 'h-9 w-full rounded-[10px] pl-3 pr-2.5 text-sm font-medium',
    tight: 'h-10 shrink-0 rounded-xl pl-2 pr-1.5 text-[13px] font-medium',
    pill: 'h-8 rounded-full bg-surface-elevated pl-2.5 pr-2 text-xs font-semibold',
} as const;

/**
 * The dropdown of the Candidate Search filters: arrows, Enter and Escape work, and the menu floats above the page, so a
 * scrolling panel cannot cut it off. On a touch screen it is the phone's own picker, which is the easiest one to use there.
 */
export function Dropdown<T extends string>({
    value, options, onChange, label, id, variant = 'field', align = 'left',
}: {
    value: T; options: DropdownOption<T>[]; onChange: (value: T) => void; label: string; id?: string;
    variant?: keyof typeof DROPDOWN_TRIGGER; align?: 'left' | 'right';
}) {
    const coarse = useCoarsePointer();
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const [menu, setMenu] = useState<{ top?: number; bottom?: number; left?: number; right?: number; minWidth: number } | null>(null);
    const [active, setActive] = useState(-1);
    const at = options.findIndex(o => o.value === value);
    const current = options[at] ?? options[0];
    const open = !!menu;

    useEffect(() => {
        if (!open) return;
        const close = () => setMenu(null);
        window.addEventListener('scroll', close, true);
        window.addEventListener('resize', close);
        return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
    }, [open]);

    const show = () => {
        const box = buttonRef.current?.getBoundingClientRect();
        if (!box) return;
        const height = Math.min(MENU_MAX, options.length * 36 + 8);
        const flip = box.bottom + height + 8 > window.innerHeight && box.top > height;
        setMenu({
            ...(flip ? { bottom: window.innerHeight - box.top + 4 } : { top: box.bottom + 4 }),
            ...(align === 'right' ? { right: window.innerWidth - box.right } : { left: box.left }),
            minWidth: box.width,
        });
        setActive(at);
    };
    const choose = (next: T) => { setMenu(null); if (next !== value) onChange(next); };

    if (coarse) {
        return (
            <select id={id} aria-label={label} value={value} onChange={e => onChange(e.target.value as T)} className={`${DROPDOWN_TRIGGER[variant]} max-w-full border border-border bg-surface text-text-primary outline-none`}>
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
        );
    }

    return (
        <>
            <button
                ref={buttonRef}
                id={id}
                type="button"
                aria-label={label}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => (open ? setMenu(null) : show())}
                onBlur={() => setMenu(null)}
                onKeyDown={e => {
                    if (e.key === 'Escape' && open) { e.preventDefault(); setMenu(null); return; }
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        if (!open) { show(); return; }
                        setActive(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
                        return;
                    }
                    if ((e.key === 'Enter' || e.key === ' ') && open) {
                        e.preventDefault();
                        if (options[active]) choose(options[active].value);
                    }
                }}
                className={`${DROPDOWN_TRIGGER[variant]} flex items-center justify-between gap-1.5 border border-border bg-surface text-left text-text-primary transition-[border-color,box-shadow] duration-150 hover:border-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 aria-expanded:border-primary aria-expanded:ring-2 aria-expanded:ring-primary/20`}
            >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    {current.dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${current.dot}`} aria-hidden />}
                    <span className="truncate">{current.label}</span>
                </span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            {menu && (
                <ModalPortal>
                    <motion.ul
                        role="listbox"
                        aria-label={label}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.16, ease: EASE_PATIENT }}
                        style={menu}
                        className={`${OVERLAY} fixed z-[95] max-h-[340px] overflow-y-auto rounded-xl px-1 py-1`}
                    >
                        {options.map((o, i) => {
                            const on = o.value === value;
                            return (
                                <li key={o.value} role="option" aria-selected={on}>
                                    <button
                                        type="button"
                                        tabIndex={-1}
                                        // Mouse down, not click: the button above keeps focus, so its blur does not close this first.
                                        onMouseDown={e => { e.preventDefault(); choose(o.value); }}
                                        onMouseEnter={() => setActive(i)}
                                        className={`flex h-9 w-full items-center gap-x-2 gap-y-2 whitespace-nowrap rounded-lg px-2.5 text-left text-sm ${i === active ? 'bg-muted' : ''} ${on ? 'font-semibold text-primary-dark' : 'font-medium text-text-primary'}`}
                                    >
                                        {o.dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${o.dot}`} aria-hidden />}
                                        <span className="min-w-0 flex-1">{o.label}</span>
                                        {on && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                                    </button>
                                </li>
                            );
                        })}
                    </motion.ul>
                </ModalPortal>
            )}
        </>
    );
}

export const STATUS_OPTIONS: DropdownOption<RecordStatus>[] = RECORD_STATUSES.map(value => ({ value, label: STATUS_LABELS[value], dot: STATUS_DOT[value] }));

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className={LABEL}>{label}</dt>
            <dd className={`${NUM_MD} mt-1 text-text-primary`}>{value}</dd>
            {hint && <dd className="mt-0.5 text-xs text-text-tertiary">{hint}</dd>}
        </div>
    );
}

export function EmptyState({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children?: React.ReactNode }) {
    return (
        <div className="flex flex-col items-center px-4 py-14 text-center">
            <span className={`${WELL} mb-4 inline-flex h-12 w-12 items-center justify-center`}>
                <Icon className="h-6 w-6 text-text-tertiary" />
            </span>
            <p className="font-display text-base font-semibold text-text-primary">{title}</p>
            {children && <div className="mt-1 max-w-md text-sm text-text-secondary">{children}</div>}
        </div>
    );
}
