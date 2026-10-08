'use client';
import { FileText, ReceiptText } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { inr } from '@/frontend/lib/pettyCash/roles';
import { pettyCashDate, type Expense } from './workflowTypes';
export default function ExpenseTable({ expenses, org, showRequest = true, onOpen, onReview, onCorrect, busy = false }: {
    expenses: Expense[]; org: string; showRequest?: boolean; onOpen?: (id: string) => void;
    onReview?: (id: string, status: 'accepted' | 'rejected') => void; onCorrect?: (expense: Expense) => void; busy?: boolean;
}) {
    if (!expenses.length) return <div className="pc-empty"><ReceiptText size={24} /><h3>No expenses recorded</h3><p>Record any amount up to the remaining cash. Add bills or receipts if available.</p></div>;
    return <div className="pc-table-wrap"><table aria-label="Expense history" className="min-w-[850px]">
        <thead><tr>{['Expense date', ...(showRequest ? ['Request', 'Property'] : []), 'Payee / purpose', 'Category', 'Amount', 'Payment', 'Bills / receipts', 'Review', ...(onOpen ? ['Details'] : [])].map(heading => <th key={heading}>{heading}</th>)}</tr></thead>
        <tbody>{expenses.map(expense => <tr key={expense.id}>
            <td className="whitespace-nowrap"><time dateTime={expense.expense_date.slice(0, 10)}>{pettyCashDate(expense.expense_date)}</time></td>
            {showRequest && <><td className="whitespace-nowrap font-medium">{expense.request?.request_no || '—'}</td><td>{expense.property?.name || '—'}</td></>}
            <td className="min-w-44 max-w-xs"><p className="font-medium break-words">{expense.vendor}</p><p className="mt-1 text-xs text-text-secondary break-words">{expense.description}</p></td>
            <td>{expense.category}</td><td className="font-semibold whitespace-nowrap tabular-nums">{inr(expense.amount)}</td>
            <td><p>{expense.payment_mode}</p>{expense.payment_ref && <p className="text-xs text-text-secondary mt-1 break-words">{expense.payment_ref}</p>}</td>
            <td className="min-w-36 max-w-52"><div className="space-y-2">{expense.documents?.length ? expense.documents.map(bill => <a key={bill.id} className="flex items-start gap-1.5 text-primary-dark underline underline-offset-2 text-xs" href={`/api/petty-cash/documents/${bill.id}/download?org_id=${org}`} target="_blank" rel="noreferrer"><FileText size={14} className="shrink-0 mt-0.5" /><span className="break-all">{bill.file_name}{bill.superseded_by ? ' (replaced)' : ''}</span></a>) : <span className="text-xs text-text-secondary">No bill attached</span>}</div></td>
            <td className="min-w-32"><span className="pc-status capitalize" data-status={expense.review_status}>{expense.review_status.replaceAll('_', ' ')}</span>{expense.review_remarks && <p className="text-xs text-text-secondary mt-2 max-w-48 break-words">{expense.review_remarks}</p>}
                {onReview && <div className="flex flex-wrap gap-2 mt-3"><button type="button" className="pc-button pc-button-secondary" disabled={busy} onClick={() => onReview(expense.id, 'accepted')}>{expense.documents?.length ? 'Accept proof' : 'Accept expense'}</button><button type="button" className="pc-button pc-button-danger" disabled={busy} onClick={() => onReview(expense.id, 'rejected')}>{expense.documents?.length ? 'Reject proof' : 'Reject expense'}</button></div>}
                {onCorrect && expense.review_status === 'rejected' && <button type="button" className="pc-button pc-button-secondary mt-3" disabled={busy} onClick={() => onCorrect(expense)}>Replace proof</button>}
            </td>
            {onOpen && <td><Button variant="solid" size="sm" disabled={busy} aria-label={`View ${expense.request?.request_no || 'request'} and proofs`} onClick={() => onOpen(expense.request_id)}>View request</Button></td>}
        </tr>)}</tbody>
    </table></div>;
}
