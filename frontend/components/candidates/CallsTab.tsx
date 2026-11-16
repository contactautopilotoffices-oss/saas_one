'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, FileAudio, FileText, Phone, RotateCcw, Trash2, Upload } from 'lucide-react';
import { CALL_AUDIO_ACCEPT, callFileType, formatClock, MAX_CALL_BYTES } from '@/backend/lib/candidates/call-files';
import {
    CALL_CONCERN_LABELS, CALL_FACT_LABELS, CALL_STATUS_LABELS,
    type CallAnalysis, type CallFactKey, type CallInsights, type CallSentiment, type CallStatus, type CandidateRecord, type Position, type PreparedCall,
} from '@/backend/lib/candidates/types';
import { api, putSignedUpload, qs } from './api';
import { formatDate, formatInr, formatNotice } from './format';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, EmptyState, INPUT, LABEL, Spinner, Tag, useUi, WELL } from './ui';

/*
 * The Calls tab (owner 2026-11-16, plan P3 + P7; mockup board 6). The recruiter records the screening call on a
 * normal phone and uploads it here (or pastes a transcript); the server transcribes and reads it. What comes back is
 * advisory and carries a quote from the call for every judgement: the sentiment, the interest, where the mood turned,
 * the concerns, and the facts heard beside the record's values, each with its own Apply. Nothing is applied by
 * itself, and no status ever changes from a call.
 *
 * Design: the same vocabulary as the rest of the panel (ui.tsx): white cards at L2, recessed wells at L1, semantic
 * colour as a dot or text beside a label, never a fill; the sentiment strip is the one place colour carries meaning,
 * so it has a legend and an aria-label that says the same thing in words.
 */

const WORKING: readonly CallStatus[] = ['uploading', 'uploaded', 'transcribing', 'analysing'];
const POLL_MS = 3000;

const SENTIMENT_LABEL: Record<CallSentiment, string> = { positive: 'Positive', neutral: 'Neutral', negative: 'Negative' };
/** The sentiment strip's fills: the locked status tokens, told apart by lightness as well as hue. */
const SENTIMENT_BG: Record<CallSentiment, string> = { positive: 'bg-success', neutral: 'bg-border', negative: 'bg-error' };
const INTEREST_LABEL: Record<CallInsights['interestLevel'], string> = { high: 'High', medium: 'Medium', low: 'Low', unclear: 'Unclear' };
const CONFIDENCE_LABEL: Record<CallInsights['sentimentConfidence'], string> = { high: 'high confidence', medium: 'fair confidence', low: 'low confidence' };

const todayIso = () => new Date().toLocaleDateString('en-CA');
const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const formatDuration = (s: number | null) => (s === null ? '' : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);

/** One call's title line: "Screening call · 14 Nov 2026 · 8 min 12 s". */
function callTitle(c: CallAnalysis): string {
    return ['Screening call', c.calledOn ? formatDate(c.calledOn) : formatDate(c.createdAt), formatDuration(c.durationSeconds)].filter(Boolean).join(' · ');
}

