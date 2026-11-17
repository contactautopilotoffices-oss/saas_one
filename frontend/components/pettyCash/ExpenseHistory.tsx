'use client';
import { useEffect, useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Loader2, ReceiptText, Building2, Users, Download, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import ExpenseTable from './ExpenseTable';
import { pcFetch, type Expense } from './workflowTypes';
import { inr } from '@/frontend/lib/pettyCash/roles';
import { exportExpensesToCsv, exportExpensesToExcel } from '@/frontend/lib/pettyCash/exportExpenses';

export default function ExpenseHistory({ org, onOpen }: { org: string; onOpen: (id: string) => void }) {
    const [rows, setRows] = useState<Expense[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [retry, setRetry] = useState(0);
    const [modeFilter, setModeFilter] = useState<'all' | 'Operation' | 'Client'>('all');

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');
        const modeParam = modeFilter !== 'all' ? `&spend_mode=${modeFilter}` : '';
        pcFetch<{ expenses: typeof rows; total_pages: number }>(`/api/petty-cash/expenses?org_id=${org}&page=${page}${modeParam}`)
            .then(data => {
                if (active) {
                    setRows(data.expenses);
                    setPages(Math.max(1, data.total_pages));
                }
            })
            .catch(reason => {
                if (active) setError(reason instanceof Error ? reason.message : 'Could not load expenses');
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, [org, page, modeFilter, retry]);

    const stats = useMemo(() => {
        let total = 0;
        let operation = 0;
        let client = 0;
        for (const row of rows) {
            const amt = Number(row.amount || 0);
            total += amt;
            if (row.spend_mode === 'Client') client += amt;
            else operation += amt;
        }
        return { total, operation, client };
    }, [rows]);

    return (
        <div className="space-y-4">
            {/* KPI Cards for Spends by Mode */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div className="p-4 rounded-2xl bg-white dark:bg-[#161b22] border border-slate-200/80 dark:border-[#30363d] shadow-sm">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Spent</span>
                    <div className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                        {inr(stats.total)}
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 block">
                        Across visible records
                    </span>
                </div>
                <div className="p-4 rounded-2xl bg-white dark:bg-[#161b22] border border-slate-200/80 dark:border-[#30363d] shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Operation Spends</span>
                        <Building2 size={15} className="text-indigo-500" />
                    </div>
                    <div className="text-2xl font-black text-indigo-950 dark:text-indigo-200 mt-1 tabular-nums">
                        {inr(stats.operation)}
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 block">
                        Maintenance, travel & assets
                    </span>
                </div>
                <div className="p-4 rounded-2xl bg-white dark:bg-[#161b22] border border-slate-200/80 dark:border-[#30363d] shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-widest text-amber-500">Client Spends</span>
                        <Users size={15} className="text-amber-500" />
                    </div>
                    <div className="text-2xl font-black text-amber-950 dark:text-amber-200 mt-1 tabular-nums">
                        {inr(stats.client)}
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 block">
                        Client hospitality & meetings
                    </span>
                </div>
            </div>

            <div className="pc-panel rounded-3xl bg-white dark:bg-[#161b22] border border-slate-100 dark:border-[#30363d] shadow-sm overflow-hidden">
                <div className="pc-panel-heading p-5 border-b border-slate-100 dark:border-[#30363d] flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="pc-icon-tile w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                            <ReceiptText size={18} />
                        </div>
                        <div>
                            <h2 className="font-bold text-base text-slate-900 dark:text-white">My Expenses</h2>
                            <p className="text-xs text-text-secondary mt-0.5">Dated spending for each request, classified by spend mode.</p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {/* Spend Mode Filter Pills */}
                        <div className="flex items-center p-1 bg-slate-100 dark:bg-[#21262d] rounded-xl text-xs font-bold">
                            <button
                                type="button"
                                onClick={() => { setModeFilter('all'); setPage(1); }}
                                className={`px-2.5 py-1 rounded-lg transition-all ${
                                    modeFilter === 'all'
                                        ? 'bg-white dark:bg-[#30363d] text-slate-900 dark:text-white shadow-xs'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                                }`}
                            >
                                All Modes
                            </button>
                            <button
                                type="button"
                                onClick={() => { setModeFilter('Operation'); setPage(1); }}
                                className={`px-2.5 py-1 rounded-lg flex items-center gap-1 transition-all ${
                                    modeFilter === 'Operation'
                                        ? 'bg-white dark:bg-[#30363d] text-indigo-600 dark:text-indigo-400 shadow-xs'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-indigo-600'
                                }`}
                            >
                                <Building2 size={12} /> Operation
                            </button>
                            <button
                                type="button"
                                onClick={() => { setModeFilter('Client'); setPage(1); }}
                                className={`px-2.5 py-1 rounded-lg flex items-center gap-1 transition-all ${
                                    modeFilter === 'Client'
                                        ? 'bg-white dark:bg-[#30363d] text-amber-600 dark:text-amber-400 shadow-xs'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-amber-600'
                                }`}
                            >
                                <Users size={12} /> Client
                            </button>
                        </div>

                        {/* Export Buttons */}
                        {rows.length > 0 && (
                            <div className="flex items-center gap-1.5">
                                <Button
                                    variant="solid"
                                    size="sm"
                                    onClick={() => exportExpensesToCsv(rows)}
                                    title="Export clean UTF-8 CSV with BOM"
                                    className="gap-1.5 rounded-xl border border-slate-200 dark:border-[#30363d] text-xs font-bold"
                                >
                                    <Download size={13} /> Export CSV
                                </Button>
                                <Button
                                    variant="solid"
                                    size="sm"
                                    onClick={() => exportExpensesToExcel(rows)}
                                    title="Export formatted Excel (.xls) with bold headers"
                                    className="gap-1.5 rounded-xl border border-slate-200 dark:border-[#30363d] text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700"
                                >
                                    <FileSpreadsheet size={13} /> Export Excel (.xls)
                                </Button>
                            </div>
                        )}
                    </div>
                </div>

                {error ? (
                    <div role="alert" className="pc-alert m-4 flex flex-wrap justify-between items-center">
                        <span>{error}</span>
                        <Button variant="solid" size="sm" onClick={() => setRetry(value => value + 1)}>Retry</Button>
                    </div>
                ) : loading ? (
                    <p role="status" className="pc-empty p-12 text-center text-sm text-text-secondary">
                        <Loader2 size={24} className="animate-spin mx-auto mb-2 text-primary" />
                        Loading expenses…
                    </p>
                ) : !rows.length ? (
                    <div className="pc-empty p-12 text-center">
                        <ReceiptText size={28} className="mx-auto text-slate-400 mb-2" />
                        <h3 className="font-bold text-slate-800 dark:text-slate-200">No expenses found</h3>
                        <p className="text-xs text-text-secondary mt-1">
                            {modeFilter !== 'all' ? `No ${modeFilter.toLowerCase()} expenses match your filter.` : 'Open a paid request to record a spend.'}
                        </p>
                    </div>
                ) : (
                    <ExpenseTable expenses={rows} org={org} onOpen={onOpen} />
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
