'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';

/** Small shared pieces for Invoice Control. Nothing here decides permissions: that is the API's job. */

export const inr = (n: number | null | undefined) =>
    n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const shortDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export class ApiError extends Error {
    constructor(message: string, public status: number, public data: { error?: string; message?: string; needs_confirmation?: boolean } = {}) { super(message); }
}

/** JSON fetch that throws the server's message, so callers can show it as it is. */
export async function api<T = unknown>(url: string, init?: RequestInit & { idempotencyKey?: string }): Promise<T> {
    const { idempotencyKey, ...rest } = init ?? {};
    const res = await fetch(url, {
        ...rest,
        headers: { 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}), ...(rest.headers ?? {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.message || data.error || `Request failed (${res.status})`, res.status, data);
    return data as T;
}

export const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random());

/** Put a file into a server-issued slot. The slot decides the path; the browser only supplies bytes. */
export async function uploadToSlot(slot: { bucket: string; upload_path: string; upload_token: string }, file: File): Promise<void> {
    const supabase = createClient();
    const { error } = await supabase.storage.from(slot.bucket).uploadToSignedUrl(slot.upload_path, slot.upload_token, file, { contentType: file.type });
    if (error) throw new Error(error.message || 'Upload failed');
}

const TONES: Record<string, string> = {
    green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
    red: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
    blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
    grey: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20',
};

export function Pill({ tone = 'grey', children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ${TONES[tone]}`}>{children}</span>;
}

export const matchTone = (s: string) => s === 'matched' ? 'green' : s === 'mismatched' || s === 'duplicate_suspected' ? 'red' : s === 'needs_review' ? 'amber' : 'grey';
export const reviewTone = (s: string) => s === 'accepted' ? 'green' : s === 'rejected' ? 'red' : s === 'resubmission_required' ? 'amber' : s === 'in_review' ? 'blue' : 'grey';
export const ftTone = (s: string) =>
    ['aligned', 'payment_recorded', 'approved'].includes(s) ? 'green' : ['rejected', 'cancelled'].includes(s) ? 'red' : ['needs_information', 'pending_approval', 'alignment_in_progress'].includes(s) ? 'amber' : 'grey';
export const docTone = (s: string, overdue?: boolean) =>
    overdue ? 'red' : ['reconciled', 'closed', 'matched'].includes(s) ? 'green' : s === 'disputed' ? 'red' : s === 'waived_by_policy' ? 'blue' : 'amber';

export const label = (s: string | null | undefined) => (s ?? '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    if (typeof document === 'undefined') return null;
    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className={`bg-surface w-full ${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'} max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-border shadow-xl`}>
                <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 bg-surface border-b border-border">
                    <h2 className="text-base font-bold text-text-primary">{title}</h2>
                    <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-text-tertiary hover:bg-surface-elevated"><X className="w-4 h-4" /></button>
                </div>
                <div className="p-5">{children}</div>
            </div>
        </div>,
        document.body,
    );
}

export const inputCls = 'w-full px-3 py-2 rounded-xl border border-border bg-surface text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30';
export const btnPrimary = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed';
export const btnGhost = 'inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-border text-sm font-bold text-text-secondary hover:bg-surface-elevated disabled:opacity-50';
export const btnDanger = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:opacity-50';

export function Field({ label: l, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
    return (
        <label className="block">
            <span className="block text-xs font-bold text-text-secondary mb-1">{l}</span>
            {children}
            {hint && <span className="block text-[11px] text-text-tertiary mt-1">{hint}</span>}
        </label>
    );
}

export function ErrorLine({ message }: { message: string | null }) {
    return message ? <p role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{message}</p> : null;
}

export function Empty({ children }: { children: React.ReactNode }) {
    return <div className="text-center py-14 text-sm text-text-tertiary">{children}</div>;
}

export function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
    if (totalPages <= 1) return null;
    return (
        <div className="flex items-center justify-end gap-2 pt-3">
            <button className={btnGhost} disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
            <span className="text-xs text-text-tertiary tabular-nums">Page {page} of {totalPages}</span>
            <button className={btnGhost} disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
        </div>
    );
}
