'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { FileSpreadsheet, Lock, Search, Users } from 'lucide-react';
import ModalPortal from '@/frontend/components/ui/ModalPortal';
import { Toast } from '@/frontend/components/ui/Toast';
import type { ApiFailure } from './api';
import { NO_ACCESS_MESSAGE } from './api';
import RecordsView from './RecordsView';
import SearchView from './SearchView';
import SheetsView from './SheetsView';
import { CARD, EASE_PATIENT, EmptyState, UiProvider } from './ui';

/**
 * Candidate Search (Tech console, owner 2026-11-02): find people in the uploaded sourcing sheets with the filter panel
 * (owner 2026-11-06), keep the records tidy, and manage the sheets. Three views behind one segmented control. Each view mounts on
 * first visit and then stays mounted (hidden), so switching views never throws away a search or a half-typed filter.
 */

type View = 'search' | 'candidates' | 'sheets';
const VIEWS: Array<{ id: View; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'search', label: 'Search', icon: Search },
    { id: 'candidates', label: 'Candidates', icon: Users },
    { id: 'sheets', label: 'Sheets', icon: FileSpreadsheet },
];

export default function CandidateSearchTab({ orgId }: { orgId: string }) {
    const [view, setView] = useState<View>('search');
    const [visited, setVisited] = useState<Record<View, boolean>>({ search: true, candidates: false, sheets: false });
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
            <div className={`mx-auto w-full min-w-0 space-y-6 ${view === 'search' ? 'max-w-[1440px]' : 'max-w-6xl'}`}>
                {/* Segmented control: L1 recessed track, active segment lifted to L2 (Linear: adjacent steps only). */}
                <div role="tablist" aria-label="Candidate Search views" className="grid w-full grid-cols-3 gap-1 rounded-xl bg-surface-elevated p-1 ring-1 ring-inset ring-border-subtle sm:inline-grid sm:w-auto">
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
                                className={`relative flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors ${on ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
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
                            </button>
                        );
                    })}
                </div>

                {VIEWS.map(({ id }) => visited[id] && (
                    <div key={id} role="tabpanel" id={`cand-panel-${id}`} aria-labelledby={`cand-tab-${id}`} hidden={view !== id} className="min-w-0">
                        {id === 'search' && <SearchView orgId={orgId} dataVersion={dataVersion} onDataChanged={onDataChanged} />}
                        {id === 'candidates' && <RecordsView orgId={orgId} dataVersion={dataVersion} onDataChanged={onDataChanged} />}
                        {id === 'sheets' && <SheetsView orgId={orgId} dataVersion={dataVersion} onDataChanged={onDataChanged} />}
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
