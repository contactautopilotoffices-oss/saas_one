'use client';
import { FileText, ReceiptText, MessageSquareText, Pencil, RotateCcw } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { inr } from '@/frontend/lib/pettyCash/roles';
import { pettyCashDate, type Expense } from './workflowTypes';
export default function ExpenseTable({ expenses, org, showRequest = true, showRequester = false, onOpen, onReview, onCorrect, onWithdraw, onEdit, busy = false }: {
    expenses: Expense[]; org: string; showRequest?: boolean; showRequester?: boolean; onOpen?: (id: string) => void;
    onReview?: (id: string, status: 'accepted' | 'rejected') => void; onCorrect?: (expense: Expense) => void;
    onWithdraw?: (expense: Expense) => void; onEdit?: (expense: Expense) => void; busy?: boolean;
}) {
    if (!expenses.length) return <div className="pc-empty"><ReceiptText size={24} /><h3>No expenses recorded</h3><p>Record any amount up to the remaining cash. Add bills or receipts if available.</p></div>;
    return <div className="pc-table-wrap"><table aria-label="Expense history" className="min-w-[850px]">
        <thead><tr>{['Expense date', ...(showRequest ? ['Request', 'Property'] : []), ...(showRequester ? ['Spent by'] : []), 'Mode', 'Payee / purpose', 'Category', 'Amount', 'Payment', 'Bills / receipts / proofs', 'Review', ...(onOpen ? ['Details'] : [])].map(heading => <th key={heading}>{heading}</th>)}</tr></thead>
        <tbody>{expenses.map(expense => <tr key={expense.id}>
            <td className="whitespace-nowrap"><time dateTime={expense.expense_date.slice(0, 10)}>{pettyCashDate(expense.expense_date)}</time></td>
            {showRequest && <><td className="whitespace-nowrap font-medium">{expense.request?.request_no || '—'}</td><td>{expense.property?.name || '—'}</td></>}
            {showRequester && <td className="min-w-32"><p className="font-medium break-words">{expense.requester?.full_name || expense.requester?.email || '—'}</p></td>}
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
                        className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline cursor-pointer"
                        title="Edit description or category"
                    >
                        <Pencil size={11} /> Edit description & category
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
            <td className="min-w-32"><span className="pc-status capitalize" data-status={expense.review_status}>{expense.review_status.replaceAll('_', ' ')}</span>
                {(expense.review_status === 'accepted' || expense.review_status === 'rejected') && (expense.reviewer?.full_name || expense.reviewer?.email || expense.reviewed_at) && (
                    <p className="text-[11px] text-text-secondary mt-1.5 max-w-48 break-words">
                        {expense.review_status === 'accepted' ? 'Approved by ' : 'Rejected by '}
                        <span className="font-semibold">{expense.reviewer?.full_name || expense.reviewer?.email || 'reviewer'}</span>
                        {expense.reviewed_at ? ` · ${pettyCashDate(expense.reviewed_at)}` : ''}
                    </p>
                )}
                {expense.review_remarks && <p className="text-xs text-text-secondary mt-2 max-w-48 break-words">{expense.review_remarks}</p>}
                {onReview && expense.review_status !== 'withdrawn' && (
                    <div className="flex flex-wrap gap-2 mt-3">
                        <button type="button" className="pc-button pc-button-secondary" disabled={busy} onClick={() => onReview(expense.id, 'accepted')}>
                            {expense.no_bill_reason ? (expense.documents?.length ? 'Accept proof' : 'Accept declaration') : (expense.documents?.length ? 'Accept bill' : 'Accept expense')}
                        </button>
                        <button type="button" className="pc-button pc-button-danger" disabled={busy} onClick={() => onReview(expense.id, 'rejected')}>
                            {expense.documents?.length ? 'Reject proof' : 'Reject expense'}
                        </button>
                    </div>
                )}
                {onCorrect && expense.review_status === 'rejected' && <button type="button" className="pc-button pc-button-secondary mt-3" disabled={busy} onClick={() => onCorrect(expense)}>Replace proof</button>}
                {onWithdraw && (expense.review_status === 'pending' || expense.review_status === 'rejected') && (
                    <button
                        type="button"
                        className="pc-button pc-button-danger mt-2 text-xs gap-1 inline-flex items-center"
                        disabled={busy}
                        onClick={() => onWithdraw(expense)}
                    >
                        <RotateCcw size={12} />
                        {expense.review_status === 'pending' ? 'Revert transaction' : 'Withdraw expense'}
                    </button>
                )}
            </td>
            {onOpen && <td><Button variant="solid" size="sm" disabled={busy} aria-label={`View ${expense.request?.request_no || 'request'} and proofs`} onClick={() => onOpen(expense.request_id)}>View request</Button></td>}
        </tr>)}</tbody>
    </table></div>;
}
