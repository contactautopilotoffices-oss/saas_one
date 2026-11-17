'use client';

import React, { useLayoutEffect, useRef } from 'react';
import { FONT } from './shared';

/**
 * Owner 2026-11-13: the Drive-style menu that opens on right-click, from a row's ⋮ button and from the "New" button.
 * Positioned at a screen point and kept inside the viewport. Clicking outside, Escape, or picking an entry closes it.
 * The host decides the entries; this only draws them.
 */

export interface MenuEntry {
    key: string;
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
    onClick?: () => void;
    /** Shown in red (Delete forever) */
    danger?: boolean;
    disabled?: boolean;
    /** Small grey text on the right (a shortcut, a count) */
    hint?: string;
    /** A line above this entry */
    dividerBefore?: boolean;
}

export function ContextMenu({ x, y, entries, onClose, label = 'Actions' }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void; label?: string }) {
    const ref = useRef<HTMLDivElement>(null);

    // Keep the whole menu on screen: flip left/up when it would run past an edge. Written straight to the element,
    // before paint, so the menu never shows in the wrong place first.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const { width, height } = el.getBoundingClientRect();
        const pad = 8;
        el.style.left = `${x + width + pad > window.innerWidth ? Math.max(pad, x - width) : x}px`;
        el.style.top = `${y + height + pad > window.innerHeight ? Math.max(pad, y - height) : y}px`;
        el.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus();
    }, [x, y, entries.length]);

    const onKey = (e: React.KeyboardEvent) => {
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? []);
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length]?.focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); }
        if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };

    return (
        <>
            <button type="button" aria-label="Close menu" className="fixed inset-0 z-[85] cursor-default" onClick={onClose}
                onContextMenu={e => { e.preventDefault(); onClose(); }} />
            <div ref={ref} role="menu" aria-label={label} style={{ ...FONT, left: x, top: y }} onKeyDown={onKey}
                className="fixed z-[86] min-w-[15rem] max-w-[calc(100vw-1rem)] rounded-lg bg-white py-2 text-[#1F1F1F] shadow-[0_2px_6px_2px_rgba(60,64,67,.15),0_1px_2px_0_rgba(60,64,67,.3)]">
                {entries.map(en => (
                    <React.Fragment key={en.key}>
                        {en.dividerBefore && <div className="my-2 border-t border-[#E1E3E1]" />}
                        <button type="button" role="menuitem" disabled={en.disabled}
                            onClick={() => { onClose(); en.onClick?.(); }}
                            className={`flex h-10 w-full items-center gap-4 px-4 text-left text-sm outline-none hover:bg-[#F0F4F9] focus-visible:bg-[#F0F4F9] disabled:opacity-40 disabled:hover:bg-transparent ${en.danger ? 'text-[#B3261E]' : ''}`}>
                            {en.icon ? <en.icon className={`h-5 w-5 shrink-0 ${en.danger ? 'text-[#B3261E]' : 'text-[#444746]'}`} /> : <span className="w-5" />}
                            <span className="flex-1 truncate">{en.label}</span>
                            {en.hint && <span className="pl-4 text-xs text-[#747775]">{en.hint}</span>}
                        </button>
                    </React.Fragment>
                ))}
            </div>
        </>
    );
}
