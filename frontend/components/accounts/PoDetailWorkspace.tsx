'use client';

// The ticketing-system replica — one internal page per PO with GST/particulars, every
// payment tranche, the document checklist, the vendor's statutory identity, and a
// chronological activity feed. Modelled directly on app/tickets/[ticketId]/page.tsx:
// tabbed sections, a realtime subscription per table involved, and an activity timeline
// that renders an emailed action differently from an in-app one.
//
// Never gates a button on a role string — every action checks `can.align` / `can.complete`
// as returned by GET /api/accounts/po/[id], the same rule AccountsDashboard follows.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import {
    ArrowLeft, IndianRupee, FileText, Building2, History, ClipboardList,
    Mail, Bot, Upload, Loader2, Wrench, AlertCircle, CheckCircle2, RefreshCw, User,
} from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';
import { inr, liveStatusMeta, derivePoPaymentStatus, PurchaseOrder, PoPayment } from '@/frontend/lib/accounts/roles';
import {
    PoDetailResponse, PoDocument, VendorDocument, PoActivityLogEntry, ComplianceStatus,
    PO_DOC_TYPES, VENDOR_DOC_TYPES,
} from '@/frontend/lib/accounts/trackerTypes';
import AlignPaymentModal from './AlignPaymentModal';
import MarkPaidModal from './MarkPaidModal';

type Section = 'overview' | 'payments' | 'documents' | 'vendor' | 'activity';

const fmtDate = (d?: string | null) => { if (!d) return '—'; try { return format(parseISO(d), 'dd/MM/yyyy'); } catch { return '—'; } };
const fmtDateTime = (d?: string | null) => { if (!d) return '—'; try { return format(parseISO(d), 'dd/MM/yyyy HH:mm'); } catch { return '—'; } };

const ACTION_LABEL: Record<string, string> = {
    po_synced: 'PO synced from Zoho',
    payment_requested: 'Payment requested',
    aligned: 'Aligned for payment',
    completed: 'Payment completed',
    cancelled: 'Payment cancelled',
    utr_recorded: 'UTR recorded',
    document_uploaded: 'Document uploaded',
    document_verified: 'Document verified',
    vendor_updated: 'Vendor profile updated',
    critical_raised: 'Marked critical',
    critical_cleared: 'Critical cleared',
    comment: 'Commented',
    email_sent: 'Email sent',
    email_action: 'Actioned via email',
};

const COMPLIANCE_META: Record<ComplianceStatus, { label: string; cls: string }> = {
    verified: { label: 'Verified', cls: 'text-success bg-success/10' },
    in_review: { label: 'In review', cls: 'text-info bg-info/10' },
    unverified: { label: 'Unverified', cls: 'text-warning bg-warning/10' },
    rejected: { label: 'Rejected', cls: 'text-error bg-error/10' },
    expired: { label: 'Expired', cls: 'text-error bg-error/10' },
};

interface Props { orgId: string; poId: string; }

