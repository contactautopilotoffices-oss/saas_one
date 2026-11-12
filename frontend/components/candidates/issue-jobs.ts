'use client';

import { useSyncExternalStore } from 'react';
import type {
    AiFixApplyResponse, AiFixApproval, AiFixDiscardResponse, AiFixField, AiFixProposal, AiFixResponse, CandidateSheet,
} from '@/backend/lib/candidates/types';
import { api, type ApiResult } from './api';

/**
 * The work of "View issues" (owner 2026-11-12: "these processes must [go on] even after I close the box").
 *
 * Asking the AI about hundreds of rows, applying its fixes, marking rows reviewed and deleting rows used to live
 * inside the box: closing it, or moving to another tab of Candidate Search, lost the suggestions and whatever was
 * still running. They live here now, outside React, one entry per sheet upload:
 *   - the AI's suggestions for the sheet's rows (kept until applied, discarded, or the sheet is uploaded again)
 *   - the one job running on the sheet, with its progress
 * so the box can be closed and opened again, and the Sheets page can show the progress beside the sheet.
 *
 * It runs in this browser tab: it goes on while HR moves around the app, and stops if the tab is refreshed or closed
 * (the page asks before leaving). Whatever was already saved stays saved; unsaved suggestions are asked for again.
 */

/** One row's AI suggestion and which of its changes HR has ticked. */
export type Suggestion = { proposal: AiFixProposal; logId: string | null; selected: AiFixField[] };
export type JobKind = 'ask' | 'apply' | 'review' | 'delete';
export type IssueJob = { kind: JobKind; done: number; total: number; rows: number[]; stopping: boolean };
export type SheetJobs = {
    byRow: Record<number, Suggestion>;
    /** Rows the AI was asked about and had no answer for (record deleted, nothing left to fix). */
    noAnswer: number[];
    job: IssueJob | null;
    /** Goes up each time rows changed on the server, so an open box loads its rows again. */
    version: number;
};
export type JobEvent = { tone: 'success' | 'info' | 'error'; message: string; changed: boolean };
/** What a job needs to know about its sheet. `key` changes with every upload: the rows are renumbered then. */
export type JobTarget = { orgId: string; sheetId: string; key: string; name: string };

/** Rows per AI call: the server's AI_FIX_BATCH. */
const AI_BATCH = 15;
/** Rows per save call (the route takes up to 200) and per delete call (the route takes up to 200). */
const SAVE_CHUNK = 100;
const DELETE_CHUNK = 200;
/** A "too many requests" answer: wait this long, this many times, then give up. */
const BUSY_WAIT_MS = 15_000;
const BUSY_TRIES = 6;

export const JOB_LABELS: Record<JobKind, string> = { ask: 'Asking AI', apply: 'Applying fixes', review: 'Marking reviewed', delete: 'Deleting rows' };

const EMPTY: SheetJobs = { byRow: {}, noAnswer: [], job: null, version: 0 };
const sheets = new Map<string, SheetJobs>();
const listeners = new Set<() => void>();
const eventListeners = new Set<(event: JobEvent) => void>();

export const jobKey = (sheet: Pick<CandidateSheet, 'id' | 'uploadCount'>) => `${sheet.id}:${sheet.uploadCount}`;
export const jobTarget = (orgId: string, sheet: CandidateSheet): JobTarget => ({ orgId, sheetId: sheet.id, key: jobKey(sheet), name: sheet.name });

