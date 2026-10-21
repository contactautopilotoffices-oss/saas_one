'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
    AlertCircle,
    Archive,
    ArrowLeft,
    CheckCircle2,
    ChevronDown,
    Download,
    FileText,
    History,
    Loader2,
    ArrowUpDown,
    RefreshCw,
    RotateCcw,
    Trash2,
    Upload,
    UploadCloud,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';

import { FRIENDLY_ERRORS, friendlyError } from '@/backend/lib/hr-assistant/friendly-errors';
import { BOT_NAME } from '@/backend/lib/hr-assistant/identity';

import { Button } from '@/frontend/components/ui/button';
import ConfirmModal from '@/frontend/components/ui/ConfirmModal';
import { Toast } from '@/frontend/components/ui/Toast';

import { BotFace } from './BotFace';

const ACCEPT = '.txt,.md,.pdf,.docx';
const MAX_UPLOAD_MB = 4;
const POLL_INTERVAL_MS = 3000;
const API = '/api/hr-assistant';

type VersionStatus = 'processing' | 'ready' | 'archived' | 'failed';

interface PolicyVersion {
    id: string;
    version: number;
    name: string;
    storage_path: string | null;
    size_bytes: number | null;
    status: VersionStatus;
    error: string | null;
    chunk_count: number;
    uploaded_by_email: string | null;
    created_at: string;
}

interface Policy {
    id: string;
    title: string;
    updated_at: string;
    versions: PolicyVersion[]; // newest first
}

interface PendingConfirm {
    title: string;
    message: string;
    confirmText: string;
    type: 'danger' | 'warning';
    run: () => void;
}

