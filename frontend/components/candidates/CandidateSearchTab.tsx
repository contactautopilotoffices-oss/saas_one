'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BadgeIndianRupee, CircleAlert, ClipboardList, FileSpreadsheet, FileText, FolderKanban, Gauge, Layers, Lock, Mail, Search, Send, Settings2, Upload, Users, UserSearch } from 'lucide-react';
import ModalPortal from '@/frontend/components/ui/ModalPortal';
import type { PanelToggleVariant } from '@/frontend/components/ui/PanelToggle';
import { Toast } from '@/frontend/components/ui/Toast';
import type { CandidateListResponse, Position, ResumeFilesResponse, ResumeSummary, SheetsResponse } from '@/backend/lib/candidates/types';
import type { ApiFailure } from './api';
import { api, NO_ACCESS_MESSAGE, qs } from './api';
import { formatCount } from './format';
import RequisitionsView from '@/frontend/components/recruitment/RequisitionsView';
import OfferLetterSettings from './OfferLetterSettings';
import OffersView from './OffersView';
import RecruitmentDashboardView from './RecruitmentDashboardView';
import RejectionReasonsSettings from './RejectionReasonsSettings';
import StagesSettings from './StagesSettings';
import PipelineView from './PipelineView';
import PositionsView from './PositionsView';
import RecordsView from './RecordsView';
import ResumesView from './ResumesView';
import EmailView from './EmailView';
import OutreachView from './OutreachView';
import RecruitmentMailButton from './RecruitmentMailButton';
import SearchView from './SearchView';
import SheetsView from './SheetsView';
import { IssueJobsWatcher } from './IssuesModal';
import { BTN_SECONDARY, CARD, EASE_PATIENT, EmptyState, Spinner, UiProvider } from './ui';

/**
 * Recruitment (owner 2026-11-02 as Candidate Search; 2026-11-15 the Recruitment module): find people in the uploaded
 * sourcing sheets with the filter panel, keep saved job descriptions as positions and run their pipelines, keep the
 * records tidy, manage the sheets, and collect the resume files. Six views behind one segmented control. Each view
 * mounts on first visit and then stays mounted (hidden), so switching views never throws away a search, a half-typed
 * filter or an upload in progress.
 *
 * Owner 2026-11-15: one header row (the module's name, the tabs, Upload resumes) stands in for the HR page header and
 * the HR console bar, which are hidden on this tab to give it the room. Positions lead into Search (their filters
 * loaded) and into the Pipeline.
 */

/** While resumes are being read in the background, the numbers beside the tabs are asked for again this often. */
const STATUS_POLL_MS = 10_000;

interface Counts { candidates: number | null; sheets: number | null; resumes: number | null; positions: number | null; reading: number; attention: number }
const NO_COUNTS: Counts = { candidates: null, sheets: null, resumes: null, positions: null, reading: 0, attention: 0 };

type View = 'dashboard' | 'search' | 'requisitions' | 'positions' | 'pipeline' | 'offers' | 'candidates' | 'resumes' | 'email' | 'outreach' | 'sheets' | 'settings';
const VIEWS: Array<{ id: View; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'search', label: 'Search', icon: Search },
    // Owner 2026-11-21: the spec's dashboard views (Today, Roles, Funnel).
    { id: 'dashboard', label: 'Dashboard', icon: Gauge },
    // Owner 2026-11-17: hiring requests (Stages 1 and 2 of the spec) sit before the positions they become. The tracker
    // lies with the HR team (the HR page's Recruitment tab) and the Tech dashboard; managers have no screen of their own yet.
    { id: 'requisitions', label: 'Requisitions', icon: ClipboardList },
    { id: 'positions', label: 'Positions', icon: FolderKanban },
    { id: 'pipeline', label: 'Pipeline', icon: Layers },
    // Owner 2026-11-21: selection to joining (spec Stages 7-9).
    { id: 'offers', label: 'Offers', icon: BadgeIndianRupee },
    { id: 'candidates', label: 'Candidates', icon: Users },
    { id: 'resumes', label: 'Resumes', icon: FileText },
    { id: 'email', label: 'Email', icon: Mail },
    // Owner 2026-11-24: bulk and automatic outreach, the job application form and its templates ("keep it configurable").
    { id: 'outreach', label: 'Outreach', icon: Send },
    { id: 'sheets', label: 'Sheets', icon: FileSpreadsheet },
    // Owner 2026-11-19: the pipeline's stages, which anyone in HR can change.
    { id: 'settings', label: 'Configurations', icon: Settings2 },
];

