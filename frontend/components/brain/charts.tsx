'use client';

/**
 * Brain Console charts, drawn in SVG. Each has readable axes or labels, a text readout for keyboard and screen-reader
 * users, and never relies on colour alone: the flagged share is hatched, over-budget gets an icon and words.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { cx, s } from './ui';
import type { Tone } from './labels';

function useWidth<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => setWidth(Math.floor(entries[0].contentRect.width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return { ref, width };
}

/** 0, then 3–5 round steps up to at least `max`. */
function niceTicks(max: number): number[] {
    if (!(max > 0)) return [0, 1];
    const raw = max / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(st => st >= raw) ?? 10 * mag;
    const out: number[] = [];
    for (let v = 0; v <= max + step * 0.999; v += step) out.push(Number(v.toPrecision(6)));
    return out.length < 2 ? [0, step] : out;
}

export interface SeriesBar { key: string; label: string; long: string; value: number; flagged?: number }

/**
 * Bars over time. The flagged part of each bar is amber AND hatched. Hover, or focus the chart and use the arrow keys,
 * to read one bar exactly.
 */
export function BarSeries({ bars, format, unit, title, tone = 'teal', height = 196 }: { bars: SeriesBar[]; format: (v: number) => string; unit: string; title: string; tone?: 'teal' | 'money'; height?: number }) {
    const { ref, width } = useWidth<HTMLDivElement>();
    const pid = useId().replace(/:/g, '');
    const [hover, setHover] = useState<number | null>(null);
    const max = Math.max(0, ...bars.map(b => b.value));
    const ticks = niceTicks(max);
    const top = ticks[ticks.length - 1] || 1;
    const longest = Math.max(...ticks.map(t => format(t).length));
    const pad = { l: Math.max(28, longest * 6.6 + 10), r: 4, t: 10, b: 24 };
    const innerW = Math.max(0, width - pad.l - pad.r);
    const innerH = height - pad.t - pad.b;
    const band = bars.length ? innerW / bars.length : 0;
    const barW = Math.max(2, Math.min(28, band * 0.64));
    const y = (v: number) => pad.t + innerH - (v / top) * innerH;
    const labelEvery = Math.max(1, Math.ceil(bars.length / Math.max(2, Math.floor(innerW / 58))));
    // Messages in the brand teal, money in the brand tan (--secondary): two series never share a colour.
    const fill = tone === 'money' ? 'var(--bc-money)' : 'var(--bc-teal)';
    const anyFlag = bars.some(b => (b.flagged ?? 0) > 0);
    const active = hover !== null ? bars[hover] : null;
    const peak = bars.reduce<SeriesBar | null>((p, b) => (!p || b.value > p.value ? b : p), null);

    const pick = (clientX: number, rect: DOMRect) => {
        const i = Math.floor((clientX - rect.left - pad.l) / (band || 1));
        setHover(i >= 0 && i < bars.length ? i : null);
    };
    const onKey = (e: React.KeyboardEvent) => {
        if (!bars.length) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const d = e.key === 'ArrowRight' ? 1 : -1;
            setHover(h => (h === null ? (d > 0 ? 0 : bars.length - 1) : Math.min(bars.length - 1, Math.max(0, h + d))));
        } else if (e.key === 'Escape') setHover(null);
    };

    return (
        <div className="flex min-w-0 flex-col gap-[12px]">
            <div className="flex min-h-[22px] flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12px] text-(--bc-ink-3)">
                <span aria-live="polite" className={cx(s.tab, 'text-(--bc-ink-2)')}>
                    {active ? <><b className="font-semibold text-(--bc-ink-1)">{active.long}</b> · {format(active.value)} {unit}{active.flagged ? ` · ${active.flagged} flagged` : ''}</>
                        : peak && peak.value > 0 ? <>Busiest: <b className="font-semibold text-(--bc-ink-1)">{peak.long}</b> · {format(peak.value)} {unit}</> : <>Nothing in this period</>}
                </span>
                <span className="flex items-center gap-[12px]" aria-hidden="true">
                    <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: fill }} />{unit[0].toUpperCase() + unit.slice(1)}</span>
                    {anyFlag && <span className="flex items-center gap-1.5"><svg width="10" height="10"><rect width="10" height="10" rx="2" fill={`url(#h${pid})`} /></svg>Flagged</span>}
                </span>
            </div>
            <div ref={ref} className="relative min-w-0 rounded-lg" tabIndex={0} onKeyDown={onKey} onBlur={() => setHover(null)}
                role="img" aria-label={`${title}. ${bars.length} bars. ${peak ? `Highest ${format(peak.value)} ${unit} on ${peak.long}.` : ''} Use the left and right arrow keys to read each bar.`}>
                {width > 0 && (
                    <svg width={width} height={height} className="block" onMouseMove={e => pick(e.clientX, e.currentTarget.getBoundingClientRect())} onMouseLeave={() => setHover(null)}>
                        <defs>
                            <pattern id={`h${pid}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                                <rect width="5" height="5" style={{ fill: 'color-mix(in srgb, var(--bc-warn) 30%, transparent)' }} />
                                <line x1="0" y1="0" x2="0" y2="5" style={{ stroke: 'var(--bc-warn)' }} strokeWidth="2.2" />
                            </pattern>
                        </defs>
                        {ticks.map(t => (
                            <g key={t}>
                                <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className={s.grid} strokeDasharray={t === 0 ? undefined : '2 4'} />
                                <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className={s.axis}>{format(t)}</text>
                            </g>
                        ))}
                        {active && hover !== null && <rect x={pad.l + hover * band} y={pad.t} width={band} height={innerH} fill="rgba(26,35,50,0.04)" />}
                        {bars.map((b, i) => {
                            const x = pad.l + i * band + (band - barW) / 2;
                            const h = Math.max(b.value > 0 ? 1.5 : 0, innerH - (y(b.value) - pad.t));
                            const fh = b.flagged ? Math.min(h, (b.flagged / Math.max(1, b.value)) * h) : 0;
                            const dim = hover !== null && hover !== i;
                            return (
                                <g key={b.key} opacity={dim ? 0.45 : 1}>
                                    <rect x={x} y={pad.t + innerH - h} width={barW} height={h} rx={Math.min(3, barW / 3)} style={{ fill }} opacity={0.9} />
                                    {fh > 0 && <rect x={x} y={pad.t + innerH - fh} width={barW} height={fh} rx={Math.min(3, barW / 3)} fill={`url(#h${pid})`} />}
                                    {i % labelEvery === 0 && <text x={x + barW / 2} y={height - 6} textAnchor="middle" className={s.axis}>{b.label}</text>}
                                </g>
                            );
                        })}
                    </svg>
                )}
                {width === 0 && <div style={{ height }} />}
            </div>
            <table className="sr-only">
                <caption>{title}</caption>
                <thead><tr><th>When</th><th>{unit}</th>{anyFlag && <th>Flagged</th>}</tr></thead>
                <tbody>{bars.map(b => <tr key={b.key}><td>{b.long}</td><td>{format(b.value)}</td>{anyFlag && <td>{b.flagged ?? 0}</td>}</tr>)}</tbody>
            </table>
        </div>
    );
}