function formatSize(bytes: number | null): string {
    if (bytes === null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const formatDate = (iso: string) => dateFormatter.format(new Date(iso));

/** The server's error, in plain words (technical details stay in the server log). */
async function readError(res: Response, fallback: string): Promise<string> {
    const data = await res.json().catch(() => ({}));
    return friendlyError(data.error ?? fallback);
}

type SortKey = 'date' | 'az' | 'za';
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
    { value: 'date', label: 'Date' },
    { value: 'az', label: 'Name A–Z' },
    { value: 'za', label: 'Name Z–A' },
];
const SORT_STORAGE_KEY = 'hr-documents-sort';
// numeric: "Policy_2" sorts before "Policy_10".
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function readSavedSort(): SortKey {
    if (typeof window === 'undefined') return 'date';
    try {
        const saved = window.localStorage.getItem(SORT_STORAGE_KEY);
        return SORT_OPTIONS.some(option => option.value === saved) ? (saved as SortKey) : 'date';
    } catch {
        return 'date';
    }
}

/** "A.pdf, B.pdf and 3 more" */
function listNames(names: string[]): string {
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

const BADGE = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold';
const BADGE_LIVE = `${BADGE} bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300`;
const BADGE_FAILED = `${BADGE} bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300`;
const BADGE_INDEXING = `${BADGE} bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300`;

function StatusBadge({ version }: { version: PolicyVersion }) {
    switch (version.status) {
        case 'ready':
            return (
                <span className={BADGE_LIVE}>
                    <CheckCircle2 className="size-3.5" aria-hidden />
                    Live
                </span>
            );
        case 'archived':
            return (
                <span className={`${BADGE} bg-muted text-text-secondary`}>
                    <Archive className="size-3.5" aria-hidden />
                    Archived
                </span>
            );
        case 'failed':
            return (
                <span className={BADGE_FAILED}>
                    <AlertCircle className="size-3.5" aria-hidden />
                    Failed
                </span>
            );
        default:
            return (
                <span className={BADGE_INDEXING}>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    Indexing
                </span>
            );
    }
}

const ICON_BUTTON =
    'rounded-lg p-2 text-text-secondary transition hover:bg-muted hover:text-text-primary disabled:opacity-40';
const DANGER_ICON_BUTTON = `${ICON_BUTTON} hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40`;

export function HrDocumentManager({ orgId }: { orgId: string }) {
    const [policies, setPolicies] = useState<Policy[] | null>(null);
    const [uploading, setUploading] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null); // id of a policy/version being changed
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [dragging, setDragging] = useState(false);
    // Errors stay on screen until the next action; successes are a toast.
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    // Saved choice; the sort control only renders once policies have loaded (client-side), so
    // reading localStorage here can't cause a server/client mismatch.
    const [sort, setSortState] = useState<SortKey>(readSavedSort);
    const dropInputRef = useRef<HTMLInputElement>(null);
    const replaceInputRef = useRef<HTMLInputElement>(null);
    const replaceTarget = useRef<Policy | null>(null);
    // Status of each version at the last load, to announce when indexing finishes.
    const lastStatus = useRef(new Map<string, VersionStatus>());

    const notify = useCallback((kind: 'error' | 'success', text: string) => {
        if (kind === 'error') setError(text);
        else setSuccess(text);
    }, []);

    // Stable, so the toast's auto-close timer isn't reset by every re-render while polling.
    const closeSuccess = useCallback(() => setSuccess(null), []);

    const load = useCallback(async () => {
        try {
            const res = await fetch(`${API}/policies`, { cache: 'no-store' });
            if (!res.ok) throw new Error(await readError(res, "Couldn't load policies"));
            const next: Policy[] = (await res.json()).policies;

            for (const policy of next) {
                for (const version of policy.versions) {
                    if (lastStatus.current.get(version.id) !== 'processing') continue;
                    const label = `${policy.title} v${version.version}`;
                    if (version.status === 'ready') {
                        notify('success', `${label} is now live. ${BOT_NAME} uses it from now on.`);
                    } else if (version.status === 'archived') {
                        notify('success', `${label} finished indexing, but a newer version is already live.`);
                    } else if (version.status === 'failed') {
                        notify(
                            'error',
                            `${label} couldn't be added. ${friendlyError(version.error)} The previous version is still in use.`,
                        );
                    }
                }
            }
            lastStatus.current = new Map(next.flatMap(p => p.versions.map(v => [v.id, v.status] as const)));
            setPolicies(next);
        } catch (err) {
            setPolicies(prev => prev ?? []);
            notify('error', friendlyError(err instanceof Error ? err.message : "Couldn't load policies"));
        }
    }, [notify]);

    useEffect(() => {
        void load();
    }, [load]);

    // While anything is indexing, refresh until it's done.
    const anyProcessing = policies?.some(p => p.versions.some(v => v.status === 'processing')) ?? false;
    useEffect(() => {
        if (!anyProcessing) return;
        const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [anyProcessing, load]);

    function setSort(next: SortKey) {
        setSortState(next);
        try {
            window.localStorage.setItem(SORT_STORAGE_KEY, next);
        } catch {
            // Private mode or blocked storage: the choice just isn't remembered.
        }
    }

    const sortedPolicies = useMemo(() => {
        if (!policies) return null;
        if (sort === 'date') return policies; // the API returns most recently updated first
        const sorted = [...policies].sort((a, b) => byName.compare(a.title, b.title));
        return sort === 'za' ? sorted.reverse() : sorted;
    }, [policies, sort]);

    async function refresh() {
        if (refreshing) return;
        setRefreshing(true);
        setError(null);
        // Spin at least briefly so the click is visibly acknowledged, even on a fast reload.
        await Promise.all([load(), new Promise(resolve => setTimeout(resolve, 600))]);
        setRefreshing(false);
    }

    /** Upload files, either as new/matching policies or as new versions of `target`. */
    async function upload(files: File[], target: Policy | null) {
        if (uploading || files.length === 0) return;
        setError(null);
        const errors: { name: string; message: string }[] = [];
        for (const file of files) {
            if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
                errors.push({ name: file.name, message: `This file is larger than ${MAX_UPLOAD_MB} MB.` });
                continue;
            }
            setUploading(file.name);
            try {
                const body = new FormData();
                body.append('file', file);
                const url = target ? `${API}/policies/${target.id}/versions` : `${API}/policies`;
                const res = await fetch(url, { method: 'POST', body });
                if (!res.ok) {
                    errors.push({ name: file.name, message: await readError(res, 'Upload failed') });
                    continue;
                }
                const { version } = (await res.json()) as { version: PolicyVersion };
                lastStatus.current.set(version.id, version.status);
            } catch {
                errors.push({ name: file.name, message: FRIENDLY_ERRORS.network });
            }
        }
        setUploading(null);
        await load();

        const uploaded = files.length - errors.length;
        const uploadedText =
            uploaded > 0
                ? `${uploaded === 1 ? 'File uploaded' : `${uploaded} files uploaded`}. Indexing happens in the background. You can leave this page; the current version stays live until the new one is ready.`
                : '';
        // One line per distinct problem ("3 files weren't uploaded (A, B and C): ..."), not one per file.
        const byMessage = new Map<string, string[]>();
        for (const { name, message } of errors) byMessage.set(message, [...(byMessage.get(message) ?? []), name]);
        const errorText = [...byMessage]
            .map(([message, names]) =>
                names.length === 1
                    ? `${names[0]} wasn't uploaded. ${message}`
                    : `${names.length} files weren't uploaded (${listNames(names)}). ${message}`,
            )
            .join(' ');
        if (errors.length) notify('error', [errorText, uploadedText].filter(Boolean).join(' '));
        else notify('success', uploadedText);
    }

    async function act(id: string, request: () => Promise<Response>, successText: string, fallback: string) {
        setBusy(id);
        setError(null);
        try {
            const res = await request();
            if (!res.ok) throw new Error(await readError(res, fallback));
            notify('success', successText);
        } catch (err) {
            notify('error', friendlyError(err instanceof Error ? err.message : fallback));
        } finally {
            setBusy(null);
            await load();
        }
    }

    function restore(policy: Policy, version: PolicyVersion) {
        const live = policy.versions.find(v => v.status === 'ready');
        setConfirm({
            title: `Restore v${version.version}?`,
            message: live
                ? `The assistant will answer from v${version.version} of "${policy.title}" instead of v${live.version}.`
                : `v${version.version} of "${policy.title}" will become the live version.`,
            confirmText: 'Restore',
            type: 'warning',
            run: () =>
                void act(
                    version.id,
                    () => fetch(`${API}/versions/${version.id}/restore`, { method: 'POST' }),
                    `${policy.title}: v${version.version} is live again.`,
                    'Restore failed',
                ),
        });
    }

    function deleteVersion(policy: Policy, version: PolicyVersion) {
        setConfirm({
            title: `Delete v${version.version}?`,
            message: `This deletes v${version.version} of "${policy.title}". This can't be undone.`,
            confirmText: 'Delete version',
            type: 'danger',
            run: () =>
                void act(
                    version.id,
                    () => fetch(`${API}/versions/${version.id}`, { method: 'DELETE' }),
                    `Deleted v${version.version} of ${policy.title}.`,
                    'Delete failed',
                ),
        });
    }

    function deletePolicy(policy: Policy) {
        const count = policy.versions.length;
        setConfirm({
            title: `Delete "${policy.title}"?`,
            message: `This deletes the policy and all ${count} version${count === 1 ? '' : 's'}. The assistant will stop using it immediately. This can't be undone.`,
            confirmText: 'Delete policy',
            type: 'danger',
            run: () =>
                void act(
                    policy.id,
                    () => fetch(`${API}/policies/${policy.id}`, { method: 'DELETE' }),
                    `Deleted ${policy.title}.`,
                    'Delete failed',
                ),
        });
    }

    function toggleHistory(id: string) {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    function chooseReplacement(policy: Policy) {
        replaceTarget.current = policy;
        replaceInputRef.current?.click();
    }

    function onReplacementChosen(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = '';
        const target = replaceTarget.current;
        replaceTarget.current = null;
        if (file && target) {
            setExpanded(prev => new Set(prev).add(target.id));
            void upload([file], target);
        }
    }

    function onFilesChosen(event: ChangeEvent<HTMLInputElement>) {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        void upload(files, null);
    }

    function onDrop(event: DragEvent) {
        event.preventDefault();
        setDragging(false);
        void upload(Array.from(event.dataTransfer.files ?? []), null);
    }

    return (
        <section className="mx-auto w-full max-w-4xl space-y-6 px-4">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                    <BotFace className="mt-6 size-12 shrink-0" />
                    <div>
                        {/* HR roles have no dashboard; hr-tickets forwards org super admins to theirs. */}
                        <Link
                            href={`/${orgId}/hr-tickets?tab=tickets`}
                            className="mb-2 inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
                        >
                            <ArrowLeft className="size-4" aria-hidden />
                            Back to grievances
                        </Link>
                        <h1 className="font-display text-xl font-bold text-text-primary">HR policy documents</h1>
                        <p className="text-sm text-text-secondary">
                            {BOT_NAME}, the HR assistant, answers only from the live version of each policy. Use &ldquo;New
                            version&rdquo; to update a policy. Older versions are kept and can be restored.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {policies && policies.length > 1 && (
                        <label className="relative inline-flex items-center">
                            <span className="sr-only">Sort policies</span>
                            <ArrowUpDown className="pointer-events-none absolute left-2.5 size-4 text-text-secondary" aria-hidden />
                            <select
                                value={sort}
                                onChange={event => setSort(event.target.value as SortKey)}
                                className="h-8 cursor-pointer appearance-none rounded-[var(--radius-sm)] border border-border bg-surface pl-8 pr-3 text-sm font-medium text-text-primary transition-smooth hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                                {SORT_OPTIONS.map(option => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                    <Button
                        type="button"
                        variant="solid"
                        size="sm"
                        onClick={() => void refresh()}
                        disabled={refreshing}
                        aria-busy={refreshing}
                        className="gap-1.5"
                    >
                        <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
                        {refreshing ? 'Refreshing…' : 'Refresh'}
                    </Button>
                </div>
            </header>

            <div
                role="button"
                tabIndex={0}
                aria-label="Upload new policy documents"
                aria-disabled={Boolean(uploading)}
                onClick={() => !uploading && dropInputRef.current?.click()}
                onKeyDown={event => {
                    if ((event.key === 'Enter' || event.key === ' ') && !uploading) {
                        event.preventDefault();
                        dropInputRef.current?.click();
                    }
                }}
                onDragOver={event => {
                    event.preventDefault();
                    setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
                    dragging ? 'border-primary bg-primary/10' : 'border-border bg-surface hover:border-primary/50 hover:bg-primary/5'
                } ${uploading ? 'pointer-events-none opacity-70' : ''}`}
            >
                {uploading ? (
                    <>
                        <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
                        <p className="text-sm font-semibold text-text-primary">Uploading {uploading}...</p>
                    </>
                ) : (
                    <>
                        <UploadCloud className="size-8 text-primary" aria-hidden />
                        <p className="text-sm font-semibold text-text-primary">Drop new policy files here, or click to choose</p>
                        <p className="text-xs text-text-tertiary">
                            PDF, DOCX, TXT or MD · up to {MAX_UPLOAD_MB} MB each · a file with the same name as an existing
                            policy becomes its new version
                        </p>
                    </>
                )}
                <input ref={dropInputRef} type="file" accept={ACCEPT} multiple onChange={onFilesChosen} className="hidden" />
            </div>
            <input ref={replaceInputRef} type="file" accept={ACCEPT} onChange={onReplacementChosen} className="hidden" />

            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        role="alert"
                        className="flex items-start gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                    >
                        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                        {error}
                    </motion.div>
                )}
            </AnimatePresence>

            {policies === null ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-secondary">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Loading policies...
                </div>
            ) : policies.length === 0 ? (
                <p className="rounded-2xl border border-border bg-surface py-10 text-center text-sm text-text-secondary">
                    No policies yet. Upload your HR policy to get started.
                </p>
            ) : (
                <ul className="space-y-3">
                    <AnimatePresence initial={false}>
                        {(sortedPolicies ?? []).map(policy => {
                            const live = policy.versions.find(v => v.status === 'ready');
                            const indexing = policy.versions.find(v => v.status === 'processing');
                            const isOpen = expanded.has(policy.id);
                            return (
                                <motion.li
                                    key={policy.id}
                                    layout
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
                                >
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                                        <FileText className="size-5 shrink-0 text-primary" aria-hidden />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="truncate text-sm font-bold text-text-primary">{policy.title}</span>
                                                {live ? (
                                                    <span className={BADGE_LIVE}>
                                                        <CheckCircle2 className="size-3.5" aria-hidden />
                                                        Live: v{live.version}
                                                    </span>
                                                ) : (
                                                    !indexing && (
                                                        <span className={BADGE_FAILED}>
                                                            <AlertCircle className="size-3.5" aria-hidden />
                                                            No live version
                                                        </span>
                                                    )
                                                )}
                                                {indexing && (
                                                    <span className={BADGE_INDEXING}>
                                                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                                                        v{indexing.version} indexing
                                                    </span>
                                                )}
                                            </div>
                                            <p className="mt-0.5 text-xs text-text-tertiary">
                                                {policy.versions.length} version{policy.versions.length === 1 ? '' : 's'} · updated{' '}
                                                {formatDate(policy.updated_at)}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <Button
                                                type="button"
                                                variant="solid"
                                                size="sm"
                                                onClick={() => chooseReplacement(policy)}
                                                disabled={Boolean(uploading)}
                                                aria-label={`Upload a new version of ${policy.title}`}
                                                className="gap-1.5 text-xs"
                                            >
                                                <Upload className="size-3.5" aria-hidden />
                                                New version
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="solid"
                                                size="sm"
                                                onClick={() => toggleHistory(policy.id)}
                                                aria-expanded={isOpen}
                                                aria-controls={`history-${policy.id}`}
                                                aria-label={`Version history of ${policy.title}`}
                                                className="gap-1.5 text-xs"
                                            >
                                                <History className="size-3.5" aria-hidden />
                                                History
                                                <ChevronDown className={`size-3.5 transition ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                                            </Button>
                                            <button
                                                type="button"
                                                onClick={() => deletePolicy(policy)}
                                                disabled={busy === policy.id}
                                                aria-label={`Delete ${policy.title} and all its versions`}
                                                className={DANGER_ICON_BUTTON}
                                            >
                                                {busy === policy.id ? (
                                                    <Loader2 className="size-4 animate-spin" aria-hidden />
                                                ) : (
                                                    <Trash2 className="size-4" aria-hidden />
                                                )}
                                            </button>
                                        </div>
                                    </div>

                                    <AnimatePresence initial={false}>
                                        {isOpen && (
                                            <motion.ol
                                                id={`history-${policy.id}`}
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                className="divide-y divide-border-subtle border-t border-border bg-background"
                                            >
                                                {policy.versions.map(version => (
                                                    <li key={version.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 sm:pl-14">
                                                        <span className="w-8 shrink-0 text-xs font-bold text-text-tertiary">v{version.version}</span>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="truncate text-sm text-text-primary">{version.name}</span>
                                                                <StatusBadge version={version} />
                                                            </div>
                                                            <p className="mt-0.5 text-xs text-text-tertiary">
                                                                {[
                                                                    version.uploaded_by_email && `by ${version.uploaded_by_email}`,
                                                                    formatDate(version.created_at),
                                                                    formatSize(version.size_bytes),
                                                                    version.chunk_count > 0 && `${version.chunk_count} chunks`,
                                                                ]
                                                                    .filter(Boolean)
                                                                    .join(' · ')}
                                                            </p>
                                                            {version.status === 'failed' && version.error && (
                                                                <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{friendlyError(version.error)}</p>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            {version.status === 'archived' && (
                                                                <Button
                                                                    type="button"
                                                                    variant="solid"
                                                                    size="sm"
                                                                    onClick={() => restore(policy, version)}
                                                                    disabled={busy === version.id}
                                                                    aria-label={`Restore v${version.version}`}
                                                                    className="gap-1.5 text-xs"
                                                                >
                                                                    {busy === version.id ? (
                                                                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                                                                    ) : (
                                                                        <RotateCcw className="size-3.5" aria-hidden />
                                                                    )}
                                                                    Restore
                                                                </Button>
                                                            )}
                                                            {version.storage_path && (
                                                                <a
                                                                    href={`${API}/versions/${version.id}/download`}
                                                                    aria-label={`Download v${version.version} (${version.name})`}
                                                                    className={ICON_BUTTON}
                                                                >
                                                                    <Download className="size-4" aria-hidden />
                                                                </a>
                                                            )}
                                                            {(version.status === 'archived' || version.status === 'failed') && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => deleteVersion(policy, version)}
                                                                    disabled={busy === version.id}
                                                                    aria-label={`Delete v${version.version}`}
                                                                    className={DANGER_ICON_BUTTON}
                                                                >
                                                                    <Trash2 className="size-4" aria-hidden />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </li>
                                                ))}
                                            </motion.ol>
                                        )}
                                    </AnimatePresence>
                                </motion.li>
                            );
                        })}
                    </AnimatePresence>
                </ul>
            )}

            <ConfirmModal
                isOpen={confirm !== null}
                onClose={() => setConfirm(null)}
                onConfirm={() => {
                    confirm?.run();
                    setConfirm(null);
                }}
                title={confirm?.title ?? ''}
                message={confirm?.message ?? ''}
                confirmText={confirm?.confirmText}
                type={confirm?.type}
            />
            <Toast message={success ?? ''} type="success" visible={success !== null} onClose={closeSuccess} duration={6000} />
        </section>
    );
}
