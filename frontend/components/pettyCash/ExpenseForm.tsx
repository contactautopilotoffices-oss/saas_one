'use client';
import { useState } from 'react';
import { inr, PC_CATEGORIES, PC_PAYMENT_MODES } from '@/frontend/lib/pettyCash/roles';
import ProofUpload from './ProofUpload';
import { pcFetch, pcJson, pettyCashToday, type Context, type Upload, type Expense } from './workflowTypes';
export default function ExpenseForm({ context, requestId, balance, correction, onSaved }: { context: Context; requestId: string; balance: number; correction?: Expense; onSaved: () => void }) {
    const [proofs, setProofs] = useState<Upload[]>([]); const [uploading, setUploading] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
    const [key] = useState(() => crypto.randomUUID());
    const [amount, setAmount] = useState('');
    const spendCents = Math.round(Number(amount) * 100);
    const validAmount = !!amount && Number.isFinite(spendCents) && Number(amount) === spendCents / 100 && spendCents > 0 && spendCents <= Math.round(balance * 100);
    const remaining = (Math.round(balance * 100) - spendCents) / 100;
    return <form className="space-y-3 border border-border rounded-xl p-4" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget);
        try {
            if (correction) await pcFetch(`/api/petty-cash/expenses/${correction.id}`, pcJson({ organization_id: context.organization_id, action: 'correct', documents: proofs, remark: form.get('description') }, 'PATCH'));
            else await pcFetch(`/api/petty-cash/${requestId}/expenses`, pcJson({ organization_id: context.organization_id, amount: form.get('amount'), description: form.get('description'), category: form.get('category'), vendor: form.get('vendor'), expense_date: form.get('expense_date'), payment_mode: form.get('payment_mode'), payment_ref: form.get('payment_ref'), documents: proofs, idempotency_key: key }));
            onSaved();
        } catch (e) { setError(e instanceof Error ? e.message : 'Expense failed'); } finally { setBusy(false); }
    }}>
        <h3 className="font-bold">{correction ? 'Correct rejected proof' : 'Record expense'}</h3>
        {correction ? <p>₹{correction.amount}: {correction.description}. Replacing proof does not deduct cash again.</p> : <>
            <div className="rounded-xl bg-primary/5 border border-border p-3 space-y-1"><p className="text-sm font-semibold">Available for this request: {inr(balance)}</p><p className="text-xs text-text-secondary">Record only what you spent. The rest stays available for later expenses.</p></div>
            <label className="block">Amount (₹)<input className="pc-input" name="amount" type="number" min="0.01" max={balance} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} required /></label>
            {validAmount && <p role="status" className="text-sm text-primary-dark font-medium">Remaining after this expense: {inr(remaining)}</p>}
            <div className="grid sm:grid-cols-2 gap-3"><label>Date<input className="pc-input" name="expense_date" type="date" defaultValue={pettyCashToday()} max={pettyCashToday()} required /></label><label>Category<select className="pc-input" name="category">{PC_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label></div>
            <label className="block">Vendor / payee<input className="pc-input" name="vendor" required maxLength={200} /></label>
            <div className="grid sm:grid-cols-2 gap-3"><label>Payment mode<select className="pc-input" name="payment_mode">{PC_PAYMENT_MODES.map(c => <option key={c}>{c}</option>)}</select></label><label>Payment reference (required except cash)<input className="pc-input" name="payment_ref" /></label></div>
        </>}
        <label className="block">{correction ? 'Correction note' : 'Description / purpose'}<textarea className="pc-input" name="description" required maxLength={2000} /></label>
        <ProofUpload org={context.organization_id} value={proofs} onChange={setProofs} disabled={busy} onBusyChange={setUploading} label={correction ? 'Replacement bills / receipts' : 'Bills / receipts (optional)'} />
        {error && <p role="alert" className="text-red-600">{error}</p>}<button className="pc-button" disabled={busy || uploading || (!!correction && !proofs.length)}>{busy ? 'Saving…' : correction ? 'Submit corrected proof' : 'Save expense'}</button>
    </form>;
}
