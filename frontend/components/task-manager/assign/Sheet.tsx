'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/** True from the `sm` breakpoint (640px) up. Starts false so the first paint matches the server. */
export function useIsDesktop(): boolean {
    const [desktop, setDesktop] = useState(false);
    useEffect(() => {
        const media = window.matchMedia('(min-width: 640px)');
        const update = () => setDesktop(media.matches);
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);
    return desktop;
}

/**
 * A panel that slides up from the bottom of a phone screen. Rendered into <body> so a transformed parent (the console's
 * tab animation) cannot pin it to the wrong place.
 */
export function BottomSheet({ open, onClose, title, children, footer }: {
    open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = overflow;
        };
    }, [open, onClose]);

    if (!open || typeof document === 'undefined') return null;
    return createPortal(
        <div className="fixed inset-0 z-[60]">
            <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-zinc-950/40" />
            <div role="dialog" aria-modal="true" aria-label={title}
                className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-3xl bg-white text-zinc-900 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100">
                <span aria-hidden="true" className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-3">
                    <h2 className="text-lg font-bold">{title}</h2>
                    <button type="button" onClick={onClose} aria-label="Close"
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
                {footer && <div className="shrink-0 border-t border-zinc-100 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-zinc-800">{footer}</div>}
            </div>
        </div>,
        document.body,
    );
}

/**
 * A card under its button on a computer, a bottom sheet on a phone. Place it inside a `relative` wrapper that also
 * holds the button: a click anywhere outside that wrapper closes it.
 */
export function ResponsivePopover({ open, onClose, title, children, footer, align = 'left', width = 320 }: {
    open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode;
    /** A number of pixels, or 'anchor' to match the wrapper (a dropdown under its button). */
    align?: 'left' | 'right'; width?: number | 'anchor';
}) {
    const desktop = useIsDesktop();
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open || !desktop) return;
        const onDown = (e: MouseEvent) => {
            const wrapper = ref.current?.parentElement;
            if (wrapper && !wrapper.contains(e.target as Node)) onClose();
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, desktop, onClose]);

    if (!open) return null;
    if (!desktop) return <BottomSheet open onClose={onClose} title={title} footer={footer}>{children}</BottomSheet>;
    return (
        <div ref={ref} role="dialog" aria-label={title} style={width === 'anchor' ? undefined : { width }}
            className={`absolute top-full z-40 mt-2 max-w-[calc(100vw-2rem)] rounded-2xl border border-zinc-200 bg-white p-3 text-zinc-900 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 ${width === 'anchor' ? 'inset-x-0 min-w-[240px] p-1.5' : align === 'right' ? 'right-0' : 'left-0'}`}>
            {children}
            {footer && <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">{footer}</div>}
        </div>
    );
}
