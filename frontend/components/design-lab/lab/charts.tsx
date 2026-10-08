'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Chart primitives that bake in the brief's chart rules (section 5):
 *   bars at most 24px wide, 4px rounded tops and square bottoms; lines 2px; area fill 10%;
 *   one y-axis; light solid gridlines; only the key value labelled; hover tooltip on every
 *   chart; labels in text colours; today's partial value lighter and labelled "so far".
 * Colours are passed in by each design. Legends are rendered by the design (see Legend).
 */

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useMeasure<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
    const ref = useRef<T | null>(null);
    const [width, setWidth] = useState(0);
    useIsoLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        setWidth(el.getBoundingClientRect().width);
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) setWidth(entry.contentRect.width);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, width];
}

interface TipState { x: number; y: number; content: React.ReactNode }

/** Tooltip anchored to whatever element is hovered inside the chart host. */
export function useTip() {
    const host = useRef<HTMLDivElement | null>(null);
    const [tip, setTip] = useState<TipState | null>(null);
    const show = useCallback((target: Element, content: React.ReactNode) => {
        const h = host.current?.getBoundingClientRect();
        const r = target.getBoundingClientRect();
        if (!h) return;
        setTip({ x: r.left + r.width / 2 - h.left, y: r.top - h.top, content });
    }, []);
    const hide = useCallback(() => setTip(null), []);
    return { host, tip, show, hide };
}

export function TipBox({ tip }: { tip: TipState | null }) {
    if (!tip) return null;
    return (
        <div
            role="tooltip"
            className="pointer-events-none absolute z-30 whitespace-nowrap px-2.5 py-1.5 text-[12px] font-medium leading-snug shadow-lg"
            style={{
                left: tip.x,
                top: tip.y - 8,
                transform: 'translate(-50%, -100%)',
                background: 'var(--lab-tooltip-bg)',
                color: 'var(--lab-tooltip-fg)',
                borderRadius: 8,
            }}
        >
            {tip.content}
        </div>
    );
}

/** Rounded top corners, square bottom. */
export function barPath(x: number, y: number, w: number, h: number, r = 4): string {
    if (h <= 0) return '';
    const rr = Math.min(r, w / 2, h);
    return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

export function niceMax(max: number): number {
    if (max <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(max)));
    const n = max / pow;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * pow;
}

export interface Series { name: string; color: string }

