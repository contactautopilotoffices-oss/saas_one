'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, ChevronUp, CircleAlert, CircleCheck, Copy, Download, Eye, Folder, FolderInput,
    FolderOpen, FolderPlus, FolderUp, Info, Link, LoaderCircle, MoreVertical, Pencil, Plus, RotateCcw, Search, Star, StickyNote, Trash2, Upload, X,
} from 'lucide-react';
import { Caller, Crumb, FONT, FilesTeam, Item, ItemIcon, Result, TextButton, baseName, ext, fmtDate, fmtSize, previewKind, teamLabel, typeLabel } from './shared';
import { ContextMenu, MenuEntry } from './ContextMenu';
import { MoveDialog } from './MoveDialog';
import { DetailsPanel } from './DetailsPanel';
import { PreviewOverlay } from './PreviewOverlay';

/**
 * Files (owner 2026-10-29): the shared drive of the Design and Tech consoles, styled like Google Drive.
 * Click selects, double-click (or Enter) opens a folder / previews or downloads a file. Files upload straight to
 * private storage through a one-time link from /api/shared-files; the server checks who may do what.
 *
 * Owner 2026-11-13 upgrade: right-click / ⋮ menu, rename (F2), move (dialog or drag onto a folder), make a copy,
 * multi-select (Ctrl / Shift / Ctrl+A) with a selection toolbar, folder upload, details panel, preview, personal
 * stars, copy link + deep links (?tab=files&folder=…), and a Bin with undo and restore. The Bin and stars switch on
 * once their migrations are applied (the server says so in `features`); until then delete stays permanent.
 */

export type { FilesTeam };

const MAX_NOTE_CHARS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UploadJob {
    key: string; name: string; parentId: string | null; file: globalThis.File;
    status: 'waiting' | 'uploading' | 'done' | 'failed' | 'cancelled'; progress: number; error?: string; xhr?: XMLHttpRequest;
}
interface Features { bin: boolean; stars: boolean; binDays: number }
type View = 'files' | 'bin';
type Snack = { text: string; action?: { label: string; run: () => void } } | null;
type Dialog = null | { type: 'folder' } | { type: 'delete'; items: Item[] } | { type: 'note'; item: Item } | { type: 'rename'; item: Item } | { type: 'move'; items: Item[] };
type Menu = null | { x: number; y: number; of: 'selection' | 'empty' | 'new' };

const MAX_BYTES = 200 * 1024 * 1024;
const PARALLEL_UPLOADS = 3;
/** Rows being dragged inside the list carry their ids under this type (never 'Files', so the upload overlay stays off). */
const DRAG_TYPE = 'application/x-shared-files';

/** A file dropped or picked from the computer, with the folders it came in (empty = straight into the target). */
interface Dropped { file: globalThis.File; dirs: string[] }

/** Reads a drop: plain files, or folders walked down to their files (Chrome, Edge, Safari, Firefox all support this). */
async function readDropped(dt: DataTransfer): Promise<Dropped[]> {
    // Entries must be taken synchronously, before the first await, or the browser forgets them
    const entries = Array.from(dt.items ?? []).map(i => (i.kind === 'file' && typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null));
    if (!entries.some(e => e?.isDirectory)) return Array.from(dt.files).map(file => ({ file, dirs: [] }));
    const out: Dropped[] = [];
    const walk = async (entry: FileSystemEntry, dirs: string[]) => {
        if (entry.isFile) {
            const file = await new Promise<globalThis.File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)).catch(() => null);
            if (file) out.push({ file, dirs });
        } else if (entry.isDirectory) {
            const reader = (entry as FileSystemDirectoryEntry).createReader();
            const all: FileSystemEntry[] = [];
            for (;;) {
                const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej)).catch(() => []);
                if (!batch.length) break;
                all.push(...batch);
            }
            for (const e of all) await walk(e, [...dirs, entry.name]);
        }
    };
    for (const e of entries) if (e) await walk(e, []);
    return out;
}

// Type column + Type filter: a file's extension, '' when it has none; folders get a key no extension can have
const FOLDER = '/folder';
const typeKey = (item: Pick<Item, 'kind' | 'name'>) => (item.kind === 'folder' ? FOLDER : ext(item.name));
const typeName = (key: string) => (key === FOLDER ? 'Folders' : key === '' ? 'No extension' : key.toUpperCase());

type SortKey = 'name' | 'type' | 'updatedAt' | 'sizeBytes';
const SORT_LABELS: Record<SortKey, string> = { name: 'Name', type: 'Type', updatedAt: 'Last modified', sizeBytes: 'File size' };

// Resizable columns, File Explorer style: drag a header's right edge, double-click it to fit the longest entry.
// Widths apply from sm up (phones keep the auto layout) and are remembered per browser.
type ColKey = SortKey | 'owner';
const DEFAULT_WIDTHS: Record<ColKey, number> = { name: 400, type: 96, owner: 240, updatedAt: 150, sizeBytes: 110 };
const minWidth = (k: ColKey) => (k === 'name' ? 140 : 64);
const MAX_WIDTH = 1200;
const WIDTHS_KEY = 'files-column-widths';
// Written out in full so Tailwind sees each class
const COL_WIDTH: Record<ColKey, string> = {
    name: 'sm:w-[var(--col-name)]', type: 'sm:w-[var(--col-type)]', owner: 'sm:w-[var(--col-owner)]',
    updatedAt: 'sm:w-[var(--col-updatedAt)]', sizeBytes: 'sm:w-[var(--col-sizeBytes)]',
};
function storedWidths() {
    const w = { ...DEFAULT_WIDTHS };
    try {
        const s = JSON.parse(window.localStorage.getItem(WIDTHS_KEY) || '{}');
        (Object.keys(w) as ColKey[]).forEach(k => { if (typeof s[k] === 'number' && s[k] >= minWidth(k) && s[k] <= MAX_WIDTH) w[k] = s[k]; });
    } catch { /* storage blocked or unreadable: defaults */ }
    return w;
}

let measureCanvas: HTMLCanvasElement | null = null;
function textWidth(el: HTMLElement) {
    const cs = getComputedStyle(el);
    const ctx = (measureCanvas ??= document.createElement('canvas')).getContext('2d');
    if (!ctx) return el.scrollWidth;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return ctx.measureText(el.textContent ?? '').width;
}
const padX = (el: HTMLElement) => { const cs = getComputedStyle(el); return parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight); };
/** Width a cell needs to show everything: its padding plus, along its [data-fit-row], the full text of [data-fit] and the size of everything else. */
function fitWidth(cell: HTMLElement) {
    const row = cell.querySelector<HTMLElement>('[data-fit-row]');
    if (!row) return padX(cell) + textWidth(cell);
    const kids = Array.from(row.children) as HTMLElement[];
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    return padX(cell) + padX(row) + gap * Math.max(0, kids.length - 1)
        + kids.reduce((sum, k) => sum + ('fit' in k.dataset ? textWidth(k) : k.offsetWidth), 0);
}

const MODIFIED = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['year', 'This year'], ['lastYear', 'Last year']] as const;
type Modified = typeof MODIFIED[number][0];
function modifiedWithin(iso: string, m: Modified) {
    const d = new Date(iso), now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (m === 'today') return d.getTime() >= today;
    if (m === '7d') return d.getTime() >= today - 6 * 864e5;
    if (m === '30d') return d.getTime() >= today - 29 * 864e5;
    if (m === 'year') return d.getFullYear() === now.getFullYear();
    return d.getFullYear() === now.getFullYear() - 1;
}

