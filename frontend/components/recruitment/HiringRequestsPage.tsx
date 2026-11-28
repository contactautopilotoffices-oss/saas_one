'use client';

import React, { useCallback, useMemo, useState } from 'react';
import ModalPortal from '@/frontend/components/ui/ModalPortal';
import { Toast } from '@/frontend/components/ui/Toast';
import type { ApiFailure } from '@/frontend/components/candidates/api';
import { UiProvider } from '@/frontend/components/candidates/ui';
import HiringManagerCandidates from './HiringManagerCandidates';
import RequisitionsView from './RequisitionsView';

/*
 * "Hiring requests" (owner 2026-11-20): the page behind the sidebar item that the Tech team switches on for chosen
 * roles and people (the Tech dashboard's HR Configs tab). Raise a hiring request, follow it, change and resubmit
 * it when sent back; an approver also decides here. HR follows every request in Recruitment -> Requisitions.
 */
export default function HiringRequestsPage({ orgId }: { orgId: string }) {
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info'; id: number } | null>(null);
    const [visible, setVisible] = useState(false);
    const notify = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
        setToast(t => ({ message, type, id: (t?.id ?? 0) + 1 }));
        setVisible(true);
    }, []);
    const reportError = useCallback((f: ApiFailure) => {
        if (f.aborted) return;
        setToast(t => ({ message: f.error, type: 'error', id: (t?.id ?? 0) + 1 }));
        setVisible(true);
    }, []);
    const ui = useMemo(() => ({ notify, reportError }), [notify, reportError]);

    return (
        <UiProvider value={ui}>
            <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
                <h1 className="mb-6 text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">Hiring requests</h1>
                {orgId ? <><RequisitionsView orgId={orgId} mode="manager" /><HiringManagerCandidates orgId={orgId} /></> : <p className="text-sm text-text-secondary">Open this page from your organisation.</p>}
            </div>
            <ModalPortal>
                <Toast key={toast?.id} visible={visible && !!toast} message={toast?.message ?? ''} type={toast?.type ?? 'info'}
                    onClose={() => setVisible(false)} duration={toast?.type === 'error' ? 6000 : 3000} />
            </ModalPortal>
        </UiProvider>
    );
}
