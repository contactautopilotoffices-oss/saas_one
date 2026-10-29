'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronUp, CircleAlert, CircleCheck, Download, File, FileArchive, FileCode,
    FileImage, FileSpreadsheet, FileText, Film, Folder, FolderPlus, LoaderCircle, Music, Plus, Presentation, Search, Trash2, Upload, X,
} from 'lucide-react';

/**
 * Files (owner 2026-10-29): the shared drive of the Design and Tech consoles, styled like Google Drive.
 * Click selects, double-click (or Enter) opens a folder / downloads a file, Delete key deletes. Files upload straight to
 * private storage through a one-time link from /api/shared-files; the server checks who may do what.
 */

export type FilesTeam = 'design' | 'tech';

interface Item {
    id: string; kind: 'folder' | 'file'; name: string; sizeBytes: number | null; mimeType: string | null;
    team: FilesTeam; createdByName: string; updatedAt: string; itemCount: number | null;
}
interface Crumb { id: string; name: string }
type Result<T> = ({ ok: true } & T) | { ok: false; error: string; code?: string };

interface UploadJob {
    key: string; name: string; parentId: string | null; file: globalThis.File;
    status: 'waiting' | 'uploading' | 'done' | 'failed' | 'cancelled'; progress: number; error?: string; xhr?: XMLHttpRequest;
}

const MAX_BYTES = 200 * 1024 * 1024;
const PARALLEL_UPLOADS = 3;
const FONT = { fontFamily: '"Google Sans", "Google Sans Text", Roboto, Arial, sans-serif' };

