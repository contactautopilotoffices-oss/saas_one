'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, CircleAlert, CircleCheck, Download, FileText, Folder, FolderDown, FolderOpen, Search, Square, SquareCheck, Trash2, Upload, X } from 'lucide-react';
import {
    MATCH_REASON_LABELS, TEXT_STATUS_LABELS,
    type PreparedUpload, type ResumeConfirmResponse, type ResumeFile, type ResumeFilesResponse, type ResumeLinksResponse, type ResumeManifestResponse, type ResumeSummary,
} from '@/backend/lib/candidates/types';
import { daysSince, PICK_LABELS, pickVerdict, RESUME_BATCH, RESUME_LINK_BATCH, RESUME_REMIND_AFTER_DAYS, sinceLastUpload, thisYearRange, type PickVerdict } from '@/backend/lib/candidates/resume-pick';
import Skeleton from '@/frontend/components/ui/Skeleton';
import { api, qs } from './api';
import { canRememberFolder, ensureReadable, folderAllowed, forgetFolder, isBrave, listFolderFiles, loadFolder, pickFolder } from './folder-store';
import { formatCount, formatDate } from './format';
import { Avatar, BTN_DANGER_GHOST, BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, Dialog, EmptyState, FIELD, INPUT, LABEL, NUM_MD, NUM_SM, Spinner, Tag, Toggle, useUi, WELL } from './ui';
import { uniqueZipName, ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, ZipWriter } from './zip-store';

/**
 * Resumes (owner 2026-11-07, phase 1): get every resume from the team's laptops into one place. Someone on each laptop
 * picks the Downloads folder; PDF and Word files downloaded between the dates are ticked; the browser hashes each
 * file, asks for upload links in batches of RESUME_BATCH and sends the bytes straight to storage, PARALLEL at a time,
 * retrying a dropped file. A file already stored (same bytes, any laptop) is skipped, so running it again is safe.
 * The tab has to stay open while it uploads: a web page can only read the laptop's files while it is open.
 *
 * Below that, the resumes already in the database: filters (download date, laptop, name), open / delete, the Excel,
 * and "Download all (ZIP)" built in the browser (the files come straight from storage; no server limit).
 *
 * Redesign (owner 2026-11-11): the page is a hub. Uploads are filed under the signed-in person's name (no "whose
 * laptop" list: the server takes it from the login), files can be dropped on the page, each team member's last upload
 * is listed, a strip shows how far the background reading is, and the few files that need a person are gathered in
 * one "Needs attention" list instead of being found through filters.
 */

/**
 * Files loaded into the "Needs attention" list. Owner 2026-11-11: the list scrolls inside itself (about six rows tall),
 * so a long one does not push the library down the page, and its rows can be ticked and deleted together; one delete
 * takes at most RESUME_DELETE_BATCH (200) files, which these two together stay under.
 */
const ATTENTION_ROWS = 120;
const OTHER_ROWS = 60;
const PARALLEL = 4;
const ATTEMPTS = 3;
const PAGE_SIZE = 50;
/** Rows of the picked-files list drawn at once (a Downloads folder can hold thousands). */
const PICK_ROWS = 400;
/** A ZIP part kept in memory (browsers without a save-to-disk stream) before it is handed to the user. */
const ZIP_PART_MEMORY = 500 * 1024 * 1024;
/**
 * Owner 2026-11-11: while files are still being read in the background, the page refreshes the counts and the list
 * every POLL_MS and asks the server for a short reading run every NUDGE_MS (same pattern as the Sheets page), so the
 * progress shows live, without a refresh.
 */
const POLL_MS = 4000;
const NUDGE_MS = 20_000;

type Picked = { key: string; file: File; folder: string | null };
type Failure = { key: string; name: string; reason: string };
type Run = {
    phase: 'running' | 'done' | 'stopped';
    total: number;
    done: number;
    uploaded: number;
    duplicates: number;
    failed: Failure[];
    bytesTotal: number;
    bytesDone: number;
    current: string;
};
type Preset = 'year' | 'all' | 'custom';
/**
 * The folder "Upload new resumes" reads (owner 2026-11-11: chosen once, shown by name, changeable). `allowed`: the
 * browser will read it without asking. `unsupported`: this browser cannot keep a folder (Firefox, Safari, Brave as shipped).
 */
type Source = { state: 'unknown' | 'none' | 'unsupported' } | { state: 'remembered'; name: string; allowed: boolean };
type LinkFilter = '' | 'linked' | 'unlinked' | 'rejected' | 'other' | 'attention';
type Loaded = { key: string; data: ResumeFilesResponse | null; error: string };

/** Phase 2 / 4: has the file's text been read, and have its details been read into the candidate. Reasons sit in the tooltip. */
function TextStatus({ f }: { f: ResumeFile }) {
    if (f.removed) return <span className="text-warning" title={f.textError ?? undefined}>Removed: not a resume</span>;
    if (f.other) return <span className="text-text-secondary" title={f.textError ?? undefined}>Other document (kept)</span>;
    const bad = f.textStatus === 'unreadable' || f.textStatus === 'failed';
    if (bad || f.textStatus !== 'ready') {
        return <span className={bad ? 'text-warning' : 'text-text-tertiary'} title={f.textError ?? undefined}>{TEXT_STATUS_LABELS[f.textStatus]}</span>;
    }
    if (f.extractStatus === 'done') return <span className="text-text-secondary">Details read</span>;
    if (f.extractStatus === 'failed') return <span className="text-warning" title={f.extractError ?? undefined}>Read · details failed</span>;
    if (f.extractStatus === 'skipped') return <span className="text-text-secondary">Read</span>;
    return <span className="text-text-tertiary" title={f.extractError ?? undefined}>Read · details soon</span>;
}
type Zip = { done: number; total: number; part: number; skipped: number; phase: 'listing' | 'saving' | 'done' };

const VERDICT_TONE: Record<PickVerdict, string> = {
    ok: 'text-text-tertiary',
    name: 'text-warning',
    date: 'text-text-tertiary',
    type: 'text-text-tertiary',
    size: 'text-error',
};

function fmtSize(bytes: number): string {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** YYYY-MM-DD in local time, for a date input. */
function dayInput(ms: number): string {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfDay(day: string): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
}
function endOfDay(day: string): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999).getTime() : null;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function sha256Hex(file: File): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/** Runs `worker` over `items`, at most `size` at a time. */
async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const lane = async () => {
        while (next < items.length) {
            const item = items[next];
            next += 1;
            await worker(item);
        }
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
}

/** PUT the bytes to a one-time upload link (the request supabase-js makes, by hand so the progress bar can move). */
function putFile(
    signedUrl: string, file: File, contentType: string, onProgress: (sent: number) => void, register: (xhr: XMLHttpRequest | null) => void,
): Promise<'ok' | 'cancelled' | string> {
    return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        register(xhr);
        xhr.open('PUT', signedUrl);
        xhr.setRequestHeader('x-upsert', 'true');
        const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (anon) { xhr.setRequestHeader('apikey', anon); xhr.setRequestHeader('Authorization', `Bearer ${anon}`); }
        xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.min(e.loaded, file.size)); };
        xhr.onload = () => {
            register(null);
            resolve(xhr.status >= 200 && xhr.status < 300 ? 'ok'
                : xhr.status === 413 ? 'Larger than storage allows'
                : xhr.status === 415 ? 'Storage refused this file type'
                : `Upload failed (${xhr.status})`);
        };
        xhr.onerror = () => { register(null); resolve('The connection dropped'); };
        xhr.onabort = () => { register(null); resolve('cancelled'); };
        const body = new FormData();
        body.append('cacheControl', '3600');
        // The stored type comes from the extension (the server decided it); a laptop may report no type for .doc files.
        body.append('', new File([file], file.name, { type: contentType }));
        xhr.send(body);
    });
}

