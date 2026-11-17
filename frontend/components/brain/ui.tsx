'use client';

/**
 * Brain Console: small shared pieces. Visual values live in brain.module.css (with their sources); this file only
 * composes them. Everything is a real button or input, with a visible focus ring and a label.
 */
import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, ImageIcon, RotateCw, TriangleAlert } from 'lucide-react';
import type { RoleClass } from '@/backend/lib/aiLayer/brain/config';
import type { BrainChannel, Outcome } from '@/backend/lib/aiLayer/brain/types';
import type { Flag, Note } from '@/backend/lib/aiLayer/brain/console/types';
import s from './brain.module.css';
import { CHANNEL_LABEL, FLAG_LABEL, FLAG_SENTENCE, NOTE_LABEL, ROLE_LABEL, outcomeLabel, outcomeTone, type Tone } from './labels';

export { s };
export const cx = clsx;

const noSubscribe = () => () => {};
/** false on the server and during hydration, true after: portals render only once there is a document. */
export const useMounted = () => useSyncExternalStore(noSubscribe, () => true, () => false);

/** monopo's patient curve ([OPS] in brain.module.css), as a framer-motion easing. */
export const EASE = [0.19, 1, 0.22, 1] as const;

export function useMotion() {
    const reduce = useReducedMotion();
    return {
        reduce: !!reduce,
        /** One-shot 4px rise + fade ([OPS] ".w-tick": "rises 4px and fades in… on the patient curve"). */
        enter: reduce
            ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0 } }
            : { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: EASE } },
        t: (seconds = 0.3) => (reduce ? { duration: 0 } : { duration: seconds, ease: EASE }),
    };
}

// ── Layout ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function Screen({ title, sub, actions, children }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
    const m = useMotion();
    return (
        <motion.section {...m.enter} className="flex min-w-0 flex-col gap-[24px]" aria-labelledby="brain-screen-title">
            <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                <div className="min-w-0 max-w-2xl">
                    <h2 id="brain-screen-title" className={s.h1}>{title}</h2>
                    {sub && <p className="mt-1 text-[13px] leading-relaxed text-(--bc-ink-3)">{sub}</p>}
                </div>
                {actions && <div className="flex flex-wrap items-center gap-[8px]">{actions}</div>}
            </header>
            {children}
        </motion.section>
    );
}

export function Card({ children, className, hover, as: Tag = 'div', ...rest }: { children: React.ReactNode; className?: string; hover?: boolean; as?: 'div' | 'section' | 'article' | 'li' } & React.HTMLAttributes<HTMLElement>) {
    return <Tag className={cx(s.card, hover && s.cardHover, className)} {...rest}>{children}</Tag>;
}

/** Card header: the 11px label, an optional sentence, and a right-hand slot. Tight interior (8px), per vercel. */
export function CardHead({ label, hint, right, icon: Icon, id }: { label: string; hint?: React.ReactNode; right?: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; id?: string }) {
    return (
        <div className="flex min-w-0 items-start justify-between gap-[12px]">
            <div className="min-w-0">
                <h3 id={id} className={cx(s.label, 'flex items-center gap-[8px]')}>{Icon && <Icon className="h-3.5 w-3.5 text-(--bc-ink-3)" />}{label}</h3>
                {hint && <p className="mt-1 text-[12.5px] leading-snug text-(--bc-ink-3)">{hint}</p>}
            </div>
            {right && <div className="flex shrink-0 items-center gap-[8px]">{right}</div>}
        </div>
    );
}

// ── Numbers ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** A figure on binance's numeric ramp. It ticks once (4px rise + fade) when the value changes, never on a loop. */
export function Num({ children, size = 'lg', className, tone }: { children: React.ReactNode; size?: 'display' | 'lg' | 'md' | 'sm'; className?: string; tone?: Tone }) {
    const m = useMotion();
    const cls = size === 'display' ? s.numDisplay : size === 'lg' ? s.numLg : size === 'md' ? s.numMd : s.numSm;
    const color = tone === 'bad' ? 'text-(--bc-bad-text)' : tone === 'warn' ? 'text-(--bc-warn-text)' : tone === 'ok' ? 'text-(--bc-ok-text)' : tone === 'accent' ? 'text-(--bc-accent-text)' : 'text-(--bc-ink-1)';
    return (
        <motion.span key={String(children)} {...m.enter} className={cx(cls, color, 'inline-block', className)}>{children}</motion.span>
    );
}

