'use client';

import React, { useEffect, useMemo, useState } from 'react';

/**
 * AGENT RADAR — the reliability pentagon, drawn by hand.
 * =============================================================================
 * Pure SVG. No charting library: a radar is five lines of trigonometry, and a
 * dependency that draws it would still have to be fought to honour the two
 * rules that actually matter here.
 *
 * RULE 1 — EVERY VERTEX CARRIES ITS NUMBER. A radar's area is famously hard to
 * read: the eye cannot compare a pentagon at 72 with one at 78, and the shape
 * exaggerates whichever axis happens to be drawn at the top. So the shape is
 * the summary and the printed value is the fact. Nobody should ever have to
 * estimate a score off this chart.
 *
 * RULE 2 — "NOT MEASURED" IS NOT ZERO. /api/agents/profile sends `value: 0,
 * measured: false` for an axis with no data, precisely so a chart can draw
 * without branching. Drawing that as a vertex at the centre would be a lie:
 * an agent registered this morning has not earned a bad Grounding score, it
 * has earned no score. So the polygon is built from the MEASURED axes only —
 * the shape closes across the gap — and the unmeasured axis keeps a dimmed
 * spoke, a tertiary label and "not measured" where its number would be, with a
 * small hollow FOOT MARKER at the base of its spoke saying "this axis exists
 * and nothing sits on it". The marker is deliberately not a vertex: the polygon
 * does not pass through it, because a collapsed spike toward the centre reads
 * as failure at a glance, and that is the one misreading this component must
 * never cause.
 *
 * RULE 3 — AND "NOT MEASURED" IS NOT "COULD NOT BE READ". Those are three
 * states, not two. /api/agents/profile marks an axis `unreadable: true` when
 * the query that feeds it FAILED on a table that exists — and deliberately
 * leaves it OUT of `radar_coverage.unmeasured` so no renderer claims "no data
 * yet" on the strength of a failed read. A chart that collapses the two throws
 * that distinction away at the last possible moment, which is the worst place
 * to lose it: the operator sees a finished, confident-looking pentagon.
 *
 *   measured    the value, plotted, with its number printed beside the vertex.
 *   unmeasured  no vertex; dimmed dashed spoke, hollow foot marker, the words
 *               "not measured". A real answer: nothing has been recorded.
 *   unreadable  no vertex AND no foot marker — it must not drag the polygon
 *               toward zero, which would be the same lie in geometric form.
 *               The spoke is drawn dashed in amber-600 and the axis reads
 *               "couldn’t read". Amber, never red: a failed read is not a
 *               failed agent, and colouring it like one is its own lie.
 *
 * Geometry lives in a fixed 420x320 viewBox and the `size` prop only scales the
 * rendered width, so label padding is computed once and cannot clip at any size.
 * Axis labels sit outside the outer ring with their text-anchor derived from the
 * vertex angle (start on the right, end on the left, middle at top and bottom).
 *
 * Built for the agent profile; deliberately generic so the Org Progress Meter's
 * five OEM levels (agent / employee / department / tech / org) can reuse it.
 * Five dimensions is the design target; 3 to 8 render correctly.
 */

export interface RadarDimension {
    key?: string;
    label: string;
    /** 0..max. Always a number — `measured: false` is what says "no data". */
    value: number;
    /** Defaults to true. False = never measured; dimmed, excluded from the shape. */
    measured?: boolean;
    /**
     * True = the read that feeds this axis FAILED, so its value is UNKNOWN.
     *
     * This is a third state, not a flavour of `measured: false`, and it wins
     * over it: the API sends `measured: false` alongside so that a chart which
     * has never heard of this flag still refuses to plot the axis, but a chart
     * that HAS heard of it must not then go on to say "no data yet". Nothing
     * has been recorded is an answer; we could not look is not.
     */
    unreadable?: boolean;
    /** Plain-English meaning of the axis; surfaced in the vertex <title>. */
    description?: string;
}

