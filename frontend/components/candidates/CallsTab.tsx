'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, FileAudio, FileText, Phone, RotateCcw, Trash2, Upload } from 'lucide-react';
import { CALL_AUDIO_ACCEPT, callFileType, formatClock, MAX_CALL_BYTES } from '@/backend/lib/candidates/call-files';
import {
    CALL_ROUND_LABELS, CALL_ROUNDS, CALL_STATUS_LABELS, isInterviewRound,
    type CallAnalysis, type CallRound, type CallStatus, type CandidateRecord, type Position, type PreparedCall, type Stage,
} from '@/backend/lib/candidates/types';
import { boardColumns, columnIndexOf, findStage, stageName, type StageDef } from '@/backend/lib/candidates/stage-list';
import { api, putSignedUpload, qs } from './api';
import CallInsightsView from './CallInsightsView';
import { useStages } from './stage-ui';
import ScreeningPanel from './ScreeningPanel';
import { formatDate } from './format';
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

const todayIso = () => new Date().toLocaleDateString('en-CA');
const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const formatDuration = (s: number | null) => (s === null ? '' : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);

/** One call's title line: "Screening call · 14 Nov 2026 · 8 min 12 s". */
/** "Screening call · 16 Nov · 4:20", "Interview round 1 · 20 Nov" (owner 2026-11-17: which round the call was for). */
function roundLabel(c: Pick<CallAnalysis, 'round'>): string {
    const round = c.round ?? 'screening';
    return round === 'screening' ? 'Screening call' : CALL_ROUND_LABELS[round];
}
function callTitle(c: CallAnalysis): string {
    return [roundLabel(c), c.calledOn ? formatDate(c.calledOn) : formatDate(c.createdAt), formatDuration(c.durationSeconds)].filter(Boolean).join(' · ');
}

/**
 * The round a new call is most likely for, from the candidate's stage in that position (owner 2026-11-17): the first
 * two board columns (Sourced, Screening) or out of the flow = screening; the last three columns (Salary discussion,
 * Offer, Joined) = the HR / offer discussion; any round in between = the next interview round after the ones already
 * on file for this position. HR can change it. (Owner 2026-11-19: from HR's stage list.)
 */
function suggestRound(stage: Stage | null, stages: StageDef[], calls: CallAnalysis[], positionId: string): CallRound {
    const at = stage ? columnIndexOf(stages, stage) : -1;
    const columns = boardColumns(stages, s => s.key === stage).length;
    if (stage && (stage === 'offer' || stage === 'joined' || (at >= 0 && columns > 5 && at >= columns - 3))) return 'hr_offer';
    if (!stage || at < 2 || findStage(stages, stage)?.kind === 'out') return 'screening';
    const done = calls.filter(c => c.positionId === positionId && isInterviewRound(c.round)).map(c => Number((c.round as string).slice(-1)));
    const next = Math.min(3, (done.length ? Math.max(...done) : 0) + 1);
    return `round_${next}` as CallRound;
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
    /** Owner 2026-11-17: which round the call was for, changed afterwards; the reading stays until "Read it again". */
    const changeRound = async (c: CallAnalysis, round: CallRound): Promise<boolean> => {
        setBusyId(c.id);
        const res = await api<{ call: CallAnalysis }>(`/api/candidates/calls/${encodeURIComponent(c.id)}`, { method: 'PATCH', json: { orgId, round } });
        setBusyId(null);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return false; }
        setFull(f => (f && f.id === c.id ? { ...f, call: { ...f.call, round } } : f));
        refresh();
        return true;
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
            {/* Owner 2026-11-24: the JD and the screening questions beside the call (option A: record on the phone, upload here) */}
            <ScreeningPanel orgId={orgId} record={record} onChanged={onLogged} />
            <AddCall orgId={orgId} record={record} calls={calls ?? []} onAdded={call => { setSelectedId(call.id); refresh(); onLogged(); }} />

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
                    <EmptyState icon={Phone} title="No calls yet">Record the call on your phone and add it above with its round. The transcript, the sentiment and the facts heard appear here in a minute or two; an interview round also shows how the answers covered the role.</EmptyState>
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
                        onRetry={() => void retry(selected)} busy={busyId === selected.id}
                        onRound={round => changeRound(selected, round)} />
                ) : (
                    <p className="flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Opening the call</p>
                )
            )}
        </div>
    );
}

/* ---- Adding a call --------------------------------------------------------------------------------------------------- */