export function Legend({ series, className, dark }: { series: (Series & { swatch?: 'dot' | 'bar' | 'line' })[]; className?: string; dark?: boolean }) {
    return (
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] ${className ?? ''}`} style={{ color: dark ? 'rgba(255,255,255,0.75)' : 'var(--lab-text2)' }}>
            {series.map(s => (
                <span key={s.name} className="inline-flex items-center gap-1.5">
                    <span
                        aria-hidden
                        style={{
                            width: s.swatch === 'line' ? 14 : 9,
                            height: s.swatch === 'line' ? 2 : 9,
                            borderRadius: s.swatch === 'bar' ? 2 : 9,
                            background: s.color,
                            display: 'inline-block',
                        }}
                    />
                    {s.name}
                </span>
            ))}
        </div>
    );
}

export interface ColumnDatum { label: string; values: number[]; partial?: boolean; highlight?: boolean; tipLabel?: string }

/**
 * Vertical columns, single or grouped. The key value (peak, today, or a given index) is the
 * only one labelled. A partial (today) column is drawn lighter and labelled "so far".
 */
export function Columns({
    data, series, height = 160, maxBar = 24, groupGap = 2, showAxis = true, showXLabels = true,
    gridColor = 'var(--lab-grid)', textColor = 'var(--lab-text3)', keyColor = 'var(--lab-text)',
    keyIndex = 'auto', keySeries = 0, format = (n: number) => n.toLocaleString('en-IN'), partialOpacity = 0.42,
    highlightColor, ariaLabel, xLabelEvery = 1, barRadius = 4, partialColors,
}: {
    data: ColumnDatum[]; series: Series[]; height?: number; maxBar?: number; groupGap?: number; showAxis?: boolean; showXLabels?: boolean;
    gridColor?: string; textColor?: string; keyColor?: string; keyIndex?: 'auto' | 'peak' | 'last' | number | null; keySeries?: number;
    format?: (n: number) => string; partialOpacity?: number; highlightColor?: string; ariaLabel: string; xLabelEvery?: number; barRadius?: number;
    /** Optional explicit lighter shades for the partial column, one per series. */
    partialColors?: string[];
}) {
    const [ref, width] = useMeasure<HTMLDivElement>();
    const { host, tip, show, hide } = useTip();
    const padL = showAxis ? 34 : 0;
    const padT = 22;
    const padB = showXLabels ? 22 : 4;
    const plotW = Math.max(0, width - padL);
    const plotH = Math.max(10, height - padT - padB);
    const max = niceMax(Math.max(1, ...data.flatMap(d => d.values)));
    const n = Math.max(1, data.length);
    const slot = plotW / n;
    const ns = series.length;
    const barW = Math.max(3, Math.min(maxBar, (slot * 0.62 - (ns - 1) * groupGap) / ns));
    const groupW = barW * ns + groupGap * (ns - 1);
    const ticks = showAxis ? [0, max / 2, max] : [0];

    let key: number | null = null;
    if (keyIndex === 'auto') {
        const partialIdx = data.findIndex(d => d.partial);
        if (partialIdx >= 0) key = partialIdx;
        else key = data.reduce((best, d, i) => (d.values[keySeries] > data[best].values[keySeries] ? i : best), 0);
    } else if (keyIndex === 'peak') {
        key = data.reduce((best, d, i) => (d.values[keySeries] > data[best].values[keySeries] ? i : best), 0);
    } else if (keyIndex === 'last') {
        key = data.length - 1;
    } else {
        key = keyIndex;
    }

    return (
        <div ref={el => { ref.current = el; host.current = el; }} className="relative w-full" style={{ height }} onMouseLeave={hide}>
            {width > 0 && (
                <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
                    {ticks.map(tv => {
                        const y = padT + plotH - (tv / max) * plotH;
                        return (
                            <g key={tv}>
                                <line x1={padL} x2={width} y1={y} y2={y} stroke={gridColor} strokeWidth={1} />
                                {showAxis && (
                                    <text x={padL - 8} y={y + 4} textAnchor="end" fontSize={11} fill={textColor}>{format(tv)}</text>
                                )}
                            </g>
                        );
                    })}
                    {data.map((d, i) => {
                        const cx = padL + slot * i + slot / 2;
                        const x0 = cx - groupW / 2;
                        const top = Math.min(...d.values.map(val => padT + plotH - (val / max) * plotH));
                        return (
                            <g key={d.label + i}>
                                {d.values.map((val, s) => {
                                    const h = (val / max) * plotH;
                                    const x = x0 + s * (barW + groupGap);
                                    const y = padT + plotH - h;
                                    let fill = series[s]?.color ?? 'currentColor';
                                    if (d.highlight && highlightColor && s === 0) fill = highlightColor;
                                    const partialFill = d.partial && partialColors?.[s];
                                    return (
                                        <path
                                            key={s}
                                            d={barPath(x, y, barW, h, barRadius)}
                                            fill={partialFill || fill}
                                            fillOpacity={d.partial && !partialFill ? partialOpacity : 1}
                                        />
                                    );
                                })}
                                {key === i && (
                                    <text
                                        x={cx > width - 40 ? x0 + groupW : cx < padL + 40 ? x0 : cx}
                                        y={top - 7}
                                        textAnchor={cx > width - 40 ? 'end' : cx < padL + 40 ? 'start' : 'middle'}
                                        fontSize={11.5}
                                        fontWeight={600}
                                        fill={keyColor}
                                    >
                                        {format(d.values[keySeries])}{d.partial ? ' so far' : ''}
                                    </text>
                                )}
                                {showXLabels && i % xLabelEvery === 0 && (
                                    <text x={cx} y={height - 5} textAnchor="middle" fontSize={11} fontWeight={d.partial || d.highlight ? 600 : 400} fill={d.partial || d.highlight ? keyColor : textColor}>
                                        {d.label}
                                    </text>
                                )}
                                <rect
                                    x={padL + slot * i}
                                    y={padT}
                                    width={slot}
                                    height={plotH}
                                    fill="transparent"
                                    onMouseEnter={e => show(e.currentTarget, (
                                        <span className="flex flex-col gap-0.5">
                                            <span className="opacity-70">{d.tipLabel ?? d.label}{d.partial ? ', so far' : ''}</span>
                                            {d.values.map((val, s) => (
                                                <span key={s}>{series[s]?.name}: <b>{format(val)}</b></span>
                                            ))}
                                        </span>
                                    ))}
                                    onClick={e => show(e.currentTarget, (
                                        <span>{d.tipLabel ?? d.label}: <b>{d.values.map(format).join(' / ')}</b></span>
                                    ))}
                                />
                            </g>
                        );
                    })}
                </svg>
            )}
            <TipBox tip={tip} />
        </div>
    );
}

/**
 * 2px line with a 10% area. Optionally keeps a tooltip pinned to the peak until hovered.
 */
export function LineArea({
    data, color, height = 140, gridColor = 'var(--lab-grid)', textColor = 'var(--lab-text3)', keyColor = 'var(--lab-text)',
    fillOpacity = 0.1, showAxis = false, pinPeak = false, format = (n: number) => n.toLocaleString('en-IN'), ariaLabel,
    xLabels, partialLast = false, gridLines = 3, dotFill,
}: {
    data: { label: string; value: number }[]; color: string; height?: number; gridColor?: string; textColor?: string; keyColor?: string;
    fillOpacity?: number; showAxis?: boolean; pinPeak?: boolean; format?: (n: number) => string; ariaLabel: string;
    xLabels?: { index: number; text: string }[]; partialLast?: boolean; gridLines?: number; dotFill?: string;
}) {
    const [ref, width] = useMeasure<HTMLDivElement>();
    const { host, tip, show, hide } = useTip();
    const [hover, setHover] = useState<number | null>(null);
    const padL = showAxis ? 34 : 4;
    const padR = 4;
    const padT = pinPeak ? 46 : 18;
    const padB = xLabels ? 20 : 4;
    const plotW = Math.max(0, width - padL - padR);
    const plotH = Math.max(10, height - padT - padB);
    const max = niceMax(Math.max(1, ...data.map(d => d.value)));
    const n = data.length;
    const x = (i: number) => padL + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
    const y = (val: number) => padT + plotH - (val / max) * plotH;
    const peak = data.reduce((b, d, i) => (d.value > data[b].value ? i : b), 0);
    const solidEnd = partialLast ? n - 1 : n;
    const line = data.slice(0, solidEnd).map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.value)}`).join(' ');
    const area = `${line} L${x(solidEnd - 1)},${padT + plotH} L${x(0)},${padT + plotH} Z`;
    const ticks = Array.from({ length: gridLines }, (_, i) => (max * i) / Math.max(1, gridLines - 1));
    const active = hover ?? (pinPeak ? peak : null);

    return (
        <div
            ref={el => { ref.current = el; host.current = el; }}
            className="relative w-full"
            style={{ height }}
            onMouseLeave={() => { setHover(null); hide(); }}
        >
            {width > 0 && (
                <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
                    {ticks.map(tv => (
                        <g key={tv}>
                            <line x1={padL} x2={width - padR} y1={y(tv)} y2={y(tv)} stroke={gridColor} strokeWidth={1} />
                            {showAxis && <text x={padL - 8} y={y(tv) + 4} textAnchor="end" fontSize={11} fill={textColor}>{format(tv)}</text>}
                        </g>
                    ))}
                    <path d={area} fill={color} fillOpacity={fillOpacity} />
                    <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    {partialLast && n > 1 && (
                        <>
                            <path d={`M${x(n - 2)},${y(data[n - 2].value)} L${x(n - 1)},${y(data[n - 1].value)}`} stroke={color} strokeOpacity={0.45} strokeWidth={2} strokeDasharray="3 4" fill="none" />
                            <circle cx={x(n - 1)} cy={y(data[n - 1].value)} r={3.5} fill={color} fillOpacity={0.45} />
                            <text x={x(n - 1)} y={y(data[n - 1].value) - 9} textAnchor="end" fontSize={11} fontWeight={600} fill={keyColor}>{format(data[n - 1].value)} so far</text>
                        </>
                    )}
                    {active !== null && data[active] && (
                        <g>
                            <line x1={x(active)} x2={x(active)} y1={padT} y2={padT + plotH} stroke={color} strokeOpacity={0.35} strokeWidth={1} />
                            <circle cx={x(active)} cy={y(data[active].value)} r={5} fill={dotFill ?? color} stroke={color} strokeWidth={2} />
                        </g>
                    )}
                    {pinPeak && hover === null && data[peak] && (
                        <foreignObject x={Math.min(Math.max(0, x(peak) - 70), width - 140)} y={y(data[peak].value) - 44} width={140} height={36}>
                            <div className="flex h-full items-center justify-center">
                                <span className="whitespace-nowrap px-2.5 py-1 text-[12px] font-semibold shadow-md" style={{ background: 'var(--lab-tooltip-bg)', color: 'var(--lab-tooltip-fg)', borderRadius: 8 }}>
                                    {data[peak].label}: {format(data[peak].value)}
                                </span>
                            </div>
                        </foreignObject>
                    )}
                    {xLabels?.map(l => (
                        <text key={l.index} x={x(l.index)} y={height - 4} textAnchor={l.index === 0 ? 'start' : l.index === n - 1 ? 'end' : 'middle'} fontSize={11} fill={textColor}>{l.text}</text>
                    ))}
                    {data.map((d, i) => {
                        const w = n <= 1 ? plotW : plotW / (n - 1);
                        return (
                            <rect
                                key={i}
                                x={x(i) - w / 2}
                                y={padT}
                                width={w}
                                height={plotH}
                                fill="transparent"
                                onMouseEnter={e => {
                                    setHover(i);
                                    show(e.currentTarget, <span>{d.label}{partialLast && i === n - 1 ? ', so far' : ''}: <b>{format(d.value)}</b></span>);
                                }}
                            />
                        );
                    })}
                </svg>
            )}
            <TipBox tip={hover !== null ? tip : null} />
        </div>
    );
}