export default function CallsTab({ orgId, record, onLogged, onRecord }: {
    orgId: string;
    record: CandidateRecord;
    /** A call was added, re-read or removed: the Activity count and history refetch. */
    onLogged: () => void;
    /** A fact was applied: the panel shows the saved record. */
    onRecord: (record: CandidateRecord) => void;
}) {
    const { notify, reportError } = useUi();
    const [state, setState] = useState<{ candidateId: string; calls: CallAnalysis[]; error: string } | null>(null);
    const [listNonce, setListNonce] = useState(0);
    const refresh = () => setListNonce(n => n + 1);
    const listKey = JSON.stringify([orgId, record.candidateId, listNonce]);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ calls: CallAnalysis[] }>(`/api/candidates/calls${qs({ orgId, candidateId: record.candidateId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (res.ok) setState({ candidateId: record.candidateId, calls: res.data.calls, error: '' });
            else { if (res.noAccess) reportError(res); setState({ candidateId: record.candidateId, calls: [], error: res.error }); }
        });
        return () => ctrl.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listKey]);
    const calls = state?.candidateId === record.candidateId ? state.calls : null;
    const loadError = state?.candidateId === record.candidateId ? state.error : '';

    // While a call is being read the list is asked again every few seconds.
    const working = calls?.some(c => WORKING.includes(c.status)) ?? false;
    useEffect(() => {
        if (!working) return;
        const t = setInterval(refresh, POLL_MS);
        return () => clearInterval(t);
    }, [working]);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selected = calls?.find(c => c.id === selectedId) ?? calls?.find(c => c.status === 'done') ?? calls?.[0] ?? null;

    // The selected call in full (transcript and result), fetched again whenever it changed on the server.
    const [full, setFull] = useState<{ id: string; updatedAt: string; call: CallAnalysis } | null>(null);
    const fullKey = selected && selected.status === 'done' ? `${selected.id}:${selected.updatedAt}` : '';
    useEffect(() => {
        if (!fullKey || !selected) return;
        if (full && `${full.id}:${full.updatedAt}` === fullKey) return;
        const ctrl = new AbortController();
        void api<{ call: CallAnalysis }>(`/api/candidates/calls/${encodeURIComponent(selected.id)}${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (res.ok) setFull({ id: res.data.call.id, updatedAt: res.data.call.updatedAt, call: res.data.call });
            else if (res.noAccess) reportError(res);
        });
        return () => ctrl.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fullKey, orgId]);
    const shown = selected && full?.id === selected.id ? full.call : null;

    const [busyId, setBusyId] = useState<string | null>(null);
    const retry = async (c: CallAnalysis) => {
        setBusyId(c.id);
        const res = await api<{ call: CallAnalysis }>(`/api/candidates/calls/${encodeURIComponent(c.id)}/retry`, { json: { orgId } });
        setBusyId(null);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        notify('Reading the call again', 'info');
        refresh();
    };
    const remove = async (c: CallAnalysis) => {
        setBusyId(c.id);
        const res = await api<{ ok: true }>(`/api/candidates/calls/${encodeURIComponent(c.id)}${qs({ orgId })}`, { method: 'DELETE' });
        setBusyId(null);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        notify(c.inputKind === 'audio' ? 'Recording deleted' : 'Transcript deleted', 'success');
        if (selectedId === c.id) setSelectedId(null);
        refresh();
        onLogged();
    };

    return (
        <div className="space-y-4">
            <AddCall orgId={orgId} record={record} onAdded={call => { setSelectedId(call.id); refresh(); onLogged(); }} />

            <section aria-label="Calls on this candidate">
                <div className="flex items-center justify-between">
                    <p className={LABEL}>Calls</p>
                    {calls && calls.length > 0 && <span className="text-xs text-text-tertiary">{calls.length} {calls.length === 1 ? 'call' : 'calls'} · private, HR only</span>}
                </div>
                {!calls ? (
                    <p className="mt-2 flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading</p>
                ) : loadError ? (
                    <p role="alert" className="mt-2 text-sm text-error">{loadError}</p>
                ) : calls.length === 0 ? (
                    <EmptyState icon={Phone} title="No calls yet">Record the screening call on your phone and add it above. The transcript, the sentiment and the facts heard appear here in a minute or two.</EmptyState>
                ) : (
                    <ul className={`${CARD} mt-2 divide-y divide-border-subtle overflow-hidden`}>
                        {calls.map(c => <CallRow key={c.id} call={c} selected={selected?.id === c.id} busy={busyId === c.id} onSelect={() => setSelectedId(c.id)} onRetry={() => void retry(c)} onDelete={() => void remove(c)} />)}
                    </ul>
                )}
            </section>

            {selected && selected.status === 'done' && (
                shown ? (
                    <Analysis orgId={orgId} call={shown} record={record}
                        onApplied={(call, saved) => { setFull({ id: call.id, updatedAt: call.updatedAt, call }); if (saved) onRecord(saved); refresh(); onLogged(); }}
                        onRetry={() => void retry(selected)} busy={busyId === selected.id} />
                ) : (
                    <p className="flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Opening the call</p>
                )
            )}
        </div>
    );
}

/* ---- Adding a call --------------------------------------------------------------------------------------------------- */

type Phase = { phase: 'preparing' | 'sending' | 'confirming'; fraction: number };