export interface AgentRadarProps {
    dimensions: RadarDimension[];
    /** Rendered width in px. The viewBox keeps the aspect ratio and the padding. */
    size?: number;
    /** Top of the scale. Defaults to 100. */
    max?: number;
    /** Optional second series — shadow-vs-live, last-30d-vs-previous. */
    comparison?: { label: string; dimensions: RadarDimension[] } | null;
    /** Legend name for the primary series. Only shown when `comparison` is set. */
    seriesLabel?: string;
    className?: string;
    /** Changing this replays the mount spring — e.g. when the agent changes. */
    animateKey?: string;
    /** Set false to skip the spring entirely (print, screenshots, tests). */
    animate?: boolean;
}

/* --------------------------------------------------------------------------
 * Geometry. Fixed viewBox; `size` scales the rendered element, never these.
 *
 * The horizontal padding (210 - 110 - 24 = 76px each side) is sized for a
 * 13-character label at 11px on the widest pentagon vertex ("ROI alignment").
 * ------------------------------------------------------------------------ */
const VB_W = 420;
const VB_H = 320;
const CX = 210;
const CY = 160;
/** Gap between the outer ring and the label block. */
const LABEL_GAP = 24;
const RINGS = [0.25, 0.5, 0.75, 1];

/** Widest axis label we budget for: ~13 characters at 11px semibold ("ROI alignment"). */
const LABEL_BUDGET = 84;
/** Vertical room the label + value block needs below a bottom vertex. */
const LABEL_BLOCK_H = 26;
/** Full-size ring. Five axes — the design target — always get this. */
const R_MAX = 110;

/**
 * Outer-ring radius, DERIVED rather than tuned.
 *
 * The thing that clips is never the ring, it is the label hanging off the
 * outermost vertex — and how far out that vertex sits horizontally depends
 * entirely on the axis count. Four and eight axes put a vertex at exactly
 * |cos| = 1 (dead level with the centre), which is the worst case; five puts
 * its widest at 0.951. So instead of hardcoding a radius per n, solve for the
 * largest ring whose label block still lands inside the viewBox:
 *
 *   CX + (r + LABEL_GAP) * max|cos| + LABEL_BUDGET  <=  VB_W
 *   CY + (r + LABEL_GAP) * max|sin| + LABEL_BLOCK_H <=  VB_H
 *
 * Five axes come out at ~108, four and eight at ~102 — the pentagon keeps its
 * size and the dense cases shrink only as much as they must.
 */
