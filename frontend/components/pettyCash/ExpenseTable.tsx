'use client';
import { FileText, ReceiptText, MessageSquareText, Pencil, RotateCcw, Check, X, Upload, Trash2 } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { inr } from '@/frontend/lib/pettyCash/roles';
import { pettyCashDate, type Expense } from './workflowTypes';
export default function ExpenseTable({ expenses, org, showRequest = true, onOpen, onReview, onCorrect, onWithdraw, onEdit, busy = false }: {
    expenses: Expense[]; org: string; showRequest?: boolean; onOpen?: (id: string) => void;
    onReview?: (id: string, status: 'accepted' | 'rejected') => void; onCorrect?: (expense: Expense) => void;
    onWithdraw?: (expense: Expense) => void; onEdit?: (expense: Expense) => void; busy?: boolean;
}) {
    if (!expenses.length) return <div className="pc-empty"><ReceiptText size={24} /><h3>No expenses recorded</h3><p>Record any amount up to the remaining cash. Add bills or receipts if available.</p></div>;
    return <div className="pc-table-wrap"><table aria-label="Expense history" className="min-w-[850px]">
        <thead><tr>{['Expense date', ...(showRequest ? ['Request', 'Property'] : []), 'Mode', 'Payee / purpose', 'Category', 'Amount', 'Payment', 'Bills / receipts / proofs', 'Review', ...(onOpen ? ['Details'] : [])].map(heading => <th key={heading}>{heading}</th>)}</tr></thead>
        <tbody>{expenses.map(expense => <tr key={expense.id}>
            <td className="whitespace-nowrap"><time dateTime={expense.expense_date.slice(0, 10)}>{pettyCashDate(expense.expense_date)}</time></td>
            {showRequest && <><td className="whitespace-nowrap font-medium">{expense.request?.request_no || '—'}</td><td>{expense.property?.name || '—'}</td></>}
            <td className="whitespace-nowrap">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                    expense.spend_mode === 'Client'
                        ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
                        : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-600 dark:text-indigo-400'
                }`}>
                    {expense.spend_mode || 'Operation'}
                </span>
            </td>
            <td className="min-w-44 max-w-xs">
                <p className="font-medium break-words">{expense.vendor}</p>
                <p className="mt-1 text-xs text-text-secondary break-words">{expense.description}</p>
                {onEdit && (expense.review_status === 'pending' || expense.review_status === 'rejected') && (
                    <button
                        type="button"
                        onClick={() => onEdit(expense)}
                        disabled={busy}
                        className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 hover:bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700 transition-all cursor-pointer shadow-2xs disabled:opacity-40"
                        title="Edit description or category"
                    >
                        <Pencil size={11} className="text-slate-500 dark:text-slate-400" />
                        <span>Edit description & category</span>
                    </button>
                )}
            </td>
            <td>
                <div className="flex items-center gap-1.5">
                    <span>{expense.category}</span>
                    {onEdit && (expense.review_status === 'pending' || expense.review_status === 'rejected') && (
                        <button
                            type="button"
                            onClick={() => onEdit(expense)}
                            disabled={busy}
                            className="p-1 rounded-md text-slate-400 hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            title="Edit category or description"
                            aria-label={`Edit category for ${expense.description}`}
                        >
                            <Pencil size={11} />
                        </button>
                    )}
                </div>
            </td><td className="font-semibold whitespace-nowrap tabular-nums">{inr(expense.amount)}</td>
            <td><p>{expense.payment_mode}</p>{expense.payment_ref && <p className="text-xs text-text-secondary mt-1 break-words">{expense.payment_ref}</p>}</td>
            <td className="min-w-36 max-w-56">
                <div className="space-y-1.5">
                    {expense.no_bill_reason && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${
                            expense.documents?.length
                                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'
                                : 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20'
                        }`}>
                            <MessageSquareText size={11} /> {expense.documents?.length ? 'Chat / Approval Proof' : 'No Bill Declared'}
                        </span>
                    )}
                    {expense.documents?.length ? (
                        expense.documents.map(bill => (
                            <a
                                key={bill.id}
                                className="flex items-start gap-1.5 text-primary-dark underline underline-offset-2 text-xs"
                                href={`/api/petty-cash/documents/${bill.id}/download?org_id=${org}`}
                                target="_blank"
                                rel="noreferrer"
                            >
                                {expense.no_bill_reason ? (
                                    <MessageSquareText size={13} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                                ) : (
                                    <FileText size={13} className="shrink-0 mt-0.5" />
                                )}
                                <span className="break-all">{bill.file_name}{bill.superseded_by ? ' (replaced)' : ''}</span>
                            </a>
                        ))
                    ) : !expense.no_bill_reason ? (
                        <span className="text-xs text-text-secondary">No bill attached</span>
                    ) : null}
                    {expense.no_bill_reason && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 italic break-words leading-tight">
                            Reason: {expense.no_bill_reason}
                        </p>
                    )}
                </div>
            </td>
            <td className="min-w-[190px]">
                <span className="pc-status capitalize" data-status={expense.review_status}>{expense.review_status.replaceAll('_', ' ')}</span>
                {expense.review_remarks && <p className="text-xs text-text-secondary mt-1.5 max-w-48 break-words leading-snug">{expense.review_remarks}</p>}
                {onReview && expense.review_status !== 'withdrawn' && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                        {expense.review_status !== 'accepted' && (
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => onReview(expense.id, 'accepted')}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all shadow-2xs border bg-emerald-50 hover:bg-emerald-100/90 text-emerald-700 border-emerald-300/80 active:scale-95 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-800/80 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
                                title={expense.no_bill_reason ? (expense.documents?.length ? 'Accept proof' : 'Accept declaration') : (expense.documents?.length ? 'Accept bill' : 'Accept expense')}
                            >
                                <Check size={12} className="stroke-[2.5] shrink-0" />
                                <span>{expense.no_bill_reason ? (expense.documents?.length ? 'Accept proof' : 'Accept declaration') : (expense.documents?.length ? 'Accept bill' : 'Accept expense')}</span>
                            </button>
                        )}
                        {expense.review_status !== 'rejected' && (
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => onReview(expense.id, 'rejected')}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all shadow-2xs border bg-rose-50 hover:bg-rose-100/90 text-rose-700 border-rose-300/80 active:scale-95 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 dark:text-rose-300 dark:border-rose-800/80 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
                                title={expense.documents?.length ? 'Reject proof' : 'Reject expense'}
                            >
                                <X size={12} className="stroke-[2.5] shrink-0" />
                                <span>{expense.documents?.length ? 'Reject proof' : 'Reject expense'}</span>
                            </button>
                        )}
                    </div>
                )}
                {onCorrect && expense.review_status === 'rejected' && (
                    <div className="mt-1.5">
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => onCorrect(expense)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all shadow-2xs border bg-indigo-50 hover:bg-indigo-100/90 text-indigo-700 border-indigo-200/90 active:scale-95 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 dark:text-indigo-300 dark:border-indigo-800/70 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
                            title="Replace proof document"
                        >
                            <Upload size={12} className="shrink-0" />
                            <span>Replace proof</span>
                        </button>
                    </div>
                )}
                {onWithdraw && (expense.review_status === 'pending' || expense.review_status === 'rejected') && (
                    <div className="mt-1.5">
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => onWithdraw(expense)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all shadow-2xs border active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none ${
                                expense.review_status === 'pending'
                                    ? 'bg-amber-50 hover:bg-amber-100/90 text-amber-800 border-amber-300/80 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 dark:text-amber-300 dark:border-amber-800/80'
                                    : 'bg-rose-50 hover:bg-rose-100/90 text-rose-700 border-rose-300/80 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 dark:text-rose-300 dark:border-rose-800/80'
                            }`}
                            title={expense.review_status === 'pending' ? 'Revert this transaction to restore balance' : 'Withdraw this rejected expense'}
                        >
                            {expense.review_status === 'pending' ? <RotateCcw size={12} className="shrink-0" /> : <Trash2 size={12} className="shrink-0" />}
                            <span>{expense.review_status === 'pending' ? 'Revert transaction' : 'Withdraw expense'}</span>
                        </button>
                    </div>
                )}
            </td>
            {onOpen && <td><Button variant="solid" size="sm" disabled={busy} aria-label={`View ${expense.request?.request_no || 'request'} and proofs`} onClick={() => onOpen(expense.request_id)}>View request</Button></td>}
        </tr>)}</tbody>
    </table></div>;
}
