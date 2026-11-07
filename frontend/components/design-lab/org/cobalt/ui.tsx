'use client';

import React, { useEffect, useId, useRef } from 'react';
import { ChevronLeft, ChevronRight, X, type LucideIcon } from 'lucide-react';
import { TipBox, useTip } from '../../lab/charts';
import { H, cx } from '../../lab/ui';
import { C, useApp } from './core';

/** Building blocks shared by Cobalt's screens. */

/** Sub screen header: Back, the title, and room for one action. Sticks while the screen scrolls. */
export function TopBar({ title, right }: { title: string; right?: React.ReactNode }) {
    const { back } = useApp();
    return (
        <header className="sticky top-0 z-20 flex h-[56px] items-center gap-[6px] px-[10px]" style={{ background: C.topBar, backdropFilter: 'blur(12px)' }}>
            <button type="button" onClick={back} aria-label="Back" className="grid h-11 w-11 shrink-0 place-items-center rounded-full" style={{ background: C.card }}>
                <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <H level={1} className="min-w-0 flex-1 truncate px-[4px] text-[17px] font-bold tracking-[-0.02em]">
                <span data-screen-title tabIndex={-1} className="outline-none">{title}</span>
            </H>
            {right}
        </header>
    );
}

/** Tab screen header: a large title with a short line under it. */
export function LargeTitle({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
    return (
        <header className="flex items-end gap-[10px] px-[16px] pb-[6px] pt-[14px]">
            <span className="min-w-0 flex-1">
                <H level={1} className="text-[28px] font-bold leading-tight tracking-[-0.03em]"><span data-screen-title tabIndex={-1} className="outline-none">{title}</span></H>
                {sub && <span className="mt-[2px] block text-[13px]" style={{ color: C.text3 }}>{sub}</span>}
            </span>
            {right}
        </header>
    );
}

export function Section({ title, right, more, children, className }: {
    title: string; right?: React.ReactNode; more?: { label: string; onClick: () => void }; children: React.ReactNode; className?: string;
}) {
    return (
        <section aria-label={title} className={cx('px-[16px] pt-[22px]', className)}>
            <div className="mb-[10px] flex min-h-[28px] items-center justify-between gap-[8px]">
                <span className="flex min-w-0 items-center gap-[6px]">
                    <H level={2} className="truncate text-[17px] font-bold tracking-[-0.02em]">{title}</H>
                    {right}
                </span>
                {more && (
                    <button type="button" onClick={more.onClick} className="-mr-[8px] inline-flex h-10 shrink-0 items-center gap-[2px] rounded-full px-[8px] text-[13px] font-semibold" style={{ color: C.accentDeep }}>
                        {more.label}<ChevronRight className="h-4 w-4" aria-hidden />
                    </button>
                )}
            </div>
            {children}
        </section>
    );
}

export function Card({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
    return <div className={cx('rounded-[22px]', className)} style={{ background: C.card, ...style }}>{children}</div>;
}

/** Round icon. Red only when the caller says the item is an SLA breach or a late round. */
export function IconDot({ icon: Icon, red, size = 40, solid }: { icon: LucideIcon; red?: boolean; size?: number; solid?: boolean }) {
    return (
        <span className="grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, background: red ? C.redBg : solid ? C.accent : C.tint }}>
            <Icon className="h-[18px] w-[18px]" style={{ color: red ? C.red : solid ? C.onAccent : C.accentDeep }} aria-hidden />
        </span>
    );
}

/** A scrolling row of filter pills. One is always on. Counts hide while they are unknown. */
export function Pills<T extends string>({ options, value, onChange, label, className }: {
    options: { id: T; label: string; count?: number | null }[]; value: T; onChange: (v: T) => void; label: string; className?: string;
}) {
    return (
        <div role="radiogroup" aria-label={label} className={cx('lab-scroll-x flex gap-[6px] overflow-x-auto px-[16px]', className)}>
            {options.map(o => {
                const on = o.id === value;
                return (
                    <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.id)}
                        className="inline-flex h-10 shrink-0 items-center gap-[6px] rounded-full px-[14px] text-[13px] font-semibold"
                        style={on ? { background: C.ink, color: C.onInk } : { background: C.card, color: C.text2, boxShadow: `inset 0 0 0 1px ${C.border}` }}>
                        {o.label}
                        {o.count != null && <span className="tabular-nums" style={{ opacity: on ? 0.75 : 0.8 }}>{o.count}</span>}
                    </button>
                );
            })}
        </div>
    );
}

