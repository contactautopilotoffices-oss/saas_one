'use client';

import React, { useEffect, useState } from 'react';
import { ChevronRight, CircleAlert, Folder, FolderOpen, FolderPlus, LoaderCircle, X } from 'lucide-react';
import { Caller, Crumb, FONT, FilledButton, Item, ItemIcon, TextButton } from './shared';

/**
 * Owner 2026-11-13: Drive's "Move to" picker. Starts in the folder the items are in; click a folder to go into it,
 * the breadcrumbs to go back up, "Move here" to move. Folders being moved are greyed out (a folder can't go into
 * itself) and the server checks that again. "New folder" (bottom left) makes a folder right here and steps into it.
 */
export function MoveDialog({ call, moving, startPath, onMove, onClose }: {
    call: Caller; moving: Item[]; startPath: Crumb[];
    onMove: (targetId: string | null, targetName: string) => Promise<boolean>; onClose: () => void;
}) {
    const startId = startPath[startPath.length - 1]?.id ?? null;
    const [folderId, setFolderId] = useState<string | null>(startId);
    const [path, setPath] = useState<Crumb[]>(startPath);
    const [folders, setFolders] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [newName, setNewName] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const movingIds = new Set(moving.map(m => m.id));

    const go = (id: string | null) => { if (id !== folderId) setLoading(true); setFolderId(id); setNewName(null); setCreateError(null); };

    const createFolder = async (e: React.FormEvent) => {
        e.preventDefault();
        const name = (newName ?? '').trim();
        if (!name || creating) return;
        setCreating(true);
        const r = await call<{ id: string }>({ action: 'create_folder', name, parentId: folderId });
        setCreating(false);
        if (!r.ok) return setCreateError(r.error);
        go(r.id);
    };

    useEffect(() => {
        let live = true;
        void call<{ items: Item[]; path: Crumb[] }>(undefined, `&folders=1${folderId ? `&parent_id=${folderId}` : ''}`).then(r => {
            if (!live) return;
            if (r.ok) { setFolders(r.items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))); setPath(r.path); setError(null); }
            else setError(r.error);
            setLoading(false);
        });
        return () => { live = false; };
    }, [call, folderId]);

    const here = path[path.length - 1]?.name ?? 'Files';
    const unchanged = folderId === startId;
    const what = moving.length === 1 ? `"${moving[0].name}"` : `${moving.length} items`;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div role="dialog" aria-modal="true" aria-labelledby="files-move-title" style={FONT} className="flex max-h-[80vh] w-full max-w-md flex-col rounded-[28px] bg-white shadow-2xl">
                <div className="px-6 pt-6">
                    <h2 id="files-move-title" className="text-2xl text-[#1F1F1F]">Move {what}</h2>
                    <nav aria-label="Destination path" className="mt-3 flex flex-wrap items-center gap-0.5 text-sm">
                        <button type="button" onClick={() => go(null)} className={`rounded-full px-2 py-1 hover:bg-[#E9EEF6] ${path.length ? 'text-[#444746]' : 'font-medium text-[#1F1F1F]'}`}>Files</button>
                        {path.map((c, i) => (
                            <React.Fragment key={c.id}>
                                <ChevronRight className="h-4 w-4 text-[#444746]" />
                                <button type="button" onClick={() => go(c.id)} className={`max-w-[10rem] truncate rounded-full px-2 py-1 hover:bg-[#E9EEF6] ${i === path.length - 1 ? 'font-medium text-[#1F1F1F]' : 'text-[#444746]'}`}>{c.name}</button>
                            </React.Fragment>
                        ))}
                    </nav>
                </div>

                <div className="mt-3 min-h-[14rem] flex-1 overflow-y-auto border-y border-[#E1E3E1]">
                    {newName !== null && (
                        <form onSubmit={createFolder} className="flex flex-wrap items-center gap-3 border-b border-[#E1E3E1] bg-[#F8FAFD] px-6 py-2">
                            <Folder className="h-5 w-5 shrink-0 fill-[#444746] text-[#444746]" aria-hidden />
                            <input autoFocus value={newName} onChange={e => { setNewName(e.target.value); setCreateError(null); }} maxLength={200} aria-label="New folder name"
                                onFocus={e => e.currentTarget.select()} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setNewName(null); } }}
                                className="h-9 min-w-0 flex-1 rounded border border-[#747775] px-3 text-sm outline-none focus:border-2 focus:border-[#0B57D0] focus:px-[11px]" />
                            <FilledButton type="submit" disabled={creating || !newName.trim()} className="h-9 px-4">{creating ? 'Creating…' : 'Create'}</FilledButton>
                            <button type="button" onClick={() => setNewName(null)} aria-label="Cancel new folder" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-black/[.08]"><X className="h-4 w-4" /></button>
                            {createError && <p role="alert" className="basis-full pl-8 text-xs text-[#B3261E]">{createError}</p>}
                        </form>
                    )}
                    {error ? (
                        <div role="alert" className="flex flex-col items-center px-6 py-10 text-center text-sm text-[#444746]"><CircleAlert className="mb-2 h-6 w-6 text-[#B3261E]" />{error}</div>
                    ) : loading ? (
                        <div className="flex justify-center py-14"><LoaderCircle className="h-6 w-6 animate-spin text-[#0B57D0]" aria-label="Loading" /></div>
                    ) : folders.length === 0 ? (
                        <div className="flex flex-col items-center px-6 py-10 text-center text-sm text-[#444746]">
                            <FolderOpen className="mb-2 h-8 w-8 text-[#C4C7C5]" aria-hidden />No folders in here
                        </div>
                    ) : (
                        <ul role="listbox" aria-label="Folders" className="py-1">
                            {folders.map(f => {
                                const own = movingIds.has(f.id);
                                return (
                                    <li key={f.id}>
                                        <button type="button" disabled={own} onClick={() => go(f.id)} title={own ? "This folder is being moved" : `Open ${f.name}`}
                                            className="flex h-11 w-full items-center gap-4 px-6 text-left text-sm hover:bg-[#F0F4F9] disabled:opacity-40 disabled:hover:bg-transparent">
                                            <ItemIcon item={f} />
                                            <span className="flex-1 truncate">{f.name}</span>
                                            {f.itemCount ? <span className="text-xs text-[#747775]">{f.itemCount}</span> : null}
                                            <ChevronRight className="h-4 w-4 text-[#747775]" />
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                <div className="flex items-center justify-between gap-2 py-4 pl-3 pr-6">
                    <div className="flex min-w-0 items-center gap-1">
                        <button type="button" onClick={() => { setNewName('Untitled folder'); setCreateError(null); }} disabled={loading || !!error} aria-label="New folder here" title="New folder"
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#444746] hover:bg-black/[.08] disabled:opacity-40">
                            <FolderPlus className="h-5 w-5" />
                        </button>
                        <p className="flex min-w-0 items-center gap-2 text-sm text-[#444746]">
                            <Folder className="h-4 w-4 shrink-0 fill-[#444746]" aria-hidden /><span className="truncate">{here}</span>
                        </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                        <TextButton onClick={onClose}>Cancel</TextButton>
                        <FilledButton disabled={busy || unchanged || loading || !!error}
                            onClick={async () => { setBusy(true); const ok = await onMove(folderId, here); setBusy(false); if (ok) onClose(); }}>
                            {busy ? 'Moving…' : 'Move here'}
                        </FilledButton>
                    </div>
                </div>
            </div>
        </div>
    );
}
