/**
 * Custom stage face icons — lucide has no "icy face" / "burning-eyes face",
 * so we draw them. Stroke-based, 24x24, inherit sizing via className.
 */
import React from 'react';

type IconProps = { className?: string };

// Warm = a requirement came in → amber flame.
export function WarmFlameIcon({ className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
            strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
            <path d="M12 2.5c.6 3-1.9 4.4-1.9 6.9a1.9 1.9 0 0 0 3.8 0c0-.7-.2-1.2-.5-1.8.9.4 1.7 1.2 2.2 2.4.9 2.5-.5 5.9-3.4 6.8-3 .9-6.2-.8-6.9-3.8-.5-2.4.8-4.4 2.3-6.2C8.8 5.2 10 4.3 12 2.5Z" />
        </svg>
    );
}

// Cold = not reachable / gone cold → icy smiley face.
export function ColdFaceIcon({ className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
            strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <line x1="8.5" y1="9.5" x2="10" y2="11" />
            <line x1="10" y1="9.5" x2="8.5" y2="11" />
            <line x1="14" y1="9.5" x2="15.5" y2="11" />
            <line x1="15.5" y1="9.5" x2="14" y2="11" />
            <path d="M8.5 15.5c1-.8 2-1.2 3.5-1.2s2.5.4 3.5 1.2" />
            <path d="M12 2.5v3M10.7 4l1.3 1 1.3-1" />
        </svg>
    );
}

// Hot = details shared, on fire → smiley face with burning eyes.
export function HotFaceIcon({ className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
            strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M9.2 11.4c-.8-.5-.9-1.5-.3-2.3.2.5.6.7 1 .7-.3-.6-.2-1.4.4-2 .3 1 1.2 1.4 1.2 2.4a1.2 1.2 0 0 1-2.3 1.2Z" />
            <path d="M14.6 11.4c-.8-.5-.9-1.5-.3-2.3.2.5.6.7 1 .7-.3-.6-.2-1.4.4-2 .3 1 1.2 1.4 1.2 2.4a1.2 1.2 0 0 1-2.3 1.2Z" />
            <path d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8" />
        </svg>
    );
}
