'use client';
import { useState } from 'react';
import { PC_CATEGORIES, PC_DEPARTMENTS } from '@/frontend/lib/pettyCash/roles';
import WorkflowModal from './WorkflowModal';
import ProofUpload from './ProofUpload';
import { pcFetch, pcJson, type Property, type Route, type Upload } from './workflowTypes';
export default function NewRequestModal({ open, properties, organizationId, routes = [], canSubmit = true, blocker, onClose, onCreated }: { open: boolean; properties: Property[]; organizationId?: string; routes?: Route[]; canSubmit?: boolean; blocker?: string | null; onClose: () => void; onCreated: () => void }) {
    const [property, setProperty] = useState(properties.length === 1 ? properties[0].id : '');
    const [proofs, setProofs] = useState<Upload[]>([]); const [uploading, setUploading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    if (!open) return null;
    const actors = routes.filter(r => r.property_id === property);
    const configured = actors.some(r => r.kind === 'allocator') && actors.some(r => r.kind === 'approver');
    return <WorkflowModal title="Request Petty Cash" onClose={onClose} busy={busy || uploading}><form className="space-y-4" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget);
        const saveDraft = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement)?.value === 'draft';
        try { await pcFetch('/api/petty-cash', pcJson({ organization_id: organizationId, property_id: property, amount_requested: form.get('amount'), purpose: form.get('purpose'), department: form.get('department'), category: form.get('category'), payment_mode: 'Cash', documents: proofs, save_draft: saveDraft })); onCreated(); }
        catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); } finally { setBusy(false); }
    }}>
        {properties.length === 1 ? <p>Property: <strong>{properties[0].name}</strong></p> : <label className="block">Property<select aria-label="Property" required className="pc-input" value={property} onChange={e => setProperty(e.target.value)}><option value="">Select assigned property</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        {!properties.length && <p role="alert">An active property assignment is needed to request cash.</p>}
        {property && <div className="rounded-xl border border-border p-3 space-y-1">{actors.map(r => <p key={r.kind}>{r.kind === 'allocator' ? 'Allocator' : 'Approver'}: {r.user?.full_name || r.user?.email}</p>)}{!configured && <p role="alert">Ask an org or ops super admin to configure routing for this property.</p>}</div>}
        <label className="block">Amount (₹)<input className="pc-input" name="amount" type="number" min="0.01" step="0.01" required /></label>
        <label className="block">Purpose<textarea className="pc-input" name="purpose" required maxLength={2000} /></label>
        <div className="grid sm:grid-cols-2 gap-3"><label>Category<select className="pc-input" name="category">{PC_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label><label>Department<select className="pc-input" name="department">{PC_DEPARTMENTS.map(c => <option key={c}>{c}</option>)}</select></label></div>
        <ProofUpload org={organizationId || ''} value={proofs} onChange={setProofs} disabled={busy} onBusyChange={setUploading} />
        {error && <p role="alert" className="text-red-600">{error}</p>}
        {blocker && <p role="status">Submission unavailable: {blocker}. You can save a draft.</p>}
        <div className="flex flex-wrap gap-3 border-t border-border pt-4"><button className="pc-button" disabled={busy || uploading || !property || !configured || !canSubmit}>{busy ? 'Saving…' : 'Submit request'}</button><button className="pc-button pc-button-secondary" type="submit" value="draft" disabled={busy || uploading || !property}>Save draft</button></div>
    </form></WorkflowModal>;
}
