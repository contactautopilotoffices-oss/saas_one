'use client';

/**
 * ORG PROGRESS RADAR — the primary instrument of the Organization Progress Meter.
 *
 * A five-point pentagon radar. The OEM level model is already exactly five —
 * agent, employee, department, tech, org — so one vertex per level needs no
 * invented axis and no ring stacking. It replaces the concentric five-arc dial,
 * which put five arcs, five needles and five floating chips in the same 180deg
 * of screen and read as clutter.
 *
 * GEOMETRY OWNERSHIP — why this is not AgentRadar
 * -----------------------------------------------
 * frontend/components/agents/AgentRadar.tsx draws the same pentagon and this
 * component was meant to import or wrap it. It was read before this was written.
 * Two of the requirements here cannot be met through its props, and it is owned
 * by another agent in this session so it cannot be extended:
 *
 *   1. SIMULATE. The meter's simulate mode must let you drag a vertex along its
 *      spoke and watch the org number move. AgentRadar exposes no pointer API,
 *      no vertex refs, and no geometry exports — its CX/CY/R and axisAngle are
 *      module-private. An overlay hit layer would have to re-derive exactly the
 *      maths the import was supposed to avoid, and would silently break the day
 *      its viewBox changes.
 *   2. STATE-TO-STATE MOTION. AgentRadar's spring is a MOUNT spring: `animateKey`
 *      replays a 0 -> 1 scale-up from the hub. On a filter change that reads as
 *      the chart being redrawn. What is needed here is a morph — each vertex
 *      springs from its old value to its new one, so a filter change is a visible
 *      movement between two states of the organization.
 *
 * So this is a deliberate fork, and the duplication is confined: the pentagon
 * maths lives in the exported `axisAngle` / `pointOn` / `ringPoints` /
 * `polygonPoints` helpers below and nowhere else in this file. If AgentRadar
 * later exports its own geometry (or grows a pointer API), collapsing the two is
 * a delete-and-import here, not a rewrite. Everything AgentRadar DOES cover is
 * kept behaviourally identical on purpose — same clockwise-from-top axis order,
 * same "polygon over measured axes only", same "not measured" wording — so the
 * two radars read as one instrument family to anyone looking at both consoles.
 *
 * WHAT MAKES IT LIVE (not decoration — each of these is a real signal)
 *   - The polygon springs between states instead of cutting, so a filter change
 *     is a visible movement rather than a repaint. Honours prefers-reduced-motion.
 *   - A dashed comparison polygon shows the previous period, derived from
 *     oem_measurements via v_oem_goal_progress.actual_rate.
 *   - Every level carries its own delta vs the previous period.
 *   - A level with no measurement is drawn as an OPEN, dashed axis labelled
 *     "not measured". It is never plotted at zero — a zero that means "no data"
 *     is a lie about the organization, and it is exactly the lie that hides the
 *     levels nobody is instrumenting.
 *
 * COLOUR
 * ------
 * The five categorical hues are imported from ./levelPalette.ts, which is the
 * single home of that palette (command-center/OrgProgressCard imports it too).
 * Re-checked for the white card surface this component actually renders on:
 *   agent #d55181 3.94:1 · employee #c98500 3.08:1 · department #199e70 3.40:1
 *   tech  #d95926 3.88:1 · org      #3987e5 3.64:1
 * All five clear the 3:1 non-text minimum against --card (#FFFFFF), and worst
 * adjacent CVD dE stays at the 9.1 documented in levelPalette's header. They
 * are used ONLY as a shape channel — vertex rings, legend chips, table swatches.
 * No number is ever printed in them: 3.08:1 is a pass for a dot and a fail for
 * 15px text. Hue is never the only channel either: every axis and every legend
 * row carries its own numeral, so nothing depends on telling two colours apart.
 * All chrome (rings, spokes, text, plates) comes from globals.css tokens.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Eye, EyeOff, Minus, MoveHorizontal } from 'lucide-react';
import { LEVEL_COLORS } from './levelPalette';

export interface LevelDimension {
    key: string;
    /** Full name, e.g. "Agent Level". */
    label: string;
    /** Short name for the axis tip, e.g. "Agent". */
    short: string;
    /** 1-5, printed so identity never rests on hue alone. */
    n: number;
    /** null = no measurement. Never coerce to 0. */
    value: number | null;
    /** Progress-point movement vs the previous period. null = unknown. */
    delta: number | null;
    /** Weighted points this level puts into the org number. */
    contribution: number | null;
    weight: number;
    measured: number;
    total: number;
    missing: number;
    hidden: boolean;
    /** One line on what this level actually measures. */
    drives: string;
    icon: React.ElementType;
}