type Phase = { phase: 'preparing' | 'sending' | 'confirming'; fraction: number };

function AddCall({ orgId, record, calls, onAdded }: { orgId: string; record: CandidateRecord; calls: CallAnalysis[]; onAdded: (call: CallAnalysis) => void }) {
    const { notify, reportError } = useUi();
    const [mode, setMode] = useState<'file' | 'transcript'>('file');
    const [file, setFile] = useState<File | null>(null);
    const [transcript, setTranscript] = useState('');
    const [positionId, setPositionId] = useState('');
    const [calledOn, setCalledOn] = useState(todayIso);
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

    // The candidate's stage in each position, for the round's default (owner 2026-11-17).
    const [stages, setStages] = useState<{ id: string; byPosition: Map<string, Stage> } | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ memberships: { member: { stage: Stage }; position: { id: string } }[] }>(`/api/candidates/${encodeURIComponent(record.id)}/positions${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            setStages({ id: record.id, byPosition: new Map((res.ok ? res.data.memberships : []).map(m => [m.position.id, m.member.stage])) });
        });
        return () => ctrl.abort();
    }, [orgId, record.id]);
    const stageHere = positionId && stages?.id === record.id ? stages.byPosition.get(positionId) ?? null : null;
    const stageList = useStages(orgId)?.stages ?? [];
    const suggested = suggestRound(stageHere, stageList, calls, positionId);
    // The round follows the suggestion until HR picks one.
    const [roundPick, setRoundPick] = useState<CallRound | null>(null);
    const round = roundPick ?? suggested;

    const problem = file ? (!callFileType(file.name) ? 'Use mp3, m4a, wav, ogg or webm.' : file.size > MAX_CALL_BYTES ? `Larger than ${MAX_CALL_BYTES / 1024 / 1024} MB. Export it at a lower quality.` : null) : null;
    const canSubmit = !busy && (mode === 'file' ? !!file && !problem : transcript.trim().length >= 40);

    const pick = (f: File | null) => { setFile(f); };
    const reset = () => { setFile(null); setTranscript(''); setRoundPick(null); if (inputRef.current) inputRef.current.value = ''; };

    const submit = async () => {
        if (!canSubmit) return;
        const common = { orgId, applicationId: record.id, positionId: positionId || null, calledOn: calledOn || null, round };
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
        const prep = await api<PreparedCall>('/api/candidates/calls', { json: { ...common, file: { name: file.name, size: file.size } } });
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
                <div
                    onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
                    onClick={() => { if (!busy) inputRef.current?.click(); }}
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
                                <span className="block text-xs text-text-tertiary">mp3, m4a, wav, ogg or webm · up to {MAX_CALL_BYTES / 1024 / 1024} MB · or <button type="button" onClick={e => { e.stopPropagation(); setMode('transcript'); }} className="font-semibold text-primary-dark hover:underline">paste a transcript</button> instead</span>
                            </>
                        )}
                    </span>
                    {/* Owner 2026-11-17: a real button, not only the drop zone. The input's own click must not bubble back to the zone (it would open the picker twice). */}
                    <button type="button" onClick={e => { e.stopPropagation(); inputRef.current?.click(); }} disabled={!!busy} className={`${BTN_SECONDARY} shrink-0`}><Upload className="h-4 w-4" />{file ? 'Choose another' : 'Choose a file'}</button>
                    <input ref={inputRef} type="file" accept={CALL_AUDIO_ACCEPT} className="sr-only" aria-label="Choose the recording" onClick={e => e.stopPropagation()} onChange={e => pick(e.target.files?.[0] ?? null)} disabled={!!busy} />
                </div>
            ) : (
                <div className="mt-3">
                    <label htmlFor="cand-call-transcript" className={LABEL}>Transcript <span className="text-text-tertiary">· as spoken, any language · <button type="button" onClick={() => setMode('file')} className="font-semibold text-primary-dark hover:underline">upload a recording</button> instead</span></label>
                    <textarea id="cand-call-transcript" rows={6} value={transcript} onChange={e => setTranscript(e.target.value)} disabled={!!busy} placeholder="Paste the whole call. One line per thing said works best." className={`${INPUT} mt-1.5 h-auto min-h-[140px] resize-y py-2.5 leading-relaxed`} />
                </div>
            )}

            <div className="mt-3 grid gap-x-3 gap-y-3 @2xl:grid-cols-[minmax(0,1fr)_190px_170px]">
                <div>
                    <label htmlFor="cand-call-position" className={LABEL}>For position <span className="text-text-tertiary">· optional, the JD is used in the reading</span></label>
                    <select id="cand-call-position" value={positionId} onChange={e => { setPositionId(e.target.value); setRoundPick(null); }} disabled={!!busy} className={`${INPUT} mt-1.5`}>
                        <option value="">Not for a position</option>
                        {(positions?.list ?? []).map(p => <option key={p.id} value={p.id}>{p.title}{p.location ? ` · ${p.location}` : ''}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="cand-call-round" className={LABEL}>Round {stageHere && <span className="text-text-tertiary">· now {stageName(stageList, stageHere)}</span>}</label>
                    <select id="cand-call-round" value={round} onChange={e => setRoundPick(e.target.value as CallRound)} disabled={!!busy} className={`${INPUT} mt-1.5`}>
                        {CALL_ROUNDS.map(r => <option key={r} value={r}>{CALL_ROUND_LABELS[r]}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="cand-call-date" className={LABEL}>Call date</label>
                    <input id="cand-call-date" type="date" value={calledOn} max={todayIso()} onChange={e => setCalledOn(e.target.value)} disabled={!!busy} className={`${INPUT} mt-1.5`} />
                </div>
            </div>

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
    const sub = [call.positionTitle, call.fileName ?? 'Transcript pasted', call.byName ? `by ${call.byName}` : null, call.language].filter(Boolean).join(' · ');
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

function Analysis({ orgId, call, record, onApplied, onRetry, busy, onRound }: {
    orgId: string; call: CallAnalysis; record: CandidateRecord;
    onApplied: (call: CallAnalysis, record: CandidateRecord | null) => void; onRetry: () => void; busy: boolean;
    /** Owner 2026-11-17: change which round the call was for. */
    onRound: (round: CallRound) => Promise<boolean>;
}) {
    const r = call.result;
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [position, setPosition] = useState(0);
    const [showAll, setShowAll] = useState(false);
    // The round was changed after this reading: offer to read it again for that round.
    const [readFor, setReadFor] = useState<string | null>(null);
    const readAs = readFor === call.id;
    const hasAudio = call.inputKind === 'audio';
    const seek = hasAudio ? (seconds: number) => { const a = audioRef.current; if (!a) return; a.currentTime = seconds; void a.play().catch(() => {}); } : undefined;

    if (!r) return null;
    const segments = call.segments ?? [];
    const textLines = !segments.length && call.transcriptText ? call.transcriptText.split('\n').filter(Boolean) : [];
    const lineCount = segments.length || textLines.length;
    const LIMIT = 12;

    return (
        <section aria-label={`Analysis of ${callTitle(call)}`} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-semibold text-text-primary">{callTitle(call)}</p>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-xs text-text-tertiary">{[call.positionTitle, call.byName ? `by ${call.byName}` : null, call.language].filter(Boolean).join(' · ')}</span>
                    <label className="sr-only" htmlFor={`call-round-${call.id}`}>Round</label>
                    <select id={`call-round-${call.id}`} value={call.round ?? 'screening'} disabled={busy}
                        onChange={e => { const next = e.target.value as CallRound; void onRound(next).then(ok => { if (ok) setReadFor(call.id); }); }}
                        className="h-8 cursor-pointer rounded-lg border border-border bg-surface px-2 text-xs font-semibold text-text-primary outline-none focus:border-primary disabled:opacity-60" title="Which round this call was for">
                        {CALL_ROUNDS.map(r => <option key={r} value={r}>{CALL_ROUND_LABELS[r]}</option>)}
                    </select>
                </span>
            </div>
            {readAs && (
                <div role="status" className={`${WELL} flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-sm`}>
                    <span className="min-w-0 flex-1 text-text-primary">Round changed to <strong>{CALL_ROUND_LABELS[call.round ?? 'screening']}</strong>. This reading is still the old one.</span>
                    <button type="button" onClick={() => setReadFor(null)} className={`${BTN_GHOST} h-8 px-3 text-xs`}>Keep this reading</button>
                    <button type="button" onClick={() => { setReadFor(null); onRetry(); }} disabled={busy} className={`${BTN_PRIMARY} h-8 px-3 text-xs`}>Read it again</button>
                </div>
            )}

            <CallInsightsView orgId={orgId} call={call} record={record} onApplied={onApplied} onSeek={seek} />

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
