'use client';

/**
 * Meera's rate checker and price-history card: what we have actually paid,
 * from the Zoho PO lines (backend/lib/satej/benchmark.ts, /api/satej/rates).
 *
 *   · RateChecker      — the "Rate checker" tab: type an item, optionally a unit
 *                        and a quoted rate, see the usual price, the range, who
 *                        sold it cheapest, and every past description it matched.
 *   · PriceHistoryCard — on a requirement: the history Meera found for it and the
 *                        target / ceiling Meera negotiates with.
 */

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import s from './satej.module.css';

/* eslint-disable @typescript-eslint/no-explicit-any */

const VERDICT: Record<string, { label: string; chip: string }> = {
    good: { label: 'Below what we usually pay', chip: s.good },
    fair: { label: 'In line with what we pay', chip: s.info },
    slightly_high: { label: 'A little above what we pay', chip: s.warn },
    high: { label: 'Well above what we pay', chip: s.bad },
    no_benchmark: { label: 'No price history to compare', chip: '' },
};

export function verdictChip(v: string | null | undefined) {
    if (!v) return null;
    const x = VERDICT[v] ?? VERDICT.no_benchmark;
    return <span className={`${s.chip} ${x.chip}`}>{x.label}</span>;
}

function rs(n: number | null | undefined): string {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
    const v = Number(n);
    const r = v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 2) / 2 : Math.round(v * 100) / 100;
    return `₹${r.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function day(iso?: string | null) {
    return iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

/** Min to max, with the middle half shaded, the usual price marked, and an optional quote. */
function RangeBar({ min, p25, median, p75, max, mark, target, ceiling }: {
    min: number; p25: number; median: number; p75: number; max: number; mark?: number | null; target?: number | null; ceiling?: number | null;
}) {
    const lo = Math.min(min, mark ?? min, target ?? min);
    const hi = Math.max(max, mark ?? max, ceiling ?? max);
    const at = (x: number) => (hi > lo ? ((x - lo) / (hi - lo)) * 100 : 50);
    return (
        <div className={s.range} aria-label={`Paid between ${rs(min)} and ${rs(max)}, usually ${rs(median)}`}>
            <div className={s.rangeTrack} />
            <div className={s.rangeBand} style={{ left: `${at(p25)}%`, width: `${Math.max(1, at(p75) - at(p25))}%` }} />
            <div className={s.rangeMedian} style={{ left: `${at(median)}%` }} title={`Usual ${rs(median)}`} />
            {target ? <div className={`${s.rangePin} ${s.rangeTarget}`} style={{ left: `${at(target)}%` }} title={`Meera aims for ${rs(target)}`} /> : null}
            {ceiling ? <div className={`${s.rangePin} ${s.rangeCeiling}`} style={{ left: `${at(ceiling)}%` }} title={`Meera's ceiling ${rs(ceiling)}`} /> : null}
            {mark ? <div className={`${s.rangePin} ${s.rangeQuote}`} style={{ left: `${at(mark)}%` }} title={`Quoted ${rs(mark)}`} /> : null}
            <div className={s.rangeEnds}><span>{rs(lo)}</span><span>{rs(hi)}</span></div>
        </div>
    );
}

