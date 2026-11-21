'use client';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, ReceiptText, ShieldCheck } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import ExpenseTable from './ExpenseTable';
import { inr } from '@/frontend/lib/pettyCash/roles';
import { pcFetch, pcJson, type Expense } from './workflowTypes';

/**
 * The expense approver's queue: every uploaded spend routed to this user by Property
 * Routing, plus (for Accounts) the spends on properties with no expense approver set.
 * Accepting stamps the approver's name and time on the expense, which is what
 * reconciliation reads back.
 */
export default function ExpenseApprovals({ org, onOpen, onReviewed }: { org: string; onOpen: (id: string) => void; onReviewed?: () => void }) {
    const [rows, setRows] = useState<Expense[]>([]);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');
        pcFetch<{ expenses: Expense[]; total_pages: number }>(`/api/petty-cash/expense-approvals?org_id=${org}&page=${page}`)
            .then(data => { if (active) { setRows(data.expenses || []); setPages(Math.max(1, data.total_pages)); } })
            .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load expenses awaiting approval'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [org, page, retry]);

    const review = useCallback(async (expenseId: string, reviewStatus: 'accepted' | 'rejected') => {
        const remark = reviewStatus === 'rejected'
            ? window.prompt('Reason for rejecting this expense (the person who spent it will see this)')
            : window.prompt('Approval note (optional)') || '';
        if (reviewStatus === 'rejected' && !remark?.trim()) return;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            await pcFetch(`/api/petty-cash/expenses/${expenseId}`, pcJson({
                organization_id: org,
                review_status: reviewStatus,
                ...(remark?.trim() ? { remark: remark.trim() } : {})
            }, 'PATCH'));
            setMessage(reviewStatus === 'accepted' ? 'Expense approved. Your name and the time are recorded on it.' : 'Expense rejected and sent back for a replacement bill.');
            setRetry(value => value + 1);
            onReviewed?.();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Review failed');
        } finally {
            setBusy(false);
        }
    }, [org, onReviewed]);

    const pendingTotal = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="p-4 rounded-2xl bg-white dark:bg-[#161b22] border border-slate-200/80 dark:border-[#30363d] shadow-sm">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Expenses On This Page</span>
                    <div className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">{rows.length}</div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 block">Awaiting your decision</span>
                </div>
                <div className="p-4 rounded-2xl bg-white dark:bg-[#161b22] border border-slate-200/80 dark:border-[#30363d] shadow-sm">
                    <span className="text-[10px] font-black uppercase tracking-widest text-amber-500">Value On This Page</span>
                    <div className="text-2xl font-black text-amber-950 dark:text-amber-200 mt-1 tabular-nums">{inr(pendingTotal)}</div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 block">Unapproved spend routed to you</span>
                </div>
            </div>

            <div className="pc-panel rounded-3xl bg-white dark:bg-[#161b22] border border-slate-100 dark:border-[#30363d] shadow-sm overflow-hidden">
                <div className="pc-panel-heading p-5 border-b border-slate-100 dark:border-[#30363d] flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="pc-icon-tile w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                            <ShieldCheck size={18} />
                        </div>
                        <div>
                            <h2 className="font-bold text-base text-slate-900 dark:text-white">Expenses To Approve</h2>
                            <p className="text-xs text-text-secondary mt-0.5">Check the bill or declaration, then approve or reject. Your decision is stamped on the expense for reconciliation.</p>
                        </div>
                    </div>
                    <Button variant="solid" size="sm" className="gap-1.5 rounded-xl text-xs font-bold" disabled={loading || busy} onClick={() => setRetry(value => value + 1)}>
                        {loading || busy ? <Loader2 size={13} className="animate-spin" /> : null} Refresh
                    </Button>
                </div>

                {message && <p role="status" className="pc-success m-4"><CheckCircle2 size={18} className="shrink-0" />{message}</p>}

                {error ? (
                    <div role="alert" className="pc-alert m-4 flex flex-wrap justify-between items-center gap-3">
                        <span>{error}</span>
                        <Button variant="solid" size="sm" onClick={() => setRetry(value => value + 1)}>Retry</Button>
                    </div>
                ) : loading ? (
                    <p role="status" className="pc-empty p-12 text-center text-sm text-text-secondary">
                        <Loader2 size={24} className="animate-spin mx-auto mb-2 text-primary" />
                        Loading expenses awaiting approval…
                    </p>
                ) : !rows.length ? (
                    <div className="pc-empty p-12 text-center">
                        <ReceiptText size={28} className="mx-auto text-slate-400 mb-2" />
                        <h3 className="font-bold text-slate-800 dark:text-slate-200">Nothing waiting on you</h3>
                        <p className="text-xs text-text-secondary mt-1">Expenses appear here as soon as staff upload them on a property you approve for.</p>
                    </div>
                ) : (
                    <ExpenseTable expenses={rows} org={org} showRequester busy={busy} onOpen={onOpen} onReview={review} />
                )}
            </div>

            <div className="flex items-center justify-end gap-2">
                <Button variant="solid" size="sm" className="gap-1" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>
                    <ChevronLeft size={14} />Previous
                </Button>
                <p className="text-xs text-text-secondary px-2">Page {page} of {pages}</p>
                <Button variant="solid" size="sm" className="gap-1" disabled={loading || page >= pages} onClick={() => setPage(value => value + 1)}>
                    Next<ChevronRight size={14} />
                </Button>
            </div>
        </div>
    );
}