export interface BarRow { key: string; label: React.ReactNode; value: number; display: React.ReactNode; sub?: React.ReactNode; tone?: Tone; /** Overrides the tone colour (spend lists use the money hue). */ color?: string }

/** A ranked list: the words, the figure, and a bar scaled to the largest row. Binance row geometry (12px). */
export function BarList({ rows, empty }: { rows: BarRow[]; empty?: React.ReactNode }) {
    const max = Math.max(0, ...rows.map(r => r.value));
    if (!rows.length) return <p className="py-3 text-[13px] text-(--bc-ink-3)">{empty ?? 'Nothing yet.'}</p>;
    return (
        <ul className={cx(s.rows, 'min-w-0')}>
            {rows.map(r => {
                const color = r.tone === 'bad' ? 'var(--bc-bad)' : r.tone === 'warn' ? 'var(--bc-warn)' : r.tone === 'accent' ? 'var(--bc-accent)' : r.tone === 'ok' ? 'var(--bc-ok)' : r.color ?? 'var(--bc-teal)';
                return (
                    <li key={r.key} className="flex min-w-0 flex-col gap-1.5 py-3 first:pt-1 last:pb-1">
                        <div className="flex min-w-0 items-baseline justify-between gap-[12px]">
                            <span className="min-w-0 truncate text-[13px] text-(--bc-ink-1)">{r.label}</span>
                            <span className={cx(s.numSm, 'shrink-0 text-(--bc-ink-1)')}>{r.display}</span>
                        </div>
                        <div className={s.barTrack}><div className={s.barFill} style={{ width: `${max > 0 ? Math.max(1.5, (r.value / max) * 100) : 0}%`, background: color }} /></div>
                        {r.sub && <div className="text-[12px] text-(--bc-ink-3)">{r.sub}</div>}
                    </li>
                );
            })}
        </ul>
    );
}

