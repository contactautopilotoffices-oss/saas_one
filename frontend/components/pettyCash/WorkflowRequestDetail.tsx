'use client';
import { useCallback, useEffect, useState } from 'react';
import { inr, PC_STATUS_META, PC_PAYMENT_MODES } from '@/frontend/lib/pettyCash/roles';
import WorkflowModal from './WorkflowModal';
import ProofUpload from './ProofUpload';
import ExpenseForm from './ExpenseForm';
import ExpenseTable from './ExpenseTable';
import ReassignmentFields from './ReassignmentFields';
import { pcFetch, pcJson, pettyCashDate, pettyCashToday, type Context, type Detail, type Upload, type Expense } from './workflowTypes';
export default function WorkflowRequestDetail({ context, id, onClose, onChanged }: { context: Context; id: string; onClose: () => void; onChanged: () => void }) {
    const [detail, setDetail] = useState<Detail | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
    const [legacyAmounts, setLegacyAmounts] = useState<Record<string, string>>({});
    const [action, setAction] = useState(''); const [proofs, setProofs] = useState<Upload[]>([]); const [uploading, setUploading] = useState(false); const [expense, setExpense] = useState(false); const [correction, setCorrection] = useState<Expense>();
    const refresh = useCallback(async () => { try { setDetail(await pcFetch<Detail>(`/api/petty-cash/${id}?org_id=${context.organization_id}`)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load request'); } }, [id, context.organization_id]);
    useEffect(() => { void refresh(); }, [refresh]);
    const changed = async () => { setAction(''); setProofs([]); setExpense(false); setCorrection(undefined); await refresh(); onChanged(); };
    const r = detail?.request; const owner = r?.requester_id === context.user_id;
    const canAllocate = r?.workflow_version === 2 && r.status === 'submitted' && r.assigned_allocator_id === context.user_id && !owner;
    const canApprove = r?.workflow_version === 2 && r.status === 'pending_approval' && r?.assigned_approver_id === context.user_id && !owner;
    const finance = context.caps.canDisburse && r && !owner;
    const funded = !!r && ['paid', 'settlement_submitted', 'closed'].includes(r.status);
    const missingCredit = !!(r?.workflow_version === 2 && funded && Number(r.paid_amount) > 0 && detail?.wallet && detail.wallet.received === 0);
    const actions: { key: string; label: string }[] = [];
    if (canAllocate) actions.push({ key: 'allocate', label: 'Allocate cash' });
    if (canApprove) actions.push({ key: 'approve', label: 'Approve allocation' });
    if (canAllocate || canApprove) actions.push({ key: 'send_back', label: 'Send back' }, { key: 'reject', label: 'Reject' });
    if (finance && r.status === 'approved') actions.push({ key: 'pay', label: 'Mark Paid' });
    if (finance && r.status === 'settlement_submitted') actions.push({ key: 'close', label: 'Review and close' });
    if (finance && ['paid', 'settlement_submitted'].includes(r.status) && (r.workflow_version === 2 ? detail.balance : detail.reconciliation?.unaccounted || 0) > 0) actions.push({ key: 'return', label: 'Confirm returned cash' });
    if (owner && r?.status === 'sent_back') actions.push({ key: 'resubmit', label: 'Correct and resubmit' });
    if (owner && r?.status === 'draft') actions.push({ key: 'submit', label: 'Edit or submit draft' });
    if (owner && r && !missingCredit && ['paid', 'settlement_submitted'].includes(r.status) && (!detail?.balance || r.workflow_version === 1)) actions.push({ key: 'settle', label: 'Submit reconciliation' });
    if (owner && r && ['draft', 'submitted', 'pending_approval', 'sent_back', 'approved'].includes(r.status)) actions.push({ key: 'cancel', label: 'Cancel unfunded request' });
    if (context.caps.canManageRouting && r && ['submitted', 'pending_approval', 'sent_back'].includes(r.status)) actions.push({ key: 'reassign', label: 'Reassign routing' });
    if (r?.request_type === 'reimbursement') actions.length = 0;
    return <WorkflowModal title={r?.request_no || 'Petty cash request'} onClose={onClose} busy={busy || uploading}>
        {error && <p role="alert" className="text-red-600">{error}</p>}
        {!detail ? (!error && <p role="status">Loading request…</p>) : <>
            <div className="pc-detail-summary grid sm:grid-cols-2 gap-3 rounded-xl border border-border bg-surface-elevated text-sm"><p>Property: <strong>{r?.property?.name}</strong></p><p>Requester: <strong>{r?.requester?.full_name || r?.requester?.email}</strong></p><p>Status: <strong>{PC_STATUS_META[r!.status]?.label || r!.status}</strong></p><p>Requested: <strong>{inr(r!.amount_requested)}</strong></p><p>Allocator: {r?.assigned_allocator?.full_name || r?.assigned_allocator?.email || 'Not assigned (legacy)'}</p><p>Approver: {r?.assigned_approver?.full_name || r?.assigned_approver?.email || 'Not assigned'}</p><p>Allocated: {inr(r?.allocated_amount)}</p><p>Approved: {inr(r?.approved_amount)}</p>{(r?.workflow_version === 1 || !detail.wallet) && <><p>Paid: {inr(r?.paid_amount)}</p><p>Remaining: <strong>{inr(detail.balance)}</strong></p></>}</div>
            {funded && r?.workflow_version === 2 && detail.wallet && <section aria-label="Request cash summary" className="grid grid-cols-2 lg:grid-cols-4 gap-3">{(['received', 'spent', 'returned', 'balance'] as const).map(key => <div className="pc-panel pc-summary" key={key}><p className="text-xs text-text-secondary capitalize">{key === 'balance' ? 'Remaining' : key}</p><strong className="block text-xl mt-2 tabular-nums">{inr(detail.wallet![key])}</strong></div>)}</section>}
            {missingCredit && <p role="alert" className="pc-notice">This request is marked Paid, but its wallet credit is missing. Accounts must check the payment record before you can record spending.</p>}
            <p>{r?.purpose}</p>{r?.payment_date && <p className="text-xs text-text-secondary">Payment date: {pettyCashDate(r.payment_date)}</p>}{r?.workflow_version === 1 && <p className="text-amber-700">Historical request: wallet posting is not replayed. {r.request_type === 'reimbursement' ? 'This reimbursement is read-only.' : 'Pending submissions require super-admin reassignment before allocation. Accounts must reconcile existing funded bill records.'}</p>}
            <div className="flex flex-wrap gap-2">{actions.map(a => <button type="button" disabled={busy} key={a.key} className={`pc-button ${['reject', 'cancel'].includes(a.key) ? 'pc-button-danger' : ['send_back', 'reassign'].includes(a.key) ? 'pc-button-secondary' : ''}`} onClick={() => { setAction(a.key); setProofs([]); setError(''); }}>{a.label}</button>)}
                {owner && r?.workflow_version === 2 && ['paid', 'settlement_submitted'].includes(r.status) && <button disabled={busy || missingCredit || detail.balance <= 0} className="pc-button" onClick={() => { setExpense(!expense); setCorrection(undefined); }}>Record expense</button>}
            </div>
            {action && <form className="space-y-3 border border-border rounded-xl p-4" onSubmit={async event => {
                event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget); const body: Record<string, unknown> = { organization_id: context.organization_id, action, expected_version: r!.version, remark: form.get('remark') || '', documents: proofs };
                if (action === 'submit' && ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement)?.value === 'draft') body.action = 'save_draft';
                if (action === 'allocate') body.allocated_amount = form.get('amount');
                if (action === 'pay') { body.paid_mode = form.get('paid_mode'); body.payment_ref = form.get('payment_ref'); body.payment_date = form.get('payment_date'); }
                if (action === 'return') body.amount_returned = form.get('amount');
                if (action === 'resubmit' || action === 'submit') { body.amount_requested = form.get('amount'); body.purpose = form.get('purpose'); body.property_id = form.get('property_id') || context.properties[0]?.id; }
                if (action === 'reassign') { body.reassign_allocator_id = form.get('reassign_allocator_id'); body.reassign_approver_id = form.get('reassign_approver_id'); }
                if (action === 'settle' && r?.workflow_version === 1) { body.documents = proofs.map(p => ({ ...p, amount: legacyAmounts[p.upload_id], bill_date: form.get('bill_date'), vendor: form.get('vendor'), replaces_document_id: form.get(`replaces_${p.upload_id}`) || undefined })); }
                try { await pcFetch(`/api/petty-cash/${id}`, pcJson(body, 'PATCH')); await changed(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); await refresh(); } finally { setBusy(false); }
            }}>
                <h3 className="font-bold">{actions.find(a => a.key === action)?.label}</h3>
                {['allocate', 'return', 'resubmit', 'submit'].includes(action) && <label className="block">Amount (₹)<input name="amount" className="pc-input" type="number" min="0.01" step="0.01" defaultValue={r?.amount_requested} max={action === 'allocate' ? r?.amount_requested : action === 'return' ? (r?.workflow_version === 2 ? detail.balance : detail.reconciliation?.unaccounted) : undefined} required /></label>}
                {(action === 'resubmit' || action === 'submit') && <><label className="block">Purpose<textarea className="pc-input" name="purpose" defaultValue={r?.purpose} required /></label>{context.properties.length === 1 ? <p>Property: <strong>{context.properties[0].name}</strong></p> : <label className="block">Property<select aria-label="Property" name="property_id" className="pc-input" required defaultValue={context.properties.some(p => p.id === r?.property_id) ? r?.property_id : ''}><option value="">Select assigned property</option>{context.properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}<ProofUpload org={context.organization_id} value={proofs} onChange={setProofs} disabled={busy} onBusyChange={setUploading} /></>}
                {action === 'reassign' && <ReassignmentFields org={context.organization_id} propertyId={r!.property_id} requesterId={r!.requester_id} />}
                {action === 'approve' && <p>Approve {inr(r?.workflow_version === 2 ? r.allocated_amount : r?.amount_requested)}. To change the amount, send it back to the allocator.</p>}
                {action === 'pay' && <><p>Confirm payment of {inr(r?.approved_amount)} has already been made. This credits the requester wallet; it does not initiate a bank transfer.</p><label className="block">Payment date<input name="payment_date" type="date" className="pc-input" defaultValue={pettyCashToday()} max={pettyCashToday()} required /></label><label className="block">Payment mode<select name="paid_mode" className="pc-input">{PC_PAYMENT_MODES.map(m => <option key={m}>{m}</option>)}</select></label><label className="block">Payment reference<input name="payment_ref" className="pc-input" /></label><ProofUpload org={context.organization_id} value={proofs} onChange={setProofs} disabled={busy} onBusyChange={setUploading} /></>}
                {action === 'settle' && r?.workflow_version === 1 && <><label>Bill date<input name="bill_date" type="date" className="pc-input" required={!!proofs.length} /></label><label>Vendor<input name="vendor" className="pc-input" required={!!proofs.length} /></label><ProofUpload org={context.organization_id} value={proofs} onChange={setProofs} disabled={busy} onBusyChange={setUploading} />{proofs.map(p => <label className="block" key={p.upload_id}>{p.file_name}: bill amount<input type="number" className="pc-input" min="0.01" step="0.01" required value={legacyAmounts[p.upload_id] || ''} onChange={e => setLegacyAmounts(prev => ({ ...prev, [p.upload_id]: e.target.value }))} /></label>)}{proofs.map(p => <label className="block" key={`replacement_${p.upload_id}`}>Replaces rejected bill (optional)<select className="pc-input" name={`replaces_${p.upload_id}`}><option value="">New bill</option>{detail.documents.filter(d => d.stage === 'settlement' && d.review_status === 'rejected' && !d.superseded_by).map(d => <option key={d.id} value={d.id}>{d.file_name} — {inr(d.amount)}</option>)}</select></label>)}</>}
                <label className="block">Remarks<textarea name="remark" className="pc-input" required={['send_back', 'reject', 'return'].includes(action)} /></label>
                <button className="pc-button" disabled={busy || uploading || (action === 'pay' && r?.workflow_version === 2 && !proofs.length) || (action === 'submit' && !context.wallet.can_request)}>{busy ? 'Processing…' : 'Confirm'}</button>{action === 'submit' && <button className="pc-button pc-button-secondary ml-3" type="submit" value="draft" disabled={busy || uploading}>Save draft</button>}<button type="button" className="pc-button pc-button-secondary ml-3" onClick={() => setAction('')} disabled={busy}>Back</button>
            </form>}
            {(expense || correction) && <ExpenseForm key={correction?.id || 'new'} context={context} requestId={id} balance={detail.balance} correction={correction} onSaved={() => { void changed(); }} />}
            <div className="flex flex-wrap justify-between items-center gap-2"><h3 className="font-bold">Expenses and bills</h3><p className="text-xs text-text-secondary">{detail.expenses.length} {detail.expenses.length === 1 ? 'expense' : 'expenses'} recorded for this request</p></div>
            <ExpenseTable org={context.organization_id} showRequest={false} busy={busy} expenses={detail.expenses.map(entry => ({ ...entry, documents: detail.documents.filter(document => document.expense_id === entry.id) }))}
                onCorrect={owner ? entry => { setCorrection(entry); setExpense(false); } : undefined}
                onReview={finance && r?.status !== 'closed' ? async (expenseId, reviewStatus) => {
                    const remark = reviewStatus === 'rejected' ? window.prompt('Reason for rejecting proof') : undefined;
                    if (reviewStatus === 'rejected' && !remark?.trim()) return;
                    setBusy(true); setError('');
                    try { await pcFetch(`/api/petty-cash/expenses/${expenseId}`, pcJson({ organization_id: context.organization_id, review_status: reviewStatus, ...(remark ? { remark } : {}) }, 'PATCH')); await changed(); }
                    catch (reason) { setError(reason instanceof Error ? reason.message : 'Review failed'); } finally { setBusy(false); }
                } : undefined} />
            {detail.documents.filter(d => !d.expense_id).map(d => <div key={d.id} className="space-y-1"><a className="block underline text-primary" href={`/api/petty-cash/documents/${d.id}/download?org_id=${context.organization_id}`} target="_blank" rel="noreferrer">{d.stage}: {d.file_name}</a>{r?.workflow_version === 1 && d.stage === 'settlement' && <p>{inr(d.amount)} · {d.superseded_by ? 'Superseded (history retained)' : d.review_status} {d.review_remarks}</p>}{finance && r?.workflow_version === 1 && r.request_type === 'advance' && d.stage === 'settlement' && !d.superseded_by && r.status !== 'closed' && <button className="pc-button" onClick={async () => { setBusy(true); try { await pcFetch(`/api/petty-cash/documents/${d.id}`, pcJson({ organization_id: context.organization_id, review_status: 'accepted' }, 'PATCH')); await changed(); } catch (e) { setError(e instanceof Error ? e.message : 'Review failed'); } finally { setBusy(false); } }}>Accept legacy bill</button>}</div>)}
            <h3 className="font-bold">Activity</h3><ol className="pc-activity space-y-2">{detail.activity.map(a => { const amount = a.action === 'allocate' ? a.metadata?.after?.allocated_amount : a.action === 'approve' ? a.metadata?.after?.approved_amount : a.action === 'pay' ? a.metadata?.after?.paid_amount : undefined; return <li key={a.id} className="text-sm">{new Date(a.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} · {a.actor?.full_name} · {a.action.replaceAll('_', ' ')}{amount != null && ` · ${inr(amount)}`} {a.remark && `— ${a.remark}`}</li>; })}</ol>
        </>}
    </WorkflowModal>;
}