/** A tappable row with an icon, two lines and something on the right. */
export function Row({ icon, red, title, sub, right, onClick, label, chevron = true }: {
    icon: LucideIcon; red?: boolean; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; onClick: () => void; label?: string; chevron?: boolean;
}) {
    return (
        <button type="button" data-lab-item onClick={onClick} aria-label={label}
            className="flex min-h-[60px] w-full items-center gap-[12px] rounded-[16px] px-[10px] py-[8px] text-left">
            <IconDot icon={icon} red={red} />
            <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold leading-snug" style={{ color: red ? C.redText : C.text }}>{title}</span>
                {sub && <span className="block truncate text-[12px]" style={{ color: C.text3 }}>{sub}</span>}
            </span>
            {right}
            {chevron && <ChevronRight className="h-4 w-4 shrink-0" style={{ color: C.text3 }} aria-hidden />}
        </button>
    );
}

/** Thick bars for comparisons, each with a hover tooltip. Rows can open a screen. */
export function Bars({ rows, ariaLabel }: {
    rows: { key: string; name: string; value: number; max: number; text: string; tip: string; color?: string; onOpen?: () => void }[]; ariaLabel: string;
}) {
    const { host, tip, show, hide } = useTip();
    return (
        <div ref={host} className="relative" onMouseLeave={hide}>
            <ul className="flex flex-col gap-[12px]" aria-label={ariaLabel}>
                {rows.map(r => {
                    const body = (
                        <>
                            <span className="flex items-baseline justify-between gap-[8px] text-[13px]">
                                <span className="truncate font-semibold">{r.name}</span>
                                <span className="shrink-0 tabular-nums" style={{ color: C.text2 }}>{r.text}</span>
                            </span>
                            <span className="mt-[6px] block h-[12px] rounded-full" style={{ background: C.track }} onMouseEnter={e => show(e.currentTarget, r.tip)}>
                                <span className="block h-full rounded-full" style={{ width: `${Math.max(3, Math.min(100, (r.value / Math.max(1, r.max)) * 100))}%`, background: r.color ?? C.accent }} />
                            </span>
                        </>
                    );
                    return (
                        <li key={r.key}>
                            {r.onOpen
                                ? <button type="button" onClick={r.onOpen} aria-label={`${r.name}, ${r.text}`} className="block w-full rounded-[10px] text-left">{body}</button>
                                : <div role="img" aria-label={`${r.name}, ${r.text}`}>{body}</div>}
                        </li>
                    );
                })}
            </ul>
            <TipBox tip={tip} />
        </div>
    );
}

/**
 * A bottom sheet inside the app: a scrim, a panel that slides up, a title, a close button,
 * optional sticky footer actions. Escape closes it and focus stays inside until it does.
 */
