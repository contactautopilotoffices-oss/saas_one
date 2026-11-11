/**
 * The remembered Downloads folder (owner 2026-11-10, phase 3). On Chrome and Edge the File System Access API lets the
 * page keep a handle to a folder the person chose once; later runs read it straight away (the browser asks "allow?"
 * on a new visit) with no file dialog. The handle lives in this browser's IndexedDB; nothing about the folder reaches
 * the server. Browsers without the API fall back to the folder picker.
 *
 * Owner 2026-11-11: the page shows the remembered folder as the "source folder" (its name, Change, Forget). A web page
 * is told only the folder's name, never its full path on the disk, so the name is all that can be shown.
 */
import { isResumeType } from '@/backend/lib/candidates/resume-pick';

interface FileHandleLike { kind: 'file'; name: string; getFile(): Promise<File> }
export interface DirHandleLike {
    kind: 'directory';
    name: string;
    entries(): AsyncIterable<[string, FileHandleLike | DirHandleLike]>;
    queryPermission(options: { mode: 'read' }): Promise<string>;
    requestPermission(options: { mode: 'read' }): Promise<string>;
}
type Picker = (options: { id: string; mode: 'read'; startIn: 'downloads' }) => Promise<DirHandleLike>;

const DB = 'cand-resumes';
const STORE = 'kv';
const KEY = 'downloads-folder';
/** Sub-folders of Downloads are read this deep (a "Resumes" folder inside it counts; the whole disk does not). */
const MAX_DEPTH = 3;
const MAX_FILES = 20_000;

export function canRememberFolder(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window && 'indexedDB' in window;
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function inStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return openDb().then(db => new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    }));
}

export async function loadFolder(): Promise<DirHandleLike | null> {
    try { return ((await inStore<unknown>('readonly', s => s.get(KEY))) as DirHandleLike | undefined) ?? null; } catch { return null; }
}

export async function forgetFolder(): Promise<void> {
    try { await inStore('readwrite', s => s.delete(KEY)); } catch { /* nothing to forget */ }
}

/** Asks for the folder (a browser dialog) and remembers it. Null when the person cancels. */
export async function pickFolder(): Promise<DirHandleLike | null> {
    try {
        const handle = await (window as unknown as { showDirectoryPicker: Picker }).showDirectoryPicker({ id: 'resumes', mode: 'read', startIn: 'downloads' });
        try { await inStore('readwrite', s => s.put(handle, KEY)); } catch { /* remembered for this visit only */ }
        return handle;
    } catch (e) {
        if ((e as { name?: string }).name === 'AbortError') return null;
        throw e;
    }
}

/** True when the folder can be read now (the browser may ask first; call from a click). */
export async function ensureReadable(handle: DirHandleLike): Promise<boolean> {
    try {
        if ((await handle.queryPermission({ mode: 'read' })) === 'granted') return true;
        return (await handle.requestPermission({ mode: 'read' })) === 'granted';
    } catch {
        return false;
    }
}

/** Whether the folder can be read without the browser asking first. Never asks, so it is safe outside a click. */
export async function folderAllowed(handle: DirHandleLike): Promise<boolean> {
    try { return (await handle.queryPermission({ mode: 'read' })) === 'granted'; } catch { return false; }
}

/** Brave ships with folder access switched off (brave://flags, "File System Access API"), so the page says how to turn it on. */
export function isBrave(): boolean {
    return typeof navigator !== 'undefined' && 'brave' in navigator;
}

/** Every PDF / Word file in the folder and its sub-folders, with the folder path shown in the list. */
export async function listFolderFiles(handle: DirHandleLike): Promise<{ file: File; folder: string }[]> {
    const out: { file: File; folder: string }[] = [];
    const walk = async (dir: DirHandleLike, path: string, depth: number) => {
        for await (const [name, entry] of dir.entries()) {
            if (out.length >= MAX_FILES) return;
            if (entry.kind === 'file') {
                if (!isResumeType(name)) continue;
                try { out.push({ file: await entry.getFile(), folder: path }); } catch { /* a file that vanished or cannot be read */ }
            } else if (depth < MAX_DEPTH && !name.startsWith('.')) {
                await walk(entry, `${path}/${name}`, depth + 1);
            }
        }
    };
    await walk(handle, handle.name, 0);
    return out;
}