/** A KPI tile: label, figure, one quiet line. Interior 16px (vercel dense card). */
export function Stat({ label, value, sub, tone, icon: Icon }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone; icon?: React.ComponentType<{ className?: string }> }) {
    return (
        <Card className="flex min-w-0 flex-col gap-[8px] p-[16px]">
            <span className={cx(s.label, 'flex items-start gap-1.5 leading-snug')}>{Icon && <Icon className="mt-px h-3.5 w-3.5 shrink-0" />}{label}</span>
            <Num tone={tone}>{value}</Num>
            {sub && <span className="text-[12px] leading-snug text-(--bc-ink-3)">{sub}</span>}
        </Card>
    );
}

// ── Chips ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function Chip({ tone = 'neutral', icon: Icon, children, title, className }: { tone?: Tone; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; title?: string; className?: string }) {
    return (
        <span className={cx(s.chip, s[`tone-${tone}`], className)} title={title}>
            {Icon && <Icon className="h-3 w-3" />}{children}
        </span>
    );
}

/**
 * The person, as the opaque tag the server sends: same person, same day → same tag. A neutral hexagon, never a circle
 * with initials: nothing here may look like identity.
 */
export function PersonTag({ tag }: { tag: string }) {
    return (
        <span className={s.tag} title="A tag for one person on one day. It does not say who they are.">
            <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 text-(--bc-ink-3)"><path d="M6 1 10.5 3.5v5L6 11 1.5 8.5v-5Z" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
            <span>Person <b>{tag}</b></span>
        </span>
    );
}

export const RoleChip = ({ role }: { role: RoleClass | 'unknown' | null }) => <Chip>{ROLE_LABEL[role ?? 'unknown']}</Chip>;
export const ChannelChip = ({ channel }: { channel: BrainChannel }) => <Chip>{CHANNEL_LABEL[channel]}</Chip>;
export const OutcomeChip = ({ outcome }: { outcome: Outcome | string }) => <Chip tone={outcomeTone(outcome)}>{outcomeLabel(outcome)}</Chip>;

/** Flags carry a triangle as well as amber, so they read without colour. */
export function FlagChips({ flags }: { flags: Flag[] }) {
    if (!flags.length) return null;
    return <>{flags.map(f => <Chip key={f} tone="warn" icon={TriangleAlert} title={FLAG_SENTENCE[f]}>{FLAG_LABEL[f]}</Chip>)}</>;
}

export function NoteChips({ notes }: { notes: Note[] }) {
    if (!notes.length) return null;
    return <>{notes.map(n => <Chip key={n} icon={n === 'photo' ? ImageIcon : undefined}>{NOTE_LABEL[n]}</Chip>)}</>;
}

// ── Buttons and inputs ────────────────────────────────────────────────────────────────────────────────────────────

type BtnVariant = 'primary' | 'ghost' | 'ok' | 'bad' | 'quiet';
export function Btn({ variant = 'ghost', size, icon: Icon, children, className, type = 'button', ...rest }: { variant?: BtnVariant; size?: 'sm'; icon?: React.ComponentType<{ className?: string }> } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button type={type} className={cx(s.btn, size === 'sm' && s.btnSm, variant === 'primary' && s.btnPrimary, variant === 'ok' && s.btnOk, variant === 'bad' && s.btnBad, variant === 'quiet' && s.btnQuiet, !children && s.iconBtn, className)} {...rest}>
            {Icon && <Icon className="h-4 w-4 shrink-0" />}{children}
        </button>
    );
}

export interface SegOption<T extends string | number> { value: T; label: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; disabled?: boolean; title?: string }