function saveBlob(blob: Blob, name: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{
    createWritable(): Promise<{ write(chunk: Uint8Array): Promise<void>; close(): Promise<void> }>;
}>;

function ProgressBar({ fraction, label }: { fraction: number; label: string }) {
    const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
    return (
        <span className="block h-1.5 w-full overflow-hidden rounded-full bg-border" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span className="block h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </span>
    );
}

/** One stage of the background work: how many files are through it, as a number and a bar. */
function Stage({ label, value, of, hint }: { label: string; value: number; of: number; hint?: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className={LABEL}>{label}</dt>
            <dd className={`${NUM_MD} mt-0.5 text-text-primary`}>{formatCount(Math.max(0, value))}</dd>
            <dd className="mt-1.5"><ProgressBar fraction={of ? Math.max(0, value) / of : 0} label={label} /></dd>
            {hint && <dd className="mt-1.5 truncate text-xs text-text-tertiary">{hint}</dd>}
        </div>
    );
}

/** "today", "yesterday", "9 days ago". */
function ago(iso: string | null): string {
    if (!iso) return 'never';
    const days = daysSince(iso);
    return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${formatCount(days)} days ago`;
}

/** Why a file is in "Needs attention", in HR's words. */
function attentionOf(f: ResumeFile): { kind: string; why: string } {
    if (f.other) return { kind: 'Other document', why: (f.textError ?? 'Kept, not matched to a candidate').replace(/^Other document \(kept, not matched\): /, '') };
    if (f.textStatus === 'ready' && f.extractStatus === 'failed') return { kind: 'Details not read', why: 'The text was read and is searchable, but the education, skills and employers could not be taken out of it.' };
    return { kind: 'Could not be read', why: f.textError ?? 'The text of this file could not be read.' };
}

export default function ResumesView({ orgId }: { orgId: string }) {
    const { notify, reportError } = useUi();
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

    // ---- who is uploading ---------------------------------------------------------------------------------------------
    // Owner 2026-11-11: uploads are filed under the signed-in person's name. The server takes it from the login and
    // sends it back with the totals, so there is nothing to choose and nothing kept in this browser.
    /** The library's totals, also this person's "last uploaded" (phase 3); fetched further down, read by the picker here. */
    const [summary, setSummary] = useState<ResumeSummary | null>(null);
    const uploader = summary?.uploader ?? null;
    const mine = useMemo(() => (uploader ? summary?.devices.find(d => d.label === uploader) ?? null : null), [summary, uploader]);
    // Phase 3: the dates start a day before the newest download this laptop has uploaded (this year on a first run);
    // HR can still change them, and the change holds until the page is left.
    const defaultRange = useMemo(() => { const r = sinceLastUpload(mine?.newest ?? null); return { from: dayInput(r.from), to: dayInput(r.to) }; }, [mine]);
    const [rangeOverride, setRangeOverride] = useState<{ from: string; to: string } | null>(null);
    const pickRange = rangeOverride ?? defaultRange;
    const setPickRange = (next: (r: { from: string; to: string }) => { from: string; to: string }) => setRangeOverride(next(pickRange));
    const range = useMemo(() => ({ from: startOfDay(pickRange.from) ?? 0, to: endOfDay(pickRange.to) ?? Number.MAX_SAFE_INTEGER }), [pickRange]);
    const [raw, setRaw] = useState<Picked[] | null>(null);
    const [overrides, setOverrides] = useState<Record<string, boolean>>({});
    const [showAll, setShowAll] = useState(false);
    const folderInput = useRef<HTMLInputElement | null>(null);
    const filesInput = useRef<HTMLInputElement | null>(null);

    const picked = useMemo(() => (raw ?? []).map(p => {
        const verdict = pickVerdict(p.file, range);
        return { ...p, verdict, ticked: overrides[p.key] ?? verdict === 'ok' };
    }), [raw, range, overrides]);
    const selected = useMemo(() => picked.filter(p => p.ticked), [picked]);
    const selectedBytes = useMemo(() => selected.reduce((n, p) => n + p.file.size, 0), [selected]);
    const counts = useMemo(() => {
        const c: Record<PickVerdict, number> = { ok: 0, name: 0, date: 0, type: 0, size: 0 };
        for (const p of picked) c[p.verdict] += 1;
        return c;
    }, [picked]);
    const visibleRows = useMemo(() => (showAll ? picked : picked.filter(p => p.ticked)), [picked, showAll]);

    const fromFileList = (list: FileList | null): Picked[] => Array.from(list ?? []).map(file => {
        const rel = file.webkitRelativePath || '';
        const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : null;
        return { key: `${rel || file.name}|${file.size}|${file.lastModified}`, file, folder };
    });
    /** Shows the files; with `autoStart` (phase 3's one click) the likely resumes are uploaded at once. */
    const takeFiles = (next: Picked[], autoStart: boolean) => {
        if (folderInput.current) folderInput.current.value = '';
        if (filesInput.current) filesInput.current.value = '';
        if (!next.length) { notify('No files in that folder', 'info'); return; }
        setRaw(next);
        setOverrides({});
        setShowAll(false);
        setRun(null);
        if (autoStart) {
            const ready = next.filter(p => pickVerdict(p.file, range) === 'ok');
            if (ready.length) void startUpload(ready);
            else notify('Nothing new to upload since your last upload', 'info');
        }
    };

    // Phase 3: the remembered Downloads folder (Chrome / Edge). One click reads it and uploads what is new.
    // Owner 2026-11-11: it is the "source folder", shown by name with Change and Forget, so it is chosen once and
    // seen every time. Looked up after the page is on screen (the server cannot know what this browser remembers).
    const [source, setSource] = useState<Source>({ state: 'unknown' });
    useEffect(() => {
        let live = true;
        void (async (): Promise<Source> => {
            if (!canRememberFolder()) return { state: 'unsupported' };
            const handle = await loadFolder();
            return handle ? { state: 'remembered', name: handle.name, allowed: await folderAllowed(handle) } : { state: 'none' };
        })().then(next => { if (live) setSource(next); });
        return () => { live = false; };
    }, []);
    const [scanning, setScanning] = useState(false);
    /**
     * Owner 2026-11-12: with no source folder set, the button opens the ordinary folder window, in every browser. That
     * window accepts Downloads (the newer folder picker refuses it: "contains system files"), and the upload of what is
     * new then starts by itself. With a source folder set, that folder is read with no window.
     */
    const uploadNew = async () => {
        if (uploading || scanning) return;
        // Decided from what is on screen, with nothing awaited first: a file window only opens straight from a click.
        if (source.state !== 'remembered') { folderInput.current?.click(); return; }
        setScanning(true);
        try {
            const handle = await loadFolder();
            if (!handle) {
                setSource({ state: 'none' });
                notify('The source folder is no longer remembered. Click Upload new resumes again to pick the folder.', 'info');
                return;
            }
            if (!(await ensureReadable(handle))) {
                notify(`The browser did not allow reading ${handle.name}. Allow it, or use Forget to pick the folder each time.`, 'info');
                return;
            }
            setSource({ state: 'remembered', name: handle.name, allowed: true });
            const found = await listFolderFiles(handle);
            takeFiles(found.map(({ file, folder }) => ({ key: `${folder}/${file.name}|${file.size}|${file.lastModified}`, file, folder })), true);
        } catch (e) {
            notify(e instanceof Error && e.message ? e.message : 'Could not read the folder', 'error');
        } finally {
            if (mounted.current) setScanning(false);
        }
    };
    const forgetThisFolder = async () => { await forgetFolder(); setSource({ state: 'none' }); notify('Source folder forgotten; the next upload asks for it again', 'info'); };
    /** "Choose folder" / "Change": the browser's folder window, once. Nothing is uploaded by this. */
    const chooseSource = async () => {
        if (uploading || scanning) return;
        try {
            const handle = await pickFolder();
            if (!handle || !mounted.current) return;
            setSource({ state: 'remembered', name: handle.name, allowed: true });
            notify(`${handle.name} is the source folder now`, 'success');
        } catch (e) {
            notify(e instanceof Error && e.message ? e.message : 'Could not open the folder', 'error');
        }
    };
    // Files dragged onto the page (owner 2026-11-11): shown for review like "Choose files"; nothing uploads by itself.
    // Owner 2026-11-12: "Review a folder" is gone (it had become the same button as Upload new resumes); reviewing
    // before sending is what Choose files and dropping are for.
    const [dropping, setDropping] = useState(false);
    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDropping(false);
        if (uploading || scanning) return;
        // A dropped folder arrives as an entry with no size and no type: only real files are taken.
        const dropped = Array.from(e.dataTransfer.files).filter(file => file.size > 0);
        if (!dropped.length) { notify('Drop PDF or Word files; for a whole folder use Upload new resumes', 'info'); return; }
        takeFiles(dropped.map(file => ({ key: `${file.name}|${file.size}|${file.lastModified}`, file, folder: null })), false);
    };
    const tick = (key: string, on: boolean) => setOverrides(o => ({ ...o, [key]: on }));
    const tickAll = (on: boolean) => setOverrides(Object.fromEntries(picked.map(p => [p.key, on])));
    const tickResumes = () => setOverrides({});

    // ---- upload run --------------------------------------------------------------------------------------------------
    const [run, setRun] = useState<Run | null>(null);
    const stopRef = useRef(false);
    const xhrs = useRef(new Set<XMLHttpRequest>());
    const uploading = run?.phase === 'running';
    const patchRun = (patch: Partial<Run>) => { if (mounted.current) setRun(r => (r ? { ...r, ...patch } : r)); };

    /** Bumped after an upload or a delete so the list and the summary below refetch. */
    const [nonce, setNonce] = useState(0);
    const reloadLibrary = () => setNonce(n => n + 1);

    const startUpload = async (files: Picked[]) => {
        if (!files.length || uploading) return;
        stopRef.current = false;
        const bytesTotal = files.reduce((n, p) => n + p.file.size, 0);
        setRun({ phase: 'running', total: files.length, done: 0, uploaded: 0, duplicates: 0, failed: [], bytesTotal, bytesDone: 0, current: '' });
        const failed: Failure[] = [];
        const inFlight = new Map<string, number>();
        let done = 0, uploaded = 0, duplicates = 0, bytesDone = 0;
        // Sent to storage, waiting for the batch to be confirmed: counted as uploaded on screen at once (owner
        // 2026-11-11: the count sat at 0 until a whole batch of 50 was through), and corrected by the confirmation.
        let awaiting = 0;
        // The last file named stays on its line. It used to be cleared between files, which took the line away and
        // put it back many times a second, and the whole panel jumped up and down with it (owner 2026-11-11).
        let lastName = '';
        const report = (current = '') => {
            if (current) lastName = current;
            let sending = 0;
            for (const n of inFlight.values()) sending += n;
            patchRun({ done, uploaded: uploaded + awaiting, duplicates, failed: [...failed], bytesDone: bytesDone + sending, current: lastName });
        };
        const giveUp = (p: Picked, reason: string) => { failed.push({ key: p.key, name: p.file.name, reason }); done += 1; bytesDone += p.file.size; };

        for (let i = 0; i < files.length && !stopRef.current; i += RESUME_BATCH) {
            const chunk = files.slice(i, i + RESUME_BATCH);
            const hashes = new Map<string, string>();
            await pool(chunk, PARALLEL, async p => {
                if (stopRef.current) return;
                try { hashes.set(p.key, await sha256Hex(p.file)); } catch { giveUp(p, 'Could not read the file'); }
                report(p.file.name);
            });
            if (stopRef.current) break;
            const toSend = chunk.filter(p => hashes.has(p.key));
            if (!toSend.length) continue;

            const prepared = await api<{ files: PreparedUpload[] }>('/api/candidates/resumes', {
                json: {
                    orgId,
                    files: toSend.map((p, index) => ({
                        index, name: p.file.name, size: p.file.size, sha256: hashes.get(p.key),
                        modifiedAt: new Date(p.file.lastModified).toISOString(), folder: p.folder,
                    })),
                },
            });
            if (!prepared.ok) {
                if (prepared.noAccess) { reportError(prepared); return; }
                for (const p of toSend) giveUp(p, prepared.error);
                report();
                if (prepared.status === 503) break; // the database update is missing: no point going on
                continue;
            }

            const uploads: { p: Picked; slot: PreparedUpload }[] = [];
            for (const slot of prepared.data.files) {
                const p = toSend[slot.index];
                if (!p) continue;
                if (slot.outcome === 'duplicate') { duplicates += 1; done += 1; bytesDone += p.file.size; }
                else if (slot.outcome === 'rejected' || !slot.signedUrl || !slot.id) giveUp(p, slot.reason ?? 'Rejected');
                else uploads.push({ p, slot });
            }
            report();

            const sent = new Map<string, Picked>();
            await pool(uploads, PARALLEL, async ({ p, slot }) => {
                if (stopRef.current) return;
                let result: string = 'The upload did not go through';
                for (let attempt = 1; attempt <= ATTEMPTS && !stopRef.current; attempt += 1) {
                    result = await putFile(
                        slot.signedUrl as string, p.file, slot.contentType ?? p.file.type,
                        bytes => { inFlight.set(p.key, bytes); report(p.file.name); },
                        xhr => { if (xhr) xhrs.current.add(xhr); else xhrs.current.forEach(x => { if (x.readyState === 4) xhrs.current.delete(x); }); },
                    );
                    if (result === 'ok' || result === 'cancelled') break;
                    await sleep(1000 * attempt);
                }
                inFlight.delete(p.key);
                if (result === 'ok') { sent.set(slot.id as string, p); done += 1; bytesDone += p.file.size; awaiting += 1; }
                else if (result !== 'cancelled') giveUp(p, result);
                report();
            });

            if (sent.size) {
                const ids = [...sent.keys()];
                const confirmed = await api<ResumeConfirmResponse>('/api/candidates/resumes/confirm', { json: { orgId, ids } });
                awaiting -= ids.length;
                if (!confirmed.ok) {
                    for (const id of ids) { const p = sent.get(id) as Picked; failed.push({ key: p.key, name: p.file.name, reason: confirmed.error }); }
                } else {
                    uploaded += confirmed.data.ready.length;
                    for (const id of confirmed.data.missing) { const p = sent.get(id); if (p) failed.push({ key: p.key, name: p.file.name, reason: 'Did not reach storage; try again' }); }
                }
                report();
            }
        }
        xhrs.current.clear();
        if (!mounted.current) return;
        patchRun({ phase: stopRef.current ? 'stopped' : 'done', current: '' });
        reloadLibrary();
        if (uploaded) notify(`${formatCount(uploaded)} ${uploaded === 1 ? 'resume' : 'resumes'} uploaded`, 'success');
    };

    const stopUpload = () => { stopRef.current = true; xhrs.current.forEach(x => x.abort()); };
    const retryFailed = () => {
        if (!run?.failed.length) return;
        const keys = new Set(run.failed.map(f => f.key));
        void startUpload(picked.filter(p => keys.has(p.key)));
    };

    // Leaving the page mid-upload loses the rest of the run; the browser asks first.
    useEffect(() => {
        if (!uploading) return;
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [uploading]);

    // ---- the library -------------------------------------------------------------------------------------------------
    const [preset, setPreset] = useState<Preset>('year');
    const [custom, setCustom] = useState({ from: '', to: '' });
    const [deviceFilter, setDeviceFilter] = useState('');
    const [linkFilter, setLinkFilter] = useState<LinkFilter>('');
    const [q, setQ] = useState('');
    const [qDebounced, setQDebounced] = useState('');
    useEffect(() => { const t = setTimeout(() => setQDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
    const listRange = useMemo(() => {
        if (preset === 'all') return { from: null, to: null };
        if (preset === 'year') { const r = thisYearRange(); return { from: new Date(r.from).toISOString(), to: new Date(r.to).toISOString() }; }
        const f = startOfDay(custom.from);
        const t = endOfDay(custom.to);
        return { from: f ? new Date(f).toISOString() : null, to: t ? new Date(t).toISOString() : null };
    }, [preset, custom]);
    const listParams = useMemo(
        () => ({ orgId, from: listRange.from, to: listRange.to, q: qDebounced, device: deviceFilter, link: linkFilter }),
        [orgId, listRange, qDebounced, deviceFilter, linkFilter],
    );
    const filtersKey = JSON.stringify(listParams);
    // The page belongs to one set of filters: a changed filter starts again at page 1 without an effect.
    const [pageState, setPageState] = useState({ key: filtersKey, page: 1 });
    const page = pageState.key === filtersKey ? pageState.page : 1;
    const setPage = (next: (p: number) => number) => setPageState({ key: filtersKey, page: Math.max(1, next(page)) });

    const key = JSON.stringify([listParams, page, nonce]);
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<ResumeFilesResponse>(`/api/candidates/resumes${qs({ ...listParams, page, pageSize: PAGE_SIZE })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { if (res.noAccess) reportError(res); setLoaded({ key, data: null, error: res.error }); return; }
            setLoaded({ key, data: res.data, error: '' });
        });
        return () => ctrl.abort();
    }, [key, listParams, page, reportError]);
    const loading = loaded?.key !== key;
    const files = loaded?.data?.files ?? [];
    const total = loaded?.data?.total ?? 0;

    // Tick boxes (owner 2026-11-10): the selection belongs to one page of one filter; another page starts empty.
    const [markedState, setMarkedState] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] });
    const marked = markedState.key === key ? markedState.ids : [];
    const setMarked = (ids: string[]) => setMarkedState({ key, ids });
    const toggleMarked = (id: string) => setMarked(marked.includes(id) ? marked.filter(x => x !== id) : [...marked, id]);
    const allOnPage = files.length > 0 && files.every(f => marked.includes(f.id));

    useEffect(() => {
        const ctrl = new AbortController();
        void api<ResumeSummary>(`/api/candidates/resumes/summary${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (!ctrl.signal.aborted && res.ok) setSummary(res.data);
        });
        return () => ctrl.abort();
    }, [orgId, nonce]);

    // Live progress while the background readers work (text, scanned files, then details; see POLL_MS / NUDGE_MS above).
    const stillToDo = (summary?.textPending ?? 0) + (summary?.extractPending ?? 0);
    const reading = stillToDo > 0;
    useEffect(() => {
        if (!reading) return;
        const ctrl = new AbortController();
        const t = setTimeout(() => {
            void Promise.all([
                api<ResumeSummary>(`/api/candidates/resumes/summary${qs({ orgId })}`, { signal: ctrl.signal }),
                api<ResumeFilesResponse>(`/api/candidates/resumes${qs({ ...listParams, page, pageSize: PAGE_SIZE })}`, { signal: ctrl.signal }),
            ]).then(([s, l]) => {
                if (ctrl.signal.aborted) return;
                if (s.ok) setSummary(s.data);
                if (l.ok) setLoaded({ key, data: l.data, error: '' });
            });
        }, POLL_MS);
        return () => { clearTimeout(t); ctrl.abort(); };
    }, [reading, summary, orgId, listParams, page, key]);
    useEffect(() => {
        if (!reading) return;
        let running = false;
        const nudge = () => {
            if (running) return;
            running = true;
            void api('/api/candidates/resumes/read', { json: { orgId } }).finally(() => { running = false; });
        };
        const t = setInterval(nudge, NUDGE_MS);
        return () => clearInterval(t);
    }, [reading, orgId]);

    // The few files that need a person (owner 2026-11-11): text or details that could not be read, and the documents
    // kept aside. Asked again after an upload or a delete, and when the background reading finishes.
    const [attention, setAttention] = useState<{ files: ResumeFile[]; total: number; others: ResumeFile[]; otherTotal: number } | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void Promise.all([
            api<ResumeFilesResponse>(`/api/candidates/resumes${qs({ orgId, link: 'attention', pageSize: ATTENTION_ROWS })}`, { signal: ctrl.signal }),
            api<ResumeFilesResponse>(`/api/candidates/resumes${qs({ orgId, link: 'other', pageSize: OTHER_ROWS })}`, { signal: ctrl.signal }),
        ]).then(([a, o]) => {
            if (ctrl.signal.aborted) return;
            setAttention({ files: a.ok ? a.data.files : [], total: a.ok ? a.data.total : 0, others: o.ok ? o.data.files : [], otherTotal: o.ok ? o.data.total : 0 });
        });
        return () => ctrl.abort();
    }, [orgId, nonce, reading]);
    // Ticked rows of the Needs attention list; a row that is gone (deleted, or read since) drops out by itself.
    const [attnMarkedIds, setAttnMarkedIds] = useState<string[]>([]);
    const attnRows = attention ? [...attention.files, ...attention.others] : [];
    const attnMarked = attnRows.filter(f => attnMarkedIds.includes(f.id));
    const attnAll = attnRows.length > 0 && attnMarked.length === attnRows.length;
    const toggleAttn = (id: string) => setAttnMarkedIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));
    const listRef = useRef<HTMLElement | null>(null);
    const showInList = (link: LinkFilter) => { setPreset('all'); setLinkFilter(link); listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

    /** Open reads the file (a PDF in the browser's viewer, a .docx as a page); download saves the original. */
    const openFile = (f: ResumeFile, inline = true) => { window.open(`/api/candidates/resumes/${encodeURIComponent(f.id)}${qs({ orgId, inline })}`, '_blank', 'noopener'); };

    const [deleteTargets, setDeleteTargets] = useState<ResumeFile[]>([]);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const askDelete = (targets: ResumeFile[]) => { if (targets.length) { setDeleteTargets(targets); setDeleteOpen(true); } };
    const doDelete = async () => {
        if (!deleteTargets.length) return;
        setDeleteBusy(true);
        const res = await api<{ deleted: number }>('/api/candidates/resumes/delete', { json: { orgId, ids: deleteTargets.map(f => f.id) } });
        if (!mounted.current) return;
        setDeleteBusy(false);
        if (!res.ok) { reportError(res); return; }
        setDeleteOpen(false);
        notify(deleteTargets.length === 1 ? `${deleteTargets[0].fileName} deleted` : `${formatCount(res.data.deleted)} files deleted`, 'success');
        setMarked([]);
        setAttnMarkedIds([]);
        reloadLibrary();
    };

    // ---- download all (ZIP) ------------------------------------------------------------------------------------------
    const [zip, setZip] = useState<Zip | null>(null);
    const zipStop = useRef(false);
    const downloadZip = async () => {
        if (zip && zip.phase !== 'done') return;
        zipStop.current = false;
        const day = new Date().toISOString().slice(0, 10);
        const partName = (n: number) => (n === 1 ? `resumes-${day}.zip` : `resumes-${day}-part${n}.zip`);
        // Ask where to save first: the save dialog needs the click; the server calls come after.
        const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
        let writable: { write(c: Uint8Array): Promise<void>; close(): Promise<void> } | null = null;
        if (picker) {
            try { writable = await (await picker({ suggestedName: partName(1), types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }] })).createWritable(); }
            catch (e) { if ((e as { name?: string }).name === 'AbortError') return; writable = null; }
        }
        setZip({ done: 0, total: 0, part: 1, skipped: 0, phase: 'listing' });

        const manifest = await api<ResumeManifestResponse>(`/api/candidates/resumes/manifest${qs(listParams)}`);
        if (!manifest.ok) { reportError(manifest); setZip(null); await writable?.close().catch(() => undefined); return; }
        const all = manifest.data.files;
        if (!all.length) { notify('No resumes match these filters', 'info'); setZip(null); await writable?.close().catch(() => undefined); return; }
        if (manifest.data.truncated) notify(`Only the first ${formatCount(all.length)} files are included`, 'info');

        let part = 0;
        let chunks: Uint8Array[] = [];
        let writer = new ZipWriter(() => undefined); // replaced by openPart() below
        let closePart: () => Promise<void> = async () => undefined;
        const limitBytes = writable ? ZIP_MAX_BYTES : ZIP_PART_MEMORY;
        const openPart = () => {
            part += 1;
            const name = partName(part);
            if (part === 1 && writable) {
                const w = writable;
                writer = new ZipWriter(c => w.write(c));
                closePart = () => w.close();
            } else {
                chunks = [];
                writer = new ZipWriter(c => { chunks.push(c); });
                closePart = async () => { saveBlob(new Blob(chunks as BlobPart[], { type: 'application/zip' }), name); chunks = []; };
            }
            setZip(z => (z ? { ...z, part, total: all.length, phase: 'saving' } : z));
        };
        openPart();

        const used = new Set<string>();
        let done = 0, skipped = 0;
        for (let i = 0; i < all.length && !zipStop.current; i += RESUME_LINK_BATCH) {
            const batch = all.slice(i, i + RESUME_LINK_BATCH);
            const links = await api<ResumeLinksResponse>('/api/candidates/resumes/links', { json: { orgId, ids: batch.map(f => f.id) } });
            if (!links.ok) { skipped += batch.length; setZip(z => (z ? { ...z, skipped } : z)); continue; }
            const byId = new Map(links.data.links.map(l => [l.id, l.url]));
            const fetched: { file: typeof batch[number]; bytes: Uint8Array | null }[] = [];
            await pool(batch, PARALLEL, async file => {
                if (zipStop.current) return;
                const url = byId.get(file.id);
                let bytes: Uint8Array | null = null;
                if (url) {
                    try { const res = await fetch(url); if (res.ok) bytes = new Uint8Array(await res.arrayBuffer()); } catch { bytes = null; }
                }
                fetched.push({ file, bytes });
            });
            for (const { file, bytes } of fetched) {
                if (zipStop.current) break;
                if (!bytes) { skipped += 1; continue; }
                if (writer.entries >= ZIP_MAX_ENTRIES || writer.bytes + bytes.length > limitBytes) { await writer.finish(); await closePart(); openPart(); }
                await writer.add(uniqueZipName(file.fileName, used), bytes, file.downloadedAt ? new Date(file.downloadedAt) : new Date());
                done += 1;
            }
            setZip(z => (z ? { ...z, done, skipped } : z));
        }
        await writer.finish();
        await closePart();
        if (!mounted.current) return;
        setZip(z => (z ? { ...z, done, skipped, phase: 'done' } : z));
        if (zipStop.current) notify(`Stopped after ${formatCount(done)} files`, 'info');
        else notify(`${formatCount(done)} ${done === 1 ? 'file' : 'files'} saved${part > 1 ? ` in ${part} parts` : ''}${skipped ? `; ${formatCount(skipped)} could not be fetched` : ''}`, skipped ? 'info' : 'success');
    };

    // ---- render ------------------------------------------------------------------------------------------------------
    const deviceOptions = summary?.devices ?? [];
    const team = [...deviceOptions].filter(d => d.label).sort((a, b) => (b.lastUploadedAt ?? '').localeCompare(a.lastUploadedAt ?? ''));
    const textRead = summary ? summary.total - summary.textPending - summary.unreadable : 0;
    const detailsRead = summary ? summary.total - summary.extractPending - summary.unreadable : 0;
    const attentionCount = (attention?.total ?? 0) + (attention?.otherTotal ?? 0);
    const pageFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const pageTo = Math.min(total, page * PAGE_SIZE);

    return (
        <div className="space-y-6">
            <div className="grid items-start gap-x-4 gap-y-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            {/* Add resumes */}
            <section className={`${CARD} px-4 py-4 sm:px-6 sm:py-5`} aria-labelledby="resume-add-heading">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1">
                        <h2 id="resume-add-heading" className="font-display text-base font-semibold text-text-primary">Add resumes</h2>
                        <p className="mt-0.5 text-sm text-text-secondary">
                            {mine?.lastUploadedAt
                                ? <>You last uploaded on <span className="font-semibold text-text-primary">{formatDate(mine.lastUploadedAt)}</span> ({formatCount(mine.count)} {mine.count === 1 ? 'file' : 'files'} in all), so files downloaded since {formatDate(new Date(startOfDay(pickRange.from) ?? 0).toISOString())} are picked. </>
                                : summary ? 'This is your first upload, so files downloaded this year are picked. ' : null}
                            A file already stored is skipped, so uploading twice is safe.
                        </p>
                    </div>
                    {uploader && (
                        <p className="inline-flex h-10 max-w-full shrink-0 items-center gap-x-2 rounded-full bg-surface-elevated pl-1 pr-3.5 text-sm text-text-secondary ring-1 ring-inset ring-border-subtle" title="Your uploads are filed under your name, taken from your login">
                            <Avatar name={uploader} size="sm" />
                            <span className="truncate">Uploading as <span className="font-semibold text-text-primary">{uploader}</span></span>
                        </p>
                    )}
                </div>

                {/* Source folder (owner 2026-11-11): chosen once, shown here, read on every "Upload new resumes". */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl bg-surface-elevated px-4 py-3 ring-1 ring-inset ring-border-subtle">
                    <div className="flex min-w-0 flex-1 basis-72 items-start gap-x-3">
                        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-primary-dark shadow-[var(--w-shadow)]"><Folder className="h-4 w-4" aria-hidden /></span>
                        <div className="min-w-0">
                            <p className={LABEL}>Source folder (optional)</p>
                            {source.state === 'remembered' ? (
                                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                                    <span className="truncate font-semibold text-text-primary" title={source.name}>{source.name}</span>
                                    <Tag tone={source.allowed ? 'success' : 'neutral'} title={source.allowed ? 'The browser reads this folder without asking' : 'On the next upload the browser asks once whether this page may read the folder'}>
                                        {source.allowed ? 'Ready' : 'Browser will ask to allow'}
                                    </Tag>
                                </p>
                            ) : source.state === 'none' ? (
                                <p className="mt-0.5 text-sm font-semibold text-text-primary">Not set: the folder is asked for on each upload</p>
                            ) : source.state === 'unsupported' ? (
                                <p className="mt-0.5 text-sm font-semibold text-text-primary">Not available in this browser</p>
                            ) : (
                                <Skeleton className="mt-1 h-4 w-40 rounded" />
                            )}
                            <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
                                {source.state === 'remembered' ? (
                                    <>
                                        Upload new resumes reads this folder and the folders inside it, and sends the files downloaded since {formatDate(new Date(startOfDay(pickRange.from) ?? 0).toISOString())}. No file window opens.
                                        {!source.allowed && <> When the browser asks, choose &ldquo;Allow on every visit&rdquo; and it stops asking.</>}
                                    </>
                                ) : source.state === 'none' ? (
                                    <>Upload new resumes opens the folder window, and Downloads can be picked there. To skip that window, choose a folder inside Downloads here, such as a Resumes folder. The browser does not let a page remember Downloads itself.</>
                                ) : source.state === 'unsupported' ? (
                                    isBrave()
                                        ? <>Upload new resumes opens the folder window each time, and Downloads can be picked there. To keep a folder selected, open <span className="font-semibold text-text-primary">brave://flags</span>, turn on &ldquo;File System Access API&rdquo; and restart Brave, or use Chrome or Edge.</>
                                        : <>Upload new resumes opens the folder window each time, and Downloads can be picked there. Chrome and Edge can keep a folder inside Downloads selected.</>
                                ) : (
                                    <>Checking which folder this browser remembers.</>
                                )}
                            </p>
                        </div>
                    </div>
                    {(source.state === 'remembered' || source.state === 'none') && (
                        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2">
                            <button type="button" onClick={() => void chooseSource()} disabled={uploading || scanning} className={BTN_SECONDARY}>
                                <FolderOpen className="h-4 w-4" />{source.state === 'remembered' ? 'Change' : 'Choose folder'}
                            </button>
                            {source.state === 'remembered' && <button type="button" onClick={() => void forgetThisFolder()} disabled={uploading || scanning} className={BTN_GHOST}>Forget</button>}
                        </div>
                    )}
                </div>

                <div
                    onDragOver={e => { e.preventDefault(); if (!uploading && !scanning) setDropping(true); }}
                    onDragLeave={() => setDropping(false)}
                    onDrop={onDrop}
                    className={`mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border-2 border-dashed px-4 py-4 transition-colors ${dropping ? 'border-primary bg-primary/[.06]' : 'border-border bg-surface-elevated'}`}
                >
                    <div className="flex min-w-0 flex-1 basis-64 items-center gap-x-3">
                        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface text-primary-dark shadow-[var(--w-shadow)]"><Upload className="h-5 w-5" aria-hidden /></span>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-text-primary">{dropping ? 'Drop the files to review them' : 'Drop PDF or Word files here'}</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
                                {source.state === 'remembered'
                                    ? 'Or click Upload new resumes: it reads the source folder and sends what is new.'
                                    : 'Or click Upload new resumes and pick your Downloads folder: the files downloaded since your last upload are sent.'}
                                {' '}Keep this tab open while it uploads.
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                        <button type="button" onClick={() => void uploadNew()} disabled={uploading || scanning} className={BTN_PRIMARY}>
                            {scanning ? <Spinner className="h-4 w-4 text-white" /> : <FolderDown className="h-4 w-4" />}{scanning ? 'Reading the folder' : 'Upload new resumes'}
                        </button>
                        <button type="button" onClick={() => filesInput.current?.click()} disabled={uploading || scanning} className={BTN_GHOST}><FileText className="h-4 w-4" />Choose files</button>
                    </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-text-secondary">
                    <label htmlFor="resume-pick-from">Pick files downloaded from</label>
                    <input id="resume-pick-from" type="date" value={pickRange.from} max={pickRange.to} onChange={e => setPickRange(r => ({ ...r, from: e.target.value }))} className={FIELD} disabled={uploading} />
                    <label htmlFor="resume-pick-to">to</label>
                    <input id="resume-pick-to" type="date" value={pickRange.to} min={pickRange.from} onChange={e => setPickRange(r => ({ ...r, to: e.target.value }))} className={FIELD} disabled={uploading} />
                    {raw && !uploading && (
                        <button type="button" onClick={() => { setRaw(null); setOverrides({}); setRun(null); }} className={BTN_GHOST}><X className="h-4 w-4" />Clear the list</button>
                    )}
                    {/* webkitdirectory (folder picking) is not in React's typings, so it is set on the element itself. */}
                    <input ref={el => { folderInput.current = el; el?.setAttribute('webkitdirectory', ''); }} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden
                        onChange={e => takeFiles(fromFileList(e.target.files), true)} />
                    <input ref={filesInput} type="file" multiple accept=".pdf,.doc,.docx" className="sr-only" tabIndex={-1} aria-hidden onChange={e => takeFiles(fromFileList(e.target.files), false)} />
                </div>

                {raw && (
                    <div className="mt-5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
                            <p className="text-sm text-text-primary">
                                <span className="font-semibold tabular-nums">{formatCount(selected.length)}</span> of <span className="tabular-nums">{formatCount(picked.length)}</span> files ticked
                                {selected.length > 0 && <span className="text-text-secondary"> · {fmtSize(selectedBytes)}</span>}
                                {(counts.date > 0 || counts.type > 0 || counts.name > 0 || counts.size > 0) && (
                                    <span className="text-text-secondary">
                                        {counts.date > 0 && <> · {formatCount(counts.date)} outside the dates</>}
                                        {counts.type > 0 && <> · {formatCount(counts.type)} not PDF / Word</>}
                                        {counts.name > 0 && <> · {formatCount(counts.name)} look like other documents</>}
                                        {counts.size > 0 && <> · {formatCount(counts.size)} over 15 MB</>}
                                    </span>
                                )}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                                <Toggle checked={showAll} onChange={setShowAll} label="Show unticked" />
                                <button type="button" onClick={tickResumes} disabled={uploading} className={BTN_GHOST}>Tick resumes</button>
                                <button type="button" onClick={() => tickAll(true)} disabled={uploading} className={BTN_GHOST}>Tick all</button>
                                <button type="button" onClick={() => tickAll(false)} disabled={uploading} className={BTN_GHOST}>Untick all</button>
                            </div>
                        </div>

                        <div className={`${WELL} max-h-80 overflow-y-auto`}>
                            {visibleRows.length === 0 ? (
                                <p className="px-4 py-6 text-center text-sm text-text-secondary">{picked.length ? 'Nothing ticked. Tick the files to upload, or widen the dates.' : 'No files in that folder.'}</p>
                            ) : (
                                <ul className="divide-y divide-border-subtle">
                                    {visibleRows.slice(0, PICK_ROWS).map(p => (
                                        <li key={p.key} className="flex items-center gap-x-3 gap-y-3 px-3 py-2 text-sm">
                                            <button type="button" role="checkbox" aria-checked={p.ticked} aria-label={`${p.ticked ? 'Untick' : 'Tick'} ${p.file.name}`} onClick={() => tick(p.key, !p.ticked)} disabled={uploading || p.verdict === 'type' || p.verdict === 'size'}
                                                className="shrink-0 text-text-secondary disabled:opacity-40">
                                                {p.ticked ? <SquareCheck className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5" />}
                                            </button>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-text-primary" title={p.file.name}>{p.file.name}</span>
                                                {p.folder && <span className="block truncate text-xs text-text-tertiary" title={p.folder}>{p.folder}</span>}
                                            </span>
                                            <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-text-tertiary sm:block">{fmtSize(p.file.size)}</span>
                                            <span className="hidden w-24 shrink-0 text-right text-xs tabular-nums text-text-tertiary sm:block">{formatDate(new Date(p.file.lastModified).toISOString())}</span>
                                            <span className={`w-32 shrink-0 truncate text-right text-xs ${VERDICT_TONE[p.verdict]}`}>{p.verdict === 'ok' ? '' : PICK_LABELS[p.verdict]}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {visibleRows.length > PICK_ROWS && (
                                <p className="border-t border-border-subtle px-4 py-2 text-xs text-text-tertiary">and {formatCount(visibleRows.length - PICK_ROWS)} more (all of them count)</p>
                            )}
                        </div>

                        {run ? (
                            <div className={`${WELL} space-y-3 px-4 py-4`} aria-live="polite">
                                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
                                    <p className="text-sm font-semibold text-text-primary">
                                        {run.phase === 'running' ? <span className="inline-flex items-center gap-x-2 gap-y-2"><Spinner />Uploading</span>
                                            : run.phase === 'stopped' ? 'Stopped' : <span className="inline-flex items-center gap-x-2 gap-y-2"><CircleCheck className="h-4 w-4 text-success" />Finished</span>}
                                        <span className="ml-2 tabular-nums text-text-secondary">{formatCount(run.done)} / {formatCount(run.total)} files</span>
                                    </p>
                                    {run.phase === 'running' ? (
                                        <button type="button" onClick={stopUpload} className={BTN_GHOST}>Stop</button>
                                    ) : run.failed.length > 0 ? (
                                        <button type="button" onClick={retryFailed} className={BTN_SECONDARY}><Upload className="h-4 w-4" />Retry {formatCount(run.failed.length)} failed</button>
                                    ) : null}
                                </div>
                                <ProgressBar fraction={run.bytesTotal ? run.bytesDone / run.bytesTotal : 1} label="Upload progress" />
                                <dl className="grid grid-cols-3 gap-x-3 gap-y-3">
                                    <div><dt className={LABEL}>Uploaded</dt><dd className={`${NUM_SM} text-text-primary`}>{formatCount(run.uploaded)}</dd></div>
                                    <div><dt className={LABEL}>Already there</dt><dd className={`${NUM_SM} text-text-primary`}>{formatCount(run.duplicates)}</dd></div>
                                    <div><dt className={LABEL}>Failed</dt><dd className={`${NUM_SM} ${run.failed.length ? 'text-error' : 'text-text-primary'}`}>{formatCount(run.failed.length)}</dd></div>
                                </dl>
                                {/* Always there while it runs, at one fixed height: the panel must not change size as files go by. */}
                                {run.phase === 'running' && <p className="h-4 truncate text-xs leading-4 text-text-secondary" title={run.current || undefined}>{run.current || 'Getting the files ready'}</p>}
                                {run.phase === 'stopped' && run.total > run.done && <p className="text-xs text-text-secondary">{formatCount(run.total - run.done)} files were not sent. Click Upload to continue; files already sent are skipped.</p>}
                                {run.phase === 'done' && run.uploaded > 0 && (
                                    <p className="text-xs text-text-secondary">
                                        Each file&rsquo;s text is read in the background. A file that turns out not to be a resume (a job description, an invoice) is removed on its own; see &ldquo;Removed as not resumes&rdquo; in the list below.
                                    </p>
                                )}
                                {run.failed.length > 0 && run.phase !== 'running' && (
                                    <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-text-secondary">
                                        {run.failed.slice(0, 50).map(f => <li key={f.key} className="truncate"><span className="text-text-primary">{f.name}</span>: {f.reason}</li>)}
                                        {run.failed.length > 50 && <li>and {formatCount(run.failed.length - 50)} more</li>}
                                    </ul>
                                )}
                            </div>
                        ) : (
                            selected.length > 0 && (
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
                                    <button type="button" onClick={() => void startUpload(selected)} className={BTN_PRIMARY}>
                                        <Upload className="h-4 w-4" />Upload {formatCount(selected.length)} {selected.length === 1 ? 'file' : 'files'}
                                    </button>
                                    <span className="text-xs text-text-tertiary">{fmtSize(selectedBytes)} · keep this tab open until it finishes</span>
                                </div>
                            )
                        )}
                        {run && run.phase !== 'running' && selected.length > 0 && (
                            <button type="button" onClick={() => void startUpload(selected)} className={BTN_GHOST}><Upload className="h-4 w-4" />Upload the ticked files again</button>
                        )}
                    </div>
                )}
            </section>

            {/* Who uploaded last */}
            <section className={`${CARD} px-4 py-4`} aria-labelledby="resume-team-heading">
                <h2 id="resume-team-heading" className="text-sm font-semibold text-text-primary">Team uploads</h2>
                {!summary ? (
                    <div className="mt-3 space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}</div>
                ) : team.length === 0 ? (
                    <p className="mt-2 text-sm text-text-secondary">No one has uploaded yet. Each person&rsquo;s last upload will show here.</p>
                ) : (
                    <ul className="mt-2 divide-y divide-border-subtle">
                        {team.map(d => {
                            const late = d.lastUploadedAt ? daysSince(d.lastUploadedAt) >= RESUME_REMIND_AFTER_DAYS : false;
                            return (
                                <li key={d.label} className="flex items-center gap-x-3 py-2">
                                    <Avatar name={d.label ?? ''} size="sm" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-semibold text-text-primary">{d.label}{d.label === uploader && <span className="font-normal text-text-tertiary"> · you</span>}</span>
                                        <span className="block text-xs tabular-nums text-text-tertiary">{formatCount(d.count)} {d.count === 1 ? 'file' : 'files'}</span>
                                    </span>
                                    <Tag tone={late ? 'warn' : 'neutral'} title={d.lastUploadedAt ? `Last upload on ${formatDate(d.lastUploadedAt)}` : undefined}>{ago(d.lastUploadedAt)}</Tag>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
            </div>

            {/* How far the background reading is */}
            {summary && summary.total > 0 && (
                <section className={`${CARD} px-4 py-4 sm:px-6`} aria-label="Reading progress">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-text-primary" aria-live="polite">
                        {stillToDo > 0 ? (
                            <>
                                <Spinner className="h-3.5 w-3.5 text-text-tertiary" />
                                {summary.textPending > summary.scanPending ? 'Reading resumes and matching candidates' : summary.scanPending > 0 ? 'Typing out scanned resumes' : 'Reading details into candidates'}
                                <span className="font-normal text-text-secondary">· it runs in the background, you can leave this page</span>
                            </>
                        ) : (
                            <><CircleCheck className="h-4 w-4 text-success" aria-hidden />Every stored resume has been read</>
                        )}
                    </p>
                    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
                        <Stage label="Stored" value={summary.total} of={summary.total} hint={<>{fmtSize(summary.totalBytes)}{team.length > 0 && <> · from {formatCount(team.length)} {team.length === 1 ? 'person' : 'people'}</>}</>} />
                        <Stage label="Text read" value={textRead} of={summary.total}
                            hint={summary.textPending > 0
                                ? <>{formatCount(summary.textPending)} to go{summary.scanPending > 0 && <>, {formatCount(summary.scanPending)} of them scans</>}</>
                                : summary.unreadable > 0 ? <>{formatCount(summary.unreadable)} could not be read</> : 'all of them'} />
                        <Stage label="Linked to a candidate" value={summary.linked} of={summary.total} hint={summary.unlinked > 0 ? <>{formatCount(summary.unlinked)} not linked yet</> : 'all of them'} />
                        <Stage label="Details read" value={detailsRead} of={summary.total} hint={summary.extractPending > 0 ? <>{formatCount(summary.extractPending)} to go</> : 'education, skills, employers'} />
                    </dl>
                    {(summary.rejected > 0 || summary.other > 0) && (
                        <p className="mt-3 border-t border-border-subtle pt-2.5 text-xs text-text-secondary">
                            Not counted above:
                            {summary.rejected > 0 && <> <button type="button" onClick={() => showInList('rejected')} className="font-semibold text-primary-dark underline-offset-2 hover:underline">{formatCount(summary.rejected)} removed as not resumes</button></>}
                            {summary.rejected > 0 && summary.other > 0 && ' ·'}
                            {summary.other > 0 && <> <button type="button" onClick={() => showInList('other')} className="font-semibold text-primary-dark underline-offset-2 hover:underline">{formatCount(summary.other)} other {summary.other === 1 ? 'document' : 'documents'} kept</button></>}
                        </p>
                    )}
                </section>
            )}

            {/* The few files that need a person */}
            {attention && attentionCount > 0 && (
                <section className={`${CARD} overflow-hidden`} aria-labelledby="resume-attention-heading">
                    <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-subtle px-4 py-2 sm:px-6">
                        <div className="flex items-center gap-x-3">
                            <input type="checkbox" checked={attnAll} onChange={e => setAttnMarkedIds(e.target.checked ? attnRows.map(f => f.id) : [])} aria-label="Select every file that needs attention" title="Select all" className="h-4 w-4 shrink-0 accent-[var(--primary-dark)]" />
                            <h2 id="resume-attention-heading" className="flex items-center gap-x-2 font-display text-base font-semibold text-text-primary">
                                <CircleAlert className="h-4 w-4 text-warning" aria-hidden />Needs attention
                                <span className="rounded-full bg-surface-elevated px-2 py-0.5 font-body text-xs font-semibold tabular-nums text-text-secondary ring-1 ring-inset ring-border">{formatCount(attentionCount)}</span>
                            </h2>
                        </div>
                        {attnMarked.length > 0 ? (
                            <div className="flex items-center gap-x-1" aria-live="polite">
                                <span className="mr-1 text-sm font-semibold tabular-nums text-text-primary">{formatCount(attnMarked.length)} selected</span>
                                <button type="button" onClick={() => setAttnMarkedIds([])} className={BTN_GHOST}><X className="h-4 w-4" />Clear</button>
                                <button type="button" onClick={() => askDelete(attnMarked)} className={BTN_DANGER_GHOST}><Trash2 className="h-4 w-4" />Delete selected</button>
                            </div>
                        ) : (
                            <p className="text-xs text-text-secondary">Everything else was read, matched and filed by itself.</p>
                        )}
                    </div>
                    {/* About six rows tall, then it scrolls inside itself: the library below stays within reach. */}
                    <ul className="max-h-[348px] divide-y divide-border-subtle overflow-y-auto overscroll-contain">
                        {attnRows.map(f => {
                            const { kind, why } = attentionOf(f);
                            const on = attnMarkedIds.includes(f.id);
                            return (
                                <li key={f.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6 ${on ? 'bg-primary/[.04]' : ''}`}>
                                    <input type="checkbox" checked={on} onChange={() => toggleAttn(f.id)} aria-label={`Select ${f.fileName}`} className="h-4 w-4 shrink-0 accent-[var(--primary-dark)]" />
                                    <span className="w-36 shrink-0"><Tag tone={f.other ? 'neutral' : 'warn'}>{kind}</Tag></span>
                                    <div className="min-w-0 flex-1 basis-60">
                                        <p className="truncate text-sm font-semibold text-text-primary" title={f.fileName}>{f.fileName}</p>
                                        <p className="text-xs leading-relaxed text-text-secondary">{why}</p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-x-0.5">
                                        <button type="button" onClick={() => openFile(f)} className={BTN_GHOST}><FileText className="h-4 w-4" />Open</button>
                                        <button type="button" onClick={() => openFile(f, false)} className={BTN_GHOST} aria-label={`Download ${f.fileName}`} title="Download"><Download className="h-4 w-4" /></button>
                                        <button type="button" onClick={() => askDelete([f])} className={BTN_DANGER_GHOST} aria-label={`Delete ${f.fileName}`} title="Delete"><Trash2 className="h-4 w-4" /></button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    {(attention.total > attention.files.length || attention.otherTotal > attention.others.length) && (
                        <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border-subtle px-4 py-2.5 text-xs sm:px-6">
                            {attention.total > attention.files.length && <button type="button" onClick={() => showInList('attention')} className="font-semibold text-primary-dark underline-offset-2 hover:underline">Show all {formatCount(attention.total)} unread files in the list</button>}
                            {attention.otherTotal > attention.others.length && <button type="button" onClick={() => showInList('other')} className="font-semibold text-primary-dark underline-offset-2 hover:underline">Show all {formatCount(attention.otherTotal)} other documents in the list</button>}
                        </p>
                    )}
                    <p className="border-t border-border-subtle bg-surface-elevated px-4 py-2.5 text-xs leading-relaxed text-text-secondary sm:px-6">
                        A file that could not be read can still be attached to its candidate: open the candidate and use Attach a resume. An old .doc can be saved as .docx or PDF and uploaded again.
                    </p>
                </section>
            )}

            {/* The library */}
            <section ref={listRef} className="scroll-mt-4 space-y-3" aria-labelledby="resume-list-heading">
                <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-3">
                    <div>
                        <h2 id="resume-list-heading" className="font-display text-base font-semibold text-text-primary">Resumes in the database</h2>
                        {summary && (
                            <p className="mt-0.5 text-sm text-text-secondary">
                                <span className="font-semibold tabular-nums text-text-primary">{formatCount(summary.total)}</span> {summary.total === 1 ? 'file' : 'files'}
                                {summary.newest && <> · newest download {formatDate(summary.newest)}</>}
                                {' '}· the Excel and the ZIP follow the filters below
                            </p>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                        {marked.length > 0 && (
                            <button type="button" onClick={() => askDelete(files.filter(f => marked.includes(f.id)))} className={BTN_DANGER_GHOST}>
                                <Trash2 className="h-4 w-4" />Delete selected ({formatCount(marked.length)})
                            </button>
                        )}
                        <a href={`/api/candidates/resumes/export${qs(listParams)}`} className={BTN_SECONDARY} download><Download className="h-4 w-4" />Download Excel</a>
                        <button type="button" onClick={() => void downloadZip()} disabled={Boolean(zip && zip.phase !== 'done') || total === 0} className={BTN_SECONDARY}>
                            {zip && zip.phase !== 'done' ? <Spinner /> : <Archive className="h-4 w-4" />}
                            {zip && zip.phase === 'saving' ? `Saving ${formatCount(zip.done)} / ${formatCount(zip.total)}${zip.part > 1 ? ` (part ${zip.part})` : ''}` : zip?.phase === 'listing' ? 'Listing…' : 'Download all (ZIP)'}
                        </button>
                        {zip && zip.phase !== 'done' && <button type="button" onClick={() => { zipStop.current = true; }} className={BTN_GHOST}>Stop</button>}
                    </div>
                </div>

                <div className={`${CARD} flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-3`}>
                    <div role="group" aria-label="Download date" className="inline-grid grid-cols-3 gap-x-1 gap-y-1 rounded-xl bg-surface-elevated px-1 py-1 ring-1 ring-inset ring-border-subtle">
                        {([['year', 'This year'], ['all', 'All dates'], ['custom', 'Custom']] as const).map(([id, label]) => (
                            <button key={id} type="button" onClick={() => setPreset(id)} aria-pressed={preset === id}
                                className={`h-8 rounded-lg px-3 text-sm font-semibold transition-colors ${preset === id ? 'bg-surface text-text-primary shadow-[var(--w-shadow)]' : 'text-text-secondary hover:text-text-primary'}`}>
                                {label}
                            </button>
                        ))}
                    </div>
                    {preset === 'custom' && (
                        <>
                            <input type="date" aria-label="From" value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} className={FIELD} />
                            <input type="date" aria-label="To" value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} className={FIELD} />
                        </>
                    )}
                    <select aria-label="Uploaded by" value={deviceFilter} onChange={e => setDeviceFilter(e.target.value)} className={FIELD}>
                        <option value="">Uploaded by anyone</option>
                        {deviceOptions.map(d => <option key={d.label ?? 'none'} value={d.label ?? 'none'}>{d.label ?? 'Not named'} ({formatCount(d.count)})</option>)}
                    </select>
                    <select aria-label="Linked to a candidate" value={linkFilter} onChange={e => setLinkFilter(e.target.value as LinkFilter)} className={FIELD}>
                        <option value="">Linked or not</option>
                        <option value="linked">Linked to a candidate</option>
                        <option value="unlinked">Not linked yet</option>
                        <option value="attention">Could not be read</option>
                        <option value="rejected">Removed as not resumes</option>
                        <option value="other">Other documents (kept)</option>
                    </select>
                    <span className="relative min-w-[200px] flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
                        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search file names" aria-label="Search file names" className={`${INPUT} pl-9`} />
                    </span>
                </div>

                <div className={`${CARD} overflow-hidden`}>
                    {loaded?.error && !loading ? (
                        <div role="alert" className="flex flex-col items-center px-4 py-12 text-center">
                            <CircleAlert className="mb-3 h-8 w-8 text-error" aria-hidden />
                            <p className="max-w-md text-sm text-text-primary">{loaded.error}</p>
                            <button type="button" onClick={reloadLibrary} className={`${BTN_SECONDARY} mt-4`}>Try again</button>
                        </div>
                    ) : !loaded?.data && loading ? (
                        <div className="space-y-3 px-4 py-4 sm:p-6">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
                    ) : files.length === 0 ? (
                        <EmptyState icon={FileText} title={total === 0 && preset === 'year' && !qDebounced && !deviceFilter && summary && summary.total > 0 ? 'No resumes downloaded this year' : 'No resumes yet'}>
                            {summary && summary.total > 0 ? 'Change the dates or the other filters above.' : 'Upload the first ones from the panel above.'}
                        </EmptyState>
                    ) : (
                        <div className={`transition-opacity duration-200 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
                            <ul className="divide-y divide-border-subtle md:hidden">
                                {files.map(f => (
                                    <li key={f.id} className="space-y-1 px-4 py-3">
                                        <div className="flex items-start gap-x-2 gap-y-2">
                                            <input type="checkbox" checked={marked.includes(f.id)} onChange={() => toggleMarked(f.id)} aria-label={`Select ${f.fileName}`} className="mt-1 h-4 w-4 shrink-0 accent-[var(--primary-dark)]" />
                                            {f.removed
                                                ? <span className="block min-w-0 flex-1 truncate font-semibold text-text-secondary" title={f.fileName}>{f.fileName}</span>
                                                : <button type="button" onClick={() => openFile(f)} className="block min-w-0 flex-1 truncate text-left font-semibold text-text-primary hover:underline" title={f.fileName}>{f.fileName}</button>}
                                        </div>
                                        <p className="text-xs text-text-secondary">
                                            {fmtSize(f.fileSize)} · downloaded <span className="tabular-nums">{f.downloadedAt ? formatDate(f.downloadedAt) : '—'}</span>
                                        </p>
                                        <p className="text-xs text-text-secondary">
                                            {f.candidateName ? <>Linked to <span className="font-medium text-text-primary">{f.candidateName}</span></> : 'Not linked'} · <TextStatus f={f} />
                                        </p>
                                        <p className="text-xs text-text-tertiary">Uploaded by {f.deviceLabel ?? f.uploadedByEmail ?? 'someone'} · <span className="tabular-nums">{formatDate(f.createdAt)}</span></p>
                                        <div className="flex justify-end gap-x-1 gap-y-1">
                                            {!f.removed && (
                                                <>
                                                    <button type="button" onClick={() => openFile(f)} className={BTN_GHOST}><FileText className="h-4 w-4" />Open</button>
                                                    <button type="button" onClick={() => openFile(f, false)} className={BTN_GHOST} aria-label={`Download ${f.fileName}`}><Download className="h-4 w-4" /></button>
                                                </>
                                            )}
                                            <button type="button" onClick={() => askDelete([f])} className={BTN_DANGER_GHOST}><Trash2 className="h-4 w-4" />Delete</button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                            <div className="hidden overflow-x-auto md:block">
                                <table className="w-full min-w-[1040px] border-collapse text-sm">
                                    <thead className="bg-surface-elevated">
                                        <tr className={`${LABEL} text-left`}>
                                            <th scope="col" className="w-10 py-3 pl-4">
                                                <input type="checkbox" checked={allOnPage} onChange={e => setMarked(e.target.checked ? files.map(f => f.id) : [])} aria-label="Select every file on this page" className="h-4 w-4 accent-[var(--primary-dark)]" />
                                            </th>
                                            <th scope="col" className="px-3 py-3 font-semibold">File</th>
                                            <th scope="col" className="px-3 py-3 text-right font-semibold">Size</th>
                                            <th scope="col" className="px-3 py-3 font-semibold">Downloaded</th>
                                            <th scope="col" className="px-3 py-3 font-semibold">Candidate</th>
                                            <th scope="col" className="px-3 py-3 font-semibold">Text</th>
                                            <th scope="col" className="px-3 py-3 font-semibold">Uploaded by</th>
                                            <th scope="col" className="px-3 py-3 font-semibold">Uploaded</th>
                                            <th scope="col" className="sticky right-0 bg-surface-elevated px-4 py-3 shadow-[-1px_0_0_var(--border-subtle)]"><span className="sr-only">Actions</span></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border-subtle">
                                        {files.map(f => (
                                            <tr key={f.id} className={`group align-middle hover:bg-surface-elevated ${marked.includes(f.id) ? 'bg-primary/[.04]' : ''}`}>
                                                <td className="py-3 pl-4">
                                                    <input type="checkbox" checked={marked.includes(f.id)} onChange={() => toggleMarked(f.id)} aria-label={`Select ${f.fileName}`} className="h-4 w-4 accent-[var(--primary-dark)]" />
                                                </td>
                                                <td className="max-w-[360px] px-3 py-3">
                                                    {f.removed
                                                        ? <span className="block truncate font-semibold text-text-secondary" title={f.fileName}>{f.fileName}</span>
                                                        : <button type="button" onClick={() => openFile(f)} className="block w-full truncate text-left font-semibold text-text-primary hover:underline" title={f.fileName}>{f.fileName}</button>}
                                                    {f.folderPath && <p className="truncate text-xs text-text-tertiary" title={f.folderPath}>{f.folderPath}</p>}
                                                </td>
                                                <td className={`${NUM_SM} whitespace-nowrap px-3 py-3 text-right text-text-secondary`}>{fmtSize(f.fileSize)}</td>
                                                <td className="whitespace-nowrap px-3 py-3 tabular-nums text-text-primary">{f.downloadedAt ? formatDate(f.downloadedAt) : <span className="text-text-tertiary">—</span>}</td>
                                                <td className="max-w-[200px] px-3 py-3">
                                                    {f.candidateName
                                                        ? <span className="block truncate font-medium text-text-primary" title={f.matchReason ? `Matched by ${MATCH_REASON_LABELS[f.matchReason].toLowerCase()}` : undefined}>{f.candidateName}</span>
                                                        : <span className="text-text-tertiary">—</span>}
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-3 text-xs"><TextStatus f={f} /></td>
                                                <td className="max-w-[200px] truncate px-3 py-3 text-text-secondary" title={f.uploadedByEmail ?? ''}>{f.deviceLabel ?? f.uploadedByEmail ?? '—'}</td>
                                                <td className="whitespace-nowrap px-3 py-3 tabular-nums text-text-secondary">{formatDate(f.createdAt)}</td>
                                                <td className="sticky right-0 whitespace-nowrap bg-surface px-4 py-3 shadow-[-1px_0_0_var(--border-subtle)] group-hover:bg-surface-elevated">
                                                    <div className="flex justify-end gap-0.5">
                                                        {!f.removed && (
                                                            <>
                                                                <button type="button" onClick={() => openFile(f)} className={BTN_GHOST}><FileText className="h-4 w-4" />Open</button>
                                                                <button type="button" onClick={() => openFile(f, false)} className={BTN_GHOST} aria-label={`Download ${f.fileName}`} title="Download"><Download className="h-4 w-4" /></button>
                                                            </>
                                                        )}
                                                        <button type="button" onClick={() => askDelete([f])} className={BTN_DANGER_GHOST} aria-label={`Delete ${f.fileName}`}><Trash2 className="h-4 w-4" /></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 border-t border-border-subtle px-4 py-3 text-sm text-text-secondary">
                                <span className="tabular-nums">Showing {formatCount(pageFrom)}–{formatCount(pageTo)} of {formatCount(total)}</span>
                                <div className="flex gap-x-1 gap-y-1">
                                    <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className={BTN_GHOST}>Previous</button>
                                    <button type="button" onClick={() => setPage(p => p + 1)} disabled={pageTo >= total} className={BTN_GHOST}>Next</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {summary && summary.total > 0 && (
                    <p className="text-xs text-text-tertiary">
                        Each file&rsquo;s text is read in the background and linked to the candidate with the same email or phone; a scanned file is typed out
                        first, then treated the same way. Education, industry, skills and employers are then read into the candidate&rsquo;s empty details, and a
                        resume that matches no one becomes a new candidate.
                    </p>
                )}
            </section>

            <Dialog
                open={deleteOpen}
                onClose={() => { if (!deleteBusy) setDeleteOpen(false); }}
                labelId="resume-delete-title"
                size="sm"
                title={deleteTargets.length === 1 ? 'Delete this file?' : `Delete ${formatCount(deleteTargets.length)} files?`}
                description={deleteTargets.length === 1 ? <span className="break-words">{deleteTargets[0].fileName}</span> : `${deleteTargets.slice(0, 3).map(f => f.fileName).join(', ')}${deleteTargets.length > 3 ? ` and ${formatCount(deleteTargets.length - 3)} more` : ''}`}
                footer={
                    <>
                        <button type="button" onClick={() => setDeleteOpen(false)} disabled={deleteBusy} className={BTN_SECONDARY}>Cancel</button>
                        <button type="button" onClick={() => void doDelete()} disabled={deleteBusy} className={`${BTN_PRIMARY} bg-error hover:bg-error`}>{deleteBusy ? <Spinner /> : <Trash2 className="h-4 w-4" />}Delete</button>
                    </>
                }
            >
                <p className="text-sm text-text-secondary">
                    {deleteTargets.length === 1 ? 'The file is' : 'The files are'} removed from the database for good. {deleteTargets.length === 1 ? 'It stays' : 'They stay'} on the laptop
                    {deleteTargets.length === 1 ? ' it' : ' they'} came from and can be uploaded again.
                </p>
            </Dialog>
        </div>
    );
}
