'use client';

/**
 * AGENT AVATAR — a face for every agent in the roster.
 * -----------------------------------------------------------------------------
 * A list of eight specialists reads as eight identical rows unless each one is
 * recognisable at a glance. This gives every agent a stable visual identity:
 *
 *   · an uploaded photo when `config.avatar_url` is set;
 *   · otherwise a generated mark — the initials on the persona's own colour,
 *     with a deterministic ring, so Nair looks like Nair on every screen.
 *
 * The colour comes from council_agents.color for council members (mirrored onto
 * oem_agents.config at provision time) and is derived from the agent key
 * otherwise, so an operational agent like Ira also gets a consistent mark
 * rather than a grey blank.
 *
 * Deterministic on purpose: no randomness, no fetch, no layout shift. The same
 * agent produces the same mark on the roster, the detail header and the Council
 * tab.
 */

import { useState } from 'react';

/** Stable hue from a string. Same key in, same colour out, forever. */
function hueOf(seed: string): number {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
    return h;
}

/** "Nair — Procurement Specialist" -> "N". "IRA — PO Anomaly Scanner" -> "IR". */
function initialsOf(name: string): string {
    const clean = name.split('—')[0].trim();
    const words = clean.split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) {
        const w = words[0];
        // An all-caps acronym reads better as two letters than one.
        return (w === w.toUpperCase() ? w.slice(0, 2) : w.slice(0, 1)).toUpperCase();
    }
    return (words[0][0] + words[1][0]).toUpperCase();
}

export interface AgentAvatarProps {
    name: string;
    /** Stable id for colour derivation — the agent key. */
    seed: string;
    /** Explicit colour, e.g. council_agents.color. Wins over the derived hue. */
    color?: string | null;
    /** An uploaded image. Wins over everything. */
    src?: string | null;
    size?: number;
    /** A quiet ring, for the selected row. */
    ring?: boolean;
    className?: string;
}

export default function AgentAvatar({
    name, seed, color, src, size = 34, ring = false, className = '',
}: AgentAvatarProps) {
    const [failed, setFailed] = useState(false);
    const hue = hueOf(seed);
    const bg = color || `hsl(${hue} 58% 42%)`;
    const initials = initialsOf(name);

    const base = 'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full';
    const style: React.CSSProperties = {
        width: size, height: size,
        background: src ? undefined : bg,
        boxShadow: ring ? `0 0 0 2px var(--card), 0 0 0 3.5px ${bg}` : undefined,
    };

    // A portrait that 404s must degrade to the monogram, not to a broken-image
    // glyph — identity falls back to initials, never to a hole.
    if (src && !failed) {
        return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
                src={src}
                alt=""
                aria-hidden
                onError={() => setFailed(true)}
                className={`${base} object-cover ${className}`}
                style={{ ...style, objectPosition: 'top' }}
            />
        );
    }

    return (
        <span className={`${base} ${className}`} style={style} aria-hidden>
            {/* A soft highlight so the disc reads as an object rather than a swatch. */}
            <span
                className="absolute inset-0"
                style={{ background: 'radial-gradient(circle at 32% 26%, rgba(255,255,255,.30), transparent 62%)' }}
            />
            <span
                className="relative font-bold leading-none text-white"
                style={{ fontSize: Math.max(10, Math.round(size * 0.38)), letterSpacing: '.01em' }}
            >
                {initials}
            </span>
        </span>
    );
}