interface Props {
    dimensions: LevelDimension[];
    overall: number | null;
    /** Weighted overall for the previous period, when derivable. */
    overallPrevious: number | null;
    simulate?: boolean;
    simulated?: boolean;
    focused?: string | null;
    onFocus?: (key: string | null) => void;
    onValueChange?: (key: string, value: number) => void;
    onToggleHidden?: (key: string) => void;
}

/* ---------------------------------------------------------------------------
 * Geometry. Exported so a second radar never re-derives it.
 * ------------------------------------------------------------------------- */

/**
 * The label ring, not the data ring, sizes this box. The widest axis tip is
 * "3. Department" at 12px (~82px of text) anchored outward on the lower-right
 * vertex, and "2. Employee" on the right vertex sits furthest out at x=375.
 * R and R_LABEL are chosen so both clear the right edge with margin to spare —
 * a radar whose labels clip is worse than one drawn slightly smaller.
 */
export const RADAR_VB_W = 460;
export const RADAR_VB_H = 420;
export const RADAR_CX = 230;
export const RADAR_CY = 208;
export const RADAR_R = 126;
const R_LABEL = RADAR_R + 26;
const RINGS = [20, 40, 60, 80, 100];

/** Screen-space angle of axis i, first axis straight up, clockwise. */
export function axisAngle(i: number, total: number): number {
    return -90 + (360 / total) * i;
}

/** Point at `pct` (0-100) along axis i. */
export function pointOn(i: number, total: number, pct: number, radius = RADAR_R) {
    const a = (axisAngle(i, total) * Math.PI) / 180;
    const r = (Math.max(0, Math.min(100, pct)) / 100) * radius;
    return { x: RADAR_CX + r * Math.cos(a), y: RADAR_CY + r * Math.sin(a) };
}

/** `points` string for the closed shape at a constant percentage — the rings. */
export function ringPoints(total: number, pct: number): string {
    return Array.from({ length: total }, (_, i) => {
        const p = pointOn(i, total, pct);
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }).join(' ');
}

/** `points` for a series, skipping axes with no reading. */
export function polygonPoints(values: (number | null)[]): string {
    return values
        .map((v, i) => (v == null ? null : pointOn(i, values.length, v)))
        .filter(Boolean)
        .map((p) => `${p!.x.toFixed(1)},${p!.y.toFixed(1)}`)
        .join(' ');
}

/* ---------------------------------------------------------------------------
 * Spring. SVG `points` is not a CSS-animatable property, so the interpolation
 * has to happen on the numbers before they reach the DOM.
 * ------------------------------------------------------------------------- */

const STIFFNESS = 170;
const DAMPING = 26;

function usePrefersReducedMotion(): boolean {
    const [reduced, setReduced] = useState(false);
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        setReduced(mq.matches);
        const on = (e: MediaQueryListEvent) => setReduced(e.matches);
        mq.addEventListener('change', on);
        return () => mq.removeEventListener('change', on);
    }, []);
    return reduced;
}

