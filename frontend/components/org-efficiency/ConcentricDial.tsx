'use client';

/**
 * Concentric semicircular progress dial.
 *
 * Five nested graduated rings — agent innermost, organization outermost —
 * each with its own pointer arm from a common hub, and a linkage polyline
 * connecting the pointer tips so you can see the gear train: move an inner
 * ring and watch the coupling to the outer ones.
 *
 * Palette: reference categorical slots 1-5 in reversed order, so blue lands
 * on the outermost (org) ring. Validated in both modes:
 *   dark  — worst adjacent CVD dE 8.4, normal-vision 19.3, all >= 3:1
 *   light — worst adjacent CVD dE 9.1, normal-vision 19.6 (contrast WARN,
 *           relieved by the always-visible direct labels on every ring)
 * The dial surface is a fixed dark instrument bezel in both app themes, so
 * the dark steps are the ones actually rendered on it.
 */

import React, { useRef, useCallback } from 'react';

export interface DialLevel {
    key: string;
    label: string;
    sublabel: string;
    value: number;
    weight: number;
    visible: boolean;
}

interface Props {
    levels: DialLevel[];          // ordered innermost -> outermost
    overall: number | null;
    simulate?: boolean;
    focused?: string | null;
    onFocus?: (key: string | null) => void;
    onValueChange?: (key: string, value: number) => void;
}

/** Dark-surface steps, innermost -> outermost. */
export const LEVEL_COLORS: Record<string, string> = {
    agent: '#d55181',      // magenta
    employee: '#c98500',   // yellow
    department: '#199e70', // aqua
    tech: '#d95926',       // orange
    org: '#3987e5',        // blue
};

const VB_W = 1000;
const VB_H = 544;
const CX = 500;
const CY = 482;
const BAND = 32;
const GAP = 12;
const R_OUTER = 400;
const R_TICK = R_OUTER + BAND / 2 + 10;   // ticks start clear of the outer band
const R_LABEL = R_TICK + 40;

/** Radius of the ring at index i, counted from the innermost. */
export function ringRadius(indexFromInner: number, total: number): number {
    const fromOuter = total - 1 - indexFromInner;
    return R_OUTER - fromOuter * (BAND + GAP);
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
/** 0% sits at 180deg (left), 100% at 0deg (right). */
const valueToAngle = (v: number) => 180 - (Math.max(0, Math.min(100, v)) / 100) * 180;

function polar(r: number, deg: number) {
    const a = toRad(deg);
    return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) };
}

/** Arc path along radius r from 0% up to value. */
function arcPath(r: number, value: number): string {
    const v = Math.max(0, Math.min(100, value));
    if (v <= 0.01) return '';
    const start = polar(r, 180);
    const end = polar(r, valueToAngle(v));
    // The sweep from 0% never exceeds 180deg, so large-arc-flag is always 0.
    // Setting it on v > 50 makes SVG draw the complementary arc instead.
    return `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`;
}