/** Two or more parts of one whole (live vs shadow, WhatsApp vs app), each labelled with its count. */
export function Split({ parts, label }: { parts: Array<{ key: string; label: string; value: number; color: string }>; label: string }) {
    const total = parts.reduce((n, p) => n + p.value, 0);
    return (
        <div className="flex min-w-0 flex-col gap-[8px]">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-(--bc-l3)" role="img" aria-label={`${label}: ${parts.map(p => `${p.label} ${p.value}`).join(', ')}`}>
                {total > 0 && parts.map((p, i) => <div key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.color, marginLeft: i ? 2 : 0 }} />)}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-(--bc-ink-3)">
                {parts.map(p => (
                    <span key={p.key} className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: p.color }} />{p.label} <b className={cx(s.tab, 'font-semibold text-(--bc-ink-1)')}>{p.value.toLocaleString('en-IN')}</b>{total > 0 && <span className={s.tab}>({Math.round((p.value / total) * 100)}%)</span>}</span>
                ))}
            </div>
        </div>
    );
}

const polar = (cx: number, cy: number, r: number, frac: number) => {
    const a = Math.PI * (1 - frac);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const;
};
const arc = (cx: number, cy: number, r: number, from: number, to: number) => {
    const [x1, y1] = polar(cx, cy, r, from), [x2, y2] = polar(cx, cy, r, to);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

/**
 * Spend against credit for one key's cycle: the solid arc is spent, the dashed arc is where the current daily rate
 * lands by the cycle end. Past 90% the arc turns amber, past 100% red, and the words under it say so.
 */
export function Gauge({ spent, credit, projected, label }: { spent: number; credit: number; projected: number; label: string }) {
    const f = credit > 0 ? Math.min(1, spent / credit) : 0;
    const p = credit > 0 ? Math.min(1, projected / credit) : 0;
    const tone = credit > 0 && spent >= credit ? 'var(--bc-bad)' : credit > 0 && spent >= credit * 0.9 ? 'var(--bc-warn)' : 'var(--bc-money)';
    const projTone = credit > 0 && projected > credit ? 'var(--bc-bad)' : 'var(--bc-ink-3)';
    return (
        <svg viewBox="0 0 200 112" className="block w-full max-w-[260px]" role="img" aria-label={label}>
            <path d={arc(100, 100, 84, 0, 1)} fill="none" style={{ stroke: 'var(--bc-l3)' }} strokeWidth="12" strokeLinecap="round" />
            {p > f && <path d={arc(100, 100, 84, f, p)} fill="none" style={{ stroke: projTone }} strokeWidth="12" strokeDasharray="3 4" opacity="0.8" />}
            {f > 0 && <path d={arc(100, 100, 84, 0, f)} fill="none" style={{ stroke: tone }} strokeWidth="12" strokeLinecap="round" />}
            {[0.5].map(t => {
                const [x1, y1] = polar(100, 100, 70, t), [x2, y2] = polar(100, 100, 64, t);
                return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} style={{ stroke: 'var(--bc-ink-4)' }} strokeWidth="1.2" />;
            })}
        </svg>
    );
}

export function OverBudget({ children }: { children: React.ReactNode }) {
    return <p className="flex items-start gap-1.5 text-[12.5px] text-(--bc-bad-text)"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{children}</p>;
}

/** Answer quality 0–3 as three cells, each filled by how much of that point was earned. */
export function QualityMeter({ value }: { value: number | null }) {
    if (value == null) return <span className="text-[12.5px] text-(--bc-ink-3)">Not graded</span>;
    return (
        <span className="inline-flex items-center gap-[8px]" role="img" aria-label={`Answer quality ${value.toFixed(1)} out of 3`}>
            <span className="inline-flex gap-[4px]">
                {[0, 1, 2].map(i => (
                    <span key={i} className="relative h-2 w-6 overflow-hidden rounded-[2px] bg-(--bc-l3)">
                        <span className="absolute inset-y-0 left-0 bg-(--bc-accent)" style={{ width: `${Math.max(0, Math.min(1, value - i)) * 100}%` }} />
                    </span>
                ))}
            </span>
            <span className={cx(s.numSm, 'text-(--bc-ink-1)')}>{value.toFixed(1)}<span className="text-(--bc-ink-3)"> / 3</span></span>
        </span>
    );
}
