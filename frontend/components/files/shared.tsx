'use client';

import React from 'react';
import { File, FileArchive, FileCode, FileImage, FileSpreadsheet, FileText, Film, Folder, Music, Presentation } from 'lucide-react';

/**
 * Files tab (owner 2026-10-29, upgraded 2026-11-13): the types and small helpers shared by FilesTab and its dialogs,
 * menu, details panel and preview. Nothing here talks to the server.
 */

export type FilesTeam = 'design' | 'tech';

export interface Item {
    id: string; kind: 'folder' | 'file'; name: string; sizeBytes: number | null; mimeType: string | null;
    team: FilesTeam; createdByName: string; createdAt: string; updatedAt: string; itemCount: number | null;
    /** Owner 2026-11-02: one editable note per file or folder (null = none) */
    note: string | null;
    /** Owner 2026-11-13: starred by the signed-in person */
    starred: boolean;
    /** Owner 2026-11-13: Bin only — when it was binned and the folder it came from */
    deletedAt: string | null; location: string | null;
}
export interface Crumb { id: string; name: string }

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string; code?: string };
/** The one way the Files UI talks to /api/shared-files: a body = POST an action, none = GET the listing. */
export type Caller = <T>(body?: Record<string, unknown>, extra?: string) => Promise<Result<T>>;

export const FONT = { fontFamily: '"Google Sans", "Google Sans Text", Roboto, Arial, sans-serif' };
export const teamLabel = (t: FilesTeam) => (t === 'design' ? 'Design' : 'Tech');

export const fmtSize = (b: number | null) => {
    if (b === null) return '—';
    if (b < 1024) return `${b} bytes`;
    if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
    return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

/** Drive style: a time for today, "29 Oct" this year, "29 Oct 2025" before. */
export function fmtDate(iso: string) {
    const d = new Date(iso), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString('en-IN', d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
/** The full date and time, for the details panel. */
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export const ext = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
/** "Report.pdf" → "Report": what the rename box preselects so the extension is kept by default. */
export const baseName = (name: string) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };

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
export function ItemIcon({ item, className = 'h-5 w-5' }: { item: Pick<Item, 'kind' | 'name'>; className?: string }) {
    if (item.kind === 'folder') return <Folder className={`${className} fill-[#444746] text-[#444746]`} aria-hidden />;
    const hit = TYPES.find(([re]) => re.test(ext(item.name)));
    const Icon = hit ? hit[1] : File;
    return <Icon className={`${className} ${hit ? hit[2] : 'text-[#5F6368]'}`} aria-hidden />;
}

export const typeLabel = (item: Pick<Item, 'kind' | 'name'>) => (item.kind === 'folder' ? 'Folder' : ext(item.name).toUpperCase() || '—');

/** Owner 2026-11-13: what opens in the preview overlay (the server allows the same set and nothing else). */
export type PreviewKind = 'image' | 'pdf' | 'video' | 'audio';
export function previewKind(item: Pick<Item, 'kind' | 'name' | 'mimeType'>): PreviewKind | null {
    if (item.kind !== 'file') return null;
    const m = (item.mimeType || '').toLowerCase(), e = ext(item.name);
    if (/^image\/(png|jpeg|gif|webp|svg\+xml|bmp|avif)$/.test(m) || /^(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(e)) return 'image';
    if (m === 'application/pdf' || e === 'pdf') return 'pdf';
    if (/^video\/(mp4|webm|quicktime)$/.test(m) || /^(mp4|webm|mov|m4v)$/.test(e)) return 'video';
    if (/^audio\/(mpeg|wav|mp4|aac|ogg|flac)$/.test(m) || /^(mp3|wav|m4a|aac|ogg|flac)$/.test(e)) return 'audio';
    return null;
}

/** The Drive-style pill button used across the Files dialogs. */
export function TextButton({ tone = 'blue', className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'blue' | 'red' }) {
    const colour = tone === 'red' ? 'text-[#B3261E] hover:bg-[#B3261E]/[.08]' : 'text-[#0B57D0] hover:bg-[#0B57D0]/[.08]';
    return <button type="button" {...rest} className={`h-10 rounded-full px-4 text-sm font-medium disabled:opacity-40 ${colour} ${className}`} />;
}
export function FilledButton({ className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return <button type="button" {...rest} className={`h-10 rounded-full bg-[#0B57D0] px-6 text-sm font-medium text-white hover:bg-[#0B57D0]/90 disabled:opacity-40 ${className}`} />;
}