export default function ConcentricDial({
    levels, overall, simulate = false, focused = null, onFocus, onValueChange,
}: Props) {
    const svgRef = useRef<SVGSVGElement>(null);
    const draggingRef = useRef<string | null>(null);

    const visible = levels.filter((l) => l.visible);

    /** Map a pointer event to a 0-100 value along the dial sweep. */
    const pointerToValue = useCallback((clientX: number, clientY: number): number => {
        const svg = svgRef.current;
        if (!svg) return 0;
        const rect = svg.getBoundingClientRect();
        const x = ((clientX - rect.left) / rect.width) * VB_W;
        const y = ((clientY - rect.top) / rect.height) * VB_H;
        const dx = x - CX;
        const dy = CY - y;
        let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (deg < 0) deg = dy < 0 && dx > 0 ? 0 : 180;
        deg = Math.max(0, Math.min(180, deg));
        return Math.round(((180 - deg) / 180) * 100);
    }, []);

    const startDrag = (key: string) => (e: React.PointerEvent) => {
        if (!simulate || !onValueChange) return;
        e.preventDefault();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        draggingRef.current = key;
        onValueChange(key, pointerToValue(e.clientX, e.clientY));
    };
    const moveDrag = (e: React.PointerEvent) => {
        if (!draggingRef.current || !onValueChange) return;
        onValueChange(draggingRef.current, pointerToValue(e.clientX, e.clientY));
    };
    const endDrag = () => { draggingRef.current = null; };

    // Pointer tips, innermost -> outermost, for the linkage polyline.
    const tips = visible.map((l) => {
        const idx = levels.findIndex((x) => x.key === l.key);
        const r = ringRadius(idx, levels.length);
        return { ...l, r, ...polar(r, valueToAngle(l.value)) };
    });

    const ariaSummary = visible.map((l) => `${l.label} ${Math.round(l.value)}%`).join(', ');

    return (
        <svg
            ref={svgRef}
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            className="w-full h-auto select-none"
            role="img"
            aria-label={`Organization progress dial. Overall ${overall != null ? Math.round(overall) : 'unavailable'}%. ${ariaSummary}.`}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            style={{ touchAction: simulate ? 'none' : undefined }}
        >
            <defs>
                <radialGradient id="oem-hub" cx="50%" cy="35%" r="70%">
                    <stop offset="0%" stopColor="#5b5f68" />
                    <stop offset="55%" stopColor="#2c2f36" />
                    <stop offset="100%" stopColor="#14161a" />
                </radialGradient>
                <filter id="oem-glow" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="5" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
            </defs>

            {/* graduated outer scale — the instrument bezel */}
            <g opacity="0.5">
                {Array.from({ length: 41 }, (_, i) => {
                    const pct = i * 2.5;
                    const major = pct % 25 === 0;
                    const mid = pct % 12.5 === 0;
                    const deg = valueToAngle(pct);
                    const rIn = R_TICK;
                    const rOut = rIn + (major ? 18 : mid ? 12 : 6);
                    const a = polar(rIn, deg);
                    const b = polar(rOut, deg);
                    return (
                        <line
                            key={pct}
                            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                            stroke={major ? '#c3c2b7' : '#6b6f77'}
                            strokeWidth={major ? 2.5 : 1.5}
                            strokeLinecap="round"
                        />
                    );
                })}
            </g>
            {/* rings, outermost first so inner ones paint on top */}
            {[...levels].reverse().map((l) => {
                if (!l.visible) return null;
                const idx = levels.findIndex((x) => x.key === l.key);
                const r = ringRadius(idx, levels.length);
                const color = LEVEL_COLORS[l.key] ?? '#3987e5';
                const dim = focused != null && focused !== l.key;
                return (
                    <g key={l.key} opacity={dim ? 0.28 : 1} style={{ transition: 'opacity 200ms' }}>
                        {/* track */}
                        <path
                            d={arcPath(r, 100)}
                            fill="none"
                            stroke="#23262c"
                            strokeWidth={BAND}
                            strokeLinecap="round"
                        />
                        <path
                            d={arcPath(r, 100)}
                            fill="none"
                            stroke="#3a3e46"
                            strokeWidth={BAND}
                            strokeLinecap="round"
                            opacity="0.55"
                            strokeDasharray="2 10"
                        />
                        {/* fill */}
                        <path
                            d={arcPath(r, l.value)}
                            fill="none"
                            stroke={color}
                            strokeWidth={BAND}
                            strokeLinecap="round"
                            filter={dim ? undefined : 'url(#oem-glow)'}
                            style={{ transition: 'd 420ms cubic-bezier(.4,0,.2,1)' }}
                        />
                        {/* hit area: hover to focus, drag to simulate */}
                        <path
                            d={arcPath(r, 100)}
                            fill="none"
                            stroke="transparent"
                            strokeWidth={BAND + GAP}
                            strokeLinecap="round"
                            style={{ cursor: simulate ? 'grab' : 'pointer' }}
                            onPointerDown={startDrag(l.key)}
                            onMouseEnter={() => onFocus?.(l.key)}
                            onMouseLeave={() => onFocus?.(null)}
                        >
                            <title>{`${l.label} — ${Math.round(l.value)}% (weight ${l.weight})`}</title>
                        </path>
                    </g>
                );
            })}

            {/* linkage: the gear train between pointer tips */}
            {tips.length > 1 && (
                <polyline
                    points={tips.map((t) => `${t.x},${t.y}`).join(' ')}
                    fill="none"
                    stroke="#8b9099"
                    strokeWidth="2"
                    strokeDasharray="5 6"
                    opacity={focused ? 0.25 : 0.65}
                />
            )}

            {/* pointer arms + joints + value chips */}
            {tips.map((t) => {
                const color = LEVEL_COLORS[t.key] ?? '#3987e5';
                const dim = focused != null && focused !== t.key;
                const label = `${Math.round(t.value)}%`;
                const w = label.length * 11 + 20;
                // Placed on the ring's own band: rings are 44 apart, so a chip
                // pushed outward would land on the neighbour. Dark fill keeps it
                // legible against the ring colour underneath.
                const chip = polar(t.r, valueToAngle(t.value));
                return (
                    <g key={t.key} opacity={dim ? 0.3 : 1} style={{ transition: 'opacity 200ms' }}>
                        <line
                            x1={CX} y1={CY} x2={t.x} y2={t.y}
                            stroke={color} strokeWidth="4" strokeLinecap="round"
                        />
                        <circle cx={t.x} cy={t.y} r="9" fill="#14161a" stroke={color} strokeWidth="3.5" />
                        <rect
                            x={chip.x - w / 2} y={chip.y - 13}
                            width={w} height={26} rx={7}
                            fill="#0e1014" stroke={color} strokeWidth="2"
                        />
                        <text
                            x={chip.x} y={chip.y}
                            textAnchor="middle" dominantBaseline="central"
                            fill={color} fontSize="16" fontWeight={700}
                            style={{ fontVariantNumeric: 'tabular-nums' }}
                        >
                            {label}
                        </text>
                    </g>
                );
            })}

            {/* overall marker on the bezel */}
            {overall != null && (() => {
                const deg = valueToAngle(overall);
                const a = polar(R_TICK - 4, deg);
                const b = polar(R_LABEL - 12, deg);
                return (
                    <g>
                        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
                        <circle cx={b.x} cy={b.y} r="7" fill="#ffffff" />
                        <circle cx={b.x} cy={b.y} r="3" fill="#0e1014" />
                        <title>{`Overall ${Math.round(overall)}%`}</title>
                    </g>
                );
            })()}

            {/* scale labels last: ring end-caps would otherwise clip them */}
            {[0, 25, 50, 75, 100].map((pct) => {
                const p = polar(R_LABEL, valueToAngle(pct));
                return (
                    <text
                        key={pct}
                        x={p.x} y={p.y}
                        textAnchor={pct === 0 ? 'start' : pct === 100 ? 'end' : 'middle'}
                        dominantBaseline="middle"
                        fill="#c3c2b7" fontSize="20" fontWeight={600}
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                        {pct}%
                    </text>
                );
            })}

            {/* hub */}
            <g>
                {Array.from({ length: 24 }, (_, i) => {
                    const deg = (i * 360) / 24;
                    const a = polar(46, deg);
                    const b = polar(54, deg);
                    return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#4a4e57" strokeWidth="3" />;
                })}
                <circle cx={CX} cy={CY} r="46" fill="url(#oem-hub)" stroke="#5b5f68" strokeWidth="2" />
                <circle cx={CX} cy={CY} r="26" fill="#101216" stroke="#6b6f77" strokeWidth="1.5" />
                <circle cx={CX} cy={CY} r="8" fill="#8b9099" />
            </g>
        </svg>
    );
}
