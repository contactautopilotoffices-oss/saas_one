'use client';

import { useState } from 'react';
import { inr, PC_CATEGORIES, PC_PAYMENT_MODES } from '@/frontend/lib/pettyCash/roles';
import ProofUpload from './ProofUpload';
import { pcFetch, pcJson, pettyCashToday, type Context, type Upload, type Expense } from './workflowTypes';
import type { PettyCashOcrData } from '@/app/api/petty-cash/ocr/route';
import { Sparkles, CheckCircle2, AlertCircle, ShieldAlert, Building2, Users, FileCheck2, FileWarning } from 'lucide-react';

export default function ExpenseForm({
    context,
    requestId,
    balance,
    correction,
    existingExpenses,
    proofThreshold = 500,
    requestDate,
    onSaved
}: {
    context: Context;
    requestId: string;
    balance: number;
    correction?: Expense;
    existingExpenses?: Expense[];
    proofThreshold?: number;
    /** Request date (YYYY-MM-DD, India time). Bills dated before it are not accepted. */
    requestDate?: string;
    onSaved: () => void;
}) {
    const [proofs, setProofs] = useState<Upload[]>([]);
    const [uploading, setUploading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [key] = useState(() => crypto.randomUUID());
    const [amount, setAmount] = useState('');
    const [spendMode, setSpendMode] = useState<'Operation' | 'Client'>(correction?.spend_mode || 'Operation');
    const [selectedCategory, setSelectedCategory] = useState(correction?.category || PC_CATEGORIES[0] || 'Travel');
    const [customCategory, setCustomCategory] = useState('');
    const [vendor, setVendor] = useState(correction?.vendor || '');
    const [expenseDate, setExpenseDate] = useState(correction?.expense_date?.slice(0, 10) || pettyCashToday());
    const [paymentMode, setPaymentMode] = useState(correction?.payment_mode || PC_PAYMENT_MODES[0] || 'Cash');
    const [paymentRef, setPaymentRef] = useState(correction?.payment_ref || '');
    const [description, setDescription] = useState(correction?.description || '');
    const [noBillReason, setNoBillReason] = useState('');
    const [ocrData, setOcrData] = useState<PettyCashOcrData | null>(null);

    const effectiveThreshold = proofThreshold ?? 500;
    const spendAmount = Number(amount) || 0;
    const requiresProof = !correction && spendAmount > effectiveThreshold;
    const missingProof = requiresProof && proofs.length === 0;
    const needsNoBillReason = !correction && !requiresProof && proofs.length === 0;
    const missingNoBillReason = needsNoBillReason && noBillReason.trim().length < 10;
    const billBeforeRequest = !correction && !!requestDate && !!expenseDate && expenseDate < requestDate;

    const spendCents = Math.round(Number(amount) * 100);
    const validAmount =
        !!amount &&
        Number.isFinite(spendCents) &&
        Number(amount) === spendCents / 100 &&
        spendCents > 0 &&
        spendCents <= Math.round(balance * 100);
    const remaining = (Math.round(balance * 100) - spendCents) / 100;

    const { clientDuplicate, clientSimilar } = findClientDuplicates(existingExpenses, correction, paymentRef, paymentMode, amount, vendor, expenseDate);

    const isBlockedDuplicate = Boolean(ocrData?.is_duplicate_ref || clientDuplicate);
    const duplicateMessage = ocrData?.is_duplicate_ref ? ocrData.duplicate_warning : clientDuplicate;
    const similarWarning = !isBlockedDuplicate ? (ocrData?.duplicate_warning || clientSimilar) : null;

    const handleOcrExtracted = (ocr: PettyCashOcrData) => {
        setOcrData(ocr);
        setError('');
        if (ocr.amount !== null && ocr.amount > 0) {
            setAmount(String(ocr.amount));
        }
        if (ocr.vendor) {
            setVendor(ocr.vendor);
        }
        if (ocr.payment_mode) {
            setPaymentMode(ocr.payment_mode);
        }
        if (ocr.payment_ref) {
            setPaymentRef(ocr.payment_ref);
        }
        if (ocr.date) {
            setExpenseDate(ocr.date);
        }
        if (ocr.category_hint) {
            const matched = PC_CATEGORIES.find(c => c.toLowerCase() === ocr.category_hint?.toLowerCase());
            if (matched) setSelectedCategory(matched);
        }
        if (ocr.summary) {
            setDescription(ocr.summary);
        }
    };

    return (
        <form
            className="space-y-3.5 border border-slate-200 dark:border-[#30363d] rounded-2xl p-5 bg-white dark:bg-[#161b22] shadow-sm"
            onSubmit={async event => {
                event.preventDefault();
                setBusy(true);
                setError('');
                const rawCategory = String(selectedCategory);
                const custom = customCategory.trim();
                const category = (rawCategory === 'custom' || rawCategory === 'Other') && custom ? custom : rawCategory === 'custom' ? 'Other' : rawCategory || 'General';

                try {
                    if (correction) {
                        await pcFetch(
                            `/api/petty-cash/expenses/${correction.id}`,
                            pcJson(
                                {
                                    organization_id: context.organization_id,
                                    action: 'correct',
                                    documents: proofs,
                                    remark: description
                                },
                                'PATCH'
                            )
                        );
                    } else {
                        await pcFetch(
                            `/api/petty-cash/${requestId}/expenses`,
                            pcJson({
                                organization_id: context.organization_id,
                                amount,
                                description,
                                category,
                                vendor,
                                expense_date: expenseDate,
                                payment_mode: paymentMode,
                                payment_ref: paymentRef,
                                spend_mode: spendMode,
                                documents: proofs,
                                ...(proofs.length === 0 ? { no_bill_reason: noBillReason.trim() } : {}),
                                idempotency_key: key
                            })
                        );
                    }
                    onSaved();
                } catch (e) {
                    setError(e instanceof Error ? e.message : 'Expense failed');
                } finally {
                    setBusy(false);
                }
            }}
        >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-[#30363d]">
                <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    {correction ? 'Correct rejected proof' : 'Record expense'}
                </h3>
                <span className="text-xs text-text-secondary">
                    Available for this request: <strong className="text-emerald-600 dark:text-emerald-400 font-bold">{inr(balance)}</strong>
                </span>
            </div>

            {correction ? (
                <p className="text-xs text-text-secondary">
                    ₹{correction.amount}: {correction.description}. Replacing proof does not deduct cash again.
                </p>
            ) : (
                <>
                    <div className="grid sm:grid-cols-2 gap-3.5">
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                            Amount (₹)
                            <input
                                className="pc-input mt-1.5"
                                name="amount"
                                type="number"
                                min="0.01"
                                max={balance}
                                step="0.01"
                                value={amount}
                                onChange={event => setAmount(event.target.value)}
                                placeholder="0.00"
                                required
                            />
                        </label>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                            Date
                            <input
                                className="pc-input mt-1.5"
                                name="expense_date"
                                type="date"
                                value={expenseDate}
                                min={requestDate}
                                max={pettyCashToday()}
                                onChange={e => setExpenseDate(e.target.value)}
                                required
                            />
                        </label>
                    </div>

                    {validAmount && (
                        <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
                            Remaining after this expense: {inr(remaining)}
                        </p>
                    )}

                    {/* Spend Mode Selector: Operation vs Client */}
                    <div>
                        <span className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                            Spend Mode / Type <span className="text-rose-500">*</span>
                        </span>
                        <div className="grid grid-cols-2 gap-2.5">
                            <button
                                type="button"
                                onClick={() => setSpendMode('Operation')}
                                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-black transition-all ${
                                    spendMode === 'Operation'
                                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-500/25'
                                        : 'bg-slate-50 dark:bg-[#21262d] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#30363d] hover:bg-slate-100 dark:hover:bg-[#282e33]'
                                }`}
                            >
                                <Building2 size={15} /> Operational Spend
                            </button>
                            <button
                                type="button"
                                onClick={() => setSpendMode('Client')}
                                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-black transition-all ${
                                    spendMode === 'Client'
                                        ? 'bg-amber-600 text-white border-amber-600 shadow-md shadow-amber-500/25'
                                        : 'bg-slate-50 dark:bg-[#21262d] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#30363d] hover:bg-slate-100 dark:hover:bg-[#282e33]'
                                }`}
                            >
                                <Users size={15} /> Client Spend
                            </button>
                        </div>
                    </div>

                    {/* Vision AI OCR Validation Card */}
                    {ocrData && (
                        <div className={`p-3.5 rounded-2xl border text-xs space-y-2 transition-all ${
                            ocrData.status === 'FAILED'
                                ? 'bg-rose-50/80 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/50 text-rose-800 dark:text-rose-300'
                                : ocrData.amount !== null && Number(amount) === ocrData.amount
                                ? 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300'
                                : 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-300'
                        }`}>
                            <div className="flex items-center justify-between font-bold">
                                <span className="flex items-center gap-1.5">
                                    <Sparkles size={14} className="text-primary" />
                                    Vision AI Receipt Extraction ({ocrData.confidence}% confidence)
                                </span>
                                <span className="uppercase text-[9px] tracking-wider px-2 py-0.5 rounded-full font-black bg-white/70 dark:bg-black/40 border border-current">
                                    {ocrData.payment_mode || 'Receipt'}
                                </span>
                            </div>
                            <p className="text-[11px] opacity-90 leading-relaxed">{ocrData.summary}</p>

                            {ocrData.amount !== null && (
                                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-black/10 dark:border-white/10">
                                    <div className="flex items-center gap-2">
                                        <span>Receipt Value: <strong>₹{ocrData.amount}</strong></span>
                                        {Number(amount) === ocrData.amount ? (
                                            <span className="text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1">
                                                <CheckCircle2 size={13} /> Matches entered amount
                                            </span>
                                        ) : (
                                            <span className="text-amber-700 dark:text-amber-400 font-semibold flex items-center gap-1">
                                                <AlertCircle size={13} /> Entered: ₹{amount || 0}
                                            </span>
                                        )}
                                    </div>
                                    {Number(amount) !== ocrData.amount && (
                                        <button
                                            type="button"
                                            onClick={() => setAmount(String(ocrData.amount))}
                                            className="px-2.5 py-1 rounded-xl text-[10px] font-black bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-all"
                                        >
                                            Apply ₹{ocrData.amount}
                                        </button>
                                    )}
                                </div>
                            )}

                            {ocrData.status === 'FAILED' && (
                                <p className="font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                                    <AlertCircle size={13} /> Warning: This payment screenshot appears to be marked as FAILED or DECLINED.
                                </p>
                            )}

                            {ocrData.is_duplicate_ref && (
                                <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-700 dark:text-rose-300 font-bold flex items-center gap-2">
                                    <AlertCircle size={16} className="shrink-0 text-rose-600" />
                                    <span>Fraud Guard: {ocrData.duplicate_warning}</span>
                                </div>
                            )}

                            {ocrData.amount !== null && ocrData.amount > balance && (
                                <p className="font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                                    <AlertCircle size={13} /> Warning: Receipt amount (₹{ocrData.amount}) exceeds remaining balance (₹{balance}).
                                </p>
                            )}
                        </div>
                    )}

                    <div className="grid sm:grid-cols-2 gap-3.5">
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                            Vendor / payee
                            <input
                                className="pc-input mt-1.5"
                                name="vendor"
                                value={vendor}
                                onChange={e => setVendor(e.target.value)}
                                placeholder="e.g. Stationery Mart, Uber, Local Hardware"
                                required
                                maxLength={200}
                            />
                        </label>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                            <span className="flex items-center justify-between">
                                <span>Category</span>
                                {selectedCategory === 'custom' && (
                                    <button
                                        type="button"
                                        onClick={() => setSelectedCategory(PC_CATEGORIES[0] || 'Travel')}
                                        className="text-[10px] font-bold text-primary hover:underline"
                                    >
                                        Select from list
                                    </button>
                                )}
                            </span>
                            <select
                                className="pc-input mt-1.5"
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
                    </div>

                    <div className="grid sm:grid-cols-2 gap-3.5">
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                            Payment mode
                            <select
                                className="pc-input mt-1.5"
                                name="payment_mode"
                                value={paymentMode}
                                onChange={e => setPaymentMode(e.target.value)}
                            >
                                {PC_PAYMENT_MODES.map(c => (
                                    <option key={c} value={c}>
                                        {c}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                            Payment reference (required except cash)
                            <input
                                className="pc-input mt-1.5"
                                name="payment_ref"
                                value={paymentRef}
                                onChange={e => setPaymentRef(e.target.value)}
                                placeholder="UPI Ref / UTR / Txn ID"
                            />
                        </label>
                    </div>
                </>
            )}

            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                {correction ? 'Correction note' : 'Description / purpose'}
                <textarea
                    className="pc-input mt-1.5"
                    name="description"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Brief explanation of the expense..."
                    required
                    maxLength={2000}
                />
            </label>

            {/* Property Proof Rule Dynamic Badge */}
            {!correction && spendAmount > 0 && (
                <div className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                    requiresProof
                        ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-200'
                        : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50 text-emerald-900 dark:text-emerald-200'
                }`}>
                    {requiresProof ? (
                        <FileWarning size={16} className="shrink-0 text-amber-600 dark:text-amber-400" />
                    ) : (
                        <FileCheck2 size={16} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                    )}
                    <div>
                        <p className="font-bold">
                            {requiresProof
                                ? `Bill / Proof Mandatory (Amount > ₹${effectiveThreshold})`
                                : `No Bill Required (Amount ≤ ₹${effectiveThreshold})`}
                        </p>
                        <p className="text-[11px] opacity-90 mt-0.5">
                            {requiresProof
                                ? `Property rule requires a valid bill/receipt upload for expenses over ₹${effectiveThreshold}.`
                                : `Property allows bill-free recording up to ₹${effectiveThreshold}. If you have no bill, give the reason below.`}
                        </p>
                    </div>
                </div>
            )}

            <ProofUpload
                org={context.organization_id}
                requestId={requestId}
                value={proofs}
                onChange={newProofs => {
                    setProofs(newProofs);
                    if (newProofs.length === 0) {
                        setOcrData(null);
                        setError('');
                    }
                }}
                disabled={busy}
                onBusyChange={setUploading}
                onOcrExtracted={handleOcrExtracted}
                label={correction ? 'Replacement bills / receipts' : requiresProof ? 'Bills / receipts / payment screenshots (Required)' : 'Bills / receipts / payment screenshots (Optional)'}
            />

            {needsNoBillReason && (
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Reason there is no bill <span className="text-rose-500">*</span>
                    <textarea
                        className="pc-input mt-1.5"
                        name="no_bill_reason"
                        value={noBillReason}
                        onChange={e => setNoBillReason(e.target.value)}
                        placeholder="e.g. Auto rickshaw fare, driver gives no receipt"
                        required
                        minLength={10}
                        maxLength={500}
                    />
                </label>
            )}

            {billBeforeRequest && (
                <p role="alert" className="text-amber-700 dark:text-amber-400 text-xs font-semibold flex items-center gap-1.5">
                    <AlertCircle size={14} /> Bill date cannot be before the request date ({requestDate}).
                </p>
            )}

            {similarWarning && (
                <p role="status" className="p-3 rounded-xl border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" /> <span>Possible duplicate: {similarWarning} Accounts will see this note.</span>
                </p>
            )}

            {isBlockedDuplicate && (
                <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border-2 border-rose-500/50 text-rose-800 dark:text-rose-200 text-xs space-y-1 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2 font-black text-rose-700 dark:text-rose-300">
                        <ShieldAlert size={16} className="text-rose-600" />
                        <span>Fraud Guard: Duplicate Claim Blocked</span>
                    </div>
                    <p className="text-[11px] font-medium leading-relaxed opacity-95">
                        {duplicateMessage}
                    </p>
                    <p className="text-[10px] text-rose-600 dark:text-rose-400 font-bold uppercase tracking-wider pt-0.5">
                        Submitting identical or already processed transactions is prohibited.
                    </p>
                </div>
            )}

            {missingProof && (
                <p role="alert" className="text-amber-700 dark:text-amber-400 text-xs font-semibold flex items-center gap-1.5">
                    <AlertCircle size={14} /> Please attach bill/receipt proof before submitting (amount exceeds ₹{effectiveThreshold}).
                </p>
            )}

            {error && <p role="alert" className="text-red-600 text-xs">{error}</p>}
            <button
                className="pc-button mt-2"
                disabled={
                    busy ||
                    uploading ||
                    (!!correction && !proofs.length) ||
                    (!correction && !validAmount) ||
                    missingProof ||
                    missingNoBillReason ||
                    billBeforeRequest ||
                    description.trim().length < 3 ||
                    isBlockedDuplicate
                }
            >
                {busy ? 'Saving…' : correction ? 'Submit corrected proof' : 'Save expense'}
            </button>
        </form>
    );
}

// Exact UTR reuse blocks; a same amount/date/vendor match only warns (two auto rides can cost the same).
function findClientDuplicates(
    existingExpenses: Expense[] | undefined, correction: Expense | undefined,
    paymentRef: string, paymentMode: string, amount: string, vendor: string, expenseDate: string
): { clientDuplicate: string | null; clientSimilar: string | null } {
    const normRef = paymentRef.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const isNonCash = paymentMode !== 'Cash';
    let similar: string | null = null;
    for (const exp of existingExpenses || []) {
        if (correction && exp.id === correction.id) continue;
        if (exp.review_status === 'rejected' || exp.review_status === 'withdrawn') continue;
        const expNorm = (exp.payment_ref || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        if (isNonCash && exp.payment_mode !== 'Cash' && normRef && expNorm && normRef === expNorm) {
            return { clientDuplicate: `UTR '${paymentRef}' is already claimed in this request for ₹${exp.amount} (${exp.vendor}).`, clientSimilar: null };
        }
        if (!similar && amount && Number(amount) === Number(exp.amount) && expenseDate === exp.expense_date?.slice(0, 10)) {
            const normVendor = vendor.trim().toLowerCase();
            const expVendor = (exp.vendor || '').trim().toLowerCase();
            if (normVendor && expVendor && (normVendor === expVendor || normVendor.includes(expVendor) || expVendor.includes(normVendor))) {
                similar = `An expense of ₹${amount} for '${exp.vendor}' on ${expenseDate} is already recorded in this request. Save only if this is a separate purchase.`;
            }
        }
    }
    return { clientDuplicate: null, clientSimilar: similar };
}