function AddCall({ orgId, record, onAdded }: { orgId: string; record: CandidateRecord; onAdded: (call: CallAnalysis) => void }) {
    const { notify, reportError } = useUi();
    const [mode, setMode] = useState<'file' | 'transcript'>('file');
    const [file, setFile] = useState<File | null>(null);
    const [transcript, setTranscript] = useState('');
    const [positionId, setPositionId] = useState('');
    const [calledOn, setCalledOn] = useState(todayIso);
    const [consent, setConsent] = useState(false);
    const [busy, setBusy] = useState<Phase | null>(null);
    const [dragging, setDragging] = useState(false);
    const xhrRef = useRef<XMLHttpRequest | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    // The open positions, for "For position"; fetched once per candidate.
    const [positions, setPositions] = useState<{ orgId: string; list: Position[] } | null>(null);
    useEffect(() => {
        if (positions?.orgId === orgId) return;
        const ctrl = new AbortController();
        void api<{ positions: Position[] }>(`/api/candidates/positions${qs({ orgId })}`, { signal: ctrl.signal }).then(res => { if (!ctrl.signal.aborted) setPositions({ orgId, list: res.ok ? res.data.positions : [] }); });
        return () => ctrl.abort();
    }, [orgId, positions?.orgId]);

    const problem = file ? (!callFileType(file.name) ? 'Use mp3, m4a, wav, ogg or webm.' : file.size > MAX_CALL_BYTES ? `Larger than ${MAX_CALL_BYTES / 1024 / 1024} MB. Export it at a lower quality.` : null) : null;
    const canSubmit = !busy && (mode === 'file' ? !!file && !problem && consent : transcript.trim().length >= 40);

    const pick = (f: File | null) => { setFile(f); };
    const reset = () => { setFile(null); setTranscript(''); setConsent(false); if (inputRef.current) inputRef.current.value = ''; };

    const submit = async () => {
        if (!canSubmit) return;
        const common = { orgId, applicationId: record.id, positionId: positionId || null, calledOn: calledOn || null };
        if (mode === 'transcript') {
            setBusy({ phase: 'preparing', fraction: 0 });
            const res = await api<PreparedCall>('/api/candidates/calls', { json: { ...common, transcript } });
            setBusy(null);
            if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
            notify('Transcript saved. Reading the call…', 'success');
            reset();
            onAdded(res.data.call);
            return;
        }
        if (!file) return;
        setBusy({ phase: 'preparing', fraction: 0 });
        const prep = await api<PreparedCall>('/api/candidates/calls', { json: { ...common, consent, file: { name: file.name, size: file.size } } });
        if (!prep.ok || !prep.data.upload) { setBusy(null); if (!prep.ok) { notify(prep.error, 'error'); if (prep.noAccess) reportError(prep); } return; }
        const id = prep.data.call.id;
        setBusy({ phase: 'sending', fraction: 0 });
        const put = await putSignedUpload(prep.data.upload.signedUrl, file, prep.data.upload.contentType, f => setBusy({ phase: 'sending', fraction: f }), x => { xhrRef.current = x; });
        if (put !== 'ok') {
            setBusy(null);
            // The row has no bytes: take it back so it does not sit at "Uploading".
            void api(`/api/candidates/calls/${encodeURIComponent(id)}${qs({ orgId })}`, { method: 'DELETE' });
            if (put !== 'cancelled') notify(put, 'error');
            return;
        }
        setBusy({ phase: 'confirming', fraction: 1 });
        const conf = await api<{ call: CallAnalysis }>(`/api/candidates/calls/${encodeURIComponent(id)}/confirm`, { json: { orgId } });
        setBusy(null);
        if (!conf.ok) { notify(conf.error, 'error'); if (conf.noAccess) reportError(conf); return; }
        notify('Recording uploaded. Transcribing…', 'success');
        reset();
        onAdded(conf.data.call);
    };

    const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) { setMode('file'); pick(f); } };

    return (
        <section className={`${WELL} px-4 py-4`} aria-labelledby="cand-add-call">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h3 id="cand-add-call" className="text-sm font-semibold text-text-primary">Add a call</h3>
                <span className="text-xs text-text-secondary">recorded on your phone, uploaded here · private, HR only</span>
            </div>

            {mode === 'file' ? (
                <label
                    onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
                    className={`mt-3 flex cursor-pointer items-center gap-x-3 rounded-xl border border-dashed bg-surface px-4 py-3.5 transition-colors ${dragging ? 'border-primary bg-surface-elevated' : 'border-border hover:border-primary'}`}
                >
                    <span className={`${WELL} inline-flex h-10 w-10 shrink-0 items-center justify-center`}>{file ? <FileAudio className="h-5 w-5 text-primary-dark" aria-hidden /> : <Upload className="h-5 w-5 text-text-tertiary" aria-hidden />}</span>
                    <span className="min-w-0 flex-1">
                        {file ? (
                            <>
                                <span className="block truncate text-sm font-semibold text-text-primary" title={file.name}>{file.name}</span>
                                <span className={`block text-xs ${problem ? 'text-error' : 'text-text-tertiary'}`}>{problem ?? `${formatBytes(file.size)} · click to choose another`}</span>
                            </>
                        ) : (
                            <>
                                <span className="block text-sm font-semibold text-text-primary">Drop the recording here, or choose a file</span>
                                <span className="block text-xs text-text-tertiary">mp3, m4a, wav, ogg or webm · up to {MAX_CALL_BYTES / 1024 / 1024} MB · or <button type="button" onClick={e => { e.preventDefault(); setMode('transcript'); }} className="font-semibold text-primary-dark hover:underline">paste a transcript</button> instead</span>
                            </>
                        )}
                    </span>
                    <input ref={inputRef} type="file" accept={CALL_AUDIO_ACCEPT} className="sr-only" aria-label="Choose the recording" onChange={e => pick(e.target.files?.[0] ?? null)} disabled={!!busy} />
                </label>
            ) : (
                <div className="mt-3">
                    <label htmlFor="cand-call-transcript" className={LABEL}>Transcript <span className="text-text-tertiary">· as spoken, any language · <button type="button" onClick={() => setMode('file')} className="font-semibold text-primary-dark hover:underline">upload a recording</button> instead</span></label>
                    <textarea id="cand-call-transcript" rows={6} value={transcript} onChange={e => setTranscript(e.target.value)} disabled={!!busy} placeholder="Paste the whole call. One line per thing said works best." className={`${INPUT} mt-1.5 h-auto min-h-[140px] resize-y py-2.5 leading-relaxed`} />
                </div>
            )}

            <div className="mt-3 grid gap-x-3 gap-y-3 @2xl:grid-cols-[minmax(0,1fr)_170px]">
                <div>
                    <label htmlFor="cand-call-position" className={LABEL}>For position <span className="text-text-tertiary">· optional, the JD is used in the reading</span></label>
                    <select id="cand-call-position" value={positionId} onChange={e => setPositionId(e.target.value)} disabled={!!busy} className={`${INPUT} mt-1.5`}>
                        <option value="">Not for a position</option>
                        {(positions?.list ?? []).map(p => <option key={p.id} value={p.id}>{p.title}{p.location ? ` · ${p.location}` : ''}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="cand-call-date" className={LABEL}>Call date</label>
                    <input id="cand-call-date" type="date" value={calledOn} max={todayIso()} onChange={e => setCalledOn(e.target.value)} disabled={!!busy} className={`${INPUT} mt-1.5`} />
                </div>
            </div>

            {mode === 'file' && (
                <label className="mt-3 flex cursor-pointer items-center gap-x-2.5 text-sm text-text-primary">
                    <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={!!busy} className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40" />
                    The candidate was told the call is recorded
                </label>
            )}

            {busy && (
                <div className="mt-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(busy.fraction * 100)} aria-label={busy.phase === 'sending' ? 'Sending the recording' : busy.phase === 'preparing' ? 'Preparing' : 'Checking the upload'}>
                    <div className="flex items-center justify-between text-xs text-text-secondary">
                        <span>{busy.phase === 'sending' ? `Sending the recording · ${Math.round(busy.fraction * 100)}%` : busy.phase === 'preparing' ? 'Preparing' : 'Checking the upload'}</span>
                        {busy.phase === 'sending' && <button type="button" onClick={() => xhrRef.current?.abort()} className="font-semibold text-text-secondary hover:text-text-primary">Cancel</button>}
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${Math.round(busy.fraction * 100)}%` }} /></div>
                </div>
            )}

            <div className="mt-3 flex items-center justify-end gap-x-2">
                {(file || transcript) && !busy && <button type="button" onClick={reset} className={BTN_GHOST}>Clear</button>}
                <button type="button" onClick={() => void submit()} disabled={!canSubmit} className={BTN_PRIMARY}>{busy && <Spinner />}{mode === 'file' ? 'Upload and analyse' : 'Save and analyse'}</button>
            </div>
        </section>
    );
}

/* ---- The list ------------------------------------------------------------------------------------------------------- */

function StatusTag({ call }: { call: CallAnalysis }) {
    switch (call.status) {
        case 'done': return <Tag tone="success" icon={Check}>Analysed</Tag>;
        case 'failed': return <Tag tone="warn" icon={AlertTriangle}>Failed</Tag>;
        case 'uploaded': return <Tag tone="info">Waiting to be read</Tag>;
        default: return <Tag tone="info" icon={Spinner}>{CALL_STATUS_LABELS[call.status]}…</Tag>;
    }
}

function CallRow({ call, selected, busy, onSelect, onRetry, onDelete }: { call: CallAnalysis; selected: boolean; busy: boolean; onSelect: () => void; onRetry: () => void; onDelete: () => void }) {
    const [confirming, setConfirming] = useState(false);
    const Icon = call.inputKind === 'audio' ? Phone : FileText;
    const sub = [call.positionTitle, call.inputKind === 'audio' ? call.fileName : 'Transcript pasted', call.byName ? `by ${call.byName}` : null, call.language].filter(Boolean).join(' · ');
    return (
        <li className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 ${selected ? 'bg-surface-elevated' : ''}`}>
            <button type="button" onClick={onSelect} aria-current={selected ? 'true' : undefined} className="flex min-w-0 flex-1 items-center gap-x-3 text-left">
                <span className={`${WELL} inline-flex h-9 w-9 shrink-0 items-center justify-center ${selected ? 'ring-1 ring-inset ring-primary' : ''}`}><Icon className="h-4 w-4 text-primary-dark" aria-hidden /></span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-text-primary">{callTitle(call)}</span>
                    <span className="block truncate text-xs text-text-tertiary">{sub || '—'}</span>
                    {call.status === 'failed' && call.error && <span className="mt-0.5 block text-xs text-error">{call.error}</span>}
                </span>
            </button>
            <span className="flex items-center gap-x-1">
                <StatusTag call={call} />
                {call.status === 'failed' && <button type="button" onClick={onRetry} disabled={busy} className={`${BTN_GHOST} h-8 px-2 text-primary-dark`}>{busy ? <Spinner /> : <RotateCcw className="h-4 w-4" />}Retry</button>}
                {confirming ? (
                    <>
                        <button type="button" onClick={() => { setConfirming(false); onDelete(); }} disabled={busy} className={`${BTN_GHOST} h-8 px-2 text-error`}>{busy ? <Spinner /> : 'Delete'}</button>
                        <button type="button" onClick={() => setConfirming(false)} className={`${BTN_GHOST} h-8 px-2`}>Keep</button>
                    </>
                ) : (
                    <button type="button" onClick={() => setConfirming(true)} disabled={busy} className={`${BTN_GHOST} h-8 px-2`} aria-label={`Delete ${callTitle(call)}`} title={call.inputKind === 'audio' ? 'Delete the recording' : 'Delete the transcript'}><Trash2 className="h-4 w-4" /></button>
                )}
            </span>
        </li>
    );
}

/* ---- The analysis --------------------------------------------------------------------------------------------------- */

function Quote({ quote, at, onSeek }: { quote: string | null; at: number | null; onSeek?: (seconds: number) => void }) {
    if (!quote) return null;
    return (
        <span className="text-xs italic text-text-secondary">
            {at !== null && (onSeek
                ? <button type="button" onClick={() => onSeek(at)} className="mr-1 not-italic font-semibold tabular-nums text-primary-dark hover:underline" title="Play from here">{formatClock(at)}</button>
                : <span className="mr-1 not-italic font-semibold tabular-nums text-text-tertiary">{formatClock(at)}</span>)}
            “{quote}”
        </span>
    );
}

function SentimentStrip({ timeline, duration }: { timeline: CallInsights['timeline']; duration: number | null }) {
    const timed = !!duration && duration > 0 && timeline.length > 0 && timeline.every(p => p.startSeconds !== null && p.endSeconds !== null && p.endSeconds > p.startSeconds);
    const parts = timeline.map(p => ({ ...p, weight: timed ? Math.max(1, (p.endSeconds as number) - (p.startSeconds as number)) : Math.max(1, p.share) }));
    const total = parts.reduce((n, p) => n + p.weight, 0) || 1;
    if (!parts.length) return <p className="text-sm text-text-tertiary">The model did not split the call into parts.</p>;
    return (
        <div>
            <div role="img" aria-label={`Sentiment over the call, start to end: ${parts.map(p => `${SENTIMENT_LABEL[p.sentiment].toLowerCase()} (${p.note})`).join('; ')}`} className="flex h-3.5 gap-x-0.5">
                {parts.map((p, i) => (
                    <span key={i} title={`${SENTIMENT_LABEL[p.sentiment]}${p.startSeconds !== null ? ` · ${formatClock(p.startSeconds)}` : ''} · ${p.note}`} style={{ flexGrow: (p.weight / total) * 100, flexBasis: 0 }} className={`min-w-[6px] rounded-[3px] ${SENTIMENT_BG[p.sentiment]}`} />
                ))}
            </div>
            {timed && duration && <div className="mt-1 flex justify-between text-[11px] tabular-nums text-text-tertiary" aria-hidden><span>0:00</span><span>{formatClock(duration / 2)}</span><span>{formatClock(duration)}</span></div>}
            <ul className="mt-2 space-y-1">
                {parts.map((p, i) => (
                    <li key={i} className="flex items-start gap-x-2 text-xs text-text-secondary">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SENTIMENT_BG[p.sentiment]}`} aria-hidden />
                        {p.startSeconds !== null && <span className="shrink-0 tabular-nums text-text-tertiary">{formatClock(p.startSeconds)}</span>}
                        <span className="sr-only">{SENTIMENT_LABEL[p.sentiment]}: </span>
                        <span>{p.note}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

type FactRow = { key: CallFactKey; onRecord: string | null; heard: string | null; same: boolean; quote: string | null; at: number | null; value: unknown };

function factRows(r: CallInsights, record: CandidateRecord): FactRow[] {
    const f = r.facts;
    const money = (v: number | null) => (v === null ? null : `${formatInr(v)} / month`);
    const sameText = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
    return [
        { key: 'currentInhand', onRecord: money(record.currentInhand), heard: money(f.currentInhand.value), same: f.currentInhand.value !== null && f.currentInhand.value === record.currentInhand, quote: f.currentInhand.quote, at: f.currentInhand.at, value: f.currentInhand.value },
        { key: 'expectedInhand', onRecord: money(record.expectedInhand), heard: money(f.expectedInhand.value), same: f.expectedInhand.value !== null && f.expectedInhand.value === record.expectedInhand, quote: f.expectedInhand.quote, at: f.expectedInhand.at, value: f.expectedInhand.value },
        { key: 'noticePeriodDays', onRecord: record.noticePeriodDays === null ? null : formatNotice(record.noticePeriodDays), heard: f.noticePeriodDays.value === null ? null : formatNotice(f.noticePeriodDays.value), same: f.noticePeriodDays.value !== null && f.noticePeriodDays.value === record.noticePeriodDays, quote: f.noticePeriodDays.quote, at: f.noticePeriodDays.at, value: f.noticePeriodDays.value },
        { key: 'location', onRecord: record.location, heard: f.location.value, same: sameText(f.location.value, record.location), quote: f.location.quote, at: f.location.at, value: f.location.value },
        { key: 'reasonForChange', onRecord: null, heard: f.reasonForChange.value, same: false, quote: f.reasonForChange.quote, at: f.reasonForChange.at, value: f.reasonForChange.value },
    ];
}

function Analysis({ orgId, call, record, onApplied, onRetry, busy }: {
    orgId: string; call: CallAnalysis; record: CandidateRecord;
    onApplied: (call: CallAnalysis, record: CandidateRecord | null) => void; onRetry: () => void; busy: boolean;
}) {
    const { notify, reportError } = useUi();
    const r = call.result;
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [position, setPosition] = useState(0);
    const [showAll, setShowAll] = useState(false);
    const [applying, setApplying] = useState<CallFactKey | null>(null);
    const hasAudio = call.inputKind === 'audio';
    const seek = hasAudio ? (seconds: number) => { const a = audioRef.current; if (!a) return; a.currentTime = seconds; void a.play().catch(() => {}); } : undefined;

    if (!r) return null;
    const applied = new Set(call.appliedFacts.map(a => a.key));
    const rows = factRows(r, record);
    const segments = call.segments ?? [];
    const textLines = !segments.length && call.transcriptText ? call.transcriptText.split('\n').filter(Boolean) : [];
    const lineCount = segments.length || textLines.length;
    const LIMIT = 12;

    const apply = async (key: CallFactKey) => {
        setApplying(key);
        const res = await api<{ call: CallAnalysis; record: CandidateRecord | null }>(`/api/candidates/calls/${encodeURIComponent(call.id)}/apply`, { json: { orgId, keys: [key] } });
        setApplying(null);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        notify(key === 'reasonForChange' ? 'Kept as a remark' : `${CALL_FACT_LABELS[key]} updated`, 'success');
        onApplied(res.data.call, res.data.record);
    };

    return (
        <section aria-label={`Analysis of ${callTitle(call)}`} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-semibold text-text-primary">{callTitle(call)}</p>
                <p className="text-xs text-text-tertiary">{[call.positionTitle, call.byName ? `by ${call.byName}` : null, call.language].filter(Boolean).join(' · ')}</p>
            </div>

            <div className="grid gap-x-3 gap-y-3 @2xl:grid-cols-3">
                <div className={`${WELL} px-4 py-3`}>
                    <p className={LABEL}>Sentiment</p>
                    <p className="mt-1 flex items-center gap-x-2 font-display text-lg font-bold leading-tight text-text-primary"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${SENTIMENT_BG[r.overallSentiment]}`} aria-hidden />{SENTIMENT_LABEL[r.overallSentiment]}</p>
                    <p className="mt-0.5 text-xs text-text-secondary">{CONFIDENCE_LABEL[r.sentimentConfidence]}</p>
                </div>
                <div className={`${WELL} px-4 py-3`}>
                    <p className={LABEL}>Interest in the role</p>
                    <p className="mt-1 font-display text-lg font-bold leading-tight text-text-primary">{INTEREST_LABEL[r.interestLevel]}</p>
                    <p className="mt-0.5 text-xs text-text-secondary">{r.concerns.length ? `${r.concerns.length} ${r.concerns.length === 1 ? 'concern' : 'concerns'} raised` : 'no concerns raised'}</p>
                </div>
                <div className={`${WELL} px-4 py-3`}>
                    <p className={LABEL}>Suggested next step</p>
                    <p className="mt-1 text-sm font-semibold leading-snug text-text-primary">{r.suggestedNextStep || '—'}</p>
                    <p className="mt-0.5 text-xs text-text-secondary">advisory · you decide</p>
                </div>
            </div>

            <div className={`${CARD} px-4 py-3`}>
                <p className={LABEL}>Summary</p>
                <p className="mt-1 text-sm leading-relaxed text-text-primary">{r.summary || 'The model wrote no summary.'}</p>
            </div>

            <div className={`${CARD} px-4 py-3`}>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className={LABEL}>Sentiment over the call</p>
                    <span className="flex gap-x-3 text-xs text-text-secondary" aria-hidden>
                        {(['positive', 'neutral', 'negative'] as const).map(s => <span key={s} className="flex items-center gap-x-1"><span className={`h-2 w-2 rounded-full ${SENTIMENT_BG[s]}`} />{SENTIMENT_LABEL[s].toLowerCase()}</span>)}
                    </span>
                </div>
                <div className="mt-2"><SentimentStrip timeline={r.timeline} duration={call.durationSeconds} /></div>
            </div>

            <div className="grid gap-x-3 gap-y-3 @2xl:grid-cols-2">
                <div className={`${CARD} px-4 py-3`}>
                    <p className={LABEL}>Concerns heard</p>
                    {r.concerns.length === 0 ? <p className="mt-1 text-sm text-text-tertiary">None heard.</p> : (
                        <ul className="mt-2 space-y-2">
                            {r.concerns.map((c, i) => (
                                <li key={i} className="text-sm">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><Tag tone={c.topic === 'salary' || c.topic === 'notice' ? 'warn' : 'neutral'}>{CALL_CONCERN_LABELS[c.topic]}</Tag><span className="text-text-primary">{c.note}</span></div>
                                    <div className="mt-0.5"><Quote quote={c.quote} at={c.at} onSeek={seek} /></div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div className={`${CARD} px-4 py-3`}>
                    <p className={LABEL}>Red flags</p>
                    {r.redFlags.length === 0 ? <p className="mt-1 text-sm text-text-tertiary">None heard. A red flag is only reported with a quote from the call.</p> : (
                        <ul className="mt-2 space-y-2">
                            {r.redFlags.map((f, i) => (
                                <li key={i} className="text-sm">
                                    <div className="flex items-start gap-x-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" aria-hidden /><span className="text-text-primary">{f.note}</span></div>
                                    <div className="mt-0.5 pl-6"><Quote quote={f.quote} at={f.at} onSeek={seek} /></div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            <div className={`${CARD} px-4 py-3`}>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className={LABEL}>Facts heard on the call</p>
                    <span className="text-xs text-text-tertiary">compared with the record · Apply writes one fact · nothing changes on its own</span>
                </div>
                <div className="-mx-4 mt-2 overflow-x-auto px-4">
                    <table className="w-full min-w-[560px] text-sm">
                        <thead>
                            <tr className="text-left text-xs font-medium text-text-secondary">
                                <th className="pb-2 pr-3 font-medium">Field</th><th className="pb-2 pr-3 font-medium">On record</th><th className="pb-2 pr-3 font-medium">Heard on call</th><th className="pb-2 pr-3 font-medium">Where</th><th className="pb-2 text-right font-medium"><span className="sr-only">Action</span></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border-subtle">
                            {rows.map(row => {
                                const done = applied.has(row.key);
                                const notSaid = row.value === null || row.value === undefined;
                                return (
                                    <tr key={row.key} className="align-top">
                                        <td className="py-2.5 pr-3 font-medium text-text-primary">{CALL_FACT_LABELS[row.key]}</td>
                                        <td className="py-2.5 pr-3 text-text-secondary">{row.key === 'reasonForChange' ? <span className="text-text-tertiary">kept as a remark</span> : row.onRecord ?? <span className="text-text-tertiary">not on record</span>}</td>
                                        <td className={`py-2.5 pr-3 ${notSaid ? 'text-text-tertiary' : row.same ? 'text-text-secondary' : 'font-semibold text-amber-800'}`}>{notSaid ? 'not said' : row.same ? `${row.heard} · matches` : row.heard}</td>
                                        <td className="py-2.5 pr-3"><Quote quote={row.quote} at={row.at} onSeek={seek} /></td>
                                        <td className="py-2.5 text-right">
                                            {notSaid ? <span className="text-text-tertiary">—</span>
                                                : done ? <Tag tone="success" icon={Check}>Applied</Tag>
                                                : row.same ? <Tag tone="success">✓</Tag>
                                                : <button type="button" onClick={() => void apply(row.key)} disabled={applying !== null} className={`${BTN_SECONDARY} h-8 px-3 text-xs`}>{applying === row.key ? <Spinner /> : 'Apply'}</button>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className={`${CARD} px-4 py-3`}>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className={LABEL}>Transcript</p>
                    <span className="text-xs text-text-tertiary">{hasAudio ? 'as spoken · click a line to play from there' : 'as pasted'}</span>
                </div>
                {hasAudio && (
                    <audio ref={audioRef} controls preload="none" src={`/api/candidates/calls/${encodeURIComponent(call.id)}/audio${qs({ orgId })}`} onTimeUpdate={e => setPosition(e.currentTarget.currentTime)} className="mt-2 h-10 w-full" aria-label="The recording">
                        Your browser cannot play this recording.
                    </audio>
                )}
                {lineCount === 0 ? <p className="mt-2 text-sm text-text-tertiary">No transcript text.</p> : (
                    <ol className="mt-2 space-y-0.5">
                        {segments.length > 0
                            ? segments.slice(0, showAll ? undefined : LIMIT).map((s, i) => {
                                const current = hasAudio && position >= s.start && position < Math.max(s.end, s.start + 0.5);
                                return (
                                    <li key={i}>
                                        <button type="button" onClick={() => seek?.(s.start)} disabled={!hasAudio} className={`grid w-full grid-cols-[44px_minmax(0,1fr)] gap-x-2 rounded-md px-1 py-1 text-left text-sm ${current ? 'bg-secondary/15' : hasAudio ? 'hover:bg-surface-elevated' : ''}`}>
                                            <span className="tabular-nums text-xs leading-5 text-text-tertiary">{formatClock(s.start)}</span>
                                            <span className="text-text-primary">{s.text}</span>
                                        </button>
                                    </li>
                                );
                            })
                            : textLines.slice(0, showAll ? undefined : LIMIT).map((t, i) => <li key={i} className="px-1 py-1 text-sm text-text-primary">{t}</li>)}
                    </ol>
                )}
                {lineCount > LIMIT && <button type="button" onClick={() => setShowAll(v => !v)} className={`${BTN_GHOST} mt-1 -ml-2.5`}>{showAll ? 'Show less' : `Show all ${lineCount} lines`}</button>}
            </div>

            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-tertiary">
                <span>Advisory only: the AI never changes a status.</span>
                {call.model && <><span aria-hidden>·</span><span>Model {call.model.replace(/^anthropic:/, '')}</span></>}
                {call.tokensIn !== null && call.tokensOut !== null && <><span aria-hidden>·</span><span>{(call.tokensIn + call.tokensOut).toLocaleString('en-IN')} tokens</span></>}
                <span aria-hidden>·</span>
                <button type="button" onClick={onRetry} disabled={busy} className="font-semibold text-primary-dark hover:underline disabled:opacity-50">Read it again</button>
            </p>
        </section>
    );
}
