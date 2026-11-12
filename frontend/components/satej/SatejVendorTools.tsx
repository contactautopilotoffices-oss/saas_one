'use client';

/**
 * Two tools for the team before any vendor is phoned:
 *
 *   VendorIntake — add the vendors YOU want called: type them, paste a list in
 *   any rough format ("Sharma Interiors 98200 11111"), or import Excel / CSV /
 *   text. Everything is previewed, cleaned to +91 and de-duplicated on the
 *   server before it reaches the call list.
 *
 *   TestCall — "call me first": Meera rings your own phone with exactly what a
 *   vendor would hear for this requirement, so the script can be heard and
 *   tuned before a real vendor's first impression is spent on it.
 */

import { useMemo, useRef, useState } from 'react';
import { Check, FileUp, Loader2, PhoneCall, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import s from './satej.module.css';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Entry = { name: string; phone: string; area: string };

const API = '/api/satej/requirements';
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;

async function post(id: string, orgId: string, body: object) {
    const res = await fetch(`${API}/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}

/** "Sharma Interiors - 98200 11111, Andheri" → { name, phone, area }. Lines without a number are dropped. */
export function parseLines(text: string): Entry[] {
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
        const m = line.match(PHONE_RE);
        if (!m) return [];
        const [before, after] = [line.slice(0, m.index), line.slice((m.index ?? 0) + m[0].length)];
        const clean = (x: string) => x.replace(/^[\s,;:|\-–—]+|[\s,;:|\-–—]+$/g, '').trim();
        return [{ name: clean(before) || clean(after), phone: m[0].replace(/[^\d+]/g, ''), area: clean(before) ? clean(after) : '' }];
    });
}

/** Rows from a sheet: finds the name / phone / area columns by header, else by content. */
function rowsToEntries(rows: unknown[][]): Entry[] {
    if (!rows.length) return [];
    const head = rows[0].map((h) => String(h ?? '').toLowerCase());
    const find = (re: RegExp) => head.findIndex((h) => re.test(h));
    let iName = find(/name|vendor|company|firm|business|supplier/);
    let iPhone = find(/phone|mobile|contact|number|whatsapp|tel/);
    const iArea = find(/area|location|city|locality|address/);
    const hasHeader = iName >= 0 || iPhone >= 0;
    const body = hasHeader ? rows.slice(1) : rows;
    return body.flatMap((row) => {
        const cells = row.map((c) => String(c ?? '').trim());
        let phone = iPhone >= 0 ? cells[iPhone] : '';
        if (!PHONE_RE.test(phone)) phone = cells.find((c) => PHONE_RE.test(c)) ?? '';
        if (!phone) return [];
        if (iName < 0) iName = cells.findIndex((c) => c && !PHONE_RE.test(c));
        return [{ name: iName >= 0 ? cells[iName] : '', phone: phone.match(PHONE_RE)![0].replace(/[^\d+]/g, ''), area: iArea >= 0 ? cells[iArea] : '' }];
    });
}

export function VendorIntake({ orgId, requirement, onAdded, defaultOpen }: {
    orgId: string; requirement: any; onAdded: () => void; defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(!!defaultOpen);
    const [mode, setMode] = useState<'type' | 'paste' | 'file'>('type');
    const [rows, setRows] = useState<Entry[]>([{ name: '', phone: '', area: '' }]);
    const [pasted, setPasted] = useState('');
    const [fileRows, setFileRows] = useState<Entry[]>([]);
    const [fileName, setFileName] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [result, setResult] = useState<{ added: number; skipped: { name: string; phone: string; reason: string }[]; calledRecently: string[] } | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);

    const entries = useMemo(() => {
        if (mode === 'type') return rows.filter((r) => r.phone.trim());
        if (mode === 'paste') return parseLines(pasted);
        return fileRows;
    }, [mode, rows, pasted, fileRows]);

    const readFile = async (f: File) => {
        setErr(''); setFileName(f.name); setFileRows([]);
        try {
            if (/\.(xlsx|xls)$/i.test(f.name)) {
                const XLSX = await import('xlsx');
                const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
                const sheet = wb.Sheets[wb.SheetNames[0]];
                setFileRows(rowsToEntries(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as unknown[][]));
            } else {
                const text = await f.text();
                const asTable = text.split(/\r?\n/).filter(Boolean).map((l) => l.split(/,|\t|;/));
                const fromTable = rowsToEntries(asTable);
                setFileRows(fromTable.length ? fromTable : parseLines(text));
            }
        } catch (e: any) {
            setErr(`Could not read ${f.name}: ${e.message}`);
        }
    };

    const add = async () => {
        setBusy(true); setErr(''); setResult(null);
        try {
            const r = await post(requirement.id, orgId, { action: 'add_vendors', vendors: entries });
            setResult(r);
            if (r.added) {
                setRows([{ name: '', phone: '', area: '' }]); setPasted(''); setFileRows([]); setFileName('');
                onAdded();
            }
        } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
    };

    if (!open) {
        return <button className={s.ghost} onClick={() => setOpen(true)}><Plus size={14} /> Add your own vendors</button>;
    }
    return (
        <div className={s.intake}>
            <div className={s.boardHead}>
                <b>Add the vendors you want called</b>
                <div className={s.segment}>
                    {(['type', 'paste', 'file'] as const).map((m) => (
                        <button key={m} className={mode === m ? s.segmentOn : ''} onClick={() => setMode(m)}>
                            {m === 'type' ? 'Type' : m === 'paste' ? 'Paste a list' : 'Import a file'}
                        </button>
                    ))}
                </div>
            </div>

            {mode === 'type' && (
                <div className={s.typeRows}>
                    {rows.map((r, i) => (
                        <div key={i} className={s.typeRow}>
                            <input placeholder="Vendor name" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                            <input placeholder="Phone, e.g. 98200 11111" value={r.phone} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />
                            <input placeholder="Area (optional)" value={r.area} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, area: e.target.value } : x)))} />
                            <button className={s.iconBtn} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove row"><Trash2 size={14} /></button>
                        </div>
                    ))}
                    <button className={s.link} onClick={() => setRows([...rows, { name: '', phone: '', area: '' }])}>+ another vendor</button>
                </div>
            )}

            {mode === 'paste' && (
                <textarea rows={6} style={{ width: '100%' }} value={pasted} onChange={(e) => setPasted(e.target.value)}
                    placeholder={'One vendor per line, any format:\nSharma Interiors - 98200 11111, Andheri\nMetro Ceilings +91 98765 43210\n9123456789'} />
            )}

            {mode === 'file' && (
                <div className={s.dropZone} onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void readFile(f); }}>
                    <FileUp size={18} />
                    <div><b>{fileName || 'Drop an Excel, CSV or text file, or click to choose'}</b></div>
                    <div className={s.muted}>Columns are found by their headers (name, phone, area) — or by what is in them.</div>
                    <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ''; }} />
                </div>
            )}

            {entries.length > 0 && mode !== 'type' && (
                <div className={s.previewList}>
                    <div className={s.muted}>{entries.length} vendor{entries.length > 1 ? 's' : ''} found — check before adding</div>
                    {entries.slice(0, 50).map((e, i) => (
                        <div key={i} className={s.previewRow}><b>{e.name || '(no name)'}</b><span>{e.phone}</span><span className={s.muted}>{e.area}</span></div>
                    ))}
                    {entries.length > 50 && <div className={s.muted}>…and {entries.length - 50} more</div>}
                </div>
            )}

            {err && <div className={s.errorBox}>{err}</div>}
            {result && (
                <div className={result.added ? s.infoBox : s.noteBox}>
                    <b>{result.added} added to the call list.</b>
                    {result.skipped.length > 0 && <> {result.skipped.length} skipped: {result.skipped.slice(0, 6).map((x) => `${x.name || x.phone} (${x.reason})`).join('; ')}{result.skipped.length > 6 ? '…' : ''}</>}
                    {result.calledRecently.length > 0 && <> Called in the last 30 days: {result.calledRecently.join(', ')}.</>}
                </div>
            )}
            <div className={s.actions} style={{ justifyContent: 'flex-start', marginTop: 8 }}>
                <button className={s.primary} disabled={busy || !entries.length} onClick={() => void add()}>
                    {busy ? <Loader2 size={14} className={s.spin} /> : <Plus size={14} />} Add {entries.length || ''} vendor{entries.length === 1 ? '' : 's'}
                </button>
                <button className={s.ghost} onClick={() => setOpen(false)}>Close</button>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------------ */

const FINAL = ['completed', 'call-disconnected', 'no-answer', 'busy', 'failed', 'canceled', 'stopped', 'error', 'balance-low'];

export function TestCall({ orgId, requirement, vendors, calls, onChanged, onImproveScript, graphAgent }: {
    orgId: string; requirement: any; vendors: any[]; calls: any[]; onChanged: () => void; onImproveScript: (transcript: string) => void;
    /** "Meera (graph)" is configured: offer it alongside the live Meera. */
    graphAgent?: boolean;
}) {
    const [agent, setAgent] = useState<'main' | 'graph'>('main');
    const named = vendors.filter((v) => v.status === 'found');
    const [phone, setPhone] = useState<string>(requirement.input.notifyWhatsapp || '');
    const [asVendor, setAsVendor] = useState<string>(named[0]?.name ?? 'Test Vendor');
    const [busy, setBusy] = useState('');
    const [err, setErr] = useState('');
    const tests = calls.filter((c) => c.rehearsal).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const live = tests.find((c) => !FINAL.includes(c.status));

    const call = async () => {
        setBusy('call'); setErr('');
        try { await post(requirement.id, orgId, { action: 'rehearse', phone, asVendor, agent }); onChanged(); }
        catch (e: any) { setErr(e.message); } finally { setBusy(''); }
    };
    const read = async (callId: string) => {
        setBusy(callId); setErr('');
        try { await post(requirement.id, orgId, { action: 'analyze_rehearsal', callId }); onChanged(); }
        catch (e: any) { setErr(e.message); } finally { setBusy(''); }
    };

    return (
        <section className={`${s.card} ${s.testCard}`}>
            <h3><PhoneCall size={15} /> Call me first</h3>
            <p className={s.muted}>Meera rings your phone and talks to you exactly as she would to a vendor on this requirement — same greeting, same questions. Hear it, then tune the script before a real vendor gets the call. Test calls are never ranked.</p>
            <div className={s.testRow}>
                <label>Your number<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98xxxxxxxx" /></label>
                <label>Meera thinks you are
                    <input list="satej-test-as" value={asVendor} onChange={(e) => setAsVendor(e.target.value)} />
                    <datalist id="satej-test-as">{named.map((v) => <option key={v.id} value={v.name} />)}</datalist>
                </label>
                {graphAgent && (
                    <label>Which Meera
                        <select value={agent} onChange={(e) => setAgent(e.target.value as 'main' | 'graph')}>
                            <option value="main">Meera — live (one prompt)</option>
                            <option value="graph">Meera (graph) — step by step, testing</option>
                        </select>
                    </label>
                )}
                <button className={s.primary} disabled={!!busy || !!live || !phone.trim()} onClick={() => void call()}>
                    {busy === 'call' ? <Loader2 size={14} className={s.spin} /> : <PhoneCall size={14} />} {live ? 'Calling you…' : 'Call me now'}
                </button>
            </div>
            {err && <div className={s.errorBox}>{err}</div>}

            {tests.map((c) => (
                <div key={c.id} className={s.testResult}>
                    <div className={s.boardHead} style={{ marginBottom: 6 }}>
                        <div>
                            <b>Test call · as {c.rehearsalAs}{c.rehearsalAgent === 'graph' ? ' · Meera (graph)' : ''}</b>
                            <div className={s.muted}>{new Date(c.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {c.toNumber}</div>
                        </div>
                        <span className={`${s.chip} ${c.status === 'completed' ? s.good : FINAL.includes(c.status) ? s.bad : s.info}`}>
                            {!FINAL.includes(c.status) && <span className={s.pulseDot} />}{c.status.replace(/-/g, ' ')}{c.durationSec ? ` · ${Math.round(c.durationSec)}s` : ''}
                        </span>
                    </div>
                    {c.recordingUrl && <audio controls preload="none" className={s.audio} src={`/api/satej/voice/recording?organizationId=${orgId}&executionId=${c.executionId}`} />}
                    {c.analysis && (
                        <div className={s.callBox}>
                            <p><Sparkles size={13} style={{ verticalAlign: -2 }} /> <b>Meera&apos;s read:</b> {c.analysis.summary}</p>
                            <p className={s.muted}>
                                As a vendor this would score {c.score?.total ?? '—'}/100 ({String(c.score?.qualification ?? '').replace('_', ' ')}) · GST {c.analysis.gstRegistered} · {c.analysis.yearsExperience ?? '—'} yrs · turnaround {c.analysis.turnaroundText || '—'}
                            </p>
                            {c.analysis.redFlags?.length > 0 && <p className={s.badText}>Flags: {c.analysis.redFlags.join('; ')}</p>}
                        </div>
                    )}
                    {c.transcript && <details><summary className={s.muted}>Transcript</summary><pre className={s.transcript}>{c.transcript}</pre></details>}
                    {c.status === 'completed' && c.transcript && (
                        <div className={s.actions} style={{ justifyContent: 'flex-start', marginTop: 8 }}>
                            {!c.analysis && (
                                <button className={s.ghost} disabled={!!busy} onClick={() => void read(c.id)}>
                                    {busy === c.id ? <Loader2 size={14} className={s.spin} /> : <Check size={14} />} Get Meera&apos;s read
                                </button>
                            )}
                            <button className={s.ghost} onClick={() => onImproveScript(c.transcript)}><Wand2 size={14} /> Improve the script from this call</button>
                        </div>
                    )}
                </div>
            ))}
        </section>
    );
}