/** Critically-ish damped spring over a fixed-length numeric array. ~400ms settle. */
function useSpringArray(target: number[], immediate: boolean): number[] {
    const [display, setDisplay] = useState<number[]>(target);
    const stateRef = useRef({ pos: target.slice(), vel: target.map(() => 0) });
    const targetRef = useRef(target);
    targetRef.current = target;
    const signature = target.map((v) => v.toFixed(2)).join(',');

    useEffect(() => {
        const tgt = targetRef.current;
        if (immediate || stateRef.current.pos.length !== tgt.length) {
            stateRef.current = { pos: tgt.slice(), vel: tgt.map(() => 0) };
            setDisplay(tgt.slice());
            return;
        }
        let raf = 0;
        let last = performance.now();
        const tick = (now: number) => {
            const dt = Math.min(0.034, Math.max(0.001, (now - last) / 1000));
            last = now;
            const { pos, vel } = stateRef.current;
            const to = targetRef.current;
            let settled = true;
            for (let i = 0; i < to.length; i += 1) {
                const accel = STIFFNESS * (to[i] - pos[i]) - DAMPING * vel[i];
                vel[i] += accel * dt;
                pos[i] += vel[i] * dt;
                if (Math.abs(to[i] - pos[i]) > 0.05 || Math.abs(vel[i]) > 0.05) settled = false;
            }
            if (settled) {
                for (let i = 0; i < to.length; i += 1) { pos[i] = to[i]; vel[i] = 0; }
                setDisplay(to.slice());
                return;
            }
            setDisplay(pos.slice());
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
        // signature is the change trigger; targetRef carries the live values.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature, immediate]);

    return display;
}

/* ------------------------------------------------------------------------- */

function DeltaChip({ delta, className = '' }: { delta: number | null; className?: string }) {
    if (delta == null) {
        return (
            <span className={`inline-flex items-center gap-1 text-[11px] text-text-tertiary ${className}`}>
                <Minus className="w-3 h-3" aria-hidden /> no prior period
            </span>
        );
    }
    const flat = Math.abs(delta) < 0.5;
    const Icon = flat ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
    const tone = flat ? 'text-text-secondary' : delta > 0 ? 'text-emerald-600' : 'text-rose-600';
    return (
        <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${tone} ${className}`}>
            <Icon className="w-3.5 h-3.5" aria-hidden />
            {flat ? 'flat' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)} pts`}
            <span className="sr-only"> versus previous period</span>
        </span>
    );
}

export default function OrgProgressRadar({
    dimensions,
    overall,
    overallPrevious,
    simulate = false,
    simulated = false,
    focused = null,
    onFocus,
    onValueChange,
    onToggleHidden,
}: Props) {
    const svgRef = useRef<SVGSVGElement>(null);
    const draggingRef = useRef<string | null>(null);
    const [dragging, setDragging] = useState(false);
    const reduced = usePrefersReducedMotion();

    const total = dimensions.length;

    /** A level is plotted only when it is visible AND actually measured. */
    const plotted = useMemo(
        () => dimensions.map((d) => (!d.hidden && d.value != null ? d.value : null)),
        [dimensions]
    );
    const previous = useMemo(
        () =>
            dimensions.map((d) =>
                !d.hidden && d.value != null && d.delta != null
                    ? Math.max(0, Math.min(100, d.value - d.delta))
                    : null
            ),
        [dimensions]
    );

    // One spring over both series concatenated, so the dashed reference travels
    // with the solid shape instead of snapping while the other morphs. The array
    // is dense — an axis that loses its reading keeps its slot and is simply not
    // drawn, so nothing whips through the hub on the way out.
    const springTarget = useMemo(
        () => [...plotted, ...previous].map((v) => v ?? 0),
        [plotted, previous]
    );
    const springed = useSpringArray(springTarget, reduced || dragging);
    const animated = useMemo(
        () => plotted.map((v, i) => (v == null ? null : springed[i] ?? v)),
        [plotted, springed]
    );
    const animatedPrev = useMemo(
        () => previous.map((v, i) => (v == null ? null : springed[total + i] ?? v)),
        [previous, springed, total]
    );

    const shape = polygonPoints(animated);
    const shapeCount = animated.filter((v) => v != null).length;
    const prevShape = polygonPoints(animatedPrev);
    const prevCount = animatedPrev.filter((v) => v != null).length;

    /* -------- simulate: drag a vertex along its own axis -------- */

    const pointerToValue = useCallback(
        (key: string, clientX: number, clientY: number): number => {
            const svg = svgRef.current;
            if (!svg) return 0;
            const i = dimensions.findIndex((d) => d.key === key);
            if (i < 0) return 0;
            const rect = svg.getBoundingClientRect();
            const x = ((clientX - rect.left) / rect.width) * RADAR_VB_W - RADAR_CX;
            const y = ((clientY - rect.top) / rect.height) * RADAR_VB_H - RADAR_CY;
            const a = (axisAngle(i, total) * Math.PI) / 180;
            // Project the pointer onto the axis: off-axis wander never counts.
            const along = x * Math.cos(a) + y * Math.sin(a);
            return Math.round(Math.max(0, Math.min(100, (along / RADAR_R) * 100)));
        },
        [dimensions, total]
    );

    const startDrag = (key: string) => (e: React.PointerEvent) => {
        if (!simulate || !onValueChange) return;
        e.preventDefault();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        draggingRef.current = key;
        setDragging(true);
        onValueChange(key, pointerToValue(key, e.clientX, e.clientY));
    };
    const moveDrag = (e: React.PointerEvent) => {
        const key = draggingRef.current;
        if (!key || !onValueChange) return;
        onValueChange(key, pointerToValue(key, e.clientX, e.clientY));
    };
    const endDrag = () => { draggingRef.current = null; setDragging(false); };

    const nudge = (key: string, current: number | null) => (e: React.KeyboardEvent) => {
        if (!simulate || !onValueChange || current == null) return;
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); onValueChange(key, current + step); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); onValueChange(key, current - step); }
    };

    const activeLevels = dimensions.filter((d) => !d.hidden && d.value != null).length;
    const unmeasured = dimensions.filter((d) => !d.hidden && d.value == null);
    const overallDelta = overall != null && overallPrevious != null ? overall - overallPrevious : null;

    const ariaSummary = dimensions
        .map((d) => `${d.label} ${d.hidden ? 'hidden' : d.value == null ? 'not measured' : `${Math.round(d.value)} percent`}`)
        .join(', ');

    return (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] gap-4 lg:gap-6 items-start">
            {/* ---------------- the shape ---------------- */}
            <div className="rounded-[var(--card-radius)] bg-card-tint border border-border/70 p-2">
                <svg
                    ref={svgRef}
                    viewBox={`0 0 ${RADAR_VB_W} ${RADAR_VB_H}`}
                    className="w-full h-auto select-none"
                    role="img"
                    aria-label={`Organization progress radar. Overall ${overall != null ? Math.round(overall) : 'unavailable'} percent. ${ariaSummary}.`}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerLeave={endDrag}
                    style={{ touchAction: simulate ? 'none' : undefined }}
                >
                    {/* graduated web. The plate is filled first — filling the outer
                        ring in the same pass would paint over the inner ones. */}
                    <g>
                        <polygon points={ringPoints(total, 100)} fill="var(--card)" stroke="none" />
                        {RINGS.map((pct) => (
                            <polygon
                                key={pct}
                                points={ringPoints(total, pct)}
                                fill="none"
                                stroke="var(--border)"
                                strokeWidth={pct === 100 ? 1.5 : 1}
                                strokeDasharray={pct === 100 ? undefined : '3 5'}
                            />
                        ))}
                        {/* Ring scale, printed once. It sits on the BISECTOR between
                            the first two axes, not on an axis: on an axis it collides
                            with that level's vertex at exactly the values you most
                            want to read. On the bisector it lands on each ring's edge
                            midpoint, where nothing else is ever drawn. */}
                        {RINGS.map((pct) => {
                            const a = ((axisAngle(0, total) + 180 / total) * Math.PI) / 180;
                            const r = (pct / 100) * RADAR_R * Math.cos(Math.PI / total);
                            return (
                                <text
                                    key={`s${pct}`}
                                    x={RADAR_CX + r * Math.cos(a)}
                                    y={RADAR_CY + r * Math.sin(a) + 3}
                                    textAnchor="middle"
                                    fontSize="9"
                                    fill="var(--text-tertiary)"
                                    style={{ fontVariantNumeric: 'tabular-nums' }}
                                >
                                    {pct}
                                </text>
                            );
                        })}
                    </g>

                    {/* spokes — dashed where there is no reading */}
                    {dimensions.map((d, i) => {
                        const tip = pointOn(i, total, 100);
                        const open = d.hidden || d.value == null;
                        return (
                            <line
                                key={`ax-${d.key}`}
                                x1={RADAR_CX} y1={RADAR_CY} x2={tip.x} y2={tip.y}
                                stroke={open ? 'var(--text-tertiary)' : 'var(--border)'}
                                strokeWidth={1.25}
                                strokeDasharray={open ? '2 6' : undefined}
                                opacity={open ? 0.55 : 1}
                            />
                        );
                    })}

                    {/* previous period — the trend line */}
                    {prevCount >= 3 && (
                        <polygon
                            points={prevShape}
                            fill="none"
                            stroke="var(--text-tertiary)"
                            strokeWidth="1.75"
                            strokeDasharray="5 5"
                            opacity={focused ? 0.3 : 0.7}
                        >
                            <title>Previous period</title>
                        </polygon>
                    )}

                    {/* current shape */}
                    {shapeCount >= 3 && (
                        <polygon
                            points={shape}
                            fill="var(--primary)"
                            fillOpacity={0.16}
                            stroke="var(--primary)"
                            strokeWidth="2.5"
                            strokeLinejoin="round"
                        />
                    )}
                    {shapeCount === 2 && (
                        <polyline points={shape} fill="none" stroke="var(--primary)" strokeWidth="2.5" />
                    )}

                    {/* vertices */}
                    {dimensions.map((d, i) => {
                        if (d.hidden || d.value == null) return null;
                        const v = animated[i] ?? d.value;
                        const p = pointOn(i, total, v);
                        const colour = LEVEL_COLORS[d.key] ?? 'var(--primary)';
                        const dim = focused != null && focused !== d.key;
                        return (
                            <g
                                key={`v-${d.key}`}
                                opacity={dim ? 0.35 : 1}
                                style={{ transition: 'opacity 200ms' }}
                                tabIndex={simulate ? 0 : -1}
                                role={simulate ? 'slider' : undefined}
                                aria-label={simulate ? `${d.label} simulated value` : undefined}
                                aria-valuenow={simulate ? Math.round(d.value) : undefined}
                                aria-valuemin={simulate ? 0 : undefined}
                                aria-valuemax={simulate ? 100 : undefined}
                                onKeyDown={nudge(d.key, d.value)}
                                onPointerDown={startDrag(d.key)}
                                onMouseEnter={() => onFocus?.(d.key)}
                                onMouseLeave={() => onFocus?.(null)}
                            >
                                <circle cx={p.x} cy={p.y} r="14" fill="transparent" style={{ cursor: simulate ? 'grab' : 'pointer' }} />
                                {simulate && <circle cx={p.x} cy={p.y} r="11" fill={colour} opacity="0.18" />}
                                <circle cx={p.x} cy={p.y} r="6.5" fill="var(--card)" stroke={colour} strokeWidth="3.5" />
                                <title>{`${d.label} — ${Math.round(d.value)}% (weight ${d.weight})`}</title>
                            </g>
                        );
                    })}

                    {/* axis tips: numeral + short name + reading, always direct */}
                    {dimensions.map((d, i) => {
                        const a = (axisAngle(i, total) * Math.PI) / 180;
                        const x = RADAR_CX + R_LABEL * Math.cos(a);
                        const y = RADAR_CY + R_LABEL * Math.sin(a);
                        const cos = Math.cos(a);
                        const anchor = Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end';
                        const dim = focused != null && focused !== d.key;
                        const reading = d.hidden ? 'hidden' : d.value == null ? 'not measured' : `${Math.round(d.value)}%`;
                        // The reading is deliberately NOT tinted with the level hue.
                        // #c98500 (employee) is 3.08:1 on white — right for a shape,
                        // a text-contrast failure at 15px. The vertex ring beside it
                        // already carries the hue, so the number is free to be legible.
                        return (
                            <g key={`t-${d.key}`} opacity={dim ? 0.4 : 1} style={{ transition: 'opacity 200ms' }}>
                                <text x={x} y={y - 4} textAnchor={anchor} fontSize="12" fontWeight={600} fill="var(--text-secondary)">
                                    {d.n}. {d.short}
                                </text>
                                <text
                                    x={x} y={y + 13} textAnchor={anchor}
                                    fontSize={d.value == null || d.hidden ? '11' : '15'}
                                    fontWeight={700}
                                    fill={d.value == null || d.hidden ? 'var(--text-tertiary)' : 'var(--text-primary)'}
                                    style={{ fontVariantNumeric: 'tabular-nums' }}
                                >
                                    {reading}
                                </text>
                            </g>
                        );
                    })}

                    {/* hub */}
                    <circle cx={RADAR_CX} cy={RADAR_CY} r="3.5" fill="var(--text-tertiary)" />
                </svg>

                {simulate && (
                    <div className="flex items-start gap-1.5 px-2 pb-1 text-[11px] text-text-secondary">
                        <MoveHorizontal className="w-3.5 h-3.5 mt-px shrink-0" />
                        <span>Drag a vertex along its spoke, or focus one and use the arrow keys
                            (shift for 10). Nothing is saved.</span>
                    </div>
                )}
            </div>

            {/* ---------------- the reading ---------------- */}
            <div className="space-y-3">
                <div className="rounded-[var(--card-radius)] border border-border bg-card-tint px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-text-tertiary">Overall progress</div>
                    <div className="flex items-end gap-3 flex-wrap">
                        <div className="text-[3.25rem] leading-none font-bold tabular-nums text-foreground">
                            {overall != null ? `${Math.round(overall)}%` : '—'}
                        </div>
                        <div className="pb-1.5 space-y-0.5">
                            <DeltaChip delta={overallDelta} />
                            <div className="text-[11px] text-text-secondary">
                                weighted across {activeLevels} of {total} levels
                                {simulated && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 font-medium">simulated</span>}
                            </div>
                        </div>
                    </div>
                    {unmeasured.length > 0 && (
                        <p className="mt-2 text-[11px] text-text-tertiary">
                            {unmeasured.map((d) => d.short).join(', ')} {unmeasured.length === 1 ? 'has' : 'have'} no
                            measurement in this view and {unmeasured.length === 1 ? 'is' : 'are'} left out of the shape
                            rather than plotted at zero.
                        </p>
                    )}
                </div>

                {/* iClarus-style legend: icon, name, reading, trend, what it measures */}
                <ul className="space-y-2">
                    {dimensions.map((d) => {
                        const Icon = d.icon;
                        const colour = LEVEL_COLORS[d.key] ?? 'var(--primary)';
                        const off = d.hidden;
                        const focus = focused === d.key;
                        return (
                            <li key={d.key}>
                                <button
                                    type="button"
                                    onClick={() => onToggleHidden?.(d.key)}
                                    onMouseEnter={() => onFocus?.(d.key)}
                                    onMouseLeave={() => onFocus?.(null)}
                                    aria-pressed={!off}
                                    className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all ${
                                        off
                                            ? 'border-border opacity-45'
                                            : focus
                                                ? 'border-primary/50 bg-card-tint'
                                                : 'border-border bg-card hover:border-primary/40'
                                    }`}
                                >
                                    <span className="flex items-center gap-2">
                                        <span
                                            className="w-7 h-7 rounded-lg grid place-items-center shrink-0"
                                            style={{ background: `${colour}1f`, color: colour }}
                                        >
                                            <Icon className="w-4 h-4" aria-hidden />
                                        </span>
                                        <span className="text-[13px] font-semibold text-foreground truncate">
                                            {d.n}. {d.label}
                                        </span>
                                        <span className="ml-auto flex items-baseline gap-2 shrink-0">
                                            <span className="text-lg font-bold tabular-nums text-foreground">
                                                {d.value != null ? `${Math.round(d.value)}%` : (
                                                    <span className="text-[11px] font-medium text-text-tertiary">not measured</span>
                                                )}
                                            </span>
                                            {off
                                                ? <EyeOff className="w-3.5 h-3.5 text-text-tertiary" aria-label="hidden" />
                                                : <Eye className="w-3.5 h-3.5 text-text-tertiary" aria-label="shown" />}
                                        </span>
                                    </span>
                                    <span className="mt-1.5 flex items-center gap-3 flex-wrap">
                                        {d.value != null && <DeltaChip delta={d.delta} />}
                                        {d.contribution != null && !off && (
                                            <span className="text-[11px] text-text-secondary tabular-nums">
                                                contributes {d.contribution.toFixed(1)} pts of the org number
                                            </span>
                                        )}
                                        <span className="text-[11px] text-text-tertiary tabular-nums">
                                            {d.measured}/{d.total} measured
                                            {d.missing > 0 && <span className="text-rose-600"> · {d.missing} out of chain</span>}
                                        </span>
                                    </span>
                                    <span className="block mt-1 text-[11px] leading-snug text-text-secondary">{d.drives}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>

                <div className="flex items-center gap-4 px-1 text-[11px] text-text-tertiary">
                    <span className="inline-flex items-center gap-1.5">
                        <svg width="20" height="8" aria-hidden><line x1="0" y1="4" x2="20" y2="4" stroke="var(--primary)" strokeWidth="2.5" /></svg>
                        this period
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <svg width="20" height="8" aria-hidden><line x1="0" y1="4" x2="20" y2="4" stroke="var(--text-tertiary)" strokeWidth="2" strokeDasharray="5 5" /></svg>
                        previous period
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <svg width="20" height="8" aria-hidden><line x1="0" y1="4" x2="20" y2="4" stroke="var(--text-tertiary)" strokeWidth="1.25" strokeDasharray="2 6" /></svg>
                        not measured
                    </span>
                </div>
            </div>
        </div>
    );
}
