'use client';
import { useCallback, useEffect, useState, useMemo } from 'react';
import { inr, PC_STATUS_META, PC_PAYMENT_MODES } from '@/frontend/lib/pettyCash/roles';
import WorkflowModal from './WorkflowModal';
import ProofUpload from './ProofUpload';
import ExpenseForm from './ExpenseForm';
import ExpenseTable from './ExpenseTable';
import ReassignmentFields from './ReassignmentFields';
import { pcFetch, pcJson, pettyCashDate, pettyCashToday, type Context, type Detail, type Upload, type Expense } from './workflowTypes';
import {
    CheckCircle2,
    Clock,
    CreditCard,
    ArrowRight,
    AlertCircle,
    AlertTriangle,
    Building2,
    User,
    Receipt,
    Calendar,
    Sparkles,
    ShieldCheck,
    Check,
    FileText,
    Coins,
    RotateCcw,
    XCircle,
    PlusCircle,
    Info,
    ExternalLink,
    Cpu,
    ChevronDown,
    ChevronUp
} from 'lucide-react';

export default function WorkflowRequestDetail({
    context,
    id,
    onClose,
    onChanged
}: {
    context: Context;
    id: string;
    onClose: () => void;
    onChanged: () => void;
}) {
    const [detail, setDetail] = useState<Detail | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [legacyAmounts, setLegacyAmounts] = useState<Record<string, string>>({});
    const [action, setAction] = useState('');
    const [proofs, setProofs] = useState<Upload[]>([]);
    const [uploading, setUploading] = useState(false);
    const [expense, setExpense] = useState(false);
    const [correction, setCorrection] = useState<Expense>();
    const [showVisionAudit, setShowVisionAudit] = useState(false);

    const refresh = useCallback(async () => {
        try {
            setDetail(await pcFetch<Detail>(`/api/petty-cash/${id}?org_id=${context.organization_id}`));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load request');
        }
    }, [id, context.organization_id]);

    const visionScans = useMemo(() => {
        return detail?.activity?.filter(a => a.action === 'vision_ocr_scan') || [];
    }, [detail?.activity]);

    const visionUsage = useMemo(() => {
        if (!visionScans.length) return null;
        const totalTokens = visionScans.reduce((s, a) => s + Number((a.metadata as any)?.total_tokens || 0), 0);
        const promptTokens = visionScans.reduce((s, a) => s + Number((a.metadata as any)?.prompt_tokens || 0), 0);
        const completionTokens = visionScans.reduce((s, a) => s + Number((a.metadata as any)?.completion_tokens || 0), 0);
        const model = (visionScans[0]?.metadata as any)?.model || 'qwen3.8-27b';
        return {
            count: visionScans.length,
            totalTokens,
            promptTokens,
            completionTokens,
            model,
            costInr: (totalTokens / 1000) * 0.04,
        };
    }, [visionScans]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const changed = async () => {
        setAction('');
        setProofs([]);
        setExpense(false);
        setCorrection(undefined);
        await refresh();
        onChanged();
    };

    const r = detail?.request;
    const owner = r?.requester_id === context.user_id;
    const canAllocate = r?.workflow_version === 2 && r.status === 'submitted' && r.assigned_allocator_id === context.user_id && !owner;
    const canApprove = r?.workflow_version === 2 && r.status === 'pending_approval' && r?.assigned_approver_id === context.user_id && !owner;
    const finance = context.caps.canDisburse && r && !owner;
    const funded = !!r && ['paid', 'settlement_submitted', 'closed'].includes(r.status);
    const missingCredit = !!(r?.workflow_version === 2 && funded && Number(r.paid_amount) > 0 && detail?.wallet && detail.wallet.received === 0);

    const actions: { key: string; label: string; primary?: boolean; danger?: boolean }[] = [];
    if (canAllocate) actions.push({ key: 'allocate', label: 'Allocate Cash', primary: true });
    if (canApprove) actions.push({ key: 'approve', label: 'Approve Allocation', primary: true });
    if (canAllocate || canApprove) {
        actions.push({ key: 'send_back', label: 'Send Back' }, { key: 'reject', label: 'Reject', danger: true });
    }
    if (finance && r?.status === 'approved') actions.push({ key: 'pay', label: 'Mark Disbursed / Paid', primary: true });
    if (finance && r?.status === 'settlement_submitted') actions.push({ key: 'close', label: 'Review and Close', primary: true });
    if (finance && ['paid', 'settlement_submitted'].includes(r?.status || '') && (r?.workflow_version === 2 ? (detail?.balance || 0) : (detail?.reconciliation?.unaccounted || 0)) > 0) {
        actions.push({ key: 'return', label: 'Confirm Returned Cash' });
    }
    if (owner && r?.status === 'sent_back') actions.push({ key: 'resubmit', label: 'Correct and Resubmit', primary: true });
    if (owner && r?.status === 'draft') actions.push({ key: 'submit', label: 'Edit or Submit Draft', primary: true });
    if (owner && r && !missingCredit && ['paid', 'settlement_submitted'].includes(r.status) && (!detail?.balance || r.workflow_version === 1)) {
        actions.push({ key: 'settle', label: 'Submit Reconciliation', primary: true });
    }
    if (owner && r && ['draft', 'submitted', 'pending_approval', 'sent_back', 'approved'].includes(r.status)) {
        actions.push({ key: 'cancel', label: 'Cancel Request', danger: true });
    }
    if (context.caps.canManageRouting && r && ['submitted', 'pending_approval', 'sent_back'].includes(r.status)) {
        actions.push({ key: 'reassign', label: 'Reassign Routing' });
    }
    if (r?.request_type === 'reimbursement') actions.length = 0;

    // Financial KPI stats
    const requestedAmt = r ? Number(r.amount_requested) : 0;
    const approvedAmt = r ? Number(r.approved_amount || r.allocated_amount || 0) : 0;
    const paidAmt = r ? Number(r.paid_amount || (detail?.wallet?.received || 0)) : 0;
    const currentBalance = detail?.balance ?? (paidAmt - Number(r?.actual_spent || 0));
    const spentAmt = detail?.wallet?.spent ?? Number(r?.actual_spent || 0);
    const percentSpent = paidAmt > 0 ? Math.min(100, Math.round((spentAmt / paidAmt) * 100)) : 0;

    // Milestone calculation
    const status = r?.status || 'draft';
    const isSpecialStatus = ['rejected', 'sent_back', 'cancelled'].includes(status);

    const stages = [
        {
            id: 'requested',
            title: '1. Submitted',
            actorName: r?.requester?.full_name || 'Requester',
            meta: pettyCashDate(r?.created_at),
            isDone: status !== 'draft',
            isActive: status === 'draft',
            isFailed: status === 'cancelled',
            badge: inr(requestedAmt)
        },
        {
            id: 'allocated',
            title: '2. Allocated',
            actorName: r?.assigned_allocator?.full_name || 'Allocator',
            meta: r?.allocated_amount ? inr(r.allocated_amount) : 'Pending',
            isDone: ['pending_approval', 'approved', 'paid', 'settlement_submitted', 'closed'].includes(status),
            isActive: status === 'submitted',
            isFailed: status === 'rejected' || (status === 'sent_back' && !r?.allocated_amount),
            badge: r?.allocated_amount ? inr(r.allocated_amount) : undefined
        },
        {
            id: 'approved',
            title: '3. Approved',
            actorName: r?.assigned_approver?.full_name || 'Approver',
            meta: r?.approved_amount ? inr(r.approved_amount) : 'Pending',
            isDone: ['approved', 'paid', 'settlement_submitted', 'closed'].includes(status),
            isActive: status === 'pending_approval',
            isFailed: status === 'rejected',
            badge: r?.approved_amount ? inr(r.approved_amount) : undefined
        },
        {
            id: 'disbursed',
            title: '4. Disbursed',
            actorName: 'Treasury / Finance',
            meta: r?.payment_date ? pettyCashDate(r.payment_date) : r?.paid_mode || 'Pending',
            isDone: ['paid', 'settlement_submitted', 'closed'].includes(status),
            isActive: status === 'approved',
            isFailed: false,
            badge: paidAmt > 0 ? inr(paidAmt) : undefined
        },
        {
            id: 'settled',
            title: '5. Reconciled',
            actorName: 'Audit & Close',
            meta: status === 'closed' ? 'Closed' : currentBalance > 0 ? `${inr(currentBalance)} left` : 'Audit pending',
            isDone: status === 'closed',
            isActive: ['paid', 'settlement_submitted'].includes(status),
            isFailed: false,
            badge: status === 'closed' ? 'Settled' : undefined
        }
    ];

    return (
        <WorkflowModal title={r?.request_no || 'Petty cash request'} onClose={onClose} busy={busy || uploading}>
            {error && (
                <div role="alert" className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-300 text-xs font-semibold flex items-center gap-2">
                    <AlertCircle size={16} className="shrink-0 text-red-500" />
                    <span>{error}</span>
                </div>
            )}

            {!detail ? (
                !error && (
                    <div role="status" className="p-8 text-center text-sm text-slate-500 flex flex-col items-center justify-center gap-2">
                        <Clock className="animate-spin text-primary" size={24} />
                        <span>Loading request lifecycle…</span>
                    </div>
                )
            ) : (
                <div className="space-y-6">
                    {/* Header Summary & Property info */}
                    <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-[#161b22] border border-slate-200/80 dark:border-[#30363d]">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-black">
                                <Building2 size={20} />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                                        {r?.property?.name || 'Assigned Property'}
                                    </h3>
                                    {r?.property?.code && (
                                        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                            {r.property.code}
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
                                    <User size={13} />
                                    <span>Requested by <strong>{r?.requester?.full_name || r?.requester?.email}</strong></span>
                                    <span>•</span>
                                    <Calendar size={13} />
                                    <span>{pettyCashDate(r?.created_at)}</span>
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="pc-status" data-status={r!.status}>
                                {PC_STATUS_META[r!.status]?.label || r!.status}
                            </span>
                            {r?.workflow_version === 1 && (
                                <span className="text-[10px] font-black uppercase px-2 py-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                    Legacy v1
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Milestone Pipeline Stepper */}
                    <div className="p-4 rounded-2xl bg-white dark:bg-[#161b22] border border-slate-200/80 dark:border-[#30363d] shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-[11px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                                <Sparkles size={13} className="text-primary" /> Lifecycle Tracking
                            </span>
                            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                                {isSpecialStatus
                                    ? PC_STATUS_META[status]?.label
                                    : `Step ${stages.findIndex(s => s.isActive || (!s.isDone && s.id !== 'settled')) + 1} of 5`}
                            </span>
                        </div>

                        {/* Stepper Chain */}
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                            {stages.map((stage, idx) => {
                                const isCurrent = stage.isActive;
                                const isDone = stage.isDone;
                                const isFailed = stage.isFailed;

                                return (
                                    <div
                                        key={stage.id}
                                        className={`relative p-3 rounded-xl border transition-all flex flex-col justify-between ${
                                            isDone
                                                ? 'bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-100'
                                                : isCurrent
                                                ? 'bg-primary/10 border-primary/50 text-slate-900 dark:text-white shadow-sm ring-1 ring-primary/30'
                                                : isFailed
                                                ? 'bg-red-500/5 border-red-500/30 text-red-900 dark:text-red-200'
                                                : 'bg-slate-50/50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-1 mb-1.5">
                                            <span className="text-xs font-bold leading-tight truncate">
                                                {stage.title}
                                            </span>
                                            {isDone && <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />}
                                            {isCurrent && (
                                                <span className="relative flex h-2 w-2 shrink-0">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                                                </span>
                                            )}
                                            {isFailed && <XCircle size={14} className="text-red-500 shrink-0" />}
                                        </div>

                                        <div className="text-[11px] space-y-0.5">
                                            <p className={`font-semibold truncate ${isDone || isCurrent ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>
                                                {stage.actorName}
                                            </p>
                                            <p className={`text-[10px] font-medium truncate ${isDone ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                                                {stage.meta}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Contextual Next Step Guidance Banner */}
                        <div className="mt-3.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 flex items-center justify-between gap-3 text-xs">
                            <div className="flex items-center gap-2">
                                <Info size={15} className="text-primary shrink-0" />
                                <span className="text-slate-700 dark:text-slate-300">
                                    {status === 'submitted' && (
                                        <>Awaiting <strong>{r?.assigned_allocator?.full_name || 'Allocator'}</strong> to assign budget limit.</>
                                    )}
                                    {status === 'pending_approval' && (
                                        <>Awaiting approval from <strong>{r?.assigned_approver?.full_name || 'Approver'}</strong> for {inr(r?.allocated_amount)}.</>
                                    )}
                                    {status === 'approved' && (
                                        <>Sanctioned! Awaiting <strong>Treasury / Accounts</strong> to record disbursal voucher.</>
                                    )}
                                    {status === 'paid' && currentBalance > 0 && (
                                        <>Cash active! Requester can record daily expenses with <strong>Vision AI OCR</strong> below.</>
                                    )}
                                    {status === 'paid' && currentBalance <= 0 && (
                                        <>All funds spent! Requester can submit reconciliation for audit review.</>
                                    )}
                                    {status === 'settlement_submitted' && (
                                        <>Settlement submitted. Finance must review attached bills and close the request.</>
                                    )}
                                    {status === 'closed' && (
                                        <>Reconciliation settled and verified. This request is closed.</>
                                    )}
                                    {status === 'sent_back' && (
                                        <span className="text-amber-600 dark:text-amber-400 font-semibold">
                                            Request was sent back: &ldquo;{r?.approval_remarks || r?.remarks || 'Please revise purpose/amount'}&rdquo;
                                        </span>
                                    )}
                                    {status === 'rejected' && (
                                        <span className="text-red-600 dark:text-red-400 font-semibold">
                                            Request rejected: &ldquo;{r?.approval_remarks || r?.remarks || 'Declined'}&rdquo;
                                        </span>
                                    )}
                                </span>
                            </div>
                            {actions.length > 0 && !action && (
                                <span className="text-[10px] font-black uppercase text-primary tracking-wider shrink-0 hidden sm:inline-block">
                                    Actions Available Below
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Financial KPI Summary Cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="p-4 rounded-2xl bg-white dark:bg-[#161b22] border border-slate-200/80 dark:border-[#30363d] shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1">
                                Requested
                            </span>
                            <strong className="block text-xl font-black text-slate-900 dark:text-white tabular-nums">
                                {inr(requestedAmt)}
                            </strong>
                            <span className="text-[11px] text-slate-400 mt-1 block">Initial estimate</span>
                        </div>

                        <div className="p-4 rounded-2xl bg-white dark:bg-[#161b22] border border-slate-200/80 dark:border-[#30363d] shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1">
                                Sanctioned
                            </span>
                            <strong className="block text-xl font-black text-slate-900 dark:text-white tabular-nums">
                                {inr(approvedAmt || requestedAmt)}
                            </strong>
                            <span className="text-[11px] text-slate-400 mt-1 block">
                                {r?.approved_amount ? 'Approved limit' : r?.allocated_amount ? 'Allocated limit' : 'Under review'}
                            </span>
                        </div>

                        <div className="p-4 rounded-2xl bg-white dark:bg-[#161b22] border border-slate-200/80 dark:border-[#30363d] shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1">
                                Disbursed
                            </span>
                            <strong className="block text-xl font-black text-slate-900 dark:text-white tabular-nums">
                                {inr(paidAmt)}
                            </strong>
                            <span className="text-[11px] text-slate-400 mt-1 block truncate">
                                {r?.paid_mode ? `${r.paid_mode} • ${pettyCashDate(r.payment_date || r.paid_at)}` : 'Pending payment'}
                            </span>
                        </div>

                        <div className="p-4 rounded-2xl bg-white dark:bg-[#161b22] border border-slate-200/80 dark:border-[#30363d] shadow-sm">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                                    Remaining Float
                                </span>
                                {currentBalance > 0 && (
                                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                        Ready
                                    </span>
                                )}
                            </div>
                            <strong className={`block text-xl font-black tabular-nums ${currentBalance > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>
                                {inr(currentBalance)}
                            </strong>
                            {paidAmt > 0 && (
                                <div className="mt-2 space-y-1">
                                    <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                        <div
                                            className="bg-primary h-full rounded-full transition-all"
                                            style={{ width: `${percentSpent}%` }}
                                        />
                                    </div>
                                    <span className="text-[10px] text-slate-400 block font-medium">
                                        Spent: {inr(spentAmt)} ({percentSpent}%)
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Purpose Statement & Details */}
                    <div className="p-4 rounded-2xl bg-slate-50/70 dark:bg-[#161b22] border border-slate-200/80 dark:border-[#30363d] space-y-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block">
                            Purpose & Justification
                        </span>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-relaxed">
                            {r?.purpose || 'No purpose description provided.'}
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1 text-xs">
                            {r?.category && (
                                <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold">
                                    Category: {r.category}
                                </span>
                            )}
                            {r?.department && (
                                <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold">
                                    Dept: {r.department}
                                </span>
                            )}
                            {r?.payment_ref && (
                                <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold">
                                    Payment Ref: {r.payment_ref}
                                </span>
                            )}
                        </div>
                    </div>

                    {missingCredit && (
                        <div role="alert" className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-amber-200 text-xs font-semibold flex items-center gap-2">
                            <AlertTriangle size={16} className="shrink-0 text-amber-500" />
                            <span>This request is marked Paid, but its wallet credit is missing. Accounts must verify the payment record before you can record spending.</span>
                        </div>
                    )}

                    {/* Action Buttons Bar */}
                    <div className="flex flex-wrap items-center gap-2.5 pt-1">
                        {actions.map(a => (
                            <button
                                type="button"
                                disabled={busy}
                                key={a.key}
                                className={`pc-button ${
                                    a.primary
                                        ? ''
                                        : a.danger
                                        ? 'pc-button-danger'
                                        : 'pc-button-secondary'
                                }`}
                                onClick={() => {
                                    setAction(a.key);
                                    setProofs([]);
                                    setError('');
                                }}
                            >
                                {a.label}
                            </button>
                        ))}

                        {owner && r?.workflow_version === 2 && ['paid', 'settlement_submitted'].includes(r.status) && (
                            <button
                                disabled={busy || missingCredit || currentBalance <= 0}
                                className="pc-button gap-1.5 shadow-sm"
                                onClick={() => {
                                    setExpense(!expense);
                                    setCorrection(undefined);
                                }}
                            >
                                <Sparkles size={14} />
                                {expense ? 'Cancel Expense Entry' : 'Record Expense (AI OCR)'}
                            </button>
                        )}
                    </div>

                    {/* Action Form (when action is selected) */}
                    {action && (
                        <form
                            className="space-y-4 border border-slate-200 dark:border-[#30363d] rounded-2xl p-5 bg-slate-50/60 dark:bg-[#161b22]/70 shadow-sm"
                            onSubmit={async event => {
                                event.preventDefault();
                                setBusy(true);
                                setError('');
                                const form = new FormData(event.currentTarget);
                                const body: Record<string, unknown> = {
                                    organization_id: context.organization_id,
                                    action,
                                    expected_version: r!.version,
                                    remark: form.get('remark') || '',
                                    documents: proofs
                                };
                                if (action === 'submit' && ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement)?.value === 'draft') {
                                    body.action = 'save_draft';
                                }
                                if (action === 'allocate') body.allocated_amount = form.get('amount');
                                if (action === 'pay') {
                                    body.paid_mode = form.get('paid_mode');
                                    body.payment_ref = form.get('payment_ref');
                                    body.payment_date = form.get('payment_date');
                                }
                                if (action === 'return') body.amount_returned = form.get('amount');
                                if (action === 'resubmit' || action === 'submit') {
                                    body.amount_requested = form.get('amount');
                                    body.purpose = form.get('purpose');
                                    body.property_id = form.get('property_id') || context.properties[0]?.id;
                                }
                                if (action === 'reassign') {
                                    body.reassign_allocator_id = form.get('reassign_allocator_id');
                                    body.reassign_approver_id = form.get('reassign_approver_id');
                                }
                                if (action === 'settle' && r?.workflow_version === 1) {
                                    body.documents = proofs.map(p => ({
                                        ...p,
                                        amount: legacyAmounts[p.upload_id],
                                        bill_date: form.get('bill_date'),
                                        vendor: form.get('vendor'),
                                        replaces_document_id: form.get(`replaces_${p.upload_id}`) || undefined
                                    }));
                                }
                                try {
                                    await pcFetch(`/api/petty-cash/${id}`, pcJson(body, 'PATCH'));
                                    await changed();
                                } catch (e) {
                                    setError(e instanceof Error ? e.message : 'Action failed');
                                    await refresh();
                                } finally {
                                    setBusy(false);
                                }
                            }}
                        >
                            <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                                <FileText size={18} className="text-primary" />
                                {actions.find(a => a.key === action)?.label || action}
                            </h3>

                            {['allocate', 'return', 'resubmit', 'submit'].includes(action) && (
                                <label className="block">
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Amount (₹)</span>
                                    <input
                                        name="amount"
                                        className="pc-input mt-1 text-sm font-bold"
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        defaultValue={r?.amount_requested}
                                        max={action === 'allocate' ? r?.amount_requested : action === 'return' ? (r?.workflow_version === 2 ? detail.balance : detail.reconciliation?.unaccounted) : undefined}
                                        required
                                    />
                                </label>
                            )}

                            {(action === 'resubmit' || action === 'submit') && (
                                <>
                                    <label className="block">
                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Purpose</span>
                                        <textarea name="purpose" className="pc-input mt-1" defaultValue={r?.purpose} required />
                                    </label>
                                    {context.properties.length === 1 ? (
                                        <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Property: <strong>{context.properties[0].name}</strong></p>
                                    ) : (
                                        <label className="block">
                                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Property</span>
                                            <select aria-label="Property" name="property_id" className="pc-input mt-1" required defaultValue={context.properties.some(p => p.id === r?.property_id) ? r?.property_id : ''}>
                                                <option value="">Select assigned property</option>
                                                {context.properties.map(p => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
                                            </select>
                                        </label>
                                    )}
                                    <ProofUpload org={context.organization_id} value={proofs} onChange={setProofs} disabled={busy} onBusyChange={setUploading} />
                                </>
                            )}

                            {action === 'reassign' && (
                                <ReassignmentFields org={context.organization_id} propertyId={r!.property_id} requesterId={r!.requester_id} />
                            )}

                            {action === 'approve' && (
                                <p className="text-sm text-slate-600 dark:text-slate-300">
                                    Approve allocation of <strong>{inr(r?.workflow_version === 2 ? r.allocated_amount : r?.amount_requested)}</strong>. To alter the sanctioned amount, choose &quot;Send Back&quot; to request changes from the allocator.
                                </p>
                            )}

                            {action === 'pay' && (
                                <div className="space-y-3">
                                    <p className="text-xs text-slate-600 dark:text-slate-300">
                                        Confirm that payment of <strong>{inr(r?.approved_amount)}</strong> has already been disbursed. This credits the requester&apos;s float wallet.
                                    </p>
                                    <div className="grid sm:grid-cols-2 gap-3">
                                        <label className="block">
                                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Payment Date</span>
                                            <input name="payment_date" type="date" className="pc-input mt-1" defaultValue={pettyCashToday()} max={pettyCashToday()} required />
                                        </label>
                                        <label className="block">
                                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Payment Mode</span>
                                            <select name="paid_mode" className="pc-input mt-1">
                                                {PC_PAYMENT_MODES.map(m => (
                                                    <option key={m}>{m}</option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>
                                    <label className="block">
                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Payment Reference / UTR</span>
                                        <input name="payment_ref" className="pc-input mt-1" placeholder="e.g. UPI Ref / Cheque No / Voucher ID" />
                                    </label>
                                </div>
                            )}

                            {action === 'settle' && r?.workflow_version === 1 && (
                                <div className="space-y-3">
                                    <label className="block">
                                        <span className="text-xs font-bold">Bill Date</span>
                                        <input name="bill_date" type="date" className="pc-input mt-1" required={!!proofs.length} />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-bold">Vendor</span>
                                        <input name="vendor" className="pc-input mt-1" required={!!proofs.length} />
                                    </label>
                                    <ProofUpload org={context.organization_id} value={proofs} onChange={setProofs} disabled={busy} onBusyChange={setUploading} />
                                    {proofs.map(p => (
                                        <label className="block" key={p.upload_id}>
                                            <span className="text-xs font-semibold">{p.file_name}: Bill amount (₹)</span>
                                            <input
                                                type="number"
                                                className="pc-input mt-1"
                                                min="0.01"
                                                step="0.01"
                                                required
                                                value={legacyAmounts[p.upload_id] || ''}
                                                onChange={e => setLegacyAmounts(prev => ({ ...prev, [p.upload_id]: e.target.value }))}
                                            />
                                        </label>
                                    ))}
                                    {proofs.map(p => (
                                        <label className="block" key={`replacement_${p.upload_id}`}>
                                            <span className="text-xs font-semibold">Replaces rejected bill (optional)</span>
                                            <select className="pc-input mt-1" name={`replaces_${p.upload_id}`}>
                                                <option value="">New bill</option>
                                                {detail.documents.filter(d => d.stage === 'settlement' && d.review_status === 'rejected' && !d.superseded_by).map(d => (
                                                    <option key={d.id} value={d.id}>{d.file_name} — {inr(d.amount)}</option>
                                                ))}
                                            </select>
                                        </label>
                                    ))}
                                </div>
                            )}

                            <label className="block">
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                    Remarks {['send_back', 'reject', 'return'].includes(action) && <span className="text-red-500">*</span>}
                                </span>
                                <textarea
                                    name="remark"
                                    className="pc-input mt-1"
                                    rows={2}
                                    placeholder="Add any notes or justification..."
                                    required={['send_back', 'reject', 'return'].includes(action)}
                                />
                            </label>

                            <div className="flex items-center gap-2.5 pt-2">
                                <button
                                    className="pc-button"
                                    disabled={busy || uploading || (action === 'submit' && !context.wallet.can_request)}
                                >
                                    {busy ? 'Processing…' : 'Confirm Action'}
                                </button>
                                {action === 'submit' && (
                                    <button className="pc-button pc-button-secondary" type="submit" value="draft" disabled={busy || uploading}>
                                        Save Draft
                                    </button>
                                )}
                                <button type="button" className="pc-button pc-button-secondary" onClick={() => setAction('')} disabled={busy}>
                                    Cancel
                                </button>
                            </div>
                        </form>
                    )}

                    {/* Expense Entry Form */}
                    {(expense || correction) && (
                        <div className="p-5 rounded-2xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-[#30363d] shadow-sm space-y-3">
                            <div className="flex items-center justify-between">
                                <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                                    <Sparkles size={16} className="text-primary" />
                                    {correction ? 'Correct Existing Expense' : 'Record Expense with Vision AI Verification'}
                                </h3>
                                <button
                                    type="button"
                                    onClick={() => { setExpense(false); setCorrection(undefined); }}
                                    className="text-xs text-slate-400 hover:text-slate-600"
                                >
                                    Cancel
                                </button>
                            </div>
                            <ExpenseForm
                                key={correction?.id || 'new'}
                                context={context}
                                requestId={id}
                                balance={detail.balance}
                                correction={correction}
                                existingExpenses={detail.expenses}
                                onSaved={() => { void changed(); }}
                            />
                        </div>
                    )}

                    {/* Vision AI Model Usage & Audit per Request - Org Super Admin Only */}
                    {context.caps.isAdmin && visionUsage && (
                        <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-50/90 via-purple-50/50 to-indigo-50/90 dark:from-indigo-950/40 dark:via-purple-950/20 dark:to-indigo-950/40 border border-indigo-200/80 dark:border-indigo-900/60 shadow-sm space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2.5">
                                <div className="flex items-center gap-2.5">
                                    <div className="p-2 rounded-xl bg-indigo-600 text-white shadow-sm flex items-center justify-center">
                                        <Sparkles size={16} />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h4 className="text-xs font-black text-slate-900 dark:text-white">
                                                Vision Model Usage
                                            </h4>
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-100 dark:bg-indigo-900/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                                {visionUsage.model}
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                            Tracked per-request for Org Super Admin audit & cost monitoring
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 bg-white/80 dark:bg-black/40 px-3 py-1.5 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
                                    <div>
                                        <span className="text-[9px] font-bold uppercase text-slate-400 block tracking-wider">Total Tokens</span>
                                        <span className="text-xs font-black text-indigo-950 dark:text-indigo-200 tabular-nums">
                                            {visionUsage.totalTokens.toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="pl-2 border-l border-slate-200 dark:border-slate-800">
                                        <span className="text-[9px] font-bold uppercase text-slate-400 block tracking-wider">Est. Cost</span>
                                        <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                                            ₹{visionUsage.costInr.toFixed(3)}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setShowVisionAudit(!showVisionAudit)}
                                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 p-1 flex items-center gap-1 font-bold"
                                    >
                                        {showVisionAudit ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                                <div className="p-2.5 rounded-xl bg-white/70 dark:bg-black/30 border border-indigo-100 dark:border-indigo-900/30">
                                    <span className="text-[9px] uppercase font-bold text-slate-400 block">OCR Scans</span>
                                    <span className="font-black text-slate-900 dark:text-white">{visionUsage.count} scans</span>
                                </div>
                                <div className="p-2.5 rounded-xl bg-white/70 dark:bg-black/30 border border-indigo-100 dark:border-indigo-900/30">
                                    <span className="text-[9px] uppercase font-bold text-slate-400 block">Prompt Tokens</span>
                                    <span className="font-bold text-slate-900 dark:text-white tabular-nums">{visionUsage.promptTokens.toLocaleString()}</span>
                                </div>
                                <div className="p-2.5 rounded-xl bg-white/70 dark:bg-black/30 border border-indigo-100 dark:border-indigo-900/30">
                                    <span className="text-[9px] uppercase font-bold text-slate-400 block">Completion Tokens</span>
                                    <span className="font-bold text-slate-900 dark:text-white tabular-nums">{visionUsage.completionTokens.toLocaleString()}</span>
                                </div>
                                <div className="p-2.5 rounded-xl bg-white/70 dark:bg-black/30 border border-indigo-100 dark:border-indigo-900/30">
                                    <span className="text-[9px] uppercase font-bold text-slate-400 block">Status</span>
                                    <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                        <ShieldCheck size={12} /> Active & Audited
                                    </span>
                                </div>
                            </div>

                            {showVisionAudit && (
                                <div className="pt-2 border-t border-indigo-200/50 dark:border-indigo-900/50 space-y-1.5">
                                    <span className="text-[10px] font-black uppercase text-indigo-700 dark:text-indigo-300 block">
                                        Request Vision OCR Call Log
                                    </span>
                                    <div className="space-y-1">
                                        {visionScans.map((s, idx) => {
                                            const meta = (s.metadata || {}) as Record<string, any>;
                                            return (
                                                <div key={s.id || idx} className="p-2 rounded-xl bg-white/60 dark:bg-black/20 border border-indigo-100/70 dark:border-indigo-900/30 flex items-center justify-between text-[11px]">
                                                    <div className="flex items-center gap-2">
                                                        <Sparkles size={12} className="text-indigo-500" />
                                                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                                                            {meta.file_name || 'Receipt Image'}
                                                        </span>
                                                        {meta.extracted_amount && (
                                                            <span className="text-slate-500">₹{meta.extracted_amount}</span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2 font-mono text-[10px]">
                                                        <span className="text-slate-500">{meta.total_tokens || 0} tokens</span>
                                                        <span className="text-emerald-600 font-bold">{meta.confidence || 80}% conf</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Expenses and Bills Section */}
                    <div className="space-y-3 pt-2">
                        <div className="flex flex-wrap justify-between items-center gap-2">
                            <div>
                                <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                                    <Receipt size={17} className="text-primary" /> Expenses & Receipt Audits
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    {detail.expenses.length} {detail.expenses.length === 1 ? 'expense' : 'expenses'} recorded against this request
                                </p>
                            </div>
                        </div>

                        <ExpenseTable
                            org={context.organization_id}
                            showRequest={false}
                            busy={busy}
                            expenses={detail.expenses.map(entry => ({
                                ...entry,
                                documents: detail.documents.filter(document => document.expense_id === entry.id)
                            }))}
                            onCorrect={owner ? entry => { setCorrection(entry); setExpense(false); } : undefined}
                            onReview={finance && r?.status !== 'closed' ? async (expenseId, reviewStatus) => {
                                const remark = reviewStatus === 'rejected' ? window.prompt('Reason for rejecting proof') : undefined;
                                if (reviewStatus === 'rejected' && !remark?.trim()) return;
                                setBusy(true);
                                setError('');
                                try {
                                    await pcFetch(`/api/petty-cash/expenses/${expenseId}`, pcJson({
                                        organization_id: context.organization_id,
                                        review_status: reviewStatus,
                                        ...(remark ? { remark } : {})
                                    }, 'PATCH'));
                                    await changed();
                                } catch (reason) {
                                    setError(reason instanceof Error ? reason.message : 'Review failed');
                                } finally {
                                    setBusy(false);
                                }
                            } : undefined}
                        />

                        {/* Standalone Request Documents / Advance attachments */}
                        {detail.documents.filter(d => !d.expense_id).length > 0 && (
                            <div className="space-y-2 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                                    Initial Attached Documents & Disbursal Proofs
                                </span>
                                <div className="space-y-1.5">
                                    {detail.documents.filter(d => !d.expense_id).map(d => (
                                        <div key={d.id} className="flex items-center justify-between text-xs py-1">
                                            <a
                                                className="text-primary hover:underline font-semibold flex items-center gap-1.5"
                                                href={`/api/petty-cash/documents/${d.id}/download?org_id=${context.organization_id}`}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                <ExternalLink size={13} />
                                                <span className="capitalize">{d.stage} Proof:</span> {d.file_name}
                                            </a>
                                            {r?.workflow_version === 1 && d.stage === 'settlement' && (
                                                <span className="text-slate-500 font-medium">
                                                    {inr(d.amount)} • {d.superseded_by ? 'Superseded' : d.review_status} {d.review_remarks}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Activity Audit Timeline */}
                    <div className="space-y-3 pt-3">
                        <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                            <Clock size={17} className="text-primary" /> Lifecycle Audit Trail
                        </h3>

                        <div className="relative border-l-2 border-slate-200 dark:border-slate-800 ml-3 pl-5 space-y-4">
                            {detail.activity.filter(a => a.action !== 'vision_ocr_scan' || context.caps.isAdmin).map(a => {
                                const amount =
                                    a.action === 'allocate' ? a.metadata?.after?.allocated_amount :
                                    a.action === 'approve' ? a.metadata?.after?.approved_amount :
                                    a.action === 'pay' ? a.metadata?.after?.paid_amount :
                                    undefined;

                                const dateStr = new Date(a.created_at).toLocaleString('en-IN', {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                    timeZone: 'Asia/Kolkata'
                                });

                                return (
                                    <div key={a.id} className="relative group">
                                        {/* Dot indicator */}
                                        <div className="absolute -left-[27px] top-1 w-3 h-3 rounded-full bg-white dark:bg-[#161b22] border-2 border-primary group-hover:scale-125 transition-transform" />

                                        <div className={`p-3 rounded-xl border space-y-1 ${
                                            a.action === 'vision_ocr_scan'
                                                ? 'bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-200/60 dark:border-indigo-900/40'
                                                : 'bg-slate-50/70 dark:bg-[#161b22] border border-slate-200/60 dark:border-[#30363d]'
                                        }`}>
                                            <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                                                <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                                                    {a.action === 'vision_ocr_scan' && <Sparkles size={13} className="text-indigo-600 dark:text-indigo-400" />}
                                                    <span className="capitalize">{a.action === 'vision_ocr_scan' ? 'Vision AI Receipt OCR' : a.action.replace(/_/g, ' ')}</span>
                                                    {amount != null && (
                                                        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[11px] font-black tabular-nums">
                                                            {inr(amount)}
                                                        </span>
                                                    )}
                                                    {a.action === 'vision_ocr_scan' && (
                                                        <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold">
                                                            {(a.metadata as any)?.total_tokens || 0} tokens
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="text-[11px] text-slate-400 font-medium">{dateStr}</span>
                                            </div>

                                            <p className="text-xs text-slate-600 dark:text-slate-400">
                                                By <strong className="font-semibold text-slate-800 dark:text-slate-200">{a.actor?.full_name || 'System'}</strong>
                                            </p>

                                            {a.remark && (
                                                <div className="mt-1.5 p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60 text-xs italic text-slate-700 dark:text-slate-300">
                                                    &ldquo;{a.remark}&rdquo;
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </WorkflowModal>
    );
}

