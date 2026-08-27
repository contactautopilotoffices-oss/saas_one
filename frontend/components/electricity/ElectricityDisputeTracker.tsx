'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Paperclip, RefreshCw, Send, XCircle } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import {
    electricityFileUrl,
    type Dispute, type DisputesPayload,
} from '@/frontend/lib/electricity/trackerTypes';

/**
 * Phase 3 — the dispute tracker. Thread-style: the checker's reason on top, then the
 * property admin's free-form responses with attachment chips (files land in the private
 * electricity-bills bucket and open through /api/electricity/files). Anyone with tracker
 * access can add context; accept/reject is checker-only (ops_super_admin / super admins)
 * and the API enforces that regardless of what the UI shows.
 */

interface Props {
    orgId: string;
}

const STATUS_META: Record<Dispute['status'], { label: string; color: string }> = {
    open: { label: 'Open', color: 'var(--error)' },
    responded: { label: 'Responded', color: 'var(--warning)' },
    accepted: { label: 'Accepted', color: 'var(--success)' },
    rejected: { label: 'Rejected', color: 'var(--text-tertiary)' },
    withdrawn: { label: 'Withdrawn', color: 'var(--text-tertiary)' },
};

const tsfmt = (iso: string) =>
    new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function ElectricityDisputeTracker({ orgId }: Props) {
    const { membership } = useAuth();
    const roles = [membership?.org_role, ...(membership?.all_org_memberships?.map(m => m.role) || [])].filter(Boolean) as string[];
    const canCheck = roles.some(r => ['ops_super_admin', 'org_super_admin', 'master_admin', 'owner'].includes(r));

    const [data, setData] = useState<DisputesPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showResolved, setShowResolved] = useState(false);

    const load = useCallback(async (quiet = false) => {
        if (quiet) setRefreshing(true); else setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/electricity/disputes?organization_id=${orgId}`);
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not load disputes');
            setData(payload as DisputesPayload);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load disputes');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [orgId]);

    useEffect(() => { void load(); }, [load]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24 text-text-tertiary">
                <Loader2 className="w-6 h-6 animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center">
                <AlertTriangle className="w-6 h-6 mx-auto mb-3" style={{ color: 'var(--warning)' }} />
                <p className="text-sm font-bold text-text-primary">{error}</p>
                <button onClick={() => void load()} className="mt-3 text-xs font-bold text-primary">Try again</button>
            </div>
        );
    }

    if (!data?.provisioned) {
        return (
            <div className="rounded-2xl border border-border bg-surface p-10 text-center">
                <AlertTriangle className="w-6 h-6 mx-auto mb-3" style={{ color: 'var(--warning)' }} />
                <p className="text-sm font-bold text-text-primary">Disputes are not set up yet</p>
                <p className="text-xs font-semibold text-text-tertiary mt-2 max-w-md mx-auto">
                    Apply supabase/migrations/20260804000003_electricity_disputes_pending_actions.sql to enable
                    the dispute tracker.
                </p>
            </div>
        );
    }

    const active = data.disputes.filter(d => d.status === 'open' || d.status === 'responded');
    const resolved = data.disputes.filter(d => d.status !== 'open' && d.status !== 'responded');
    const visible = showResolved ? data.disputes : active;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold text-text-tertiary">
                    {active.length} active{resolved.length > 0 && ` · ${resolved.length} resolved`}
                </p>
                <div className="flex items-center gap-2">
                    {resolved.length > 0 && (
                        <button
                            onClick={() => setShowResolved(v => !v)}
                            className="px-3 py-1.5 rounded-xl border border-border text-[11px] font-bold text-text-secondary hover:bg-muted"
                        >
                            {showResolved ? 'Hide resolved' : 'Show resolved'}
                        </button>
                    )}
                    <button
                        onClick={() => void load(true)}
                        className="p-2 rounded-xl border border-border text-text-secondary hover:text-text-primary hover:bg-muted transition-colors"
                        aria-label="Refresh"
                    >
                        <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {visible.length === 0 ? (
                <div className="rounded-2xl border border-border bg-surface p-12 text-center">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--success)' }} />
                    <p className="text-sm font-bold text-text-primary">No active disputes</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {visible.map(d => (
                        <DisputeCard key={d.id} dispute={d} canCheck={canCheck} onChanged={() => void load(true)} />
                    ))}
                </div>
            )}
        </div>
    );
}

function DisputeCard({ dispute, canCheck, onChanged }: {
    dispute: Dispute;
    canCheck: boolean;
    onChanged: () => void;
}) {
    const [body, setBody] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const meta = STATUS_META[dispute.status] ?? STATUS_META.open;
    const responses = [...(dispute.electricity_dispute_responses || [])]
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const isActive = dispute.status === 'open' || dispute.status === 'responded';

    const respond = async () => {
        if (!body.trim()) { setError('Write a response first'); return; }
        setBusy('respond');
        setError(null);
        try {
            const fd = new FormData();
            fd.append('body', body.trim());
            files.forEach(f => fd.append('files', f));
            const res = await fetch(`/api/electricity/disputes/${dispute.id}/respond`, { method: 'POST', body: fd });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not send the response');
            setBody('');
            setFiles([]);
            onChanged();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not send the response');
        } finally {
            setBusy(null);
        }
    };

    const resolve = async (resolution: 'accepted' | 'rejected') => {
        setBusy(resolution);
        setError(null);
        try {
            const res = await fetch('/api/electricity/disputes', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: dispute.id, resolution }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not resolve the dispute');
            onChanged();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not resolve the dispute');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold"
                        style={{ color: meta.color, background: 'var(--muted)' }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
                        {meta.label}
                    </span>
                    <p className="text-sm font-bold text-text-primary mt-1.5">{dispute.reason}</p>
                    <p className="text-[11px] font-semibold text-text-tertiary mt-0.5">
                        Raised {tsfmt(dispute.raised_at)}
                        {dispute.resolved_at && ` · resolved ${tsfmt(dispute.resolved_at)}`}
                    </p>
                </div>
                {canCheck && isActive && (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => resolve('accepted')}
                            disabled={busy !== null}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-[11px] font-bold hover:bg-primary/90 disabled:opacity-50"
                        >
                            {busy === 'accepted' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                            Accept
                        </button>
                        <button
                            onClick={() => resolve('rejected')}
                            disabled={busy !== null}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-[11px] font-bold disabled:opacity-50"
                            style={{ color: 'var(--error)', borderColor: 'var(--error)' }}
                        >
                            <XCircle className="w-3.5 h-3.5" /> Reject
                        </button>
                    </div>
                )}
            </div>

            {dispute.resolution_note && (
                <p className="mt-2 text-[11px] font-semibold text-text-secondary">
                    Resolution note: {dispute.resolution_note}
                </p>
            )}

            {/* Thread */}
            {responses.length > 0 && (
                <div className="mt-3 space-y-2">
                    {responses.map(r => (
                        <div key={r.id} className="rounded-xl bg-surface-elevated p-3">
                            <p className="text-[12px] text-text-primary whitespace-pre-wrap">{r.body}</p>
                            {r.attachments && r.attachments.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {r.attachments.map((a, i) => (
                                        <a
                                            key={i}
                                            href={electricityFileUrl(a.storage_path)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-[10px] font-bold text-primary hover:bg-muted"
                                        >
                                            <Paperclip className="w-3 h-3" /> {a.file_name}
                                        </a>
                                    ))}
                                </div>
                            )}
                            <p className="text-[10px] font-semibold text-text-tertiary mt-1.5">{tsfmt(r.created_at)}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Respond box — active disputes only */}
            {isActive && (
                <div className="mt-3 pt-3 border-t border-border-subtle space-y-2">
                    <textarea
                        value={body}
                        onChange={e => setBody(e.target.value)}
                        rows={2}
                        placeholder="Add a response — context, explanation, evidence…"
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            onClick={() => fileInput.current?.click()}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-[11px] font-bold text-text-secondary hover:bg-muted"
                        >
                            <Paperclip className="w-3.5 h-3.5" />
                            {files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'Attach'}
                        </button>
                        <input
                            ref={fileInput}
                            type="file"
                            multiple
                            className="hidden"
                            onChange={e => setFiles(Array.from(e.target.files || []))}
                        />
                        {files.map((f, i) => (
                            <span key={i} className="px-2 py-1 rounded-lg bg-muted text-[10px] font-bold text-text-secondary">{f.name}</span>
                        ))}
                        <button
                            onClick={respond}
                            disabled={busy !== null}
                            className="ml-auto inline-flex items-center gap-1.5 px-4 py-1.5 bg-primary text-white rounded-lg text-[11px] font-bold hover:bg-primary/90 disabled:opacity-50"
                        >
                            {busy === 'respond' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                            Send
                        </button>
                    </div>
                </div>
            )}

            {error && <p className="mt-2 text-sm" style={{ color: 'var(--error)' }}>{error}</p>}
        </div>
    );
}