/** A radio group drawn as a segmented control. Arrow keys move between options; the thumb glides on the patient curve. */
export function Segmented<T extends string | number>({ value, options, onChange, label, size, className }: { value: T; options: SegOption<T>[]; onChange: (v: T) => void; label: string; size?: 'sm'; className?: string }) {
    const id = useId();
    const m = useMotion();
    const refs = useRef<Array<HTMLButtonElement | null>>([]);
    const onKey = (e: React.KeyboardEvent, i: number) => {
        const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        for (let step = 1; step <= options.length; step++) {
            const j = (i + dir * step + options.length) % options.length;
            if (!options[j].disabled) { onChange(options[j].value); refs.current[j]?.focus(); break; }
        }
    };
    return (
        <div role="radiogroup" aria-label={label} className={cx(s.seg, className)}>
            {options.map((o, i) => {
                const on = o.value === value;
                const Icon = o.icon;
                return (
                    <button key={String(o.value)} ref={el => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
                        disabled={o.disabled} title={o.title} onClick={() => onChange(o.value)} onKeyDown={e => onKey(e, i)}
                        className={cx(s.segItem, size === 'sm' && 'min-h-[26px]! px-2.5! text-[12px]!')}>
                        {on && <motion.span layoutId={`seg-${id}`} className={s.segThumb} transition={m.t(0.3)} />}
                        <span>{Icon && <Icon className="h-3.5 w-3.5" />}{o.label}</span>
                    </button>
                );
            })}
        </div>
    );
}

export function Toggle({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
    return (
        <button id={id} type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={s.switch}>
            <span className={s.switchTrack}><span className={s.switchKnob} /></span>
        </button>
    );
}

/** A labelled row: words on the left, the control on the right; stacks on a narrow card. */
export function Field({ label, hint, htmlFor, children, error }: { label: React.ReactNode; hint?: React.ReactNode; htmlFor?: string; children: React.ReactNode; error?: string | null }) {
    return (
        <div className="flex min-w-0 flex-col gap-[8px] py-3 @xs:flex-row @xs:items-center @xs:justify-between @xs:gap-6">
            <div className="min-w-0 @xs:max-w-[62%]">
                {htmlFor ? <label htmlFor={htmlFor} className="text-[13.5px] font-semibold text-(--bc-ink-1)">{label}</label> : <span className="text-[13.5px] font-semibold text-(--bc-ink-1)">{label}</span>}
                {hint && <p className="mt-0.5 text-[12.5px] leading-snug text-(--bc-ink-3)">{hint}</p>}
                {error && <p className="mt-1 text-[12.5px] text-(--bc-bad-text)" role="alert">{error}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-[8px]">{children}</div>
        </div>
    );
}

/**
 * A whole-number input. While typing, the text is the box's own; a valid number inside the range is written through at
 * once, anything else shows the range and goes back to the last good value when the box is left.
 * `width` must be a literal important class such as "w-20!": the .input module rule sets width: 100% and, being
 * unlayered, beats a plain Tailwind utility.
 */
export function NumberField({ id, value, min, max, onChange, suffix, width = 'w-24!', disabled, describedBy }: { id: string; value: number; min: number; max: number; onChange: (n: number) => void; suffix?: string; width?: string; disabled?: boolean; describedBy?: string }) {
    const [text, setText] = useState<string | null>(null);
    const shown = text ?? String(value);
    const n = Number(shown);
    const bad = text !== null && (shown.trim() === '' || !Number.isInteger(n) || n < min || n > max);
    return (
        <span className="flex items-center gap-[8px]">
            <input id={id} inputMode="numeric" className={cx(s.input, s.tab, width, 'text-right')} value={shown} disabled={disabled} aria-invalid={bad}
                aria-describedby={describedBy}
                onFocus={() => setText(String(value))}
                onBlur={() => setText(null)}
                onChange={e => {
                    const t = e.target.value.replace(/[^\d]/g, '');
                    setText(t);
                    const v = Number(t);
                    if (t !== '' && Number.isInteger(v) && v >= min && v <= max) onChange(v);
                }} />
            {suffix && <span className="text-[12.5px] text-(--bc-ink-3)">{suffix}</span>}
            {bad && <span className="sr-only" role="alert">Use a whole number from {min} to {max}.</span>}
            {bad && <span aria-hidden="true" className="text-[12px] text-(--bc-bad-text)">{min}–{max}</span>}
        </span>
    );
}

// ── States ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
    return <div aria-hidden="true" className={cx(s.skeleton, className)} />;
}

/** A screen-shaped placeholder while the first answer is on its way. */
export function LoadingScreen({ label = 'Loading' }: { label?: string }) {
    return (
        <div role="status" aria-live="polite" className="flex flex-col gap-[24px]">
            <span className="sr-only">{label}…</span>
            <Skeleton className="h-7 w-56" />
            <div className="grid grid-cols-2 gap-[16px] @3xl:grid-cols-4">
                {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[104px]" />)}
            </div>
            <Skeleton className="h-64" />
        </div>
    );
}

export function Empty({ icon: Icon, title, children, action }: { icon: React.ComponentType<{ className?: string }>; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
    return (
        <div className="flex flex-col items-center justify-center gap-[12px] px-6 py-14 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-(--bc-l2) text-(--bc-ink-3) shadow-[inset_0_0_0_1px_var(--bc-line)]">
                <Icon className="h-5 w-5" />
            </span>
            <h3 className={s.h2}>{title}</h3>
            {children && <p className="max-w-md text-[13px] leading-relaxed text-(--bc-ink-3)">{children}</p>}
            {action}
        </div>
    );
}

export function ErrorState({ message, onRetry, what }: { message: string; onRetry?: () => void; what?: string }) {
    return (
        <div role="alert" className={cx(s.banner, s.bannerBad, 'items-center')}>
            <AlertCircle className="h-5 w-5 shrink-0 text-(--bc-bad-text)" />
            <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold">{what ? `Could not load ${what}.` : 'Something went wrong.'}</p>
                <p className="text-[12.5px] text-(--bc-ink-2)">{message}</p>
            </div>
            {onRetry && <Btn size="sm" icon={RotateCw} onClick={onRetry}>Try again</Btn>}
        </div>
    );
}

// ── Dialog ────────────────────────────────────────────────────────────────────────────────────────────────────────

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog: focus moves in and is trapped, Escape closes, focus returns to where it was. It is portalled to the
 * body (so no transformed parent can move it) inside a .theme wrapper, so it keeps the console's tokens.
 */
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    const titleId = useId();
    const m = useMotion();
    const mounted = useMounted();
    useEffect(() => { closeRef.current = onClose; });
    useEffect(() => {
        if (!open) return;
        const before = document.activeElement as HTMLElement | null;
        const node = ref.current;
        const list = () => (node ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)) : []);
        (node?.querySelector<HTMLElement>('[data-autofocus]:not([disabled])') ?? list()[0] ?? node)?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(); return; }
            if (e.key !== 'Tab') return;
            const f = list();
            if (!f.length) { e.preventDefault(); return; }
            const first = f[0], last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKey, true);
        return () => { document.removeEventListener('keydown', onKey, true); before?.focus?.(); };
    }, [open]);

    if (!mounted) return null;
    return createPortal(
        <div className={s.theme}>
            <AnimatePresence>
                {open && (
                    <>
                        <motion.div key="scrim" className={s.scrim} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={m.t(0.2)} onClick={onClose} />
                        <motion.div key="dialog" ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
                            className={cx(s.dialog, wide && 'w-[min(720px,calc(100vw-24px))]!')}
                            initial={m.reduce ? { opacity: 0, x: '-50%', y: '-50%' } : { opacity: 0, x: '-50%', y: 'calc(-50% + 8px)' }}
                            animate={{ opacity: 1, x: '-50%', y: '-50%' }}
                            exit={{ opacity: 0, x: '-50%', y: '-50%' }}
                            transition={m.t(0.3)}>
                            <div className="flex flex-col gap-[16px] p-[24px]">
                                <h2 id={titleId} className={s.h1}>{title}</h2>
                                {children}
                            </div>
                            {footer && <div className="sticky bottom-0 flex flex-wrap justify-end gap-[8px] border-t border-(--bc-line) bg-(--bc-l1) px-6 py-4">{footer}</div>}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>,
        document.body,
    );
}

/** A short-lived message at the bottom of the screen, read out politely by screen readers. */
export function Toast({ message, tone }: { message: string | null; tone: 'ok' | 'bad' }) {
    const m = useMotion();
    const mounted = useMounted();
    if (!mounted) return null;
    return createPortal(
        <div className={s.theme}>
            <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-6 z-[95] flex justify-center px-4">
                <AnimatePresence>
                    {message && (
                        <motion.div key={message} initial={m.reduce ? { opacity: 0 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={m.t(0.3)}
                            className={cx(s.banner, tone === 'bad' ? s.toastBad : s.toast, 'pointer-events-auto max-w-md text-[13.5px]')}>
                            {message}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>,
        document.body,
    );
}
