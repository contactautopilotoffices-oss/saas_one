'use client';

import React, { useRef } from 'react';

/**
 * Owner 2026-10-26: grows with what is typed (up to about six lines, then scrolls). Enter adds the task; Shift+Enter starts
 * a new line. The keys are not spelled out on screen, by request.
 */
export function useGrowingTextarea() {
    const ref = useRef<HTMLTextAreaElement>(null);
    const grow = () => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    };
    return { ref, grow };
}

/** Enter (without Shift, and not while an input method is composing) submits; Shift+Enter keeps the new line. */
export function submitsOnEnter(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
    return e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing;
}
