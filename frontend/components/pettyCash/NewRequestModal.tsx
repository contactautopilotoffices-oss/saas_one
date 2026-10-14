'use client';

import { useState } from 'react';
import { PC_CATEGORIES, PC_DEPARTMENTS } from '@/frontend/lib/pettyCash/roles';
import WorkflowModal from './WorkflowModal';
import ProofUpload from './ProofUpload';
import { pcFetch, pcJson, type Property, type Route, type Upload } from './workflowTypes';

export default function NewRequestModal({
    open,
    properties,
    organizationId,
    routes = [],
    canSubmit = true,
    blocker,
    onClose,
    onCreated
}: {
    open: boolean;
    properties: Property[];
    organizationId?: string;
    routes?: Route[];
    canSubmit?: boolean;
    blocker?: string | null;
    onClose: () => void;
    onCreated: () => void;
}) {
    const [property, setProperty] = useState(properties.length === 1 ? properties[0].id : '');
    const [proofs, setProofs] = useState<Upload[]>([]);
    const [uploading, setUploading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [selectedCategory, setSelectedCategory] = useState(PC_CATEGORIES[0] || 'Travel');
    const [customCategory, setCustomCategory] = useState('');

    if (!open) return null;

    const actors = routes.filter(r => r.property_id === property);
    const configured = actors.some(r => r.kind === 'allocator') && actors.some(r => r.kind === 'approver');

    return (
        <WorkflowModal title="Request Petty Cash" onClose={onClose} busy={busy || uploading}>
            <form
                className="space-y-4"
                onSubmit={async event => {
                    event.preventDefault();
                    setBusy(true);
                    setError('');
                    const form = new FormData(event.currentTarget);
                    const saveDraft = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement)?.value === 'draft';
                    const rawCategory = String(form.get('category') || selectedCategory);
                    const custom = String(form.get('custom_category') || customCategory).trim();
                    const category = (rawCategory === 'custom' || rawCategory === 'Other') && custom ? custom : rawCategory === 'custom' ? 'Other' : rawCategory || 'General';

                    try {
                        await pcFetch(
                            '/api/petty-cash',
                            pcJson({
                                organization_id: organizationId,
                                property_id: property,
                                amount_requested: form.get('amount'),
                                purpose: form.get('purpose'),
                                department: form.get('department'),
                                category,
                                payment_mode: 'Cash',
                                documents: proofs,
                                save_draft: saveDraft
                            })
                        );
                        onCreated();
                    } catch (e) {
                        setError(e instanceof Error ? e.message : 'Request failed');
                    } finally {
                        setBusy(false);
                    }
                }}
            >
                {properties.length === 1 ? (
                    <p>
                        Property: <strong>{properties[0].name}</strong>
                    </p>
                ) : (
                    <label className="block">
                        Property
                        <select
                            aria-label="Property"
                            required
                            className="pc-input"
                            value={property}
                            onChange={e => setProperty(e.target.value)}
                        >
                            <option value="">Select assigned property</option>
                            {properties.map(p => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                {!properties.length && <p role="alert">An active property assignment is needed to request cash.</p>}
                {property && (
                    <div className="rounded-xl border border-border p-3 space-y-1">
                        {actors.map(r => (
                            <p key={r.kind}>
                                {r.kind === 'allocator' ? 'Allocator' : 'Approver'}: {r.user?.full_name || r.user?.email}
                            </p>
                        ))}
                        {!configured && <p role="alert">Ask an org or ops super admin to configure routing for this property.</p>}
                    </div>
                )}
                <label className="block">
                    Amount (₹)
                    <input className="pc-input" name="amount" type="number" min="0.01" step="0.01" required />
                </label>
                <label className="block">
                    Purpose
                    <textarea className="pc-input" name="purpose" required maxLength={2000} />
                </label>
                <div className="grid sm:grid-cols-2 gap-3">
                    <label className="block">
                        <span className="flex items-center justify-between">
                            <span>Category</span>
                            {selectedCategory === 'custom' ? (
                                <button
                                    type="button"
                                    onClick={() => setSelectedCategory(PC_CATEGORIES[0] || 'Travel')}
                                    className="text-[10px] font-bold text-primary hover:underline"
                                >
                                    Select from list
                                </button>
                            ) : null}
                        </span>
                        <select
                            className="pc-input"
                            name="category"
                            value={selectedCategory}
                            onChange={e => setSelectedCategory(e.target.value)}
                        >
                            {PC_CATEGORIES.map(c => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                            <option value="custom">Other / Custom (Write your own)…</option>
                        </select>
                        {selectedCategory === 'custom' && (
                            <input
                                className="pc-input mt-2"
                                name="custom_category"
                                placeholder="Type custom category name…"
                                value={customCategory}
                                onChange={e => setCustomCategory(e.target.value)}
                                autoFocus
                                required
                            />
                        )}
                    </label>
                    <label className="block">
                        Department
                        <select className="pc-input" name="department">
                            {PC_DEPARTMENTS.map(c => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                {/* Supporting Documents Section with Explicit Optional Clarity */}
                <div className="rounded-2xl border border-slate-200/80 dark:border-[#30363d] p-3.5 space-y-2 bg-slate-50/60 dark:bg-[#161b22]/40">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                            Supporting Quotation / Estimate <span className="font-normal text-slate-400">(Optional)</span>
                        </span>
                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                            No bills needed now
                        </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        Receipts and bills are <strong>not required</strong> when requesting cash. You will submit spend receipts during settlement after cash is used. You may optionally attach a vendor quotation or estimate here if available.
                    </p>
                    <ProofUpload
                        org={organizationId || ''}
                        value={proofs}
                        onChange={setProofs}
                        disabled={busy}
                        onBusyChange={setUploading}
                        label="Attach Quotation / Estimate (Optional)"
                    />
                </div>

                {error && <p role="alert" className="text-red-600">{error}</p>}
                {blocker && <p role="status">Submission unavailable: {blocker}. You can save a draft.</p>}
                <div className="flex flex-wrap gap-3 border-t border-border pt-4">
                    <button
                        className="pc-button"
                        disabled={busy || uploading || !property || !configured || !canSubmit}
                    >
                        {busy ? 'Saving…' : 'Submit request'}
                    </button>
                    <button
                        className="pc-button pc-button-secondary"
                        type="submit"
                        value="draft"
                        disabled={busy || uploading || !property}
                    >
                        Save draft
                    </button>
                </div>
            </form>
        </WorkflowModal>
    );
}