function radiusFor(n: number): number {
    let maxCos = 0;
    let maxSin = 0;
    for (let i = 0; i < n; i++) {
        const a = toRad(axisAngle(i, n));
        maxCos = Math.max(maxCos, Math.abs(Math.cos(a)));
        maxSin = Math.max(maxSin, Math.abs(Math.sin(a)));
    }
    const byWidth = maxCos > 0.02 ? (CX - LABEL_BUDGET) / maxCos - LABEL_GAP : R_MAX;
    const byHeight = maxSin > 0.02 ? (VB_H - CY - LABEL_BLOCK_H) / maxSin - LABEL_GAP : R_MAX;
    return Math.max(70, Math.min(R_MAX, byWidth, byHeight));
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Vertex i of n, clockwise from straight up. */
function axisAngle(i: number, n: number): number {
    return 90 - (360 / n) * i;
}

function point(angleDeg: number, radius: number) {
    const a = toRad(angleDeg);
    return { x: CX + radius * Math.cos(a), y: CY - radius * Math.sin(a) };
}

function ringPoints(n: number, scale: number, r: number): string {
    return Array.from({ length: n }, (_, i) => {
        const p = point(axisAngle(i, n), r * scale);
        return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    }).join(' ');
}

/* --------------------------------------------------------------------------
 * The mount spring.
 *
 * Semi-implicit Euler on a mass-spring-damper (k=170, c=22, m=1 -> zeta 0.84),
 * which overshoots by well under 1% and settles in ~600ms: a shape that arrives
 * with a little weight rather than a linear wipe. It runs ONCE per `animateKey`
 * and then stops — a chart that breathes forever is a distraction on a console
 * an operator is meant to read, not watch.
 *
 * prefers-reduced-motion short-circuits to the settled state.
 * ------------------------------------------------------------------------ */
function useSpringProgress(animateKey: string, enabled: boolean): number {
    const [t, setT] = useState(enabled ? 0 : 1);

    useEffect(() => {
        if (!enabled) {
            setT(1);
            return;
        }
        const reduced =
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced) {
            setT(1);
            return;
        }

        let x = 0;
        let v = 0;
        let last = 0;
        let raf = 0;
        setT(0);

        const step = (now: number) => {
            if (!last) last = now;
            // Clamp dt so a backgrounded tab does not resume with one huge step
            // that flings the spring past the ring.
            const dt = Math.min(0.032, (now - last) / 1000);
            last = now;
            v += (-170 * (x - 1) - 22 * v) * dt;
            x += v * dt;
            if (Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) {
                setT(1);
                return;
            }
            setT(x);
            raf = requestAnimationFrame(step);
        };

        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [animateKey, enabled]);

    return t;
}

/**
 * The three states of RULE 3, resolved once so every draw pass agrees.
 * `unreadable` wins over `measured` — see RadarDimension.unreadable.
 */
export type VertexState = 'measured' | 'unmeasured' | 'unreadable';

/** The short line printed under an axis label when there is no number to print. */
const NOT_MEASURED_TEXT = 'not measured';
const UNREADABLE_TEXT = 'couldn’t read';

function stateOf(dim: RadarDimension): VertexState {
    if (dim.unreadable === true) return 'unreadable';
    return dim.measured === false ? 'unmeasured' : 'measured';
}

interface Vertex {
    dim: RadarDimension;
    index: number;
    angle: number;
    state: VertexState;
    /** Convenience for the one question the geometry asks: is it in the shape? */
    measured: boolean;
    /** 0..1 of the outer ring. */
    ratio: number;
    label: { x: number; y: number; anchor: 'start' | 'middle' | 'end' };
}

function buildVertices(dims: RadarDimension[], max: number, r: number): Vertex[] {
    const n = dims.length;
    const labelRadius = r + LABEL_GAP;
    return dims.map((dim, index) => {
        const angle = axisAngle(index, n);
        const state = stateOf(dim);
        const measured = state === 'measured';
        const ratio = Math.max(0, Math.min(1, (Number(dim.value) || 0) / (max || 100)));
        const cos = Math.cos(toRad(angle));
        const sin = Math.sin(toRad(angle));
        const p = point(angle, labelRadius);
        // Nudge the label block off the vertex so the dot never sits on the text.
        const offsetY = sin > 0.3 ? -10 : sin < -0.3 ? 8 : 0;
        return {
            dim,
            index,
            angle,
            state,
            measured,
            ratio,
            label: {
                x: p.x,
                y: p.y + offsetY,
                anchor: cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle',
            },
        };
    });
}

/**
 * Polygon over the MEASURED vertices only. See RULES 2 and 3 in the header —
 * an unmeasured axis and an unreadable one are both absent from the shape, for
 * two different reasons, and both would otherwise pull it toward the centre.
 */
function seriesPoints(vertices: Vertex[], t: number, r: number): string {
    return vertices
        .filter((v) => v.state === 'measured')
        .map((v) => {
            const p = point(v.angle, r * v.ratio * t);
            return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
        })
        .join(' ');
}

export default function AgentRadar({
    dimensions,
    size = 300,
    max = 100,
    comparison = null,
    seriesLabel = 'Current',
    className = '',
    animateKey,
    animate = true,
}: AgentRadarProps) {
    const dims = useMemo(
        () => (Array.isArray(dimensions) ? dimensions.slice(0, 8) : []),
        [dimensions],
    );
    const n = dims.length;

    const radius = radiusFor(n);
    const vertices = useMemo(() => buildVertices(dims, max, radius), [dims, max, radius]);
    const compVertices = useMemo(
        () =>
            comparison ? buildVertices(comparison.dimensions.slice(0, n), max, radius) : [],
        [comparison, max, n, radius],
    );

    const springKey = animateKey ?? dims.map((d) => d.key ?? d.label).join('|');
    const t = useSpringProgress(springKey, animate && n >= 3);

    if (n < 3) {
        return (
            <div
                className={`flex items-center justify-center rounded-[var(--card-radius)] border border-dashed border-border bg-card-tint text-xs text-text-tertiary ${className}`}
                style={{ width: size, maxWidth: '100%', height: size * (VB_H / VB_W) }}
            >
                A radar needs at least three dimensions.
            </div>
        );
    }

    const measured = vertices.filter((v) => v.state === 'measured');
    const summary =
        `Reliability radar. ` +
        vertices
            .map((v) => {
                if (v.state === 'measured') return `${v.dim.label}: ${Math.round(v.dim.value)}`;
                if (v.state === 'unreadable') return `${v.dim.label}: could not be read`;
                return `${v.dim.label}: not measured`;
            })
            .join('. ');

    return (
        <div className={className}>
            <svg
                viewBox={`0 0 ${VB_W} ${VB_H}`}
                style={{ width: size, maxWidth: '100%', height: 'auto', display: 'block' }}
                role="img"
                aria-label={summary}
            >
                {/* --- the web: concentric guide rings at 25 / 50 / 75 / 100 --- */}
                <g fill="none" stroke="var(--border)" strokeLinejoin="round">
                    {RINGS.map((scale) => (
                        <polygon
                            key={scale}
                            points={ringPoints(n, scale, radius)}
                            strokeWidth={scale === 1 ? 1.25 : 1}
                            opacity={scale === 1 ? 0.9 : 0.55}
                        />
                    ))}
                </g>

                {/* --- spokes. Three weights for the three states: solid for a
                        measured axis, dimmed and dashed for one with nothing on
                        it, amber and dashed for one we could not read. --- */}
                <g>
                    {vertices.map((v) => {
                        const p = point(v.angle, radius);
                        const unreadable = v.state === 'unreadable';
                        return (
                            <line
                                key={v.dim.key ?? v.index}
                                x1={CX}
                                y1={CY}
                                x2={p.x}
                                y2={p.y}
                                stroke={unreadable ? undefined : 'var(--border)'}
                                className={unreadable ? 'stroke-amber-600' : undefined}
                                strokeWidth={unreadable ? 1.25 : 1}
                                opacity={v.state === 'measured' ? 0.7 : unreadable ? 0.75 : 0.35}
                                strokeDasharray={v.state === 'measured' ? undefined : unreadable ? '2 4' : '3 3'}
                            />
                        );
                    })}
                </g>

                {/* --- comparison series, behind the primary --- */}
                {comparison && compVertices.length >= 3 && (
                    <polygon
                        points={seriesPoints(compVertices, t, radius)}
                        fill="var(--secondary)"
                        fillOpacity={0.08}
                        stroke="var(--secondary)"
                        strokeWidth={1.5}
                        strokeDasharray="5 4"
                        strokeLinejoin="round"
                    />
                )}

                {/* --- the shape --- */}
                {measured.length > 0 && (
                    <polygon
                        points={seriesPoints(vertices, t, radius)}
                        fill="var(--primary)"
                        fillOpacity={0.18}
                        stroke="var(--primary)"
                        strokeWidth={2}
                        strokeLinejoin="round"
                    />
                )}

                {/* --- vertex dots. Only a MEASURED axis gets a real vertex --- */}
                <g>
                    {vertices.filter((v) => v.state === 'measured').map((v) => {
                        const p = point(v.angle, radius * v.ratio * t);
                        return (
                            <circle
                                key={v.dim.key ?? v.index}
                                cx={p.x}
                                cy={p.y}
                                r={4}
                                fill="var(--primary)"
                                stroke="var(--card)"
                                strokeWidth={1.5}
                            >
                                <title>
                                    {`${v.dim.label}: ${Math.round(v.dim.value)} of ${max}` +
                                        (v.dim.description ? ` — ${v.dim.description}` : '')}
                                </title>
                            </circle>
                        );
                    })}
                </g>

                {/* --- foot markers. An UNMEASURED axis gets a hollow ring at the
                        base of its spoke: the axis is there and nothing sits on
                        it. It is set just off centre so several of them do not
                        pile up on the same pixel, and it is never joined to the
                        polygon — see RULE 2. An UNREADABLE axis gets NOTHING,
                        because a mark at the foot of the scale would read as a
                        score of zero, which is the claim a failed read may not
                        make. --- */}
                <g>
                    {vertices.filter((v) => v.state === 'unmeasured').map((v) => {
                        const p = point(v.angle, 8);
                        return (
                            <circle
                                key={v.dim.key ?? `foot-${v.index}`}
                                cx={p.x}
                                cy={p.y}
                                r={3.5}
                                fill="var(--card)"
                                stroke="var(--border)"
                                strokeWidth={1.25}
                                strokeDasharray="2 2"
                            >
                                <title>
                                    {`${v.dim.label} — not measured yet. Nothing has been recorded on this axis, which is not the same as a score of zero, so it is left out of the shape.`}
                                </title>
                            </circle>
                        );
                    })}
                </g>

                {/* --- labels + values, outside the outer ring --- */}
                <g>
                    {vertices.map((v) => {
                        const unreadable = v.state === 'unreadable';
                        // Why this axis is blank, in one sentence, on hover. The two
                        // blank states get DIFFERENT sentences — that is the whole
                        // point of the third state.
                        const explain = unreadable
                            ? `${v.dim.label} — could not be read. The query behind this axis failed, so its value is UNKNOWN. This is not "no data yet" and it is not a score of zero; nothing is being claimed about the agent here.`
                            : `${v.dim.label} — not measured yet. No data has been recorded for this axis, which is not the same as a score of zero.`;
                        return (
                            <g key={v.dim.key ?? `label-${v.index}`}>
                                <text
                                    x={v.label.x}
                                    y={v.label.y}
                                    textAnchor={v.label.anchor}
                                    fontSize={11}
                                    fontWeight={600}
                                    fill={unreadable ? undefined : v.measured ? 'var(--text-secondary)' : 'var(--text-tertiary)'}
                                    className={unreadable ? 'fill-amber-600' : undefined}
                                >
                                    {v.dim.label}
                                    <title>
                                        {v.measured ? v.dim.description ?? v.dim.label : explain}
                                    </title>
                                </text>
                                <text
                                    x={v.label.x}
                                    y={v.label.y + 13}
                                    textAnchor={v.label.anchor}
                                    fontSize={v.measured ? 12 : 11}
                                    fontWeight={v.measured ? 700 : unreadable ? 600 : 500}
                                    fill={unreadable ? undefined : v.measured ? 'var(--primary-dark)' : 'var(--text-tertiary)'}
                                    className={unreadable ? 'fill-amber-600' : undefined}
                                >
                                    {/* Short on purpose: this line sits on the horizontal
                                        axis of a 4-axis radar, where a long string is the
                                        one thing that overflows the viewBox. Both blank
                                        strings are inside the 13-character label budget
                                        radiusFor() solves against. The full explanation
                                        lives in the <title> beside it. */}
                                    {v.measured
                                        ? Math.round(v.dim.value)
                                        : unreadable
                                          ? UNREADABLE_TEXT
                                          : NOT_MEASURED_TEXT}
                                    <title>{v.measured ? v.dim.description ?? v.dim.label : explain}</title>
                                </text>
                            </g>
                        );
                    })}
                </g>
            </svg>

            {comparison && (
                <div className="mt-1 flex items-center justify-center gap-4 text-[11px] text-text-tertiary">
                    <span className="inline-flex items-center gap-1.5">
                        <span
                            className="inline-block h-2 w-4 rounded-full"
                            style={{ background: 'var(--primary)' }}
                        />
                        {seriesLabel}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span
                            className="inline-block h-0 w-4 border-t-2 border-dashed"
                            style={{ borderColor: 'var(--secondary)' }}
                        />
                        {comparison.label}
                    </span>
                </div>
            )}
        </div>
    );
}