function PoolStats({ p, quote, target, ceiling }: { p: any; quote?: number | null; target?: number | null; ceiling?: number | null }) {
    const per = p.unit && p.unit !== '-' ? ` / ${p.unit}` : '';
    return (
        <>
            <div className={s.stats}>
                <div><span>Usual{per}</span><b>{rs(p.rate_median ?? p.median)}</b></div>
                <div><span>Middle half</span><b>{rs(p.rate_p25 ?? p.p25)} – {rs(p.rate_p75 ?? p.p75)}</b></div>
                <div><span>Last 12 months</span><b>{rs(p.median_12m ?? p.median12m)}</b></div>
                <div><span>Last paid</span><b>{rs(p.last_rate ?? p.lastRate)}</b><em>{day(p.last_date ?? p.lastDate)}{(p.last_vendor ?? p.lastVendor) ? ` · ${p.last_vendor ?? p.lastVendor}` : ''}</em></div>
            </div>
            <RangeBar
                min={Number(p.rate_min ?? p.min)} p25={Number(p.rate_p25 ?? p.p25)} median={Number(p.rate_median ?? p.median)}
                p75={Number(p.rate_p75 ?? p.p75)} max={Number(p.rate_max ?? p.max)} mark={quote} target={target} ceiling={ceiling}
            />
            <p className={s.muted}>
                From {p.n_lines ?? p.nLines} purchase line{(p.n_lines ?? p.nLines) === 1 ? '' : 's'} across {p.n_vendors ?? p.nVendors} vendor{(p.n_vendors ?? p.nVendors) === 1 ? '' : 's'}
                {p.tax_percentage ?? p.taxPercentage ? ` · rates before GST (${p.tax_percentage ?? p.taxPercentage}% on these lines)` : ' · rates before GST'}
            </p>
            {(p.vendors ?? []).length > 0 && (
                <div className={s.tableWrap}>
                    <table className={s.table}>
                        <thead><tr><th>Vendor</th><th>Their usual</th><th>Orders</th><th>Last bought</th></tr></thead>
                        <tbody>
                            {p.vendors.map((v: any) => (
                                <tr key={v.vendor}><td>{v.vendor}</td><td>{rs(v.median)}</td><td>{v.n}</td><td>{day(v.last_date ?? v.lastDate)}</td></tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}

export function RateChecker({ orgId }: { orgId: string }) {
    const [q, setQ] = useState('');
    const [unit, setUnit] = useState('');
    const [rate, setRate] = useState('');
    const [res, setRes] = useState<any>(null);
    const [busy, setBusy] = useState<'' | 'search' | 'refresh'>('');
    const [err, setErr] = useState<string | null>(null);

    async function call(params: Record<string, string>, init?: RequestInit) {
        const url = `/api/satej/rates?${new URLSearchParams({ organizationId: orgId, ...params })}`;
        const r = await fetch(init ? '/api/satej/rates' : url, init);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        return j;
    }

    useEffect(() => {
        call({}).then(setRes).catch((e) => setErr(e.message));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orgId]);

    async function search(e?: React.FormEvent) {
        e?.preventDefault();
        if (!q.trim()) return;
        setBusy('search'); setErr(null);
        try { setRes(await call({ q, unit, rate })); } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } finally { setBusy(''); }
    }

    async function refresh() {
        setBusy('refresh'); setErr(null);
        try {
            const j = await call({}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, action: 'refresh' }) });
            setRes((prev: any) => ({ ...(prev ?? {}), status: j.status }));
            if (q.trim()) await search();
        } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } finally { setBusy(''); }
    }

    const status = res?.status;
    const pool = res?.pool;
    const verdict = res?.verdict;
    return (
        <div>
            <section className={s.card}>
                <div className={s.boardHead}>
                    <div>
                        <h3>Rate checker</h3>
                        <p className={s.muted}>
                            What we have actually paid, from Zoho purchase orders (approved, open and billed, last 36 months).
                            {status ? ` ${status.products.toLocaleString('en-IN')} products · rebuilt ${day(status.refreshedAt)} · rebuilds itself every 10 days.` : ''}
                        </p>
                    </div>
                    <button className={s.ghost} disabled={!!busy} onClick={refresh}>
                        {busy === 'refresh' ? <Loader2 size={14} className={s.spin} /> : <RefreshCw size={14} />} Refresh now
                    </button>
                </div>
                <form className={s.rateForm} onSubmit={search}>
                    <label>Item<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="20 litre water jar, security guard, hand wash 5 ltr…" /></label>
                    <label>Unit<input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="jar, day, nos…" /></label>
                    <label>Quoted rate ₹<input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} placeholder="optional" /></label>
                    <button className={s.primary} disabled={!!busy || !q.trim()}>
                        {busy === 'search' ? <Loader2 size={14} className={s.spin} /> : <Search size={14} />} Check
                    </button>
                </form>
                {err && <div className={s.errorBox}>{err}</div>}
            </section>

            {res && q && !pool && !busy && !err && (res.rows ?? []).length === 0 && (
                <section className={s.card}><p className={s.muted}>Nothing in the purchase history looks like “{q}”. Try fewer words, or the way it is written on a PO.</p></section>
            )}

            {pool && (
                <section className={s.card}>
                    <div className={s.boardHead}>
                        <div>
                            <h3>{pool.label}</h3>
                            <p className={s.muted}>
                                {pool.unitMatch || !unit ? '' : `No history in “${unit}”; showing the closest unit (${pool.unit}). `}
                                Pooled from {pool.matched.length} way{pool.matched.length === 1 ? '' : 's'} of writing it on a PO.
                            </p>
                        </div>
                        {verdict && <div className={s.actions}>{verdictChip(verdict.verdict)}{verdict.deltaPct !== null && <span className={s.muted}>{verdict.deltaPct > 0 ? '+' : ''}{verdict.deltaPct}% vs usual</span>}</div>}
                    </div>
                    <PoolStats p={pool} quote={Number(rate) > 0 ? Number(rate) : null} />
                    <details>
                        <summary className={s.detailsSummary}>Descriptions pooled into this</summary>
                        <ul className={s.setupList}>{pool.matched.map((m: any) => <li key={m.label}>{m.label} <span className={s.muted}>· {m.n} line{m.n === 1 ? '' : 's'} · usual {rs(m.median)}</span></li>)}</ul>
                    </details>
                </section>
            )}

            {(res?.rows ?? []).length > 0 && (
                <details className={s.card}>
                    <summary className={s.detailsSummary}>Everything that looks like “{q}” ({res.rows.length})</summary>
                    <div className={s.tableWrap}>
                        <table className={s.table}>
                            <thead><tr><th>As written on the PO</th><th>Unit</th><th>Usual</th><th>Range</th><th>Lines</th><th>Last</th><th>Match</th></tr></thead>
                            <tbody>
                                {res.rows.map((x: any) => (
                                    <tr key={`${x.productKey}|${x.unit}`}>
                                        <td>{x.label}{x.category && <div className={s.muted}>{x.category}</div>}</td>
                                        <td>{x.unit}</td>
                                        <td>{rs(x.median)}</td>
                                        <td>{rs(x.min)} – {rs(x.max)}</td>
                                        <td>{x.nLines}</td>
                                        <td>{rs(x.lastRate)}<div className={s.muted}>{day(x.lastDate)}</div></td>
                                        <td>{Math.round(x.similarity * 100)}%</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </details>
            )}
        </div>
    );
}

/** On a requirement: the history Meera matched and Meera's negotiating numbers. */
export function PriceHistoryCard({ r }: { r: any }) {
    if (r.benchmark === undefined) return null;
    const b = r.benchmark;
    return (
        <section className={s.card}>
            <h3>Price history</h3>
            {!b ? (
                <p className={s.muted}>Nothing in the Zoho purchase history is close enough to this item, so Meera asks for a rate without pushing back. Use the Rate checker tab to look it up by hand.</p>
            ) : (
                <>
                    <p className={s.muted}>
                        Matched “{b.pool.label}” for “{b.query}”. Meera aims for <b>{rs(b.targetRate)}</b> and does not agree above <b>{rs(b.walkAwayRate)}</b>
                        {b.unit !== '-' ? ` per ${b.unit}` : ''}. She never says where these numbers come from.
                    </p>
                    <PoolStats p={b.pool} target={b.targetRate} ceiling={b.walkAwayRate} />
                </>
            )}
        </section>
    );
}
