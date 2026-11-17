'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, FileText, FileSpreadsheet, Image as ImageIcon, Trash2, Loader2, AlertCircle } from 'lucide-react';

/**
 * Owner 2026-11-03: optional files on a request (ticket). Server rules live in backend/lib/ticketing/attachments.ts
 * (the server re-checks every file's real type and size); these client checks only give a quick, friendly message.
 */
export const MAX_TICKET_FILES = 5;
export const MAX_TICKET_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'png', 'jpg', 'jpeg', 'webp'];
export const TICKET_ATTACHMENT_ACCEPT = [
    '.pdf', '.docx', '.xlsx', '.png', '.jpg', '.jpeg', '.webp',
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',');

/** null = fine to send; otherwise the reason it cannot be attached. */
export function checkTicketFile(file: File): string | null {
    const ext = file.name.toLowerCase().split('.').pop() || '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) return `"${file.name}": only PDF, Word (.docx), Excel (.xlsx) or image (PNG, JPG, WEBP) files can be attached.`;
    if (!file.size) return `"${file.name}" is empty.`;
    if (file.size > MAX_TICKET_FILE_BYTES) return `"${file.name}" is over 10 MB.`;
    return null;
}

/** Uploads one file to a request. Returns null on success, or the error message. */
export async function uploadTicketFile(ticketId: string, file: File): Promise<string | null> {
    try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`/api/tickets/${ticketId}/attachments`, { method: 'POST', body: form });
        if (res.ok) return null;
        const data = await res.json().catch(() => ({}));
        return data.error || `Could not attach "${file.name}".`;
    } catch {
        return `Could not attach "${file.name}". Please check your connection.`;
    }
}

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TicketFileIcon({ name, className }: { name: string; className?: string }) {
    const ext = name.toLowerCase().split('.').pop() || '';
    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return <ImageIcon className={className} />;
    if (ext === 'xlsx') return <FileSpreadsheet className={className} />;
    return <FileText className={className} />;
}

interface Attachment {
    id: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    uploadedByName: string;
    createdAt: string;
    url: string | null;
    canDelete: boolean;
}

/** Download links expire after 10 minutes, so the list is quietly refreshed before then. */
const REFRESH_MS = 8 * 60 * 1000;

export default function TicketAttachments({ ticketId, isDark = false }: { ticketId: string; isDark?: boolean }) {
    const [files, setFiles] = useState<Attachment[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/tickets/${ticketId}/attachments`, { cache: 'no-store' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Could not load the files.');
            setFiles(data.attachments || []);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the files.');
        } finally {
            setLoading(false);
        }
    }, [ticketId]);

    useEffect(() => {
        load();
        const timer = setInterval(load, REFRESH_MS);
        return () => clearInterval(timer);
    }, [load]);

    const handlePick = async (list: FileList | null) => {
        const picked = Array.from(list || []);
        if (inputRef.current) inputRef.current.value = '';
        if (!picked.length) return;
        setError(null);
        const room = MAX_TICKET_FILES - files.length;
        if (picked.length > room) {
            setError(room > 0 ? `You can add ${room} more file${room === 1 ? '' : 's'} (at most ${MAX_TICKET_FILES} per request).` : `A request can have at most ${MAX_TICKET_FILES} files.`);
            return;
        }
        const problem = picked.map(checkTicketFile).find(Boolean);
        if (problem) {
            setError(problem);
            return;
        }
        setUploading(true);
        const failures: string[] = [];
        for (const file of picked) {
            const err = await uploadTicketFile(ticketId, file);
            if (err) failures.push(err);
        }
        setUploading(false);
        if (failures.length) setError(failures.join(' '));
        await load();
    };

    const handleRemove = async (file: Attachment) => {
        if (!window.confirm(`Remove "${file.fileName}" from this request?`)) return;
        setRemovingId(file.id);
        setError(null);
        try {
            const res = await fetch(`/api/tickets/${ticketId}/attachments?attachmentId=${encodeURIComponent(file.id)}`, { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Could not remove the file.');
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not remove the file.');
        } finally {
            setRemovingId(null);
        }
    };

    const muted = isDark ? 'text-slate-500' : 'text-slate-400';
    const full = files.length >= MAX_TICKET_FILES;

    return (
        <div
            id="section-attachments"
            className={`${isDark ? 'bg-[#161b22] border-[#21262d]' : 'bg-white border-slate-100'} p-6 rounded-3xl border shadow-sm`}
        >
            <div className="flex items-center justify-between gap-3 mb-5">
                <h3 className={`text-sm font-black ${isDark ? 'text-white' : 'text-slate-900'} flex items-center gap-2`}>
                    <Paperclip className="w-4 h-4 text-primary" />
                    Attachments
                    {files.length > 0 && <span className={`text-[10px] font-bold ${muted}`}>{files.length}/{MAX_TICKET_FILES}</span>}
                </h3>
                {!full && (
                    <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        disabled={uploading}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:opacity-80 disabled:opacity-50 transition-opacity"
                    >
                        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                        {uploading ? 'Attaching…' : 'Attach'}
                    </button>
                )}
                <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept={TICKET_ATTACHMENT_ACCEPT}
                    className="hidden"
                    onChange={(e) => handlePick(e.target.files)}
                />
            </div>

            {loading ? (
                <div className={`flex items-center gap-2 text-xs ${muted}`}>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading files…
                </div>
            ) : files.length === 0 ? (
                <p className={`text-xs ${muted}`}>No files attached. PDF, Word, Excel or images, up to 10 MB each.</p>
            ) : (
                <ul className="space-y-2">
                    {files.map((f) => (
                        <li
                            key={f.id}
                            className={`flex items-center gap-3 p-3 rounded-xl border ${isDark ? 'bg-[#0d1117] border-[#30363d]' : 'bg-slate-50 border-slate-100'}`}
                        >
                            <TicketFileIcon name={f.fileName} className="w-5 h-5 text-primary flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                                {f.url ? (
                                    <a
                                        href={f.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`block truncate text-xs font-bold ${isDark ? 'text-white' : 'text-slate-900'} hover:text-primary hover:underline`}
                                        title={f.fileName}
                                    >
                                        {f.fileName}
                                    </a>
                                ) : (
                                    <span className={`block truncate text-xs font-bold ${isDark ? 'text-white' : 'text-slate-900'}`} title={f.fileName}>{f.fileName}</span>
                                )}
                                <p className={`text-[10px] ${muted} truncate`}>
                                    {formatFileSize(f.fileSize)} · {f.uploadedByName} · {new Date(f.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </p>
                            </div>
                            {f.canDelete && (
                                <button
                                    type="button"
                                    onClick={() => handleRemove(f)}
                                    disabled={removingId === f.id}
                                    title="Remove file"
                                    className={`p-1.5 rounded-lg ${muted} hover:text-rose-500 hover:bg-rose-500/10 disabled:opacity-50 transition-colors`}
                                >
                                    {removingId === f.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {error && (
                <div className="mt-3 flex items-start gap-2 text-xs text-rose-500">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                </div>
            )}
        </div>
    );
}