const get = (key: string) => sheets.get(key) ?? EMPTY;
function patch(key: string, update: (state: SheetJobs) => SheetJobs) {
    sheets.set(key, update(get(key)));
    for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/** The suggestions and the running job of one sheet upload. */
export function useSheetJobs(key: string | null): SheetJobs {
    return useSyncExternalStore(subscribe, () => (key ? get(key) : EMPTY), () => EMPTY);
}

/** How many sheets have a job running (the page asks before it is left while this is above zero). */
export function useRunningJobs(): number {
    const count = () => { let n = 0; for (const s of sheets.values()) if (s.job) n += 1; return n; };
    return useSyncExternalStore(subscribe, count, () => 0);
}

/** Told when a job ends, to show its result wherever HR is by then. */
export function onJobEvent(listener: (event: JobEvent) => void) {
    eventListeners.add(listener);
    return () => { eventListeners.delete(listener); };
}

/** One job per sheet at a time. */
function start(t: JobTarget, kind: JobKind, rows: number[]): boolean {
    if (!rows.length || get(t.key).job) return false;
    patch(t.key, s => ({ ...s, job: { kind, done: 0, total: rows.length, rows, stopping: false } }));
    return true;
}
function advance(key: string, by: number, more: Partial<SheetJobs> = {}) {
    patch(key, s => ({ ...s, ...more, job: s.job ? { ...s.job, done: Math.min(s.job.total, s.job.done + by) } : null }));
}
function finish(t: JobTarget, event: JobEvent) {
    patch(t.key, s => ({ ...s, job: null }));
    for (const listener of eventListeners) listener({ ...event, message: `${t.name}: ${event.message}` });
}
const stopping = (key: string) => get(key).job?.stopping === true;

/** Ends the running job after the step it is on. What that step saved stays saved. */
export function stopJob(key: string) {
    patch(key, s => (s.job ? { ...s, job: { ...s.job, stopping: true } } : s));
}

/** A call that waits and tries again while the server says "too many requests". */
async function patient<T>(key: string, call: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
    let res = await call();
    for (let i = 0; i < BUSY_TRIES && !res.ok && res.status === 429 && !stopping(key); i += 1) {
        await sleep(BUSY_WAIT_MS);
        res = await call();
    }
    return res;
}

const without = (byRow: Record<number, Suggestion>, rows: Iterable<number>) => {
    const next = { ...byRow };
    for (const row of rows) delete next[row];
    return next;
};

/** Tick or untick one suggested change. */
export function toggleField(key: string, rowNumber: number, field: AiFixField) {
    patch(key, s => {
        const suggestion = s.byRow[rowNumber];
        if (!suggestion) return s;
        const selected = suggestion.selected.includes(field) ? suggestion.selected.filter(f => f !== field) : [...suggestion.selected, field];
        return { ...s, byRow: { ...s.byRow, [rowNumber]: { ...suggestion, selected } } };
    });
}

/** Throws away the AI's suggestions for these rows. Nothing on the server changes; the rows can be asked again. */
export function dismissSuggestions(key: string, rowNumbers: number[]) {
    patch(key, s => ({ ...s, byRow: without(s.byRow, rowNumbers) }));
}

/** Asks the AI about these rows, AI_BATCH at a time. The suggestions appear as each batch answers. */
export async function askAi(t: JobTarget, rowNumbers: number[]): Promise<void> {
    if (!start(t, 'ask', rowNumbers)) return;
    let got = 0;
    let error = '';
    for (let i = 0; i < rowNumbers.length && !stopping(t.key); i += AI_BATCH) {
        const batch = rowNumbers.slice(i, i + AI_BATCH);
        const res = await patient<AiFixResponse>(t.key, () => api<AiFixResponse>(`/api/candidates/sheets/${encodeURIComponent(t.sheetId)}/ai-fix`, { json: { orgId: t.orgId, rowNumbers: batch } }));
        if (!res.ok) { error = res.error; break; }
        const { proposals, logId, notFixable } = res.data;
        got += proposals.length;
        const s = get(t.key);
        const byRow = { ...s.byRow };
        for (const p of proposals) byRow[p.rowNumber] = { proposal: p, logId, selected: p.changes.map(c => c.field) };
        advance(t.key, batch.length, { byRow, noAnswer: [...new Set([...s.noAnswer, ...notFixable])] });
    }
    const stopped = stopping(t.key);
    if (error) finish(t, { tone: 'error', message: got ? `${error} (suggestions for ${plural(got, 'row')} were kept)` : error, changed: false });
    else finish(t, { tone: 'info', message: `${stopped ? 'Stopped. ' : ''}AI suggestions ready for ${plural(got, 'row')}. Review them, then apply.`, changed: false });
}

/**
 * Saves approvals: a row's ticked changes ('apply'), or nothing but "this row is fine" ('review'). One call can carry
 * only one AI fix log, so the rows are grouped by the log their suggestion came from, then sent SAVE_CHUNK at a time.
 */
export async function saveRows(t: JobTarget, approvals: AiFixApproval[], kind: 'apply' | 'review'): Promise<void> {
    if (!start(t, kind, approvals.map(a => a.rowNumber))) return;
    const before = get(t.key).byRow;
    const groups = new Map<string, AiFixApproval[]>();
    for (const a of approvals) {
        const logId = before[a.rowNumber]?.logId ?? '';
        groups.set(logId, [...(groups.get(logId) ?? []), a]);
    }
    let applied = 0;
    let error = '';
    const failed: AiFixApplyResponse['failed'] = [];
    outer: for (const [logId, group] of groups) {
        for (let i = 0; i < group.length; i += SAVE_CHUNK) {
            if (stopping(t.key)) break outer;
            const chunk = group.slice(i, i + SAVE_CHUNK);
            const res = await patient<AiFixApplyResponse>(t.key, () => api<AiFixApplyResponse>(`/api/candidates/sheets/${encodeURIComponent(t.sheetId)}/ai-fix/apply`, {
                json: { orgId: t.orgId, logId: logId || undefined, approvals: chunk },
            }));
            if (!res.ok) { error = res.error; break outer; }
            applied += res.data.applied;
            failed.push(...res.data.failed);
            const bad = new Set(res.data.failed.map(f => f.rowNumber));
            const s = get(t.key);
            advance(t.key, chunk.length, { byRow: without(s.byRow, chunk.map(a => a.rowNumber).filter(row => !bad.has(row))), version: s.version + (res.data.applied ? 1 : 0) });
        }
    }
    const what = kind === 'apply' ? `${plural(applied, 'row')} updated` : `${plural(applied, 'row')} marked as reviewed`;
    const trouble = error || (failed.length ? `Row ${failed[0].rowNumber}: ${failed[0].error}${failed.length > 1 ? ` (and ${plural(failed.length - 1, 'more row')})` : ''}` : '');
    if (trouble) finish(t, { tone: 'error', message: applied ? `${what}. ${trouble}` : trouble, changed: applied > 0 });
    else finish(t, { tone: 'success', message: `${stopping(t.key) ? 'Stopped. ' : ''}${what}`, changed: applied > 0 });
}

/**
 * Deletes rows (owner 2026-11-12: "mass discard means deleting those rows which the AI could not fix"): their records
 * move to Deleted, restorable from the Candidates tab, and the rows leave "Needs review".
 */
export async function deleteRows(t: JobTarget, rowNumbers: number[]): Promise<void> {
    if (!start(t, 'delete', rowNumbers)) return;
    let closed = 0;
    let error = '';
    for (let i = 0; i < rowNumbers.length && !stopping(t.key); i += DELETE_CHUNK) {
        const chunk = rowNumbers.slice(i, i + DELETE_CHUNK);
        const res = await patient<AiFixDiscardResponse>(t.key, () => api<AiFixDiscardResponse>(`/api/candidates/sheets/${encodeURIComponent(t.sheetId)}/discard`, { json: { orgId: t.orgId, rowNumbers: chunk } }));
        if (!res.ok) { error = res.error; break; }
        closed += res.data.closed;
        const s = get(t.key);
        advance(t.key, chunk.length, { byRow: without(s.byRow, chunk), version: s.version + (res.data.closed ? 1 : 0) });
    }
    const what = `${plural(closed, 'row')} deleted. They can be restored from the Candidates tab.`;
    if (error) finish(t, { tone: 'error', message: closed ? `${what} ${error}` : error, changed: closed > 0 });
    else finish(t, { tone: 'success', message: `${stopping(t.key) ? 'Stopped. ' : ''}${what}`, changed: closed > 0 });
}
