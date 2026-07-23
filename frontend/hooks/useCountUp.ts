'use client';

import { useEffect, useRef, useState } from 'react';

// Animates the numeric portion of a display string from 0 → target on mount /
// when the value changes, preserving any prefix/suffix (e.g. "₹1.2L", "94%",
// "1,240"). Honours prefers-reduced-motion and a caller `enabled` flag by
// snapping straight to the final value.
//
// Example: useCountUp("₹1.2L")  →  "₹0L" … "₹1.2L"
//          useCountUp("1,240")  →  "0" … "1,240"
const NUM_RE = /^(\D*?)(-?[\d,]*\.?\d+)(\D*)$/;

export function useCountUp(text: string, enabled: boolean = true, durationMs = 800): string {
    const [display, setDisplay] = useState(text);
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
        const m = NUM_RE.exec(text || '');
        const prefersReduced =
            typeof window !== 'undefined' &&
            window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

        // No number to animate, disabled, or reduced motion → show as-is.
        if (!m || !enabled || prefersReduced) {
            setDisplay(text);
            return;
        }

        const [, prefix, rawNum, suffix] = m;
        const target = parseFloat(rawNum.replace(/,/g, ''));
        if (isNaN(target)) {
            setDisplay(text);
            return;
        }
        const decimals = rawNum.includes('.') ? (rawNum.split('.')[1]?.length ?? 0) : 0;
        const useGrouping = rawNum.includes(',');

        const fmt = (n: number) => {
            const v = n.toLocaleString('en-IN', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
                useGrouping,
            });
            return `${prefix}${v}${suffix}`;
        };

        const start = performance.now();
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / durationMs);
            // easeOutCubic — fast then settling.
            const eased = 1 - Math.pow(1 - t, 3);
            setDisplay(fmt(target * eased));
            if (t < 1) rafRef.current = requestAnimationFrame(tick);
            else setDisplay(text); // exact final string (avoids rounding drift)
        };
        rafRef.current = requestAnimationFrame(tick);

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [text, enabled, durationMs]);

    return display;
}