export function SheetFrame({ title, onClose, children, footer, tall }: {
    title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; tall?: boolean;
}) {
    const panel = useRef<HTMLDivElement>(null);
    const titleId = useId();
    useEffect(() => {
        const before = document.activeElement as HTMLElement | null;
        panel.current?.focus({ preventScroll: true });
        return () => before?.focus?.({ preventScroll: true });
    }, []);
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
        if (e.key !== 'Tab' || !panel.current) return;
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    return (
        <div className="absolute inset-0 z-40" onKeyDown={onKeyDown}>
            <div aria-hidden className="lab-fade-in absolute inset-0" style={{ background: C.scrim }} onClick={onClose} />
            <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
                className={cx('lab-sheet-in absolute inset-x-0 bottom-0 flex flex-col rounded-t-[28px] outline-none', tall ? 'max-h-[92%]' : 'max-h-[86%]')}
                style={{ background: C.page, boxShadow: C.shadowSheet }}>
                <div aria-hidden className="mx-auto mt-[8px] h-[5px] w-[40px] shrink-0 rounded-full" style={{ background: C.dot }} />
                <div className="flex shrink-0 items-center gap-[8px] px-[16px] pb-[6px] pt-[6px]">
                    <H level={2} id={titleId} className="min-w-0 flex-1 truncate text-[17px] font-bold tracking-[-0.02em]">{title}</H>
                    <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full" style={{ background: C.card }}>
                        <X className="h-[18px] w-[18px]" aria-hidden />
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[16px] pb-[16px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{children}</div>
                {footer && <div className="shrink-0 border-t px-[16px] pb-[20px] pt-[12px]" style={{ borderColor: C.border, background: C.card }}>{footer}</div>}
            </div>
        </div>
    );
}

/** The filled button. `ink` is for a decision that sends something back (reject), since red is kept for SLA and rounds. */
export function PrimaryButton({ children, onClick, disabled, className, icon: Icon, tone = 'accent' }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; className?: string; icon?: LucideIcon; tone?: 'accent' | 'ink' }) {
    return (
        <button type="button" onClick={onClick} disabled={disabled}
            className={cx('inline-flex h-12 items-center justify-center gap-[8px] rounded-full px-[18px] text-[14.5px] font-bold disabled:opacity-50', className)}
            style={tone === 'ink' ? { background: C.ink, color: C.onInk } : { background: C.accent, color: C.onAccent }}>
            {Icon && <Icon className="h-[18px] w-[18px]" aria-hidden />}{children}
        </button>
    );
}

export function GhostButton({ children, onClick, className, icon: Icon }: { children: React.ReactNode; onClick: () => void; className?: string; icon?: LucideIcon }) {
    return (
        <button type="button" onClick={onClick}
            className={cx('inline-flex h-12 items-center justify-center gap-[8px] rounded-full px-[18px] text-[14.5px] font-bold', className)}
            style={{ background: C.card, color: C.text, boxShadow: `inset 0 0 0 1px ${C.border}` }}>
            {Icon && <Icon className="h-[18px] w-[18px]" aria-hidden />}{children}
        </button>
    );
}

/** Small label chip: ink for "critical", red only for a breach. */
export function Tag({ children, tone = 'tint', icon: Icon }: { children: React.ReactNode; tone?: 'tint' | 'ink' | 'red' | 'plain'; icon?: LucideIcon }) {
    const style = tone === 'ink' ? { background: C.ink, color: C.onInk }
        : tone === 'red' ? { background: C.redBg, color: C.redText }
            : tone === 'plain' ? { background: C.track, color: C.text2 }
                : { background: C.tint, color: C.accentDeep };
    return (
        <span className="inline-flex h-[24px] shrink-0 items-center gap-[4px] rounded-full px-[8px] text-[11.5px] font-semibold" style={style}>
            {Icon && <Icon className="h-3 w-3" aria-hidden style={tone === 'red' ? { color: C.red } : undefined} />}{children}
        </span>
    );
}

/** A thick meter with a hover tooltip and an optional target marker. */
export function TargetMeter({ pct, target, label, tip, height = 14 }: { pct: number; target?: number; label: string; tip: string; height?: number }) {
    const { host, tip: t, show, hide } = useTip();
    return (
        <div ref={host} className="relative" onMouseLeave={hide}>
            <div className="relative rounded-full" style={{ height, background: C.track }} role="meter" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
                onMouseEnter={e => show(e.currentTarget, tip)}>
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: C.accent }} />
                {target !== undefined && <span aria-hidden className="absolute w-[3px] rounded" style={{ left: `${target}%`, top: -5, height: height + 10, background: C.text }} />}
            </div>
            <TipBox tip={t} />
        </div>
    );
}