/** Drive-style filter chip: outlined when off, filled with an X to clear when on; opens a menu below it. */
function Chip({ label, active, open, onToggle, onClear, align = 'left', children }: {
    label: React.ReactNode; active: boolean; open: boolean; onToggle: () => void; onClear?: () => void; align?: 'left' | 'right'; children: React.ReactNode;
}) {
    const clearable = active && onClear;
    return (
        <div className="relative">
            <div className={`flex h-8 items-center rounded-lg border text-sm font-medium ${active ? 'border-transparent bg-[#C2E7FF] text-[#001D35]' : 'border-[#747775] text-[#444746]'}`}>
                <button type="button" onClick={onToggle} aria-haspopup="menu" aria-expanded={open}
                    className={`flex h-full items-center gap-1.5 pl-3 hover:bg-black/[.06] ${clearable ? 'rounded-l-lg pr-1' : 'rounded-lg pr-2'}`}>
                    {label}<ChevronDown className="h-4 w-4" />
                </button>
                {clearable && (
                    <button type="button" onClick={onClear} aria-label="Clear filter" className="mr-1 flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/[.08]">
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>
            {open && (
                <>
                    <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 cursor-default" onClick={onToggle} />
                    <div role="menu" className={`absolute z-50 mt-1 max-h-80 min-w-[12rem] overflow-y-auto rounded-lg bg-white py-2 shadow-[0_2px_6px_2px_rgba(60,64,67,.15),0_1px_2px_0_rgba(60,64,67,.3)] ${align === 'right' ? 'right-0' : 'left-0'}`}>
                        {children}
                    </div>
                </>
            )}
        </div>
    );
}

/** A chip that is simply on or off (Starred, Bin). */
function ToggleChip({ icon: Icon, label, active, onClick, title }: { icon: React.ComponentType<{ className?: string }>; label: string; active: boolean; onClick: () => void; title?: string }) {
    return (
        <button type="button" onClick={onClick} aria-pressed={active} title={title}
            className={`flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium ${active ? 'border-transparent bg-[#C2E7FF] text-[#001D35]' : 'border-[#747775] text-[#444746] hover:bg-black/[.06]'}`}>
            <Icon className={`h-4 w-4 ${active && Icon === Star ? 'fill-current' : ''}`} />{label}
        </button>
    );
}

function MenuOption({ checked, onClick, hint, children }: { checked: boolean; onClick: () => void; hint?: React.ReactNode; children: React.ReactNode }) {
    return (
        <button type="button" role="menuitemradio" aria-checked={checked} onClick={onClick}
            className="flex h-10 w-full items-center gap-3 whitespace-nowrap px-4 text-left text-sm hover:bg-[#F0F4F9]">
            <Check className={`h-4 w-4 shrink-0 ${checked ? 'text-[#1F1F1F]' : 'invisible'}`} />
            <span className="flex flex-1 items-center gap-3">{children}</span>
            {hint !== undefined && <span className="pl-4 text-xs tabular-nums text-[#747775]">{hint}</span>}
        </button>
    );
}

/** Round icon button used in rows and the selection toolbar. */
function IconBtn({ label, onClick, disabled, className = '', children }: { label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; disabled?: boolean; className?: string; children: React.ReactNode }) {
    return (
        <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} onKeyDown={e => e.stopPropagation()}
            className={`flex h-10 w-10 items-center justify-center rounded-full text-[#444746] hover:bg-black/[.08] disabled:opacity-40 ${className}`}>
            {children}
        </button>
    );
}

const describe = (t: Item[]) => (t.length === 1 ? `"${t[0].name}"` : `${t.length} items`);
const fromUrl = (k: string) => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(k));

