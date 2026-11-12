'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CircleAlert, FileSpreadsheet, FileText, Lock, Search, Users } from 'lucide-react';
import ModalPortal from '@/frontend/components/ui/ModalPortal';
import type { PanelToggleVariant } from '@/frontend/components/ui/PanelToggle';
import { Toast } from '@/frontend/components/ui/Toast';
import type { CandidateListResponse, ResumeFilesResponse, ResumeSummary, SheetsResponse } from '@/backend/lib/candidates/types';
import type { ApiFailure } from './api';
import { api, NO_ACCESS_MESSAGE, qs } from './api';
import { formatCount } from './format';
import RecordsView from './RecordsView';
import ResumesView from './ResumesView';
import SearchView from './SearchView';
import SheetsView from './SheetsView';
import { IssueJobsWatcher } from './IssuesModal';
import { CARD, EASE_PATIENT, EmptyState, Spinner, UiProvider } from './ui';

/**
 * Candidate Search (Tech console and the HR logins, owner 2026-11-02 / 2026-11-07): find people in the uploaded sourcing
 * sheets with the filter panel (owner 2026-11-06), keep the records tidy, manage the sheets, and collect the resume
 * files (owner 2026-11-07). Four views behind one segmented control. Each view mounts on first visit and then stays
 * mounted (hidden), so switching views never throws away a search, a half-typed filter or an upload in progress.
 *
 * Redesign (owner 2026-11-11): each tab shows how much it holds, and beside the tabs the module says what it is doing in
 * the background (resumes still being read) and what needs a person (files that could not be read). Both lead to the
 * Resumes tab. The numbers are refreshed when the data changes, on a tab switch, and while files are being read.
 */

/** While resumes are being read in the background, the numbers beside the tabs are asked for again this often. */
const STATUS_POLL_MS = 10_000;

interface Counts { candidates: number | null; sheets: number | null; resumes: number | null; reading: number; attention: number }
const NO_COUNTS: Counts = { candidates: null, sheets: null, resumes: null, reading: 0, attention: 0 };

type View = 'search' | 'candidates' | 'sheets' | 'resumes';
const VIEWS: Array<{ id: View; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'search', label: 'Search', icon: Search },
    { id: 'candidates', label: 'Candidates', icon: Users },
    { id: 'sheets', label: 'Sheets', icon: FileSpreadsheet },
    { id: 'resumes', label: 'Resumes', icon: FileText },
];

