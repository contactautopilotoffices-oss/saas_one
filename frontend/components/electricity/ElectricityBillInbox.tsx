'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, FileText, Inbox, Link2, Loader2, RefreshCw, X, ShieldAlert, ShieldCheck, Eye } from 'lucide-react';
import {
    electricityFileUrl, monthLabel, OCR_FIELD_LABELS,
    type AccountLite, type BillDocument, type DocumentsPayload,
} from '@/frontend/lib/electricity/trackerTypes';

/**
 * Phase 1 Inbox — the human review queue for the mailbox pipeline. Two kinds of rows
 * land here (the API filters to exactly these): parse failures, and parsed PDFs that
 * matched no billing account. Everything else is already visible in the Register.
 * The manual-match modal links a document to an account; the API re-runs the bill
 * upsert from the stored OCR payload where a billing month was parsed.
 */

interface Props {
    orgId: string;
    accounts: AccountLite[];
}

const dfmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export default function ElectricityBillInbox({ orgId, accounts }: Props) {
    const [data, setData] = useState<DocumentsPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [matching, setMatching] = useState<BillDocument | null>(null);

    const load = useCallback(async (quiet = false) => {
        if (quiet) setRefreshing(true); else setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/electricity/documents?org_id=${orgId}`);
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not load the bill inbox');
            setData(payload as DocumentsPayload);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the bill inbox');
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
                <p className="text-sm font-bold text-text-primary">The bill inbox is not set up yet</p>
                <p className="text-xs font-semibold text-text-tertiary mt-2 max-w-md mx-auto">
                    Apply supabase/migrations/20260804000001_electricity_bill_ingestion.sql to enable
                    mailbox ingestion.
                </p>
            </div>
        );
    }

    // Quarantined mail is separated out and shown first: it is a security decision, not a
    // data-entry queue, and it must never be one row among many in a table somebody scrolls.
    const quarantined = data.documents.filter(d => d.sender_status === 'quarantined');
    const docs = data.documents.filter(d => d.sender_status !== 'quarantined');

    return (
        <div className="space-y-3">
            {quarantined.length > 0 && (
                <QuarantinePanel orgId={orgId} documents={quarantined} onReleased={() => void load(true)} />
            )}

            <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold text-text-tertiary">
                    {docs.length === 0
                        ? 'Nothing needs review — every received bill is parsed and matched.'
                        : `${docs.length} document${docs.length === 1 ? '' : 's'} need a human: parse failures, low-confidence fields, and PDFs that matched no billing account.`}
                </p>
                <button
                    onClick={() => void load(true)}
                    className="p-2 rounded-xl border border-border text-text-secondary hover:text-text-primary hover:bg-muted transition-colors"
                    aria-label="Refresh"
                >
                    <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {docs.length === 0 ? (
                <div className="rounded-2xl border border-border bg-surface p-12 text-center">
                    <Inbox className="w-8 h-8 mx-auto mb-3 text-text-tertiary" />
                    <p className="text-sm font-bold text-text-primary">Inbox zero</p>
                </div>
            ) : (
                <div className="rounded-2xl border border-border bg-surface overflow-hidden">
                    <table className="w-full border-collapse">
                        <thead className="bg-surface-elevated">
                            <tr className="border-b border-border">
                                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Received</th>
                                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">From</th>
                                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Subject / file</th>
                                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Parse</th>
                                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Parsed month</th>
                                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border-subtle">
                            {docs.map(d => {
                                const rawMonth = (d.ocr_payload?.raw?.billing_month as string | undefined) ?? null;
                                return (
                                    <tr key={d.id} className="hover:bg-muted/60 transition-colors">
                                        <td className="px-3 py-[7px] text-[11px] font-semibold text-text-secondary whitespace-nowrap">{dfmt(d.received_at)}</td>
                                        <td className="px-3 py-[7px] text-[11px] font-semibold text-text-secondary">
                                            <span className="truncate block max-w-[200px]">{d.from_address || '—'}</span>
                                        </td>
                                        <td className="px-3 py-[7px] text-[11px]">
                                            <span className="truncate block max-w-[260px] font-bold text-text-primary">{d.subject || '—'}</span>
                                            {d.storage_path ? (
                                                <a
                                                    href={electricityFileUrl(d.storage_path)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1 text-[10px] font-bold text-primary hover:underline"
                                                >
                                                    <FileText className="w-3 h-3" /> {d.file_name || 'View PDF'}
                                                </a>
                                            ) : (
                                                <span className="text-[10px] font-semibold text-text-tertiary">{d.file_name || '—'}</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-[7px] text-[11px]">
                                            <FieldConfidence doc={d} />
                                            <span
                                                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold"
                                                style={d.ocr_status === 'failed'
                                                    ? { color: 'var(--error)', background: 'rgba(239,68,68,0.10)' }
                                                    : { color: 'var(--warning)', background: 'rgba(245,158,11,0.10)' }}
                                            >
                                                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />
                                                {d.ocr_status === 'failed' ? 'Parse failed' : 'No account match'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-[7px] text-[11px] font-semibold text-text-secondary whitespace-nowrap">
                                            {rawMonth ? monthLabel(rawMonth) : '—'}
                                        </td>
                                        <td className="px-3 py-[7px] text-right whitespace-nowrap">
                                            <button
                                                onClick={() => setMatching(d)}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-[11px] font-bold hover:bg-primary/90"
                                            >
                                                <Link2 className="w-3.5 h-3.5" /> Match account
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {matching && (
                <MatchModal
                    doc={matching}
                    accounts={accounts}
                    onClose={() => setMatching(null)}
                    onDone={() => { setMatching(null); void load(true); }}
                />
            )}
        </div>
    );
}

function MatchModal({ doc, accounts, onClose, onDone }: {
    doc: BillDocument;
    accounts: AccountLite[];
    onClose: () => void;
    onDone: () => void;
}) {
    const [accountId, setAccountId] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (!accountId) { setError('Pick a billing account'); return; }
        setSaving(true);
        setError(null);
        try {
            const res = await fetch('/api/electricity/documents', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: doc.id, account_id: accountId }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not link the document');
            onDone();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not link the document');
        } finally {
            setSaving(false);
        }
    };

    if (typeof document === 'undefined') return null;
    return createPortal(
        <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4" onClick={onClose}>
            <div onClick={e => e.stopPropagation()} className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <h3 className="text-base font-bold text-text-primary">Match to a billing account</h3>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-xl"><X className="w-5 h-5 text-text-secondary" /></button>
                </div>

                <div className="px-6 py-4 space-y-4">
                    <div className="bg-surface-elevated rounded-xl p-3 text-sm">
                        <div className="flex justify-between gap-3">
                            <span className="text-text-tertiary">From</span>
                            <span className="text-text-primary font-medium text-right truncate">{doc.from_address || '—'}</span>
                        </div>
                        <div className="flex justify-between gap-3 mt-1">
                            <span className="text-text-tertiary">File</span>
                            <span className="text-text-primary font-medium text-right truncate">{doc.file_name || '—'}</span>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1.5">Billing account *</label>
                        <select
                            autoFocus
                            value={accountId}
                            onChange={e => setAccountId(e.target.value)}
                            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        >
                            <option value="">Select…</option>
                            {accounts.map(a => (
                                <option key={a.id} value={a.id}>
                                    {a.site_label} · {a.provider}{a.consumer_ref ? ` #${a.consumer_ref}` : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    <p className="text-[11px] text-text-tertiary">
                        Where the parse produced a billing month, the bill row is created (or updated) from the
                        stored OCR data. Otherwise the link is recorded so the original PDF stays reachable.
                    </p>
                    {error && <p className="text-sm" style={{ color: 'var(--error)' }}>{error}</p>}
                </div>

                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-surface-elevated">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-muted rounded-xl">Cancel</button>
                    <button
                        onClick={submit}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 px-5 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50"
                    >
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />} Link account
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}

/* ------------------------------------------------------------------ quarantine */

/**
 * Mail held because its sender is not on the electricity allow-list (REQ-E-01).
 *
 * The spec's reasoning: "Utility bill mail is a high-value phishing target and this inbox
 * will eventually touch payment amounts." Nothing here has been parsed or forwarded — the
 * PDF was stored and stopped. Releasing is a deliberate human act, recorded against a name,
 * and "trust this sender" adds the exact address (never the whole domain) to the allow-list
 * so a genuine board only has to be admitted once.
 */
function QuarantinePanel({ orgId, documents, onReleased }: {
    orgId: string;
    documents: BillDocument[];
    onReleased: () => void;
}) {
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const release = async (doc: BillDocument, trustSender: boolean) => {
        setBusyId(doc.id);
        setError(null);
        try {
            const res = await fetch(`/api/electricity/documents?org_id=${orgId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: doc.id, action: 'release', trust_sender: trustSender }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.error || 'Could not release this document');
            onReleased();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not release this document');
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="rounded-2xl border p-5"
            style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.04)' }}>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] mb-1 flex items-center gap-1.5"
                style={{ color: 'var(--error)' }}>
                <ShieldAlert className="w-3 h-3" /> Quarantined · {documents.length}
            </p>
            <p className="text-[11px] font-semibold text-text-secondary mb-4 leading-relaxed">
                These arrived from an address that is not on the electricity allow-list. They have
                <strong> not</strong> been read, parsed, or forwarded to any site. Open the PDF to check it is a
                genuine bill before releasing it.
            </p>

            <ul className="space-y-2">
                {documents.map(d => (
                    <li key={d.id} className="rounded-xl border border-border bg-surface p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-[11px] font-bold text-text-primary truncate max-w-[320px]">
                                    {d.subject || '(no subject)'}
                                </p>
                                <p className="text-[10px] font-semibold text-text-tertiary">
                                    From <span className="font-black text-text-secondary">{d.from_address || 'unknown'}</span>
                                    {' · '}{dfmt(d.received_at)}
                                </p>
                                {d.storage_path && (
                                    <a href={electricityFileUrl(d.storage_path)} target="_blank" rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold text-primary hover:underline">
                                        <Eye className="w-3 h-3" /> Inspect {d.file_name || 'PDF'}
                                    </a>
                                )}
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                                    onClick={() => void release(d, false)}
                                    disabled={busyId === d.id}
                                    className="px-2.5 py-1.5 rounded-lg border border-border text-[10px] font-bold text-text-secondary hover:text-text-primary hover:bg-muted transition-colors disabled:opacity-40"
                                >
                                    {busyId === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Release once'}
                                </button>
                                <button
                                    onClick={() => void release(d, true)}
                                    disabled={busyId === d.id}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary text-white text-[10px] font-bold disabled:opacity-40"
                                >
                                    <ShieldCheck className="w-3 h-3" /> Release &amp; trust sender
                                </button>
                            </div>
                        </div>
                    </li>
                ))}
            </ul>

            {error && (
                <p className="mt-3 text-[10px] font-bold" style={{ color: 'var(--error)' }}>{error}</p>
            )}
        </div>
    );
}

/* ------------------------------------------------------------ field confidence */

/**
 * Which field on this bill is the system least sure about (REQ-E-02).
 *
 * The requirement is explicit that one number per document is the wrong shape — a bill can
 * be certain about its total and guessing at its due date. This shows the weakest critical
 * field by name, and the full per-field breakdown on hover, so the reviewer knows what to
 * check without opening the PDF.
 */
function FieldConfidence({ doc }: { doc: BillDocument }) {
    if (!doc.needs_field_review || !doc.lowest_confidence_field) return null;

    const entries = Object.entries(doc.field_confidence || {})
        .filter(([, v]) => typeof v === 'number')
        .sort((a, b) => a[1] - b[1]);

    const label = OCR_FIELD_LABELS[doc.lowest_confidence_field] || doc.lowest_confidence_field;
    const breakdown = entries
        .map(([k, v]) => `${OCR_FIELD_LABELS[k] || k}: ${v}%`)
        .join('\n');

    return (
        <span
            title={breakdown ? `Per-field confidence\n\n${breakdown}` : undefined}
            className="inline-flex items-center gap-1.5 px-2 py-1 mb-1 rounded-lg text-[10px] font-bold cursor-help"
            style={{ color: 'var(--error)', background: 'rgba(239,68,68,0.10)' }}
        >
            <AlertTriangle className="w-3 h-3" />
            {label} {doc.lowest_confidence ?? 0}%
        </span>
    );
}