const fmtSize = (b: number | null) => {
    if (b === null) return '—';
    if (b < 1024) return `${b} bytes`;
    if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
    return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

/** Drive style: a time for today, "29 Oct" this year, "29 Oct 2025" before. */
function fmtDate(iso: string) {
    const d = new Date(iso), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString('en-IN', d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

const ext = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
const TYPES: Array<[RegExp, React.ComponentType<{ className?: string }>, string]> = [
    [/^pdf$/, FileText, 'text-[#EA4335]'],
    [/^(png|jpe?g|gif|webp|svg|bmp|tiff?|heic|avif)$/, FileImage, 'text-[#EA4335]'],
    [/^(mp4|mov|avi|mkv|webm|m4v)$/, Film, 'text-[#EA4335]'],
    [/^(mp3|wav|m4a|aac|ogg|flac)$/, Music, 'text-[#EA4335]'],
    [/^(xlsx?|csv|ods|numbers)$/, FileSpreadsheet, 'text-[#188038]'],
    [/^(docx?|txt|rtf|odt|pages|md)$/, FileText, 'text-[#4285F4]'],
    [/^(pptx?|key|odp)$/, Presentation, 'text-[#F9AB00]'],
    [/^(zip|rar|7z|tar|gz|tgz|apk|ipa)$/, FileArchive, 'text-[#5F6368]'],
    [/^(fig|psd|ai|sketch|xd|dwg|dxf|indd|eps|skp)$/, File, 'text-[#A142F4]'],
    [/^(js|ts|tsx|jsx|json|html|css|py|sql|sh|xml|ya?ml)$/, FileCode, 'text-[#5F6368]'],
];
function ItemIcon({ item, className = 'h-5 w-5' }: { item: Pick<Item, 'kind' | 'name'>; className?: string }) {
    if (item.kind === 'folder') return <Folder className={`${className} fill-[#444746] text-[#444746]`} aria-hidden />;
    const hit = TYPES.find(([re]) => re.test(ext(item.name)));
    const Icon = hit ? hit[1] : File;
    return <Icon className={`${className} ${hit ? hit[2] : 'text-[#5F6368]'}`} aria-hidden />;
}

export default function FilesTab({ orgId, team }: { orgId: string; team: FilesTeam }) {
    const base = `/api/shared-files?organization_id=${encodeURIComponent(orgId)}&team=${team}`;
    const call = useCallback(async <T,>(body?: Record<string, unknown>, extra = ''): Promise<Result<T>> => {
        try {
            const res = await fetch(base + extra, body
                ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
                : { cache: 'no-store' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) return { ok: false, error: data.error || 'That did not work', code: data.code };
            return { ok: true, ...(data as T) };
        } catch {
            return { ok: false, error: 'Could not reach the server. Please check the connection and try again.' };
        }
    }, [base]);

    const [folderId, setFolderId] = useState<string | null>(null);
    const [items, setItems] = useState<Item[]>([]);
    const [path, setPath] = useState<Crumb[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<{ message: string; notReady: boolean } | null>(null);
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState<{ key: 'name' | 'updatedAt' | 'sizeBytes'; dir: 1 | -1 }>({ key: 'name', dir: 1 });
    const [selected, setSelected] = useState<string | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [dialog, setDialog] = useState<null | { type: 'folder' } | { type: 'delete'; item: Item }>(null);
    const [folderName, setFolderName] = useState('');
    const [busy, setBusy] = useState(false);
    const [snack, setSnack] = useState<string | null>(null);
    const [jobs, setJobs] = useState<UploadJob[]>([]);
    const [panelOpen, setPanelOpen] = useState(true);
    const [dragDepth, setDragDepth] = useState(0);
    const fileInput = useRef<HTMLInputElement>(null);
    const folderRef = useRef<string | null>(null);
    useEffect(() => { folderRef.current = folderId; }, [folderId]);
    // Upload keys already started (an effect can run twice) and ones cancelled before their upload began
    const started = useRef(new Set<string>());
    const cancelled = useRef(new Set<string>());

    const toast = useCallback((m: string) => setSnack(m), []);
    useEffect(() => {
        if (!snack) return;
        const t = setTimeout(() => setSnack(null), 4000);
        return () => clearTimeout(t);
    }, [snack]);

    // Fetches the open folder whenever it changes or something asks for a reload. The spinner is switched on by whoever
    // asks for a different folder (initial state, openFolder, Try again); a reload after a change stays quiet.
    const [reloadKey, setReloadKey] = useState(0);
    const load = useCallback(() => setReloadKey(k => k + 1), []);
    useEffect(() => {
        let live = true;
        void call<{ items: Item[]; path: Crumb[] }>(undefined, folderId ? `&parent_id=${folderId}` : '').then(r => {
            if (!live) return;
            if (r.ok) { setItems(r.items); setPath(r.path); setLoadError(null); }
            else setLoadError({ message: r.error, notReady: r.code === 'NOT_READY' });
            setLoading(false);
        });
        return () => { live = false; };
    }, [call, folderId, reloadKey]);

    const openFolder = (id: string | null) => {
        if (id !== folderId) setLoading(true);
        setFolderId(id); setSelected(null); setQuery('');
    };

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items;
        return [...list].sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
            const { key, dir } = sort;
            const v = key === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
                : key === 'updatedAt' ? a.updatedAt.localeCompare(b.updatedAt) : (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0);
            return v * dir;
        });
    }, [items, query, sort]);

    const download = useCallback(async (item: Item) => {
        const r = await call<{ url: string }>({ action: 'download_url', id: item.id });
        if (!r.ok) return toast(r.error);
        const a = document.createElement('a');
        a.href = r.url;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
    }, [call, toast]);

    const activate = (item: Item) => (item.kind === 'folder' ? openFolder(item.id) : void download(item));

    // ---- uploads -------------------------------------------------------------------------------------------------
    const patchJob = (key: string, patch: Partial<UploadJob>) => setJobs(js => js.map(j => (j.key === key ? { ...j, ...patch } : j)));

    const runJob = useCallback(async (job: UploadJob) => {
        patchJob(job.key, { status: 'uploading', progress: 0 });
        const link = await call<{ id: string; signedUrl: string }>({ action: 'upload_url', name: job.name, size: job.file.size, mimeType: job.file.type || null, parentId: job.parentId });
        if (!link.ok) return patchJob(job.key, { status: 'failed', error: link.error });
        if (cancelled.current.has(job.key)) { void call({ action: 'delete', id: link.id }); return; }

        const sent = await new Promise<'ok' | 'cancelled' | string>(resolve => {
            const xhr = new XMLHttpRequest();
            patchJob(job.key, { xhr });
            xhr.open('PUT', link.signedUrl);
            // Same request supabase-js uploadToSignedUrl makes; done by hand so the progress bar can move
            xhr.setRequestHeader('x-upsert', 'false');
            const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
            if (anon) { xhr.setRequestHeader('apikey', anon); xhr.setRequestHeader('Authorization', `Bearer ${anon}`); }
            xhr.upload.onprogress = e => { if (e.lengthComputable) patchJob(job.key, { progress: e.loaded / e.total }); };
            xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300 ? 'ok'
                : xhr.status === 413 ? 'The file is larger than storage allows.' : 'The upload did not go through. Please try again.');
            xhr.onerror = () => resolve('The connection dropped during the upload. Please try again.');
            xhr.onabort = () => resolve('cancelled');
            const body = new FormData();
            body.append('cacheControl', '3600');
            body.append('', job.file);
            xhr.send(body);
        });
        if (sent === 'cancelled') {
            void call({ action: 'delete', id: link.id });
            return patchJob(job.key, { status: 'cancelled', xhr: undefined });
        }
        if (sent !== 'ok') {
            void call({ action: 'delete', id: link.id });
            return patchJob(job.key, { status: 'failed', error: sent, xhr: undefined });
        }
        const done = await call({ action: 'complete', id: link.id });
        if (!done.ok) return patchJob(job.key, { status: 'failed', error: done.error, xhr: undefined });
        patchJob(job.key, { status: 'done', progress: 1, xhr: undefined });
        if (folderRef.current === job.parentId) load();
    }, [call, load]);

    // Starts waiting uploads while fewer than PARALLEL_UPLOADS are running
    useEffect(() => {
        const running = jobs.filter(j => j.status === 'uploading').length;
        const next = jobs.filter(j => j.status === 'waiting' && !started.current.has(j.key)).slice(0, Math.max(0, PARALLEL_UPLOADS - running));
        next.forEach(j => { started.current.add(j.key); void runJob(j); });
    }, [jobs, runJob]);

    const addFiles = (files: globalThis.File[]) => {
        if (!files.length) return;
        const fresh: UploadJob[] = files.map((file, i) => ({
            key: `${Date.now()}-${i}-${file.name}`, name: file.name, parentId: folderId, file,
            ...(file.size > MAX_BYTES
                ? { status: 'failed' as const, progress: 0, error: `Larger than 200 MB (${fmtSize(file.size)})` }
                : { status: 'waiting' as const, progress: 0 }),
        }));
        setJobs(js => [...js.filter(j => j.status === 'uploading' || j.status === 'waiting'), ...fresh]);
        setPanelOpen(true);
    };

    const active = jobs.filter(j => j.status === 'uploading' || j.status === 'waiting').length;
    const doneCount = jobs.filter(j => j.status === 'done').length;

    // ---- folder + delete -----------------------------------------------------------------------------------------
    const createFolder = async (e: React.FormEvent) => {
        e.preventDefault();
        const name = folderName.trim();
        if (!name || busy) return;
        setBusy(true);
        const r = await call({ action: 'create_folder', name, parentId: folderId });
        setBusy(false);
        if (!r.ok) return toast(r.error);
        setDialog(null);
        toast(`Folder "${name}" created`);
        load();
    };

    const confirmDelete = async (item: Item) => {
        if (busy) return;
        setBusy(true);
        const r = await call({ action: 'delete', id: item.id });
        setBusy(false);
        setDialog(null);
        if (!r.ok) return toast(r.error);
        setSelected(null);
        toast(`"${item.name}" deleted`);
        load();
    };

    useEffect(() => {
        if (!dialog && !menuOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDialog(null); setMenuOpen(false); } };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [dialog, menuOpen]);

    const sortHeader = (key: typeof sort.key, label: string, className = '') => {
        const on = sort.key === key;
        const Arrow = sort.dir === 1 ? ArrowUp : ArrowDown;
        return (
            <th scope="col" className={`h-12 px-2 text-left font-medium ${className}`} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => setSort(s => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-[#E9EEF6] ${on ? 'text-[#1F1F1F]' : 'text-[#444746]'}`}>
                    {label}{on && <Arrow className="h-4 w-4" />}
                </button>
            </th>
        );
    };

    const dragging = dragDepth > 0;

    return (
        <div style={FONT} className="relative rounded-3xl bg-[#F8FAFD] p-3 text-[#1F1F1F] md:p-4"
            onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragDepth(d => d + 1); } }}
            onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
            onDragLeave={() => setDragDepth(d => Math.max(0, d - 1))}
            onDrop={e => { e.preventDefault(); setDragDepth(0); addFiles(Array.from(e.dataTransfer.files)); }}>

            {/* Toolbar: New + search */}
            <div className="mb-3 flex flex-wrap items-center gap-3">
                <div className="relative">
                    <button type="button" onClick={() => setMenuOpen(o => !o)} aria-haspopup="menu" aria-expanded={menuOpen}
                        className="flex h-14 items-center gap-3 rounded-2xl bg-white pl-4 pr-5 text-sm font-medium shadow-[0_1px_2px_0_rgba(60,64,67,.3),0_1px_3px_1px_rgba(60,64,67,.15)] transition hover:bg-[#EDF2FA] hover:shadow-[0_1px_3px_0_rgba(60,64,67,.3),0_4px_8px_3px_rgba(60,64,67,.15)]">
                        <Plus className="h-6 w-6" /> New
                    </button>
                    {menuOpen && (
                        <>
                            <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 cursor-default" onClick={() => setMenuOpen(false)} />
                            <div role="menu" className="absolute left-0 z-50 mt-1 w-56 rounded-lg bg-white py-2 shadow-[0_2px_6px_2px_rgba(60,64,67,.15),0_1px_2px_0_rgba(60,64,67,.3)]">
                                <button type="button" role="menuitem" className="flex h-10 w-full items-center gap-4 px-4 text-sm hover:bg-[#F0F4F9]"
                                    onClick={() => { setMenuOpen(false); setFolderName('Untitled folder'); setDialog({ type: 'folder' }); }}>
                                    <FolderPlus className="h-5 w-5 text-[#444746]" /> New folder
                                </button>
                                <div className="my-2 border-t border-[#E1E3E1]" />
                                <button type="button" role="menuitem" className="flex h-10 w-full items-center gap-4 px-4 text-sm hover:bg-[#F0F4F9]"
                                    onClick={() => { setMenuOpen(false); fileInput.current?.click(); }}>
                                    <Upload className="h-5 w-5 text-[#444746]" /> File upload
                                </button>
                            </div>
                        </>
                    )}
                    <input ref={fileInput} type="file" multiple hidden onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
                </div>
                <label className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full bg-[#E9EEF6] px-4 transition focus-within:bg-white focus-within:shadow-[0_1px_3px_0_rgba(60,64,67,.3),0_4px_8px_3px_rgba(60,64,67,.15)] sm:max-w-xl">
                    <Search className="h-5 w-5 shrink-0 text-[#444746]" />
                    <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search in this folder" aria-label="Search in this folder"
                        className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[#444746]" />
                    {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="rounded-full p-1 hover:bg-black/5"><X className="h-5 w-5 text-[#444746]" /></button>}
                </label>
            </div>

            {/* List */}
            <div className="relative min-h-[420px] overflow-hidden rounded-2xl bg-white">
                <nav aria-label="Folder path" className="flex flex-wrap items-center gap-0.5 px-3 pt-3 pb-1">
                    <button type="button" onClick={() => openFolder(null)} className={`rounded-full px-3 py-1 text-[22px] leading-8 hover:bg-[#E9EEF6] ${path.length ? 'text-[#444746]' : 'text-[#1F1F1F]'}`}>Files</button>
                    {path.map((c, i) => (
                        <React.Fragment key={c.id}>
                            <ChevronRight className="h-5 w-5 text-[#444746]" />
                            <button type="button" onClick={() => openFolder(c.id)} className={`max-w-[16rem] truncate rounded-full px-3 py-1 text-[22px] leading-8 hover:bg-[#E9EEF6] ${i === path.length - 1 ? 'text-[#1F1F1F]' : 'text-[#444746]'}`}>{c.name}</button>
                        </React.Fragment>
                    ))}
                </nav>

                {loadError ? (
                    <div role="alert" className="flex flex-col items-center px-6 py-20 text-center">
                        <CircleAlert className="mb-3 h-10 w-10 text-[#B3261E]" />
                        <p className="max-w-md text-sm text-[#444746]">{loadError.message}</p>
                        {!loadError.notReady && <button type="button" onClick={() => { setLoading(true); load(); }} className="mt-4 h-10 rounded-full px-4 text-sm font-medium text-[#0B57D0] hover:bg-[#0B57D0]/[.08]">Try again</button>}
                    </div>
                ) : loading ? (
                    <div className="flex justify-center py-24"><LoaderCircle className="h-8 w-8 animate-spin text-[#0B57D0]" aria-label="Loading" /></div>
                ) : shown.length === 0 ? (
                    <div className="flex flex-col items-center px-6 py-20 text-center">
                        <Folder className="mb-4 h-16 w-16 fill-[#E9EEF6] text-[#C4C7C5]" aria-hidden />
                        <p className="text-[22px] text-[#1F1F1F]">{query ? 'No matching files' : 'Drop files here'}</p>
                        {!query && <p className="mt-1 text-sm text-[#444746]">or use the &ldquo;New&rdquo; button</p>}
                    </div>
                ) : (
                    <div className="overflow-x-auto px-2 pb-2">
                        <table className="w-full min-w-[320px] border-collapse text-sm">
                            <thead className="border-b border-[#E1E3E1] text-[#444746]">
                                <tr>
                                    {sortHeader('name', 'Name')}
                                    <th scope="col" className="hidden h-12 px-4 text-left font-medium md:table-cell">Owner</th>
                                    {sortHeader('updatedAt', 'Last modified', 'hidden sm:table-cell')}
                                    {sortHeader('sizeBytes', 'File size', 'hidden lg:table-cell')}
                                    <th scope="col" className="w-24"><span className="sr-only">Actions</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {shown.map(item => {
                                    const on = selected === item.id;
                                    return (
                                        <tr key={item.id} tabIndex={0} aria-selected={on}
                                            onClick={() => setSelected(item.id)}
                                            onDoubleClick={() => activate(item)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') activate(item);
                                                if (e.key === 'Delete') setDialog({ type: 'delete', item });
                                            }}
                                            className={`group cursor-default border-b border-[#E1E3E1] outline-none last:border-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0B57D0] ${on ? 'bg-[#C2E7FF]' : 'hover:bg-[#F0F4F9]'}`}>
                                            <td className="h-12 max-w-0 px-4">
                                                <div className="flex min-w-0 items-center gap-4">
                                                    <ItemIcon item={item} />
                                                    <span className="truncate font-medium" title={item.name}>{item.name}</span>
                                                </div>
                                            </td>
                                            <td className="hidden px-4 md:table-cell">
                                                <div className="flex items-center gap-2 whitespace-nowrap text-[#444746]">
                                                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${item.team === 'design' ? 'bg-[#F6D9F0] text-[#7D2A6B]' : 'bg-[#D3E3FD] text-[#0842A0]'}`}>
                                                        {item.createdByName[0]?.toUpperCase()}
                                                    </span>
                                                    <span className="truncate">{item.createdByName}</span>
                                                    <span className="text-xs text-[#747775]">{item.team === 'design' ? 'Design' : 'Tech'}</span>
                                                </div>
                                            </td>
                                            <td className="hidden whitespace-nowrap px-4 text-[#444746] tabular-nums sm:table-cell">{fmtDate(item.updatedAt)}</td>
                                            <td className="hidden whitespace-nowrap px-4 text-[#444746] tabular-nums lg:table-cell">{item.kind === 'folder' ? '—' : fmtSize(item.sizeBytes)}</td>
                                            <td className="px-2">
                                                <div className={`flex justify-end gap-1 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 ${on ? 'md:opacity-100' : ''}`}>
                                                    {item.kind === 'file' && (
                                                        <button type="button" onClick={e => { e.stopPropagation(); void download(item); }} aria-label={`Download ${item.name}`} title="Download"
                                                            className="flex h-10 w-10 items-center justify-center rounded-full text-[#444746] hover:bg-black/[.08]">
                                                            <Download className="h-5 w-5" />
                                                        </button>
                                                    )}
                                                    <button type="button" onClick={e => { e.stopPropagation(); setDialog({ type: 'delete', item }); }} aria-label={`Delete ${item.name}`} title="Delete"
                                                        className="flex h-10 w-10 items-center justify-center rounded-full text-[#444746] hover:bg-black/[.08]">
                                                        <Trash2 className="h-5 w-5" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {dragging && (
                    <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-[#0B57D0] bg-[#0B57D0]/[.06]">
                        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full bg-[#0B57D0] px-6 py-3 text-sm text-white shadow-lg">
                            <Upload className="h-5 w-5" /> Drop files to upload them to <span className="font-medium">{path[path.length - 1]?.name || 'Files'}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Dialogs */}
            {dialog && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) setDialog(null); }}>
                    <div role="dialog" aria-modal="true" aria-labelledby="files-dialog-title" style={FONT} className="w-full max-w-sm rounded-[28px] bg-white p-6 shadow-2xl">
                        {dialog.type === 'folder' ? (
                            <form onSubmit={createFolder}>
                                <h2 id="files-dialog-title" className="mb-4 text-2xl text-[#1F1F1F]">New folder</h2>
                                <input id="files-folder-name" autoFocus value={folderName} onChange={e => setFolderName(e.target.value)} maxLength={200} aria-label="Folder name"
                                    onFocus={e => e.currentTarget.select()}
                                    className="h-12 w-full rounded border border-[#747775] px-4 text-base outline-none focus:border-2 focus:border-[#0B57D0] focus:px-[15px]" />
                                <div className="mt-6 flex justify-end gap-2">
                                    <button type="button" onClick={() => setDialog(null)} className="h-10 rounded-full px-4 text-sm font-medium text-[#0B57D0] hover:bg-[#0B57D0]/[.08]">Cancel</button>
                                    <button type="submit" disabled={busy || !folderName.trim()} className="h-10 rounded-full px-4 text-sm font-medium text-[#0B57D0] hover:bg-[#0B57D0]/[.08] disabled:opacity-40">Create</button>
                                </div>
                            </form>
                        ) : (
                            <>
                                <h2 id="files-dialog-title" className="mb-4 break-words text-2xl text-[#1F1F1F]">Delete &ldquo;{dialog.item.name}&rdquo;?</h2>
                                <p className="text-sm text-[#444746]">
                                    {dialog.item.kind === 'folder' && dialog.item.itemCount ? 'Everything in this folder will be deleted too. ' : ''}
                                    It will be deleted for both teams and can&rsquo;t be restored.
                                </p>
                                <div className="mt-6 flex justify-end gap-2">
                                    <button type="button" onClick={() => setDialog(null)} className="h-10 rounded-full px-4 text-sm font-medium text-[#0B57D0] hover:bg-[#0B57D0]/[.08]">Cancel</button>
                                    <button type="button" autoFocus disabled={busy} onClick={() => void confirmDelete(dialog.item)} className="h-10 rounded-full px-4 text-sm font-medium text-[#B3261E] hover:bg-[#B3261E]/[.08] disabled:opacity-40">
                                        {busy ? 'Deleting…' : 'Delete'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Upload progress panel */}
            {jobs.length > 0 && (
                <div style={FONT} className="fixed bottom-0 right-4 z-[70] w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-t-2xl bg-white shadow-[0_4px_8px_3px_rgba(60,64,67,.15),0_1px_3px_rgba(60,64,67,.3)]">
                    <div className="flex h-14 items-center justify-between bg-[#F8FAFD] pl-6 pr-2">
                        <p className="text-base font-medium">
                            {active ? `Uploading ${active} item${active === 1 ? '' : 's'}` : `${doneCount} upload${doneCount === 1 ? '' : 's'} complete`}
                        </p>
                        <div className="flex">
                            <button type="button" onClick={() => setPanelOpen(o => !o)} aria-label={panelOpen ? 'Minimise' : 'Expand'} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-black/[.08]">
                                {panelOpen ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
                            </button>
                            {!active && (
                                <button type="button" onClick={() => setJobs([])} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-black/[.08]">
                                    <X className="h-5 w-5" />
                                </button>
                            )}
                        </div>
                    </div>
                    {panelOpen && (
                        <ul className="max-h-72 overflow-y-auto py-1">
                            {jobs.map(j => (
                                <li key={j.key} className="flex items-center gap-4 px-6 py-2.5">
                                    <ItemIcon item={{ kind: 'file', name: j.name }} />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm" title={j.name}>{j.name}</p>
                                        {j.status === 'failed' && <p className="text-xs text-[#B3261E]">{j.error}</p>}
                                        {j.status === 'cancelled' && <p className="text-xs text-[#444746]">Cancelled</p>}
                                        {j.status === 'uploading' && (
                                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#E9EEF6]">
                                                <div className="h-full rounded-full bg-[#0B57D0] transition-[width]" style={{ width: `${Math.round(j.progress * 100)}%` }} />
                                            </div>
                                        )}
                                    </div>
                                    {j.status === 'done' && <CircleCheck className="h-5 w-5 shrink-0 fill-[#188038] text-white" aria-label="Uploaded" />}
                                    {j.status === 'failed' && <CircleAlert className="h-5 w-5 shrink-0 text-[#B3261E]" aria-label="Failed" />}
                                    {(j.status === 'uploading' || j.status === 'waiting') && (
                                        <button type="button" aria-label={`Cancel ${j.name}`} title="Cancel upload"
                                            onClick={() => {
                                                if (j.xhr) return j.xhr.abort();
                                                cancelled.current.add(j.key);
                                                patchJob(j.key, { status: 'cancelled' });
                                            }}
                                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#444746] hover:bg-black/[.08]">
                                            <X className="h-4 w-4" />
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {/* Snackbar */}
            {snack && (
                <div role="status" style={FONT} className="fixed bottom-6 left-4 z-[90] max-w-[calc(100vw-2rem)] rounded bg-[#303030] px-4 py-3.5 text-sm text-[#F2F2F2] shadow-lg lg:left-[19rem]">
                    {snack}
                </div>
            )}
        </div>
    );
}