export default function PoDetailWorkspace({ orgId, poId }: Props) {
    const router = useRouter();
    const [supabase] = useState(() => createClient());

    const [data, setData] = useState<PoDetailResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [section, setSection] = useState<Section>('overview');

    const [alignOpen, setAlignOpen] = useState(false);
    const [payOpen, setPayOpen] = useState<PoPayment | null>(null);

    const fetchDetail = useCallback(async () => {
        try {
            const res = await fetch(`/api/accounts/po/${poId}?org_id=${orgId}`);
            if (res.status === 404) { setNotFound(true); setData(null); return; }
            if (!res.ok) { setFetchError('Could not load this purchase order.'); return; }
            const d: PoDetailResponse = await res.json();
            if (!d.po) { setNotFound(true); setData(null); return; }
            setNotFound(false); setFetchError(null);
            setData(d);
        } catch {
            setFetchError('Could not reach the accounts service.');
        } finally {
            setLoading(false);
        }
    }, [poId, orgId]);

    useEffect(() => { fetchDetail(); }, [fetchDetail]);

    // Realtime — copied verbatim from app/tickets/[ticketId]/page.tsx's pattern (one channel,
    // scoped `.on()` per table, filtered to this row). A single debounce timer shared across
    // all three subscriptions collapses a burst (e.g. document_uploaded firing po_documents +
    // po_activity_log together) into one refetch instead of two.
    const fetchRef = useRef(fetchDetail);
    useEffect(() => { fetchRef.current = fetchDetail; });
    useEffect(() => {
        const timer = { current: null as ReturnType<typeof setTimeout> | null };
        const bump = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => fetchRef.current(), 300); };
        const channel = supabase
            .channel(`po_detail_${poId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'po_payments', filter: `po_id=eq.${poId}` }, bump)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'po_documents', filter: `po_id=eq.${poId}` }, bump)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'po_activity_log', filter: `po_id=eq.${poId}` }, bump)
            .subscribe();
        return () => { if (timer.current) clearTimeout(timer.current); supabase.removeChannel(channel); };
    }, [poId, supabase]);

    if (loading && !data) return <DetailSkeleton />;

    if (notFound) {
        return (
            <EmptyShell orgId={orgId} icon={AlertCircle}
                title="Purchase order not found"
                body="It may have been removed, or belongs to a different organisation." />
        );
    }
    if (fetchError) {
        return (
            <EmptyShell orgId={orgId} icon={AlertCircle} title="Could not load this PO" body={fetchError}
                action={<button onClick={() => { setLoading(true); fetchDetail(); }} className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90"><RefreshCw className="w-4 h-4" /> Retry</button>} />
        );
    }
    if (!data?.po) {
        // The backend for these routes may not exist yet — degrade honestly rather than
        // pretend the page is empty of data.
        return (
            <EmptyShell orgId={orgId} icon={Wrench} title="This PO's detail page isn't wired up yet"
                body="GET /api/accounts/po/[id] hasn't responded with a purchase order. Once the accounts API is live this page will populate automatically." />
        );
    }

    const po = data.po;
    const provisioned = data.provisioned !== false;
    const can = data.can || { align: false, complete: false };
    const payments = data.payments || [];
    const paymentStatus = po.payment_status || derivePoPaymentStatus(payments);
    const meta = liveStatusMeta(paymentStatus);
    const pending = po.pending_amount ?? po.po_amount;

    const tabs: { key: Section; label: string; icon: typeof IndianRupee }[] = [
        { key: 'overview', label: 'Overview', icon: ClipboardList },
        { key: 'payments', label: 'Payments', icon: IndianRupee },
        { key: 'documents', label: 'Documents', icon: FileText },
        { key: 'vendor', label: 'Vendor', icon: Building2 },
        { key: 'activity', label: 'Activity', icon: History },
    ];

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-start gap-3">
                <button onClick={() => router.push(`/${orgId}/accounts`)} className="p-2 -ml-2 mt-0.5 text-text-secondary hover:text-text-primary rounded-lg hover:bg-surface-elevated" aria-label="Back to tracker">
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-xl font-bold text-text-primary">{po.po_number}</h1>
                        <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${meta.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} /> {meta.label}
                        </span>
                    </div>
                    <p className="text-sm text-text-secondary mt-0.5">
                        {po.vendor_name || 'Unknown vendor'} · <span className="tabular-nums font-medium text-text-primary">{inr(po.po_amount)}</span>
                        {po.department && <> · {po.department}</>}
                    </p>
                </div>
                {can.align && paymentStatus === 'to_align' && (
                    <button onClick={() => setAlignOpen(true)} className="px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 whitespace-nowrap">
                        Align payment ▸
                    </button>
                )}
            </div>

            {!provisioned && (
                <div className="flex items-start gap-2 px-4 py-3 rounded-xl border border-warning/30 bg-warning/10 text-sm text-warning">
                    <Wrench className="w-4 h-4 mt-0.5 shrink-0" />
                    <p>Compliance tracking (documents, vendor profile, activity timeline) isn’t set up for this organisation yet. Overview and Payments below reflect live data; the other tabs will populate once the migration is applied.</p>
                </div>
            )}

            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
                {tabs.map(t => {
                    const Icon = t.icon;
                    return (
                        <button key={t.key} onClick={() => setSection(t.key)}
                            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 transition-colors ${
                                section === t.key ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                            <Icon className="w-4 h-4" /> {t.label}
                        </button>
                    );
                })}
            </div>

            {section === 'overview' && <OverviewSection po={po} pending={pending} payments={payments} />}
            {section === 'payments' && (
                <PaymentsSection payments={payments} can={can} pending={pending}
                    onAlign={() => setAlignOpen(true)} onMarkPaid={p => setPayOpen(p)} />
            )}
            {section === 'documents' && (
                provisioned
                    ? <DocumentsSection poId={poId} orgId={orgId} documents={data.documents || []} onChanged={fetchDetail} />
                    : <SectionSetupNotice label="document checklist" />
            )}
            {section === 'vendor' && (
                provisioned
                    ? <VendorSection vendor={data.vendor} vendorDocuments={data.vendor_documents || []} />
                    : <SectionSetupNotice label="vendor profile" />
            )}
            {section === 'activity' && (
                provisioned
                    ? <ActivitySection activity={data.activity || []} />
                    : <SectionSetupNotice label="activity timeline" />
            )}

            {alignOpen && (
                <AlignPaymentModal po={po as PurchaseOrder} onClose={() => setAlignOpen(false)}
                    onDone={() => { setAlignOpen(false); fetchDetail(); }} />
            )}
            {payOpen && (
                <MarkPaidModal payment={payOpen} onClose={() => setPayOpen(null)}
                    onDone={() => { setPayOpen(null); fetchDetail(); }} />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
function OverviewSection({ po, pending, payments }: { po: PoDetailResponse['po']; pending: number; payments: PoPayment[] }) {
    if (!po) return null;
    const alignedTotal = po.aligned_total || 0;
    const completedTotal = po.completed_total || 0;
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-surface rounded-xl border border-border p-4">
                <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-3">PO particulars</h3>
                <dl className="space-y-2 text-sm">
                    <Row label="PO number" value={po.po_number} />
                    <Row label="PO date" value={fmtDate(po.po_date)} />
                    <Row label="Department" value={po.department || '—'} />
                    <Row label="Site / project" value={po.project_name || '—'} />
                    <Row label="Category" value={po.category || '—'} />
                    <Row label="Source" value={po.source || '—'} />
                </dl>
            </div>
            <div className="bg-surface rounded-xl border border-border p-4">
                <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-3">GST &amp; value breakdown</h3>
                <dl className="space-y-2 text-sm">
                    <Row label="Taxable value" value={po.taxable_value != null ? inr(po.taxable_value) : '—'} tabular />
                    <Row label="GST amount" value={po.gst_amount != null ? inr(po.gst_amount) : '—'} tabular />
                    <Row label="PO amount (total)" value={inr(po.po_amount)} bold tabular />
                    <Row label="Aligned so far" value={inr(alignedTotal)} tabular />
                    <Row label="Paid so far" value={inr(completedTotal)} tabular />
                    <Row label="Pending" value={inr(pending)} bold tabular accent="text-warning" />
                </dl>
            </div>
            <div className="bg-surface rounded-xl border border-border p-4 lg:col-span-2">
                <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-3">Tranches at a glance</h3>
                {payments.length === 0 ? (
                    <p className="text-sm text-text-secondary">No payment tranches have been requested yet.</p>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {payments.map(p => {
                            const m = liveStatusMeta(p.status);
                            return (
                                <span key={p.id} className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-bold ${m.text}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} /> #{p.tranche_no} · {p.percent_of_po ? `${p.percent_of_po}% · ` : ''}{inr(p.requested_amount)}
                                </span>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

function Row({ label, value, bold, tabular, accent }: { label: string; value: React.ReactNode; bold?: boolean; tabular?: boolean; accent?: string }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <dt className="text-text-tertiary">{label}</dt>
            <dd className={`${bold ? 'font-bold' : 'font-medium'} ${tabular ? 'tabular-nums' : ''} ${accent || 'text-text-primary'}`}>{value}</dd>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Payments — every tranche, and where the UTR gets captured on "payment done".
// ---------------------------------------------------------------------------
function PaymentsSection({ payments, can, pending, onAlign, onMarkPaid }: {
    payments: PoPayment[]; can: { align: boolean; complete: boolean };
    pending: number; onAlign: () => void; onMarkPaid: (p: PoPayment) => void;
}) {
    return (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <p className="text-sm font-bold text-text-primary">Payment tranches</p>
                {can.align && pending > 0 && (
                    <button onClick={onAlign} className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90">
                        + Align another tranche
                    </button>
                )}
            </div>
            {payments.length === 0 ? (
                <div className="px-4 py-14 text-center text-text-secondary">
                    <IndianRupee className="w-9 h-9 mx-auto mb-2 text-text-tertiary" />
                    <p className="font-medium text-sm">No tranches yet — procurement hasn’t sent this PO to accounts.</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-surface-elevated border-b border-border text-left">
                                {['#', '%', 'Requested', 'GST hold', 'TDS', 'Status', 'UTR', 'Proof', ''].map((h, i) => (
                                    <th key={i} className="px-4 py-2.5 text-xs font-bold text-text-secondary uppercase tracking-wide whitespace-nowrap">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {payments.map(p => {
                                const m = liveStatusMeta(p.status);
                                return (
                                    <tr key={p.id} className="hover:bg-surface-elevated transition-colors">
                                        <td className="px-4 py-3 text-sm font-bold text-text-primary">{p.tranche_no}</td>
                                        <td className="px-4 py-3 text-sm text-text-secondary tabular-nums">{p.percent_of_po ? `${p.percent_of_po}%` : '—'}</td>
                                        <td className="px-4 py-3 text-sm font-bold text-text-primary tabular-nums">{inr(p.requested_amount)}</td>
                                        <td className="px-4 py-3 text-sm text-text-secondary tabular-nums">{inr(p.gst_hold)}</td>
                                        <td className="px-4 py-3 text-sm text-text-secondary tabular-nums">{inr(p.tds)}</td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${m.text}`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} /> {m.label}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs font-mono text-text-secondary whitespace-nowrap">{p.utr_no || '—'}</td>
                                        <td className="px-4 py-3">
                                            {p.payment_proof_url
                                                ? <a href={p.payment_proof_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-primary inline-flex items-center gap-1 text-xs font-bold"><FileText className="w-3.5 h-3.5" /> View</a>
                                                : <span className="text-xs text-text-tertiary">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {can.complete && p.status === 'aligned' && (
                                                <button onClick={() => onMarkPaid(p)} className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90 whitespace-nowrap">
                                                    Mark paid ▸
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Documents — tax invoice, proforma, delivery challan, GRN, work completion.
// ---------------------------------------------------------------------------
function DocumentsSection({ poId, orgId, documents, onChanged }: { poId: string; orgId: string; documents: PoDocument[]; onChanged: () => void }) {
    const [uploadingType, setUploadingType] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const byType = new Map(documents.map(d => [d.doc_type, d]));
    const acquired = PO_DOC_TYPES.filter(t => {
        const d = byType.get(t.key);
        return d && (d.status === 'uploaded' || d.status === 'verified');
    }).length;

    const upload = async (docType: string, file: File | null) => {
        if (!file) return;
        setUploadingType(docType); setErr(null);
        try {
            const fd = new FormData(); fd.append('file', file);
            const up = await fetch('/api/accounts/upload', { method: 'POST', body: fd });
            if (!up.ok) throw new Error('Upload failed');
            const uploaded = await up.json();
            const res = await fetch(`/api/accounts/po/${poId}/documents`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organization_id: orgId, doc_type: docType, file_url: uploaded.url, file_name: uploaded.file_name }),
            });
            if (res.status === 404) { setErr('Document registration isn’t wired up on the server yet — the file uploaded but couldn’t be recorded against this PO.'); return; }
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Could not save the document'); }
            onChanged();
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Upload failed');
        } finally {
            setUploadingType(null);
        }
    };

    return (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <p className="text-sm font-bold text-text-primary">Document checklist</p>
                <span className="text-xs font-bold text-text-secondary tabular-nums">{acquired} of {PO_DOC_TYPES.length} acquired</span>
            </div>
            {err && <p className="px-4 pt-3 text-xs text-error">{err}</p>}
            <div className="divide-y divide-border">
                {PO_DOC_TYPES.map(t => {
                    const doc = byType.get(t.key);
                    const acquired_ = doc && (doc.status === 'uploaded' || doc.status === 'verified');
                    return (
                        <div key={t.key} className="flex items-center justify-between gap-3 px-4 py-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                                {acquired_ ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" /> : <AlertCircle className="w-4 h-4 text-warning shrink-0" />}
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-text-primary truncate">{t.label}</p>
                                    {doc?.invoice_no && <p className="text-xs text-text-tertiary truncate">Invoice {doc.invoice_no} · {fmtDate(doc.invoice_date)} · {doc.invoice_amount != null ? inr(doc.invoice_amount) : ''}</p>}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                {doc?.status === 'verified' && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold text-success bg-success/10">Verified</span>}
                                {doc?.file_url && (
                                    <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="text-primary text-xs font-bold inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> View</a>
                                )}
                                <label className="flex items-center gap-1.5 px-2.5 py-1.5 border border-dashed border-border rounded-lg text-xs font-bold text-text-secondary cursor-pointer hover:border-primary/40">
                                    {uploadingType === t.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                                    {doc ? 'Replace' : 'Upload'}
                                    <input type="file" className="hidden" onChange={e => upload(t.key, e.target.files?.[0] || null)} accept="application/pdf,image/*" />
                                </label>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Vendor — statutory identity + that vendor's own document checklist.
// ---------------------------------------------------------------------------
function VendorSection({ vendor, vendorDocuments }: { vendor: PoDetailResponse['vendor']; vendorDocuments: VendorDocument[] }) {
    if (!vendor) {
        return (
            <div className="bg-surface rounded-xl border border-border p-10 text-center">
                <Building2 className="w-9 h-9 mx-auto mb-3 text-text-tertiary" />
                <p className="font-bold text-text-primary">No vendor profile linked yet</p>
                <p className="text-sm text-text-secondary mt-1">GSTIN, PAN, Udyam and bank details will appear here once this vendor is onboarded into the compliance layer.</p>
            </div>
        );
    }
    const cmeta = COMPLIANCE_META[vendor.compliance_status] || COMPLIANCE_META.unverified;
    const byType = new Map(vendorDocuments.map(d => [d.doc_type, d]));
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-surface rounded-xl border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wide">Statutory identity</h3>
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold ${cmeta.cls}`}>{cmeta.label}</span>
                </div>
                <dl className="space-y-2 text-sm">
                    <Row label="Vendor" value={vendor.vendor_name} />
                    <Row label="GSTIN" value={vendor.gstin || '—'} />
                    <Row label="PAN" value={vendor.pan || '—'} />
                    <Row label="Udyam number" value={vendor.udyam_number || '—'} />
                    <Row label="MSME category" value={vendor.msme_category ? vendor.msme_category.replace(/_/g, ' ') : '—'} />
                    <Row label="CIN" value={vendor.cin || '—'} />
                </dl>
            </div>
            <div className="bg-surface rounded-xl border border-border p-4">
                <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-3">Banking &amp; contact</h3>
                <dl className="space-y-2 text-sm">
                    <Row label="Account name" value={vendor.bank_account_name || '—'} />
                    <Row label="Account number" value={vendor.bank_account_number || '—'} />
                    <Row label="IFSC" value={vendor.bank_ifsc || '—'} />
                    <Row label="Contact" value={vendor.contact_name || '—'} />
                    <Row label="Email" value={vendor.contact_email || '—'} />
                    <Row label="Phone" value={vendor.contact_phone || '—'} />
                </dl>
            </div>
            <div className="bg-surface rounded-xl border border-border p-4 lg:col-span-2">
                <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-3">Vendor document checklist</h3>
                <div className="divide-y divide-border">
                    {VENDOR_DOC_TYPES.map(t => {
                        const doc = byType.get(t.key);
                        const ok = doc && (doc.status === 'uploaded' || doc.status === 'verified');
                        return (
                            <div key={t.key} className="flex items-center justify-between gap-3 py-2.5">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    {ok ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" /> : <AlertCircle className="w-4 h-4 text-warning shrink-0" />}
                                    <span className="text-sm text-text-primary truncate">{t.label}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {doc?.status === 'verified' && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold text-success bg-success/10">Verified</span>}
                                    {doc?.expires_on && <span className="text-xs text-text-tertiary">exp. {fmtDate(doc.expires_on)}</span>}
                                    {doc?.file_url
                                        ? <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="text-primary text-xs font-bold inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> View</a>
                                        : <span className="text-xs text-text-tertiary">Missing</span>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Activity — the ticket-style timeline. Emailed actions render distinctly from in-app ones.
// ---------------------------------------------------------------------------
function ActivitySection({ activity }: { activity: PoActivityLogEntry[] }) {
    const sorted = [...activity].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (sorted.length === 0) {
        return (
            <div className="bg-surface rounded-xl border border-border p-10 text-center">
                <History className="w-9 h-9 mx-auto mb-3 text-text-tertiary" />
                <p className="font-medium text-text-secondary">No activity recorded for this PO yet.</p>
            </div>
        );
    }
    return (
        <div className="bg-surface rounded-xl border border-border p-4">
            <ol className="space-y-4">
                {sorted.map(a => {
                    const isEmail = a.actor_channel === 'email';
                    const isAutomated = a.actor_channel === 'system' || a.actor_channel === 'cron';
                    return (
                        <li key={a.id} className="flex gap-3">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                                isEmail ? 'bg-info/10 text-info' : isAutomated ? 'bg-muted text-text-tertiary' : 'bg-primary/10 text-primary'}`}>
                                {isEmail ? <Mail className="w-3.5 h-3.5" /> : isAutomated ? <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-bold text-text-primary">{a.actor_name || (isAutomated ? 'System' : 'Someone')}</span>
                                    <span className="text-sm text-text-secondary">{ACTION_LABEL[a.action] || a.action.replace(/_/g, ' ')}</span>
                                    {isEmail && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide text-info bg-info/10">via email</span>}
                                </div>
                                {a.note && <p className="text-sm text-text-secondary mt-0.5">{a.note}</p>}
                                <p className="text-xs text-text-tertiary mt-0.5 tabular-nums">{fmtDateTime(a.created_at)}</p>
                            </div>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Shared shells
// ---------------------------------------------------------------------------
function SectionSetupNotice({ label }: { label: string }) {
    return (
        <div className="bg-surface rounded-xl border border-border p-10 text-center">
            <Wrench className="w-9 h-9 mx-auto mb-3 text-text-tertiary" />
            <p className="font-bold text-text-primary">The {label} isn’t set up yet</p>
            <p className="text-sm text-text-secondary mt-1">This appears once the payment-tracker compliance migration is applied to this organisation.</p>
        </div>
    );
}

function EmptyShell({ orgId, icon: Icon, title, body, action }: { orgId: string; icon: typeof AlertCircle; title: string; body: string; action?: React.ReactNode }) {
    const router = useRouter();
    return (
        <div className="flex flex-col items-center justify-center py-24 text-center">
            <button onClick={() => router.push(`/${orgId}/accounts`)} className="self-start mb-6 -mt-6 inline-flex items-center gap-1.5 text-sm font-bold text-text-secondary hover:text-text-primary">
                <ArrowLeft className="w-4 h-4" /> Back to Payment Tracker
            </button>
            <Icon className="w-10 h-10 text-text-tertiary mb-3" />
            <p className="font-bold text-text-primary">{title}</p>
            <p className="text-sm text-text-secondary mt-1 max-w-md">{body}</p>
            {action}
        </div>
    );
}

function DetailSkeleton() {
    return (
        <div className="space-y-5">
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-muted animate-pulse" />
                <div className="space-y-2">
                    <div className="h-5 w-40 bg-muted rounded animate-pulse" />
                    <div className="h-3 w-56 bg-muted rounded animate-pulse" />
                </div>
            </div>
            <div className="h-9 w-full bg-muted rounded animate-pulse" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {[...Array(2)].map((_, i) => <div key={i} className="h-40 bg-muted rounded-xl animate-pulse" />)}
            </div>
        </div>
    );
}