/** Tiny line for module rows. Still has a hover tooltip. */
export function Sparkline({ values, labels, color, width = 88, height = 28, format = (n: number) => n.toLocaleString('en-IN'), ariaLabel }: {
    values: number[]; labels?: string[]; color: string; width?: number; height?: number; format?: (n: number) => string; ariaLabel: string;
}) {
    const { host, tip, show, hide } = useTip();
    const max = Math.max(1, ...values);
    const min = Math.min(...values);
    const n = values.length;
    const x = (i: number) => 2 + ((width - 4) * i) / Math.max(1, n - 1);
    const y = (val: number) => 3 + (height - 6) * (1 - (val - min) / Math.max(1, max - min));
    const d = values.map((val, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(val)}`).join(' ');
    return (
        <div ref={host} className="relative" style={{ width, height }} onMouseLeave={hide}>
            <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
                <path d={`${d} L${x(n - 1)},${height} L${x(0)},${height} Z`} fill={color} fillOpacity={0.1} />
                <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                <circle cx={x(n - 1)} cy={y(values[n - 1])} r={2.5} fill={color} />
                {values.map((val, i) => (
                    <rect key={i} x={x(i) - width / n / 2} y={0} width={width / n} height={height} fill="transparent"
                        onMouseEnter={e => show(e.currentTarget, <span>{labels?.[i] ?? `Day ${i + 1}`}: <b>{format(val)}</b></span>)} />
                ))}
            </svg>
            <TipBox tip={tip} />
        </div>
    );
}

/** Progress ring with a hover tooltip. */
export function Ring({ value, size = 96, stroke = 10, color, track, children, tipText, rounded = true, ariaLabel }: {
    value: number; size?: number; stroke?: number; color: string; track: string; children?: React.ReactNode; tipText: string; rounded?: boolean; ariaLabel: string;
}) {
    const { host, tip, show, hide } = useTip();
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(1, value));
    return (
        <div ref={host} className="relative inline-grid place-items-center" style={{ width: size, height: size }} onMouseLeave={hide}
            onMouseEnter={e => show(e.currentTarget, tipText)}>
            <svg width={size} height={size} role="img" aria-label={ariaLabel} className="-rotate-90">
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
                    strokeDasharray={`${c * pct} ${c}`} strokeLinecap={rounded ? 'round' : 'butt'} />
            </svg>
            <div className="absolute inset-0 grid place-items-center">{children}</div>
            <TipBox tip={tip} />
        </div>
    );
}

/** Donut made of separate arcs with small gaps. Each arc has its own tooltip. */
export function Donut({ segments, size = 168, thickness = 18, gapDeg = 2.5, children, ariaLabel }: {
    segments: { label: string; value: number; color: string }[]; size?: number; thickness?: number; gapDeg?: number; children?: React.ReactNode; ariaLabel: string;
}) {
    const { host, tip, show, hide } = useTip();
    const total = segments.reduce((s, x) => s + x.value, 0) || 1;
    const r = size / 2 - thickness / 2;
    const cxy = size / 2;
    const visible = segments.filter(s => s.value > 0);
    const starts = visible.map((_, i) => -90 + (visible.slice(0, i).reduce((a, x) => a + x.value, 0) / total) * 360);
    const arcs = visible.map((s, i) => {
        const sweep = (s.value / total) * 360;
        const start = starts[i] + gapDeg / 2;
        const end = starts[i] + sweep - gapDeg / 2;
        const p = (deg: number) => [cxy + r * Math.cos((deg * Math.PI) / 180), cxy + r * Math.sin((deg * Math.PI) / 180)];
        const [x1, y1] = p(start);
        const [x2, y2] = p(Math.max(start + 0.1, end));
        const large = end - start > 180 ? 1 : 0;
        return { ...s, d: `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2}` };
    });
    return (
        <div ref={host} className="relative inline-grid place-items-center" style={{ width: size, height: size }} onMouseLeave={hide}>
            <svg width={size} height={size} role="img" aria-label={ariaLabel}>
                {arcs.map(a => (
                    <path key={a.label} d={a.d} fill="none" stroke={a.color} strokeWidth={thickness}
                        onMouseEnter={e => show(e.currentTarget, <span>{a.label}: <b>{a.value}</b></span>)} />
                ))}
            </svg>
            <div className="pointer-events-none absolute inset-0 grid place-items-center">{children}</div>
            <TipBox tip={tip} />
        </div>
    );
}

/** Horizontal stacked bar with 2px gaps, one tooltip per segment. */
export function SegmentBar({ segments, height = 10, gap = 2, radius = 999, ariaLabel, className }: {
    segments: { label: string; value: number; color: string }[]; height?: number; gap?: number; radius?: number; ariaLabel: string; className?: string;
}) {
    const { host, tip, show, hide } = useTip();
    const total = segments.reduce((s, x) => s + x.value, 0);
    return (
        <div ref={host} className={`relative ${className ?? ''}`} onMouseLeave={hide}>
            <div className="flex w-full" style={{ height, gap }} role="img" aria-label={ariaLabel}>
                {total === 0 ? (
                    <div className="h-full w-full" style={{ borderRadius: radius, background: 'var(--lab-border)' }} />
                ) : segments.filter(s => s.value > 0).map(s => (
                    <div key={s.label} className="h-full"
                        style={{ flexGrow: s.value, flexBasis: 0, background: s.color, borderRadius: radius }}
                        onMouseEnter={e => show(e.currentTarget, <span>{s.label}: <b>{s.value}</b></span>)} />
                ))}
            </div>
            <TipBox tip={tip} />
        </div>
    );
}

/** Horizontal bars for rankings (categories). Bar thickness capped at 24px. */
export function HBars({ data, color, max: maxIn, height = 10, textColor = 'var(--lab-text)', mutedColor = 'var(--lab-text2)', track = 'var(--lab-tile)', ariaLabel, radius = 4 }: {
    data: { name: string; value: number }[]; color: string; max?: number; height?: number; textColor?: string; mutedColor?: string; track?: string; ariaLabel: string; radius?: number;
}) {
    const { host, tip, show, hide } = useTip();
    const max = maxIn ?? Math.max(1, ...data.map(d => d.value));
    return (
        <div ref={host} className="relative flex flex-col gap-[12px]" role="img" aria-label={ariaLabel} onMouseLeave={hide}>
            {data.map((d, i) => (
                <div key={d.name} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between text-[13px]">
                        <span style={{ color: textColor }} className="font-medium">{d.name}</span>
                        <span style={{ color: i === 0 ? textColor : mutedColor }} className={i === 0 ? 'font-semibold tabular-nums' : 'tabular-nums'}>{d.value.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="w-full" style={{ height: Math.min(24, height), background: track, borderRadius: `0 ${radius}px ${radius}px 0` }}>
                        <div style={{ width: `${(d.value / max) * 100}%`, height: '100%', background: color, borderRadius: `0 ${radius}px ${radius}px 0` }}
                            onMouseEnter={e => show(e.currentTarget, <span>{d.name}: <b>{d.value.toLocaleString('en-IN')}</b> tickets</span>)} />
                    </div>
                </div>
            ))}
            <TipBox tip={tip} />
        </div>
    );
}

/** Horizontal level meter (tank %, stock vs minimum). Has a hover tooltip like every chart. */
export function Meter({ value, label, color, track, height = 8, radius = 999, tip }: {
    value: number; label: string; color: string; track: string; height?: number; radius?: number; tip: string;
}) {
    const { host, tip: t, show, hide } = useTip();
    return (
        <div ref={host} className="relative" onMouseLeave={hide}>
            <div role="meter" aria-label={label} aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}
                className="w-full overflow-hidden" style={{ height, background: track, borderRadius: radius }}
                onMouseEnter={e => show(e.currentTarget, tip)}>
                <div style={{ width: `${Math.max(2, Math.min(100, value * 100))}%`, height: '100%', background: color, borderRadius: radius }} />
            </div>
            <TipBox tip={t} />
        </div>
    );
}

/** A row of thin vertical ticks, one per item, each with a tooltip (checklist rounds, SLA time). */
export function Ticks({ items, height = 28, width = 3, gap = 3, ariaLabel, marker }: {
    items: { color: string; tip: string }[]; height?: number; width?: number; gap?: number; ariaLabel: string;
    /** Draws a "now" marker before this index. */
    marker?: { index: number; color: string; label?: string };
}) {
    const { host, tip, show, hide } = useTip();
    return (
        <div ref={host} className="relative" onMouseLeave={hide}>
            <div className="flex items-end" style={{ gap, height }} role="img" aria-label={ariaLabel}>
                {items.map((it, i) => (
                    <React.Fragment key={i}>
                        {marker && marker.index === i && (
                            <span aria-hidden className="relative shrink-0" style={{ width: 2, height: height + 8, marginTop: -8, background: marker.color, borderRadius: 2 }}>
                                {marker.label && <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10.5px] font-semibold" style={{ color: marker.color }}>{marker.label}</span>}
                            </span>
                        )}
                        <span
                            className="shrink-0"
                            style={{ width, height, background: it.color, borderRadius: width }}
                            onMouseEnter={e => show(e.currentTarget, it.tip)}
                        />
                    </React.Fragment>
                ))}
            </div>
            <TipBox tip={tip} />
        </div>
    );
}