export default function CandidateSearchTab({ orgId, collapseStyle = 'panel' }: {
    orgId: string;
    /** The filters' collapse button follows the host console's sidebar button: "panel" (Tech) or "chevron" (HR logins). */
    collapseStyle?: PanelToggleVariant;
}) {
    const [view, setView] = useState<View>('search');
    const [visited, setVisited] = useState<Record<View, boolean>>({ search: true, candidates: false, sheets: false, resumes: false });
    const [noAccess, setNoAccess] = useState(false);
    // The last toast is kept after it hides so its exit animation has content; a new id remounts it (restarts the timer).
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info'; id: number } | null>(null);
    const [toastVisible, setToastVisible] = useState(false);
    /** Bumped after any change (record saved / deleted, sheet uploaded / deleted / restored) so other views refetch. */
    const [dataVersion, setDataVersion] = useState(0);

    const notify = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
        setToast(t => ({ message, type, id: (t?.id ?? 0) + 1 }));
        setToastVisible(true);
    }, []);
    const reportError = useCallback((f: ApiFailure) => {
        if (f.aborted) return;
        if (f.noAccess) { setNoAccess(true); return; }
        setToast(t => ({ message: f.error, type: 'error', id: (t?.id ?? 0) + 1 }));
        setToastVisible(true);
    }, []);
    const closeToast = useCallback(() => setToastVisible(false), []);
    const ui = useMemo(() => ({ notify, reportError }), [notify, reportError]);
    const onDataChanged = useCallback(() => setDataVersion(v => v + 1), []);

    // What each tab holds and what is going on in the background. A failed call leaves its number out; it never shows an error.
    const [counts, setCounts] = useState<Counts>(NO_COUNTS);
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (noAccess) return;
        const ctrl = new AbortController();
        const signal = ctrl.signal;
        void Promise.all([
            api<CandidateListResponse>(`/api/candidates${qs({ orgId, pageSize: 1 })}`, { signal }),
            api<SheetsResponse>(`/api/candidates/sheets${qs({ orgId })}`, { signal }),
            api<ResumeSummary>(`/api/candidates/resumes/summary${qs({ orgId })}`, { signal }),
            api<ResumeFilesResponse>(`/api/candidates/resumes${qs({ orgId, link: 'attention', pageSize: 1 })}`, { signal }),
        ]).then(([people, sheets, resumes, attention]) => {
            if (signal.aborted) return;
            const denied = [people, sheets, resumes, attention].find(r => !r.ok && r.noAccess);
            if (denied && !denied.ok) { reportError(denied); return; }
            setCounts({
                candidates: people.ok ? people.data.total : null,
                sheets: sheets.ok ? sheets.data.sheets.length : null,
                resumes: resumes.ok ? resumes.data.total : null,
                // Files not finished yet: a file whose text is still being read is also waiting for its details.
                reading: resumes.ok ? Math.max(resumes.data.textPending, resumes.data.extractPending) : 0,
                // The same files the Resumes tab lists under "Needs attention": unread ones and the documents kept aside.
                attention: (attention.ok ? attention.data.total : 0) + (resumes.ok ? resumes.data.other : 0),
            });
        });
        return () => ctrl.abort();
    }, [orgId, dataVersion, view, tick, noAccess, reportError]);
    const reading = counts.reading > 0;
    useEffect(() => {
        if (!reading) return;
        const t = setInterval(() => setTick(n => n + 1), STATUS_POLL_MS);
        return () => clearInterval(t);
    }, [reading]);
    const countOf: Record<View, number | null> = { search: null, candidates: counts.candidates, sheets: counts.sheets, resumes: counts.resumes };

    const open = (v: View) => {
        setView(v);
        if (!visited[v]) setVisited(s => ({ ...s, [v]: true }));
    };

    if (noAccess) {
        return (
            <div className={`${CARD} mx-auto max-w-lg`}>
                <EmptyState icon={Lock} title={NO_ACCESS_MESSAGE}>Ask an administrator if you need it.</EmptyState>
            </div>
        );
    }

    return (
        <UiProvider value={ui}>
            {/* View issues: its jobs go on when the box is closed, and report here wherever HR is by then. */}
            <IssueJobsWatcher onChanged={onDataChanged} />
            {/* One width for every view (owner 2026-11-11), so the tab bar does not shift when the view changes: the
                whole width of the page, so nothing is left empty beside it when the sidebar is collapsed. */}
            <div className="w-full min-w-0 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                {/* Segmented control: L1 recessed track, active segment lifted to L2 (Linear: adjacent steps only). */}
                <div role="tablist" aria-label="Candidate Search views" className="grid w-full grid-cols-4 gap-x-1 gap-y-1 rounded-xl bg-surface-elevated px-1 py-1 ring-1 ring-inset ring-border-subtle sm:inline-grid sm:w-auto">
                    {VIEWS.map(({ id, label, icon: Icon }) => {
                        const on = view === id;
                        return (
                            <button
                                key={id}
                                type="button"
                                role="tab"
                                id={`cand-tab-${id}`}
                                aria-selected={on}
                                aria-controls={`cand-panel-${id}`}
                                onClick={() => open(id)}
                                className={`relative flex h-9 items-center justify-center gap-x-2 gap-y-2 rounded-lg px-4 text-sm font-semibold transition-colors ${on ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
                            >
                                {on && (
                                    <motion.span
                                        layoutId="cand-seg-active"
                                        transition={{ duration: 0.36, ease: EASE_PATIENT }}
                                        className="absolute inset-0 rounded-lg bg-surface shadow-[var(--w-shadow)]"
                                        aria-hidden
                                    />
                                )}
                                <Icon className="relative h-4 w-4 shrink-0" />
                                <span className="relative">{label}</span>
                                {countOf[id] !== null && <span className={`relative hidden text-xs font-medium tabular-nums sm:inline ${on ? 'text-text-secondary' : 'text-text-tertiary'}`}>{formatCount(countOf[id] as number)}</span>}
                            </button>
                        );
                    })}
                </div>
                {(reading || counts.attention > 0) && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-live="polite">
                        {reading && (
                            <button type="button" onClick={() => open('resumes')} className="inline-flex h-9 items-center gap-x-2 rounded-[10px] bg-surface px-3 text-sm font-semibold text-text-secondary shadow-[var(--w-shadow)] hover:text-text-primary" title="Resumes are being read in the background. You can keep working.">
                                <Spinner className="h-3.5 w-3.5" /><span>Reading <span className="tabular-nums">{formatCount(counts.reading)}</span> {counts.reading === 1 ? 'resume' : 'resumes'}</span>
                            </button>
                        )}
                        {counts.attention > 0 && (
                            <button type="button" onClick={() => open('resumes')} className="inline-flex h-9 items-center gap-x-2 rounded-[10px] bg-surface px-3 text-sm font-semibold text-text-primary shadow-[var(--w-shadow)] hover:shadow-[var(--w-shadow-hover)]" title="Files whose text or details could not be read. Open the Resumes tab to see them.">
                                <CircleAlert className="h-4 w-4 text-warning" aria-hidden /><span><span className="tabular-nums">{formatCount(counts.attention)}</span> {counts.attention === 1 ? 'needs' : 'need'} attention</span>
                            </button>
                        )}
                    </div>
                )}
                </div>

                {VIEWS.map(({ id }) => visited[id] && (
                    <div key={id} role="tabpanel" id={`cand-panel-${id}`} aria-labelledby={`cand-tab-${id}`} hidden={view !== id} className="min-w-0">
                        {id === 'search' && <SearchView orgId={orgId} dataVersion={dataVersion} onDataChanged={onDataChanged} collapseStyle={collapseStyle} />}
                        {id === 'candidates' && <RecordsView orgId={orgId} dataVersion={dataVersion} onDataChanged={onDataChanged} />}
                        {id === 'sheets' && <SheetsView orgId={orgId} dataVersion={dataVersion} onDataChanged={onDataChanged} />}
                        {id === 'resumes' && <ResumesView orgId={orgId} />}
                    </div>
                ))}
            </div>

            <ModalPortal>
                <Toast
                    key={toast?.id}
                    visible={toastVisible && !!toast}
                    message={toast?.message ?? ''}
                    type={toast?.type ?? 'info'}
                    onClose={closeToast}
                    duration={toast?.type === 'error' ? 6000 : 3000}
                />
            </ModalPortal>
        </UiProvider>
    );
}