export default function CandidateSearchTab({ orgId, collapseStyle = 'panel' }: {
    orgId: string;
    /** The filters' collapse button follows the host console's sidebar button: "panel" (Tech) or "chevron" (HR logins). */
    collapseStyle?: PanelToggleVariant;
}) {
    const [view, setView] = useState<View>('search');
    const [visited, setVisited] = useState<Record<View, boolean>>({ dashboard: false, search: true, requisitions: false, positions: false, pipeline: false, offers: false, candidates: false, sheets: false, resumes: false, email: false, outreach: false, settings: false });
    const [requisitionVersion, setRequisitionVersion] = useState(0);
    const [noAccess, setNoAccess] = useState(false);
    // The last toast is kept after it hides so its exit animation has content; a new id remounts it (restarts the timer).
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info'; id: number } | null>(null);
    const [toastVisible, setToastVisible] = useState(false);
    /** Bumped after any change (record saved / deleted, sheet uploaded / deleted / restored) so other views refetch. */
    const [dataVersion, setDataVersion] = useState(0);
    // A position opened in Search (its filters loaded) or in the Pipeline. The nonce makes the same position reopenable.
    const [searchRequest, setSearchRequest] = useState<{ position: Position; nonce: number } | null>(null);
    const [pipelineRequest, setPipelineRequest] = useState<{ positionId: string; nonce: number } | null>(null);

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
            api<{ positions: Position[] }>(`/api/candidates/positions${qs({ orgId })}`, { signal }),
        ]).then(([people, sheets, resumes, attention, positions]) => {
            if (signal.aborted) return;
            const denied = [people, sheets, resumes, attention].find(r => !r.ok && r.noAccess);
            if (denied && !denied.ok) { reportError(denied); return; }
            setCounts({
                candidates: people.ok ? people.data.total : null,
                sheets: sheets.ok ? sheets.data.sheets.length : null,
                resumes: resumes.ok ? resumes.data.total : null,
                // Open positions; absent before migration 20261115000002 (the call answers 409 then).
                positions: positions.ok ? positions.data.positions.length : null,
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
    const countOf: Record<View, number | null> = { dashboard: null, offers: null, search: null, requisitions: null, positions: counts.positions, pipeline: null, candidates: counts.candidates, sheets: counts.sheets, resumes: counts.resumes, email: null, outreach: null, settings: null };

    const open = (v: View) => {
        setView(v);
        if (!visited[v]) setVisited(s => ({ ...s, [v]: true }));
    };
    const openSearch = (position: Position) => { setSearchRequest(r => ({ position, nonce: (r?.nonce ?? 0) + 1 })); open('search'); };
    const openPipeline = (position: Position) => { setPipelineRequest(r => ({ positionId: position.id, nonce: (r?.nonce ?? 0) + 1 })); open('pipeline'); };

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
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {/* The module's name: this row replaces the HR page header on the Recruitment tab. */}
                    <div className="flex items-center gap-2">
                        <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400"><UserSearch className="h-5 w-5" /></div>
                        <h1 className="font-display text-lg font-black tracking-tight text-text-primary sm:text-xl">Recruitment</h1>
                        {/* Owner 2026-11-16: the module is in beta while HR starts using it. */}
                        <span className="inline-flex h-[22px] items-center rounded-full bg-amber-100 px-2.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:ring-amber-800/60" title="New module: in use by the HR team, still being refined">Beta</span>
                    </div>
                    {/* Segmented control: L1 recessed track, active segment lifted to L2 (Linear: adjacent steps only). */}
                    <div role="tablist" aria-label="Recruitment views" className={`grid w-full grid-cols-3 gap-x-1 gap-y-1 rounded-xl bg-surface-elevated px-1 py-1 ring-1 ring-inset ring-border-subtle sm:inline-grid sm:w-auto sm:grid-cols-8`}>
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
                                    className={`relative flex h-9 items-center justify-center gap-x-2 gap-y-2 rounded-lg px-3.5 text-sm font-semibold transition-colors ${on ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
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
                    <div className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-2" aria-live="polite">
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
                        {/* Owner 2026-11-24: link the HR mailbox, like Zoho Tasks */}
                        <RecruitmentMailButton orgId={orgId} onOpenEmail={() => open('email')} />
                        <button type="button" onClick={() => open('resumes')} className={`${BTN_SECONDARY} h-9 rounded-[10px] px-3`} title="Upload resumes from the Resumes tab"><Upload className="h-4 w-4" />Upload resumes</button>
                    </div>
                </div>

                {VIEWS.map(({ id }) => visited[id] && (
                    <div key={id} role="tabpanel" id={`cand-panel-${id}`} aria-labelledby={`cand-tab-${id}`} hidden={view !== id} className="min-w-0">
                        {id === 'search' && <SearchView orgId={orgId} dataVersion={dataVersion} onDataChanged={onDataChanged} collapseStyle={collapseStyle} loadPosition={searchRequest} />}
                        {id === 'dashboard' && <RecruitmentDashboardView orgId={orgId} />}
                        {id === 'requisitions' && <RequisitionsView key={requisitionVersion} orgId={orgId} mode="hr" />}
                        {id === 'offers' && <OffersView orgId={orgId} />}
                        {id === 'positions' && <PositionsView orgId={orgId} dataVersion={dataVersion} onDataChanged={onDataChanged} onSearch={openSearch} onPipeline={openPipeline} />}
                        {id === 'pipeline' && <PipelineView orgId={orgId} dataVersion={dataVersion} onDataChanged={onDataChanged} selectPosition={pipelineRequest} onSearch={openSearch} />}
                        {id === 'candidates' && <RecordsView orgId={orgId} dataVersion={dataVersion} onDataChanged={onDataChanged} />}
                        {id === 'sheets' && <SheetsView orgId={orgId} dataVersion={dataVersion} onDataChanged={onDataChanged} />}
                        {id === 'resumes' && <ResumesView orgId={orgId} />}
                        {id === 'outreach' && <OutreachView orgId={orgId} />}
                        {id === 'email' && <EmailView orgId={orgId} onSettings={() => open('resumes')} onRequisitions={() => { setRequisitionVersion(n => n + 1); open('requisitions'); }} />}
                        {/* Owner 2026-11-20: the hiring request approvers are in the Tech dashboard's HR Configs tab */}
                        {id === 'settings' && <div className="space-y-6"><StagesSettings orgId={orgId} /><RejectionReasonsSettings orgId={orgId} /><OfferLetterSettings orgId={orgId} /></div>}
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
