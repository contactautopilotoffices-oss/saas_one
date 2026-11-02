'use client';

import React, { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import type { CandidateSheet, SheetIssueRow } from '@/backend/lib/candidates/types';
import Skeleton from '@/frontend/components/ui/Skeleton';
import { api, qs } from './api';
import { BTN_SECONDARY, Dialog, EmptyState, LABEL, NUM_SM, useUi } from './ui';

type Loaded = { key: number; rows: SheetIssueRow[] | null; error: string };

/** "View issues": the rows of one sheet that were flagged or skipped, with what was wrong and the raw cell values. */
export default function IssuesModal({
    orgId, request, open, onClose,
}: {
    orgId: string;
    /** Kept after close so the content stays put during the exit animation; a new `key` refetches. */
    request: { sheet: CandidateSheet; key: number } | null;
    open: boolean;
    onClose: () => void;
}) {
    const { reportError } = useUi();
    const [loaded, setLoaded] = useState<Loaded | null>(null);

    useEffect(() => {
        if (!request) return;
        const { sheet, key } = request;
        const ctrl = new AbortController();
        void api<{ rows: SheetIssueRow[] }>(`/api/candidates/sheets/${encodeURIComponent(sheet.id)}/issues${qs({ orgId })}`, { signal: ctrl.signal })
            .then(res => {
                if (ctrl.signal.aborted) return;
                if (!res.ok) { if (res.noAccess) reportError(res); setLoaded({ key, rows: null, error: res.error }); return; }
                setLoaded({ key, rows: res.data.rows, error: '' });
            });
        return () => ctrl.abort();
    }, [orgId, request, reportError]);

    const sheet = request?.sheet ?? null;
    const current = request && loaded?.key === request.key ? loaded : null;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            labelId="sheet-issues-title"
            size="xl"
            title="Rows with issues"
            description={sheet && <span className="break-words">{sheet.name}</span>}
            footer={<button type="button" onClick={onClose} className={BTN_SECONDARY}>Close</button>}
        >
            {!current ? (
                <div className="space-y-3 py-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
            ) : current.error ? (
                <p role="alert" className="flex gap-2 py-6 text-sm text-text-primary"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-error" />{current.error}</p>
            ) : !current.rows || current.rows.length === 0 ? (
                <EmptyState icon={CircleCheck} title="No issues">Every row in this sheet was imported cleanly.</EmptyState>
            ) : (
                <div className="-mx-4 overflow-x-auto sm:mx-0">
                    <table className="w-full min-w-[640px] border-collapse text-sm">
                        <thead className="bg-surface-elevated">
                            <tr className={`${LABEL} text-left`}>
                                <th scope="col" className="w-20 px-4 py-3 font-semibold">Row</th>
                                <th scope="col" className="w-[38%] px-3 py-3 font-semibold">Issues</th>
                                <th scope="col" className="px-3 py-3 font-semibold">Values in the sheet</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border-subtle">
                            {current.rows.map(row => (
                                <tr key={row.rowNumber} className="align-top">
                                    <td className={`${NUM_SM} px-4 py-3 text-text-primary`}>{row.rowNumber}</td>
                                    <td className="px-3 py-3">
                                        <ul className="space-y-1">
                                            {row.issues.map((x, i) => (
                                                <li key={i} className="flex gap-1.5 text-text-primary">
                                                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden />{x}
                                                </li>
                                            ))}
                                        </ul>
                                    </td>
                                    <td className="px-3 py-3">
                                        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                                            {Object.entries(row.raw).map(([k, v]) => (
                                                <React.Fragment key={k}>
                                                    <dt className="truncate text-text-tertiary" title={k}>{k}</dt>
                                                    <dd className="break-words text-text-primary">{v || <span className="text-text-tertiary">(empty)</span>}</dd>
                                                </React.Fragment>
                                            ))}
                                        </dl>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </Dialog>
    );
}