export default function FilesTab({ orgId, team }: { orgId: string; team: FilesTeam }) {
    const base = `/api/shared-files?organization_id=${encodeURIComponent(orgId)}&team=${team}`;
    const call = useCallback<Caller>(async <T,>(body?: Record<string, unknown>, extra = ''): Promise<Result<T>> => {
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

    // Deep link (owner 2026-11-13): ?folder=<id> opens that folder, &bin=1 opens the Bin. First paint is a spinner either way.
    const [folderId, setFolderId] = useState<string | null>(() => { const f = fromUrl('folder'); return f && UUID.test(f) ? f : null; });
    const [view, setView] = useState<View>(() => (fromUrl('bin') === '1' ? 'bin' : 'files'));
    const [items, setItems] = useState<Item[]>([]);
    const [path, setPath] = useState<Crumb[]>([]);
    const [features, setFeatures] = useState<Features>({ bin: false, stars: false, binDays: 30 });
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<{ message: string; notReady: boolean } | null>(null);
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
    // Filters stay on when moving between folders, like Drive
    const [typeFilter, setTypeFilter] = useState<string | null>(null);
    const [teamFilter, setTeamFilter] = useState<FilesTeam | null>(null);
    const [modified, setModified] = useState<Modified | null>(null);
    const [starFilter, setStarFilter] = useState(false);
    const [openChip, setOpenChip] = useState<null | 'type' | 'team' | 'modified' | 'sort'>(null);
    const filtering = typeFilter !== null || teamFilter !== null || modified !== null || starFilter;
    const clearFilters = () => { setTypeFilter(null); setTeamFilter(null); setModified(null); setStarFilter(false); };
    const toggleChip = (c: NonNullable<typeof openChip>) => setOpenChip(o => (o === c ? null : c));

    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const anchor = useRef<string | null>(null);
    const [menu, setMenu] = useState<Menu>(null);
    const [dialog, setDialog] = useState<Dialog>(null);
    const [folderName, setFolderName] = useState('');
    const [noteText, setNoteText] = useState('');
    const [renameText, setRenameText] = useState('');
    const [busy, setBusy] = useState(false);
    const [snack, setSnack] = useState<Snack>(null);
    const [jobs, setJobs] = useState<UploadJob[]>([]);
    const [panelOpen, setPanelOpen] = useState(true);
    const [dragDepth, setDragDepth] = useState(0);
    const [dropTarget, setDropTarget] = useState<{ id: string | null; name: string } | null>(null);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [preview, setPreview] = useState<{ item: Item; url: string } | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const dirInput = useRef<HTMLInputElement>(null);
    const newButton = useRef<HTMLButtonElement>(null);
    const folderRef = useRef<string | null>(null);
    useEffect(() => { folderRef.current = folderId; }, [folderId]);
    const dragIds = useRef<string[]>([]);
    // Upload keys already started (an effect can run twice) and ones cancelled before their upload began
    const started = useRef(new Set<string>());
    const cancelled = useRef(new Set<string>());

    const toast = useCallback((text: string, action?: NonNullable<Snack>['action']) => setSnack({ text, action }), []);
    useEffect(() => {
        if (!snack) return;
        const t = setTimeout(() => setSnack(null), snack.action ? 7000 : 4000);
        return () => clearTimeout(t);
    }, [snack]);

    // Fetches the open folder (or the Bin) whenever it changes or something asks for a reload. The spinner is switched on
    // by whoever asks for a different place (initial state, openFolder, Try again); a reload after a change stays quiet.
    const [reloadKey, setReloadKey] = useState(0);
    const load = useCallback(() => setReloadKey(k => k + 1), []);
    useEffect(() => {
        let live = true;
        const extra = view === 'bin' ? '&view=bin' : folderId ? `&parent_id=${folderId}` : '';
        void call<{ items: Item[]; path: Crumb[]; features?: Features }>(undefined, extra).then(r => {
            if (!live) return;
            if (r.ok) { setItems(r.items); setPath(r.path); if (r.features) setFeatures(r.features); setLoadError(null); }
            else setLoadError({ message: r.error, notReady: r.code === 'NOT_READY' });
            setLoading(false);
        });
        return () => { live = false; };
    }, [call, folderId, view, reloadKey]);

    // The address bar follows the open folder / the Bin, so the page can be refreshed or the link copied
    useEffect(() => {
        const u = new URL(window.location.href);
        if (u.searchParams.get('tab') !== 'files') return;
        if (folderId) u.searchParams.set('folder', folderId); else u.searchParams.delete('folder');
        if (view === 'bin') u.searchParams.set('bin', '1'); else u.searchParams.delete('bin');
        if (u.toString() !== window.location.href) window.history.replaceState(window.history.state, '', u.toString());
    }, [folderId, view]);

    // A selection never outlives its items (after a move, delete or folder change)
    useEffect(() => {
        setSelected(s => { const keep = new Set([...s].filter(id => items.some(i => i.id === id))); return keep.size === s.size ? s : keep; });
    }, [items]);

    const openFolder = (id: string | null) => {
        if (id !== folderId || view !== 'files') setLoading(true);
        setView('files'); setFolderId(id); setSelected(new Set()); setQuery('');
    };
    const openBin = (on: boolean) => {
        if ((view === 'bin') !== on) setLoading(true);
        setView(on ? 'bin' : 'files'); setSelected(new Set()); setQuery(''); setStarFilter(false);
    };

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = items.filter(i => (!q || i.name.toLowerCase().includes(q))
            && (typeFilter === null || typeKey(i) === typeFilter)
            && (teamFilter === null || i.team === teamFilter)
            && (!starFilter || i.starred)
            && (modified === null || modifiedWithin(view === 'bin' ? i.deletedAt ?? i.updatedAt : i.updatedAt, modified)));
        const byName = (a: Item, b: Item) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        const when = (i: Item) => (view === 'bin' ? i.deletedAt ?? i.updatedAt : i.updatedAt);
        return list.sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
            const { key, dir } = sort;
            // Same type sorts by name, so the list doesn't shuffle within a type; folders have no type to sort by
            if (key === 'type') return (a.kind === 'file' ? ext(a.name).localeCompare(ext(b.name)) * dir : 0) || byName(a, b);
            const v = key === 'name' ? byName(a, b)
                : key === 'updatedAt' ? when(a).localeCompare(when(b)) : (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0);
            return v * dir;
        });
    }, [items, query, sort, typeFilter, teamFilter, modified, starFilter, view]);

    const selectedItems = useMemo(() => items.filter(i => selected.has(i.id)), [items, selected]);
    const selectedFiles = selectedItems.filter(i => i.kind === 'file');
    const allStarred = selectedItems.length > 0 && selectedItems.every(i => i.starred);
    const detailsItem = selectedItems.length === 1 ? selectedItems[0] : null;
    const hereName = view === 'bin' ? 'Bin' : path[path.length - 1]?.name || 'Files';

    // Types in the open folder with counts: folders first, then extensions A–Z, no extension last.
    // The chosen type stays listed even when the folder has none of it, so it can be seen and changed.
    const typeOptions = useMemo(() => {
        const counts = new Map<string, number>();
        items.forEach(i => counts.set(typeKey(i), (counts.get(typeKey(i)) ?? 0) + 1));
        if (typeFilter !== null && !counts.has(typeFilter)) counts.set(typeFilter, 0);
        const rank = (k: string) => (k === FOLDER ? 0 : k === '' ? 2 : 1);
        return [...counts].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
    }, [items, typeFilter]);

    // ---- selection ------------------------------------------------------------------------------------------------
    const select = (item: Item, e: React.MouseEvent) => {
        if (e.shiftKey && anchor.current) {
            const ids = shown.map(i => i.id);
            const a = ids.indexOf(anchor.current), b = ids.indexOf(item.id);
            if (a >= 0 && b >= 0) { setSelected(new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1))); return; }
        }
        if (e.ctrlKey || e.metaKey) {
            setSelected(s => { const n = new Set(s); if (n.has(item.id)) n.delete(item.id); else n.add(item.id); return n; });
        } else setSelected(new Set([item.id]));
        anchor.current = item.id;
    };
    const selectOnly = (item: Item) => { setSelected(new Set([item.id])); anchor.current = item.id; };

    /** Right-click or ⋮ on a row: the row joins (or becomes) the selection and the menu opens there. */
    const openMenu = (e: React.MouseEvent, item: Item | null) => {
        e.preventDefault(); e.stopPropagation();
        if (item && !selected.has(item.id)) selectOnly(item);
        const el = e.currentTarget as HTMLElement;
        const at = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : (() => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.bottom + 4 }; })();
        setMenu({ ...at, of: item ? 'selection' : 'empty' });
    };

    // ---- downloads + preview ---------------------------------------------------------------------------------------
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
    const downloadMany = async (files: Item[]) => {
        for (const [i, f] of files.entries()) { if (i) await new Promise(r => setTimeout(r, 400)); await download(f); }
    };

    const openPreview = useCallback(async (item: Item) => {
        const r = await call<{ url: string }>({ action: 'download_url', id: item.id, inline: true });
        if (!r.ok) return toast(r.error);
        setPreview({ item, url: r.url });
    }, [call, toast]);
    const previewable = useMemo(() => shown.filter(i => previewKind(i)), [shown]);
    const previewAt = preview ? previewable.findIndex(i => i.id === preview.item.id) : -1;

    const activate = (item: Item) => {
        if (view === 'bin') return toast(`Restore the ${item.kind} to open it`);
        if (item.kind === 'folder') return openFolder(item.id);
        return previewKind(item) ? void openPreview(item) : void download(item);
    };

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

    const addFiles = (files: globalThis.File[], parentId: string | null = folderRef.current) => {
        if (!files.length) return;
        const fresh: UploadJob[] = files.map((file, i) => ({
            key: `${Date.now()}-${i}-${file.name}`, name: file.name, parentId, file,
            ...(file.size > MAX_BYTES
                ? { status: 'failed' as const, progress: 0, error: `Larger than 200 MB (${fmtSize(file.size)})` }
                : { status: 'waiting' as const, progress: 0 }),
        }));
        setJobs(js => [...js.filter(j => j.status === 'uploading' || j.status === 'waiting'), ...fresh]);
        setPanelOpen(true);
    };

    /**
     * Owner 2026-11-13, folder upload: makes the folders first (top level down, reusing ones already there by name),
     * then queues each file into its folder. Files that came without a folder go straight into the target.
     */
    const addDropped = async (list: Dropped[], parentId: string | null) => {
        addFiles(list.filter(d => !d.dirs.length).map(d => d.file), parentId);
        const nested = list.filter(d => d.dirs.length);
        if (!nested.length) return;
        if (view === 'bin') return toast('Leave the Bin to upload files');
        const paths = [...new Set(nested.flatMap(d => d.dirs.map((_, i) => d.dirs.slice(0, i + 1).join('/'))))].sort((a, b) => a.split('/').length - b.split('/').length);
        const idOf = new Map<string, string | null | false>([['', parentId]]);
        const existing = new Map<string | null, Map<string, string>>();
        let made = 0, failed: string | null = null;
        toast(`Creating ${paths.length} folder${paths.length === 1 ? '' : 's'}…`);
        for (const p of paths) {
            const parts = p.split('/');
            const parent = idOf.get(parts.slice(0, -1).join('/'));
            if (parent === false || parent === undefined) { idOf.set(p, false); continue; }
            if (!existing.has(parent)) {
                const r = await call<{ items: Item[] }>(undefined, `&folders=1${parent ? `&parent_id=${parent}` : ''}`);
                existing.set(parent, new Map(r.ok ? r.items.map(f => [f.name.toLowerCase(), f.id]) : []));
            }
            const name = parts[parts.length - 1];
            const have = existing.get(parent)!.get(name.toLowerCase());
            if (have) { idOf.set(p, have); continue; }
            const r = await call<{ id: string }>({ action: 'create_folder', name, parentId: parent });
            if (!r.ok) { idOf.set(p, false); failed ??= r.error; continue; }
            idOf.set(p, r.id); existing.get(parent)!.set(name.toLowerCase(), r.id); made++;
        }
        const ready = nested.filter(d => typeof idOf.get(d.dirs.join('/')) === 'string');
        const byFolder = new Map<string, globalThis.File[]>();
        for (const d of ready) { const pid = idOf.get(d.dirs.join('/')) as string; byFolder.set(pid, [...(byFolder.get(pid) ?? []), d.file]); }
        for (const [pid, files] of byFolder) addFiles(files, pid);
        if (made && (parentId === folderRef.current)) load();
        if (failed) toast(`Some folders could not be created: ${failed}`);
        else toast(`Uploading ${ready.length} file${ready.length === 1 ? '' : 's'} into ${paths.length} folder${paths.length === 1 ? '' : 's'}`);
    };

    const pickedFolder = (files: globalThis.File[]) => {
        void addDropped(files.map(file => {
            const rel = (file as globalThis.File & { webkitRelativePath?: string }).webkitRelativePath || '';
            return { file, dirs: rel.includes('/') ? rel.split('/').slice(0, -1) : [] };
        }), folderRef.current);
    };

    const active = jobs.filter(j => j.status === 'uploading' || j.status === 'waiting').length;
    const doneCount = jobs.filter(j => j.status === 'done').length;

    // ---- folder, rename, move, copy --------------------------------------------------------------------------------
    const newFolder = () => { setFolderName('Untitled folder'); setDialog({ type: 'folder' }); };
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

    const openRename = (item: Item) => { selectOnly(item); setRenameText(item.name); setDialog({ type: 'rename', item }); };
    const doRename = async (item: Item, text: string) => {
        const name = text.trim();
        if (!name || busy) return;
        if (name === item.name) return setDialog(null);
        setBusy(true);
        const r = await call<{ name: string }>({ action: 'rename', id: item.id, name });
        setBusy(false);
        if (!r.ok) return toast(r.error);
        setItems(list => list.map(i => (i.id === item.id ? { ...i, name: r.name, updatedAt: new Date().toISOString() } : i)));
        setDialog(null);
        toast(`Renamed to "${r.name}"`);
    };

    const moveIds = async (ids: string[], targetId: string | null, targetName: string) => {
        if (!ids.length) return false;
        const r = await call<{ moved: number }>({ action: 'move', ids, targetId });
        if (!r.ok) { toast(r.error); return false; }
        setSelected(new Set());
        load();
        toast(r.moved ? `Moved ${r.moved === 1 ? '1 item' : `${r.moved} items`} to ${targetName}` : 'Already there');
        return true;
    };

    const copyItem = async (item: Item) => {
        if (busy) return;
        setBusy(true);
        toast(item.kind === 'folder' ? `Copying "${item.name}" and everything in it…` : `Copying "${item.name}"…`);
        const r = await call<{ id: string; name: string }>({ action: 'copy', id: item.id });
        setBusy(false);
        if (!r.ok) return toast(r.error);
        load();
        toast(`Made "${r.name}"`);
    };

    const copyLink = async (id: string | null) => {
        const u = new URL(window.location.href);
        u.searchParams.set('tab', 'files');
        if (id) u.searchParams.set('folder', id); else u.searchParams.delete('folder');
        u.searchParams.delete('bin');
        try { await navigator.clipboard.writeText(u.toString()); toast('Link copied'); }
        catch { toast('Could not copy the link'); }
    };

    // ---- bin, delete, restore ---------------------------------------------------------------------------------------
    /** "Delete" with the Bin on: into the Bin at once, with Undo in the snackbar. Without it: the old confirm + delete for good. */
    const trashItems = async (target: Item[]) => {
        if (!target.length || busy) return;
        if (!features.bin) return setDialog({ type: 'delete', items: target });
        const ids = target.map(t => t.id);
        setBusy(true);
        const r = await call<{ trashed: number }>({ action: 'trash', ids });
        setBusy(false);
        if (!r.ok) return toast(r.error);
        setSelected(new Set());
        load();
        toast(`${describe(target)} moved to the Bin`, {
            label: 'Undo',
            run: async () => { const u = await call({ action: 'restore', ids }); if (!u.ok) return toast(u.error); toast('Restored'); load(); },
        });
    };

    const restoreItems = async (target: Item[]) => {
        if (!target.length || busy) return;
        setBusy(true);
        const r = await call<{ restored: number; toTop: number }>({ action: 'restore', ids: target.map(t => t.id) });
        setBusy(false);
        if (!r.ok) return toast(r.error);
        setSelected(new Set());
        load();
        toast(`Restored ${describe(target)}${r.toTop ? ' to Files (the folder it was in is gone)' : ''}`);
    };

    const confirmDelete = async (target: Item[]) => {
        if (busy) return;
        setBusy(true);
        const r = await call(target.length === 1 ? { action: 'delete', id: target[0].id } : { action: 'delete', ids: target.map(t => t.id) });
        setBusy(false);
        setDialog(null);
        if (!r.ok) return toast(r.error);
        setSelected(new Set());
        toast(`${describe(target)} deleted`);
        load();
    };

    // ---- notes + stars --------------------------------------------------------------------------------------------
    const openNote = (item: Item) => { selectOnly(item); setNoteText(item.note ?? ''); setDialog({ type: 'note', item }); };

    const saveNote = async (item: Item, text: string) => {
        if (busy) return;
        setBusy(true);
        const r = await call<{ note: string | null }>({ action: 'set_note', id: item.id, note: text });
        setBusy(false);
        if (!r.ok) return toast(r.error);
        setItems(list => list.map(i => (i.id === item.id ? { ...i, note: r.note } : i)));
        setDialog(null);
        toast(r.note ? 'Note saved' : 'Note removed');
    };

    /** Stars show at once and are confirmed one by one; the list reloads if any of them fails. */
    const starMany = async (target: Item[], starred: boolean) => {
        const ids = new Set(target.map(t => t.id));
        setItems(list => list.map(i => (ids.has(i.id) ? { ...i, starred } : i)));
        for (const t of target) {
            const r = await call({ action: 'set_star', id: t.id, starred });
            if (!r.ok) { toast(r.error); load(); return; }
        }
    };

    useEffect(() => {
        if (!dialog && !menu && !openChip) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDialog(null); setMenu(null); setOpenChip(null); } };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [dialog, menu, openChip]);

    // Keyboard, Drive style: Ctrl+A selects all, Delete bins the selection, F2 renames, Escape clears
    const onKeyDown = (e: React.KeyboardEvent) => {
        const t = e.target as HTMLElement;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || dialog || preview || menu) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelected(new Set(shown.map(i => i.id))); }
        else if (e.key === 'Escape') setSelected(new Set());
        else if (e.key === 'Delete' && selectedItems.length) { e.preventDefault(); if (view === 'bin') setDialog({ type: 'delete', items: selectedItems }); else void trashItems(selectedItems); }
        else if (e.key === 'F2' && selectedItems.length === 1 && view === 'files') { e.preventDefault(); openRename(selectedItems[0]); }
    };

    // ---- menus ----------------------------------------------------------------------------------------------------
    const entriesFor = (target: Item[]): MenuEntry[] => {
        const one = target.length === 1 ? target[0] : null;
        if (view === 'bin') {
            return [
                { key: 'restore', label: target.length > 1 ? `Restore ${target.length} items` : 'Restore', icon: RotateCcw, onClick: () => void restoreItems(target) },
                ...(one ? [{ key: 'details', label: 'Details', icon: Info, onClick: () => { selectOnly(one); setDetailsOpen(true); } }] : []),
                { key: 'forever', label: 'Delete forever', icon: Trash2, danger: true, dividerBefore: true, onClick: () => setDialog({ type: 'delete', items: target }) },
            ];
        }
        const files = target.filter(t => t.kind === 'file');
        const out: MenuEntry[] = [];
        if (one?.kind === 'folder') out.push({ key: 'open', label: 'Open', icon: FolderOpen, onClick: () => openFolder(one.id) });
        if (one && previewKind(one)) out.push({ key: 'preview', label: 'Preview', icon: Eye, onClick: () => void openPreview(one) });
        if (files.length) out.push({ key: 'download', label: files.length > 1 ? `Download ${files.length} files` : 'Download', icon: Download, onClick: () => void downloadMany(files) });
        if (one) out.push({ key: 'rename', label: 'Rename', icon: Pencil, hint: 'F2', dividerBefore: out.length > 0, onClick: () => openRename(one) });
        out.push({ key: 'move', label: 'Move to', icon: FolderInput, dividerBefore: !one && out.length > 0, onClick: () => setDialog({ type: 'move', items: target }) });
        if (one) out.push({ key: 'copy', label: 'Make a copy', icon: Copy, onClick: () => void copyItem(one) });
        if (features.stars) out.push({ key: 'star', label: target.every(t => t.starred) ? 'Remove star' : 'Add star', icon: Star, dividerBefore: true, onClick: () => void starMany(target, !target.every(t => t.starred)) });
        if (one) out.push({ key: 'note', label: one.note ? 'Edit note' : 'Add note', icon: StickyNote, dividerBefore: !features.stars, onClick: () => openNote(one) });
        if (one) out.push({ key: 'details', label: 'Details', icon: Info, onClick: () => { selectOnly(one); setDetailsOpen(true); } });
        if (one?.kind === 'folder') out.push({ key: 'link', label: 'Copy link', icon: Link, onClick: () => void copyLink(one.id) });
        out.push({ key: 'trash', label: features.bin ? 'Move to bin' : 'Delete', icon: Trash2, hint: 'Delete', danger: !features.bin, dividerBefore: true, onClick: () => void trashItems(target) });
        return out;
    };
    const newEntries = (): MenuEntry[] => [
        { key: 'folder', label: 'New folder', icon: FolderPlus, onClick: newFolder },
        { key: 'upload', label: 'File upload', icon: Upload, dividerBefore: true, onClick: () => fileInput.current?.click() },
        { key: 'uploadDir', label: 'Folder upload', icon: FolderUp, onClick: () => dirInput.current?.click() },
    ];
    const emptyEntries = (): MenuEntry[] => [
        ...(view === 'files' ? newEntries() : []),
        { key: 'link', label: 'Copy link to this folder', icon: Link, dividerBefore: view === 'files', onClick: () => void copyLink(folderId) },
        { key: 'details', label: detailsOpen ? 'Hide details' : 'Show details', icon: Info, onClick: () => setDetailsOpen(o => !o) },
        ...(view === 'bin' && items.length ? [{ key: 'empty', label: 'Empty bin', icon: Trash2, danger: true, dividerBefore: true, onClick: () => setDialog({ type: 'delete', items }) }] : []),
    ];
    const menuEntries = menu?.of === 'new' ? newEntries() : menu?.of === 'selection' && selectedItems.length ? entriesFor(selectedItems) : emptyEntries();

    // ---- drag rows onto folders ------------------------------------------------------------------------------------
    const isInternal = (dt: DataTransfer) => dt.types.includes(DRAG_TYPE);
    /** Handlers for anything items can be dropped on: a folder row or a breadcrumb. OS files dropped there upload into it. */
    const dropProps = (target: { id: string | null; name: string }) => ({
        onDragOver: (e: React.DragEvent) => {
            if (!isInternal(e.dataTransfer) && !e.dataTransfer.types.includes('Files')) return;
            if (view === 'bin' || (target.id && dragIds.current.includes(target.id))) return;
            e.preventDefault(); e.stopPropagation();
            e.dataTransfer.dropEffect = isInternal(e.dataTransfer) ? 'move' : 'copy';
            setDropTarget(t => (t?.id === target.id ? t : target));
        },
        onDragLeave: () => setDropTarget(t => (t?.id === target.id ? null : t)),
        onDrop: (e: React.DragEvent) => {
            if (view === 'bin') return;
            e.preventDefault(); e.stopPropagation();
            setDropTarget(null); setDragDepth(0);
            if (isInternal(e.dataTransfer)) {
                let ids: string[] = [];
                try { ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)); } catch { /* not ours */ }
                if (ids.length && !(target.id && ids.includes(target.id))) void moveIds(ids, target.id, target.name);
            } else void readDropped(e.dataTransfer).then(d => addDropped(d, target.id));
        },
    });

    // The table only renders after the first load, so reading storage here can't cause a hydration mismatch
    const [widths, setWidths] = useState<Record<ColKey, number>>(() => (typeof window === 'undefined' ? DEFAULT_WIDTHS : storedWidths()));
    useEffect(() => { try { window.localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths)); } catch { /* not remembered */ } }, [widths]);
    const setColWidth = (key: ColKey, px: number) => setWidths(w => ({ ...w, [key]: Math.round(Math.min(MAX_WIDTH, Math.max(minWidth(key), px))) }));
    const tableRef = useRef<HTMLTableElement>(null);
    const resizing = useRef<{ key: ColKey; x: number; w: number } | null>(null);
    const fitColumn = (key: ColKey) => {
        const cells = tableRef.current?.querySelectorAll<HTMLElement>(`[data-col="${key}"]`);
        if (!cells?.length) return;
        let need = 0;
        cells.forEach(c => { need = Math.max(need, fitWidth(c)); });
        setColWidth(key, Math.ceil(need) + 4);
    };

    const header = (key: ColKey, label: string, className = '') => {
        const sortKey = key === 'owner' ? null : key;
        const on = sortKey !== null && sort.key === sortKey;
        const Arrow = sort.dir === 1 ? ArrowUp : ArrowDown;
        const endResize = () => { resizing.current = null; };
        return (
            <th scope="col" data-col={key} className={`relative h-12 overflow-hidden px-2 text-left font-medium ${COL_WIDTH[key]} ${className}`}
                aria-sort={sortKey === null ? undefined : on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                {sortKey === null ? (
                    <span data-fit-row className="inline-flex max-w-full px-2"><span data-fit className="truncate">{label}</span></span>
                ) : (
                    <button type="button" data-fit-row onClick={() => setSort(s => ({ key: sortKey, dir: s.key === sortKey ? (s.dir === 1 ? -1 : 1) : 1 }))}
                        className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 hover:bg-[#E9EEF6] ${on ? 'text-[#1F1F1F]' : 'text-[#444746]'}`}>
                        <span data-fit className="truncate">{label}</span>{on && <Arrow className="h-4 w-4 shrink-0" />}
                    </button>
                )}
                <span role="separator" aria-orientation="vertical" aria-label={`Resize ${label} column`} title="Drag to resize · double-click to fit"
                    aria-valuenow={widths[key]} aria-valuemin={minWidth(key)} aria-valuemax={MAX_WIDTH} tabIndex={0}
                    onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); resizing.current = { key, x: e.clientX, w: widths[key] }; }}
                    onPointerMove={e => { const r = resizing.current; if (r) setColWidth(r.key, r.w + e.clientX - r.x); }}
                    onPointerUp={endResize} onPointerCancel={endResize}
                    onDoubleClick={() => fitColumn(key)}
                    onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setColWidth(key, widths[key] + (e.key === 'ArrowRight' ? 16 : -16)); } }}
                    className="absolute inset-y-0 right-0 z-10 hidden w-3 cursor-col-resize touch-none select-none outline-none after:absolute after:inset-y-3 after:right-1 after:w-px after:bg-[#E1E3E1] hover:after:w-0.5 hover:after:bg-[#0B57D0] focus-visible:after:w-0.5 focus-visible:after:bg-[#0B57D0] active:after:w-0.5 active:after:bg-[#0B57D0] sm:block" />
            </th>
        );
    };

    const dragging = dragDepth > 0;
    const inBin = view === 'bin';
    const crumbClass = (current: boolean, over: boolean) => `rounded-full px-3 py-1 text-[22px] leading-8 hover:bg-[#E9EEF6] ${current ? 'text-[#1F1F1F]' : 'text-[#444746]'} ${over ? 'bg-[#C2E7FF] ring-2 ring-[#0B57D0]' : ''}`;

    return (
        <div style={FONT} className="relative rounded-3xl bg-[#F8FAFD] p-3 text-[#1F1F1F] md:p-4" onKeyDown={onKeyDown}
            onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragDepth(d => d + 1); } }}
            onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
            onDragLeave={() => setDragDepth(d => Math.max(0, d - 1))}
            onDrop={e => {
                e.preventDefault(); setDragDepth(0); setDropTarget(null);
                if (isInternal(e.dataTransfer)) return;
                if (inBin) return toast('Leave the Bin to upload files');
                void readDropped(e.dataTransfer).then(d => addDropped(d, folderRef.current));
            }}>

            {/* Toolbar: New + search */}
            <div className="mb-3 flex flex-wrap items-center gap-3">
                <div className="relative">
                    <button ref={newButton} type="button" aria-haspopup="menu" aria-expanded={menu?.of === 'new'} disabled={inBin}
                        onClick={() => { const r = newButton.current!.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, of: 'new' }); }}
                        className="flex h-14 items-center gap-3 rounded-2xl bg-white pl-4 pr-5 text-sm font-medium shadow-[0_1px_2px_0_rgba(60,64,67,.3),0_1px_3px_1px_rgba(60,64,67,.15)] transition hover:bg-[#EDF2FA] hover:shadow-[0_1px_3px_0_rgba(60,64,67,.3),0_4px_8px_3px_rgba(60,64,67,.15)] disabled:opacity-40 disabled:hover:bg-white">
                        <Plus className="h-6 w-6" /> New
                    </button>
                    <input ref={fileInput} type="file" multiple hidden onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
                    <input ref={dirInput} type="file" multiple hidden {...({ webkitdirectory: '', directory: '' } as object)}
                        onChange={e => { pickedFolder(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
                </div>
                <label className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full bg-[#E9EEF6] px-4 transition focus-within:bg-white focus-within:shadow-[0_1px_3px_0_rgba(60,64,67,.3),0_4px_8px_3px_rgba(60,64,67,.15)] sm:max-w-xl">
                    <Search className="h-5 w-5 shrink-0 text-[#444746]" />
                    <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={inBin ? 'Search in the Bin' : 'Search in this folder'} aria-label={inBin ? 'Search in the Bin' : 'Search in this folder'}
                        className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[#444746]" />
                    {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="rounded-full p-1 hover:bg-black/5"><X className="h-5 w-5 text-[#444746]" /></button>}
                </label>
            </div>

            {/* Selection toolbar, or filters + sort. Kept outside the list card so the menus aren't clipped by its rounded overflow. */}
            {selectedItems.length > 0 ? (
                <div role="toolbar" aria-label="Selection" className="mb-3 flex h-12 flex-wrap items-center gap-1 rounded-full bg-[#E9EEF6] pl-1 pr-3">
                    <IconBtn label="Clear selection" onClick={() => setSelected(new Set())}><X className="h-5 w-5" /></IconBtn>
                    <span className="mr-2 text-sm font-medium">{selectedItems.length} selected</span>
                    {inBin ? (
                        <>
                            <IconBtn label="Restore" onClick={() => void restoreItems(selectedItems)}><RotateCcw className="h-5 w-5" /></IconBtn>
                            <IconBtn label="Delete forever" onClick={() => setDialog({ type: 'delete', items: selectedItems })}><Trash2 className="h-5 w-5" /></IconBtn>
                        </>
                    ) : (
                        <>
                            {selectedFiles.length > 0 && <IconBtn label={selectedFiles.length > 1 ? `Download ${selectedFiles.length} files` : 'Download'} onClick={() => void downloadMany(selectedFiles)}><Download className="h-5 w-5" /></IconBtn>}
                            <IconBtn label="Move to" onClick={() => setDialog({ type: 'move', items: selectedItems })}><FolderInput className="h-5 w-5" /></IconBtn>
                            {features.stars && <IconBtn label={allStarred ? 'Remove star' : 'Add star'} onClick={() => void starMany(selectedItems, !allStarred)}><Star className={`h-5 w-5 ${allStarred ? 'fill-[#F9AB00] text-[#F9AB00]' : ''}`} /></IconBtn>}
                            <IconBtn label={features.bin ? 'Move to bin' : 'Delete'} onClick={() => void trashItems(selectedItems)}><Trash2 className="h-5 w-5" /></IconBtn>
                        </>
                    )}
                    <IconBtn label="More actions" onClick={e => openMenu(e, selectedItems[0])}><MoreVertical className="h-5 w-5" /></IconBtn>
                </div>
            ) : !loadError && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Chip label={typeFilter === null ? 'Type' : typeName(typeFilter)} active={typeFilter !== null} open={openChip === 'type'}
                        onToggle={() => toggleChip('type')} onClear={() => setTypeFilter(null)}>
                        {typeOptions.length === 0 && <p className="px-4 py-2 text-sm text-[#747775]">Nothing in {inBin ? 'the Bin' : 'this folder'} yet</p>}
                        {typeOptions.map(([key, count]) => (
                            <MenuOption key={key || 'none'} checked={typeFilter === key} hint={count}
                                onClick={() => { setTypeFilter(typeFilter === key ? null : key); setOpenChip(null); }}>
                                <ItemIcon item={{ kind: key === FOLDER ? 'folder' : 'file', name: `x.${key}` }} className="h-4 w-4" />
                                {typeName(key)}
                            </MenuOption>
                        ))}
                    </Chip>
                    <Chip label={teamFilter === null ? 'Team' : teamLabel(teamFilter)} active={teamFilter !== null} open={openChip === 'team'}
                        onToggle={() => toggleChip('team')} onClear={() => setTeamFilter(null)}>
                        {(['design', 'tech'] as const).map(t => (
                            <MenuOption key={t} checked={teamFilter === t} onClick={() => { setTeamFilter(teamFilter === t ? null : t); setOpenChip(null); }}>
                                {teamLabel(t)}
                            </MenuOption>
                        ))}
                    </Chip>
                    <Chip label={modified === null ? (inBin ? 'Binned' : 'Modified') : MODIFIED.find(([k]) => k === modified)![1]} active={modified !== null} open={openChip === 'modified'}
                        onToggle={() => toggleChip('modified')} onClear={() => setModified(null)}>
                        {MODIFIED.map(([k, label]) => (
                            <MenuOption key={k} checked={modified === k} onClick={() => { setModified(modified === k ? null : k); setOpenChip(null); }}>
                                {label}
                            </MenuOption>
                        ))}
                    </Chip>
                    {features.stars && !inBin && <ToggleChip icon={Star} label="Starred" active={starFilter} onClick={() => setStarFilter(s => !s)} />}
                    {filtering && (
                        <button type="button" onClick={clearFilters} className="h-8 rounded-full px-3 text-sm font-medium text-[#0B57D0] hover:bg-[#0B57D0]/[.08]">Clear filters</button>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                        {features.bin && <ToggleChip icon={Trash2} label="Bin" active={inBin} onClick={() => openBin(!inBin)} title={inBin ? 'Back to Files' : 'Open the Bin'} />}
                        <ToggleChip icon={Info} label="Details" active={detailsOpen} onClick={() => setDetailsOpen(o => !o)} />
                        <Chip align="right" active={false} open={openChip === 'sort'} onToggle={() => toggleChip('sort')}
                            label={<>{sort.dir === 1 ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}Sort: {sort.key === 'updatedAt' && inBin ? 'Binned' : SORT_LABELS[sort.key]}</>}>
                            {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
                                <MenuOption key={k} checked={sort.key === k} onClick={() => setSort(s => ({ key: k, dir: s.dir }))}>{k === 'updatedAt' && inBin ? 'Binned' : SORT_LABELS[k]}</MenuOption>
                            ))}
                            <div className="my-2 border-t border-[#E1E3E1]" />
                            <MenuOption checked={sort.dir === 1} onClick={() => setSort(s => ({ ...s, dir: 1 }))}>Ascending</MenuOption>
                            <MenuOption checked={sort.dir === -1} onClick={() => setSort(s => ({ ...s, dir: -1 }))}>Descending</MenuOption>
                        </Chip>
                    </div>
                </div>
            )}

            {/* List (+ details panel) */}
            <div className="relative min-h-[420px] overflow-hidden rounded-2xl bg-white lg:flex">
                <div className="relative min-w-0 flex-1" onContextMenu={e => { if (!(e.target as HTMLElement).closest('tr[data-item]')) openMenu(e, null); }}>
                    {inBin ? (
                        <div className="flex flex-wrap items-center gap-3 px-3 pt-3 pb-1">
                            <button type="button" onClick={() => openBin(false)} className={crumbClass(false, false)}>Files</button>
                            <ChevronRight className="-mx-2 h-5 w-5 text-[#444746]" />
                            <span className="rounded-full px-3 py-1 text-[22px] leading-8 text-[#1F1F1F]">Bin</span>
                            <p className="ml-auto text-sm text-[#444746]">Items in the Bin are deleted forever after {features.binDays} days.</p>
                            {items.length > 0 && <TextButton tone="red" onClick={() => setDialog({ type: 'delete', items })}>Empty bin</TextButton>}
                        </div>
                    ) : (
                        <nav aria-label="Folder path" className="flex flex-wrap items-center gap-0.5 px-3 pt-3 pb-1">
                            <button type="button" onClick={() => openFolder(null)} {...dropProps({ id: null, name: 'Files' })} className={crumbClass(!path.length, dropTarget?.id === null && !!dropTarget)}>Files</button>
                            {path.map((c, i) => (
                                <React.Fragment key={c.id}>
                                    <ChevronRight className="h-5 w-5 text-[#444746]" />
                                    <button type="button" onClick={() => openFolder(c.id)} {...dropProps({ id: c.id, name: c.name })} className={`max-w-[16rem] truncate ${crumbClass(i === path.length - 1, dropTarget?.id === c.id)}`}>{c.name}</button>
                                </React.Fragment>
                            ))}
                        </nav>
                    )}

                    {loadError ? (
                        <div role="alert" className="flex flex-col items-center px-6 py-20 text-center">
                            <CircleAlert className="mb-3 h-10 w-10 text-[#B3261E]" />
                            <p className="max-w-md text-sm text-[#444746]">{loadError.message}</p>
                            <div className="mt-4 flex gap-2">
                                {!loadError.notReady && <TextButton onClick={() => { setLoading(true); load(); }}>Try again</TextButton>}
                                {(folderId || inBin) && <TextButton onClick={() => openFolder(null)}>Back to Files</TextButton>}
                            </div>
                        </div>
                    ) : loading ? (
                        <div className="flex justify-center py-24"><LoaderCircle className="h-8 w-8 animate-spin text-[#0B57D0]" aria-label="Loading" /></div>
                    ) : shown.length === 0 ? (
                        <div className="flex flex-col items-center px-6 py-20 text-center">
                            {inBin ? <Trash2 className="mb-4 h-16 w-16 text-[#C4C7C5]" aria-hidden /> : <Folder className="mb-4 h-16 w-16 fill-[#E9EEF6] text-[#C4C7C5]" aria-hidden />}
                            <p className="text-[22px] text-[#1F1F1F]">{query || filtering ? 'No matching files' : inBin ? 'The Bin is empty' : 'Drop files here'}</p>
                            {!query && !filtering && !inBin && <p className="mt-1 text-sm text-[#444746]">or use the &ldquo;New&rdquo; button</p>}
                            {!query && !filtering && inBin && <p className="mt-1 text-sm text-[#444746]">Things you delete show up here for {features.binDays} days</p>}
                            {filtering && <TextButton className="mt-4" onClick={clearFilters}>Clear filters</TextButton>}
                        </div>
                    ) : (
                        <div className="overflow-x-auto px-2 pb-2">
                            {/* Fixed layout from sm up: columns keep their set widths, the empty filler column takes any space left over,
                                and once they add up to more than the card the table scrolls sideways */}
                            <table ref={tableRef} aria-multiselectable className="w-full min-w-[320px] border-collapse text-sm sm:table-fixed"
                                style={Object.fromEntries((Object.keys(widths) as ColKey[]).map(k => [`--col-${k}`, `${widths[k]}px`])) as React.CSSProperties}>
                                <thead className="border-b border-[#E1E3E1] text-[#444746]">
                                    <tr>
                                        {header('name', 'Name')}
                                        {header('type', 'Type', 'hidden sm:table-cell')}
                                        {header('owner', inBin ? 'Location' : 'Owner', 'hidden md:table-cell')}
                                        {header('updatedAt', inBin ? 'Binned' : 'Last modified', 'hidden sm:table-cell')}
                                        {header('sizeBytes', 'File size', 'hidden lg:table-cell')}
                                        <th aria-hidden className="hidden sm:table-cell" />
                                        <th scope="col" className="w-44"><span className="sr-only">Actions</span></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {shown.map(item => {
                                        const on = selected.has(item.id);
                                        const over = item.kind === 'folder' && dropTarget?.id === item.id;
                                        return (
                                            <tr key={item.id} data-item={item.id} tabIndex={0} aria-selected={on} draggable={!inBin}
                                                onClick={e => select(item, e)}
                                                onMouseDown={e => { if (e.shiftKey) e.preventDefault(); }}
                                                onDoubleClick={() => activate(item)}
                                                onContextMenu={e => openMenu(e, item)}
                                                onKeyDown={e => { if (e.key === 'Enter') activate(item); }}
                                                onDragStart={e => {
                                                    const ids = on ? [...selected] : [item.id];
                                                    if (!on) selectOnly(item);
                                                    dragIds.current = ids;
                                                    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
                                                    e.dataTransfer.effectAllowed = 'move';
                                                }}
                                                onDragEnd={() => { dragIds.current = []; setDropTarget(null); }}
                                                {...(item.kind === 'folder' && !inBin ? dropProps({ id: item.id, name: item.name }) : {})}
                                                className={`group cursor-default border-b border-[#E1E3E1] outline-none last:border-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0B57D0] ${over ? 'bg-[#C2E7FF] ring-2 ring-inset ring-[#0B57D0]' : on ? 'bg-[#C2E7FF]' : 'hover:bg-[#F0F4F9]'}`}>
                                                <td data-col="name" className="h-12 max-w-0 px-4 sm:max-w-none">
                                                    <div data-fit-row className="flex min-w-0 items-center gap-4">
                                                        <ItemIcon item={item} />
                                                        <span data-fit className="truncate font-medium" title={item.name}>{item.name}</span>
                                                        {item.starred && <Star className="h-4 w-4 shrink-0 fill-[#F9AB00] text-[#F9AB00]" aria-label="Starred" />}
                                                        {item.note && (
                                                            <button type="button" onClick={e => { e.stopPropagation(); openNote(item); }} onDoubleClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                                                                title={item.note} aria-label={`Note on ${item.name}: ${item.note}`}
                                                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#F9AB00] hover:bg-black/[.08]">
                                                                <StickyNote className="h-4 w-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                                <td data-col="type" className="hidden truncate px-4 text-[#444746] sm:table-cell">{typeLabel(item)}</td>
                                                <td data-col="owner" className="hidden overflow-hidden px-4 md:table-cell">
                                                    {inBin ? (
                                                        <div data-fit-row className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[#444746]">
                                                            <Folder className="h-4 w-4 shrink-0 fill-[#444746]" aria-hidden /><span data-fit className="truncate" title={item.location ?? 'Files'}>{item.location ?? 'Files'}</span>
                                                        </div>
                                                    ) : (
                                                        <div data-fit-row className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[#444746]">
                                                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${item.team === 'design' ? 'bg-[#F6D9F0] text-[#7D2A6B]' : 'bg-[#D3E3FD] text-[#0842A0]'}`}>
                                                                {item.createdByName[0]?.toUpperCase()}
                                                            </span>
                                                            <span data-fit className="truncate" title={item.createdByName}>{item.createdByName}</span>
                                                            <span className="text-xs text-[#747775]">{teamLabel(item.team)}</span>
                                                        </div>
                                                    )}
                                                </td>
                                                <td data-col="updatedAt" className="hidden truncate px-4 text-[#444746] tabular-nums sm:table-cell">{fmtDate(inBin ? item.deletedAt ?? item.updatedAt : item.updatedAt)}</td>
                                                <td data-col="sizeBytes" className="hidden truncate px-4 text-[#444746] tabular-nums lg:table-cell">{item.kind === 'folder' ? '—' : fmtSize(item.sizeBytes)}</td>
                                                <td aria-hidden className="hidden sm:table-cell" />
                                                <td className="px-2">
                                                    <div className={`flex justify-end gap-1 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 ${on ? 'md:opacity-100' : ''}`}>
                                                        {inBin ? (
                                                            <>
                                                                <IconBtn label={`Restore ${item.name}`} onClick={e => { e.stopPropagation(); void restoreItems([item]); }}><RotateCcw className="h-5 w-5" /></IconBtn>
                                                                <IconBtn label={`Delete ${item.name} forever`} onClick={e => { e.stopPropagation(); setDialog({ type: 'delete', items: [item] }); }}><Trash2 className="h-5 w-5" /></IconBtn>
                                                            </>
                                                        ) : (
                                                            <>
                                                                {item.kind === 'file' && <IconBtn label={`Download ${item.name}`} onClick={e => { e.stopPropagation(); void download(item); }}><Download className="h-5 w-5" /></IconBtn>}
                                                                {features.stars && (
                                                                    <IconBtn label={item.starred ? `Remove star from ${item.name}` : `Star ${item.name}`} onClick={e => { e.stopPropagation(); void starMany([item], !item.starred); }}>
                                                                        <Star className={`h-5 w-5 ${item.starred ? 'fill-[#F9AB00] text-[#F9AB00]' : ''}`} />
                                                                    </IconBtn>
                                                                )}
                                                                <IconBtn label={`${item.note ? 'Edit' : 'Add'} note on ${item.name}`} onClick={e => { e.stopPropagation(); openNote(item); }}><StickyNote className="h-5 w-5" /></IconBtn>
                                                            </>
                                                        )}
                                                        <IconBtn label={`More actions for ${item.name}`} onClick={e => openMenu(e, item)}><MoreVertical className="h-5 w-5" /></IconBtn>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {dragging && !inBin && (
                        <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-[#0B57D0] bg-[#0B57D0]/[.06]">
                            <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full bg-[#0B57D0] px-6 py-3 text-sm text-white shadow-lg">
                                <Upload className="h-5 w-5" /> Drop files to upload them to <span className="font-medium">{dropTarget?.name ?? hereName}</span>
                            </div>
                        </div>
                    )}
                </div>

                {detailsOpen && (
                    <>
                        <button type="button" aria-label="Close details" onClick={() => setDetailsOpen(false)} className="fixed inset-0 z-[74] bg-black/30 lg:hidden" />
                        <div className="fixed inset-y-0 right-0 z-[75] w-80 max-w-full shadow-2xl lg:static lg:z-auto lg:w-auto lg:shrink-0 lg:shadow-none">
                            <DetailsPanel item={detailsItem} path={path} inBin={inBin} onClose={() => setDetailsOpen(false)} onEditNote={openNote} />
                        </div>
                    </>
                )}
            </div>

            {/* Menus */}
            {menu && <ContextMenu x={menu.x} y={menu.y} entries={menuEntries} onClose={() => setMenu(null)} label={menu.of === 'new' ? 'New' : 'Actions'} />}

            {/* Move picker */}
            {dialog?.type === 'move' && (
                <MoveDialog call={call} moving={dialog.items} startPath={path} onClose={() => setDialog(null)}
                    onMove={(targetId, targetName) => moveIds(dialog.items.map(i => i.id), targetId, targetName)} />
            )}

            {/* Dialogs */}
            {dialog && dialog.type !== 'move' && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) setDialog(null); }}>
                    <div role="dialog" aria-modal="true" aria-labelledby="files-dialog-title" style={FONT} className={`w-full ${dialog.type === 'note' ? 'max-w-md' : 'max-w-sm'} rounded-[28px] bg-white p-6 shadow-2xl`}>
                        {dialog.type === 'note' ? (
                            <form onSubmit={e => { e.preventDefault(); void saveNote(dialog.item, noteText); }}>
                                <h2 id="files-dialog-title" className="mb-1 text-2xl text-[#1F1F1F]">Note</h2>
                                <p className="mb-4 flex min-w-0 items-center gap-2 text-sm text-[#444746]">
                                    <ItemIcon item={dialog.item} className="h-4 w-4 shrink-0" />
                                    <span className="truncate" title={dialog.item.name}>{dialog.item.name}</span>
                                </p>
                                <textarea autoFocus value={noteText} onChange={e => setNoteText(e.target.value)} maxLength={MAX_NOTE_CHARS} rows={5}
                                    aria-label={`Note on ${dialog.item.name}`} placeholder="Add a note for both teams…"
                                    onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit(); }}
                                    className="w-full resize-y rounded border border-[#747775] px-4 py-3 text-base outline-none focus:border-2 focus:border-[#0B57D0] focus:px-[15px] focus:py-[11px]" />
                                <p className="mt-1 text-right text-xs tabular-nums text-[#747775]">{noteText.length} / {MAX_NOTE_CHARS}</p>
                                <div className="mt-4 flex items-center justify-between gap-2">
                                    {dialog.item.note ? (
                                        <TextButton tone="red" disabled={busy} onClick={() => void saveNote(dialog.item, '')}>Remove note</TextButton>
                                    ) : <span />}
                                    <div className="flex gap-2">
                                        <TextButton onClick={() => setDialog(null)}>Cancel</TextButton>
                                        <TextButton type="submit" disabled={busy || noteText.trim() === (dialog.item.note ?? '')}>{busy ? 'Saving…' : 'Save'}</TextButton>
                                    </div>
                                </div>
                            </form>
                        ) : dialog.type === 'folder' ? (
                            <form onSubmit={createFolder}>
                                <h2 id="files-dialog-title" className="mb-4 text-2xl text-[#1F1F1F]">New folder</h2>
                                <input id="files-folder-name" autoFocus value={folderName} onChange={e => setFolderName(e.target.value)} maxLength={200} aria-label="Folder name"
                                    onFocus={e => e.currentTarget.select()}
                                    className="h-12 w-full rounded border border-[#747775] px-4 text-base outline-none focus:border-2 focus:border-[#0B57D0] focus:px-[15px]" />
                                <div className="mt-6 flex justify-end gap-2">
                                    <TextButton onClick={() => setDialog(null)}>Cancel</TextButton>
                                    <TextButton type="submit" disabled={busy || !folderName.trim()}>Create</TextButton>
                                </div>
                            </form>
                        ) : dialog.type === 'rename' ? (
                            <form onSubmit={e => { e.preventDefault(); void doRename(dialog.item, renameText); }}>
                                <h2 id="files-dialog-title" className="mb-4 text-2xl text-[#1F1F1F]">Rename</h2>
                                <input autoFocus value={renameText} onChange={e => setRenameText(e.target.value)} maxLength={200} aria-label="New name"
                                    onFocus={e => e.currentTarget.setSelectionRange(0, dialog.item.kind === 'file' ? baseName(dialog.item.name).length : dialog.item.name.length)}
                                    className="h-12 w-full rounded border border-[#747775] px-4 text-base outline-none focus:border-2 focus:border-[#0B57D0] focus:px-[15px]" />
                                {dialog.item.kind === 'file' && renameText.trim() && ext(renameText.trim()) !== ext(dialog.item.name) && (
                                    <p className="mt-2 flex items-start gap-2 text-xs text-[#B3261E]"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />Changing the file extension may make the file unusable.</p>
                                )}
                                <div className="mt-6 flex justify-end gap-2">
                                    <TextButton onClick={() => setDialog(null)}>Cancel</TextButton>
                                    <TextButton type="submit" disabled={busy || !renameText.trim() || renameText.trim() === dialog.item.name}>{busy ? 'Renaming…' : 'OK'}</TextButton>
                                </div>
                            </form>
                        ) : (
                            <>
                                <h2 id="files-dialog-title" className="mb-4 break-words text-2xl text-[#1F1F1F]">
                                    {dialog.items.length === 1 ? <>Delete &ldquo;{dialog.items[0].name}&rdquo;{features.bin ? ' forever' : ''}?</> : <>Delete {dialog.items.length} items{features.bin ? ' forever' : ''}?</>}
                                </h2>
                                <p className="text-sm text-[#444746]">
                                    {dialog.items.some(i => i.kind === 'folder' && i.itemCount) ? 'Everything in the folder will be deleted too. ' : ''}
                                    {dialog.items.length === 1 ? 'It' : 'They'} will be deleted for both teams and can&rsquo;t be restored.
                                </p>
                                <div className="mt-6 flex justify-end gap-2">
                                    <TextButton onClick={() => setDialog(null)}>Cancel</TextButton>
                                    <TextButton tone="red" autoFocus disabled={busy} onClick={() => void confirmDelete(dialog.items)}>{busy ? 'Deleting…' : features.bin ? 'Delete forever' : 'Delete'}</TextButton>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Preview */}
            {preview && (
                <PreviewOverlay item={preview.item} url={preview.url} onClose={() => setPreview(null)} onDownload={() => void download(preview.item)}
                    onPrev={previewAt > 0 ? () => void openPreview(previewable[previewAt - 1]) : undefined}
                    onNext={previewAt >= 0 && previewAt < previewable.length - 1 ? () => void openPreview(previewable[previewAt + 1]) : undefined} />
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
                <div role="status" style={FONT} className="fixed bottom-6 left-4 z-[90] flex max-w-[calc(100vw-2rem)] items-center gap-4 rounded bg-[#303030] py-2 pl-4 pr-2 text-sm text-[#F2F2F2] shadow-lg lg:left-[19rem]">
                    <span className="py-1.5">{snack.text}</span>
                    {snack.action && (
                        <button type="button" onClick={() => { const a = snack.action!; setSnack(null); a.run(); }}
                            className="h-9 shrink-0 rounded px-3 font-medium text-[#A8C7FA] hover:bg-white/10">{snack.action.label}</button>
                    )}
                </div>
            )}
        </div>
    );
}
