'use client';

/**
 * A word with a dotted underline that explains itself on hover or tap.
 *
 * This console is full of terms that mean something specific here — shadow,
 * bundle, autonomy, disposition — and a newcomer has no way to learn them except
 * by breaking something. A glossary page nobody opens does not fix that; an
 * explanation attached to the word where it appears does.
 *
 * Deliberately not a tooltip library: `title` alone is invisible on touch, so
 * this also opens on tap and closes on a second tap or Escape.
 */

import { useEffect, useRef, useState } from 'react';

export default function Hint({ children, text }: { children: React.ReactNode; text: string }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLSpanElement | null>(null);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as globalThis.Node)) setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onClick);
        return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
    }, [open]);

    return (
        <span ref={ref} className="relative inline-block">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
                className="cursor-help border-0 bg-transparent p-0 text-inherit underline decoration-dotted decoration-from-font underline-offset-[3px]"
                aria-label={`What is ${typeof children === 'string' ? children : 'this'}?`}
            >
                {children}
            </button>
            {open && (
                <span
                    role="tooltip"
                    className="absolute left-0 top-full z-50 mt-1.5 block w-[268px] rounded-[10px] border border-border bg-card px-3 py-2 text-[12.5px] font-normal normal-case leading-relaxed tracking-normal text-text-secondary shadow-lg"
                >
                    {text}
                </span>
            )}
        </span>
    );
}
