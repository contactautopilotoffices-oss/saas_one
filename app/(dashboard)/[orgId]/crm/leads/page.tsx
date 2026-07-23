'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/frontend/context/AuthContext';
import { LeadsTable, LeadDetailDrawer, LeadForm } from '@/frontend/components/crm';
import { CRMLead, CreateLeadInput } from '@/frontend/types/crm';
import { CrmTour, leadsTableSteps, leadDetailSteps } from '@/frontend/components/crm/onboarding';
import { useCrmTour } from '@/frontend/hooks/useCrmTour';
import { Toast } from '@/frontend/components/ui/Toast';

function useResolvedFilters() {
    const searchParams = useSearchParams();
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [priorityFilter, setPriorityFilter] = useState<string[]>([]);

    useEffect(() => {
        const names = searchParams.getAll('status');
        const filterVal = searchParams.get('filter');

        if (filterVal && !names.length) {
            if (filterVal === 'all') {
                setStatusFilter([]);
                return;
            }
            fetch('/api/crm/statuses')
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    if (!data?.statuses) return;
                    const allStatuses = data.statuses as any[];
                    const terminalIds = new Set(
                        allStatuses.filter((s: any) => s.is_terminal).map((s: any) => s.id)
                    );
                    const nonTerminalIds = new Set(
                        allStatuses.filter((s: any) => !s.is_terminal).map((s: any) => s.id)
                    );

                    switch (filterVal) {
                        case 'open':
                            setStatusFilter([...nonTerminalIds]);
                            break;
                        case 'closed':
                            setStatusFilter([...terminalIds]);
                            break;
                        case 'in_progress':
                        case 'overdue':
                            setStatusFilter([...nonTerminalIds]);
                            break;
                        default:
                            setStatusFilter([]);
                    }
                })
                .catch(() => setStatusFilter([]));
            return;
        }

        if (!names.length) { setStatusFilter([]); return; }

        fetch('/api/crm/statuses')
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data?.statuses) return;
                const uuids: string[] = [];
                for (const name of names) {
                    const norm = name.toLowerCase().replace(/\s+/g, '');
                    const match = (data.statuses as any[]).find(
                        (s: any) => s.name.toLowerCase().replace(/\s+/g, '') === norm
                    );
                    if (match) uuids.push(match.id);
                }
                setStatusFilter(uuids);
            })
            .catch(() => setStatusFilter([]));
    }, [searchParams]);

    return { statusFilter, priorityFilter };
}

export default function LeadsPage() {
    const { membership } = useAuth();
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const orgId = params.orgId as string;
    const [selectedLead, setSelectedLead] = useState<CRMLead | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingLead, setEditingLead] = useState<CRMLead | null>(null);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; visible: boolean }>({ message: '', type: 'success', visible: false });
    const { statusFilter } = useResolvedFilters();
    const { isCompleted: leadsTableDone } = useCrmTour('crm-leads');
    const { isCompleted: leadDetailDone } = useCrmTour('crm-lead-detail');
    const autoOpenedRef = useRef(false);
    const queryLeadRef = useRef<string | null>(null);

    // Auto-open lead drawer when navigated from dashboard with ?lead=id
    useEffect(() => {
        const leadId = searchParams.get('lead');
        if (!leadId) return;
        if (queryLeadRef.current === leadId) return;
        queryLeadRef.current = leadId;

        fetch(`/api/crm/leads/${leadId}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data?.lead) {
                    setSelectedLead(data.lead);
                    setIsDetailOpen(true);
                    router.replace(`/${orgId}/crm/leads`);
                }
            })
            .catch(() => {});
    }, [searchParams, orgId, router]);

    const handleLeadSelect = (lead: CRMLead) => {
        setSelectedLead(lead);
        setIsDetailOpen(true);
    };

    const handleCreateLead = () => {
        setEditingLead(null);
        setIsFormOpen(true);
    };

    const handleEditLead = (lead: CRMLead) => {
        setEditingLead(lead);
        setIsFormOpen(true);
        setIsDetailOpen(false);
    };

    const handleSubmitLead = async (data: CreateLeadInput) => {
        const isCreate = !editingLead;
        const url = editingLead ? `/api/crm/leads/${editingLead.id}` : '/api/crm/leads';
        const method = editingLead ? 'PATCH' : 'POST';

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!res.ok) {
            const error = await res.json();
            setToast({ message: error.error || 'Failed to save lead', type: 'error', visible: true });
            throw new Error(error.error || 'Failed to save lead');
        }

        setToast({
            message: isCreate ? 'Lead created successfully' : 'Lead updated successfully',
            type: 'success',
            visible: true,
        });
    };

    const handleLeadsTableComplete = () => {
        if (!leadDetailDone && !autoOpenedRef.current) {
            autoOpenedRef.current = true;
            fetch('/api/crm/leads?limit=1')
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    if (data?.leads?.[0]) {
                        setSelectedLead(data.leads[0]);
                        setIsDetailOpen(true);
                    }
                })
                .catch(() => {});
        }
    };

    return (
        <div>
            <LeadsTable
                onLeadSelect={handleLeadSelect}
                onCreateLead={handleCreateLead}
                filters={statusFilter.length ? { status: statusFilter } : undefined}
            />

            <LeadDetailDrawer
                leadId={selectedLead?.id || null}
                isOpen={isDetailOpen}
                onClose={() => {
                    setIsDetailOpen(false);
                    setSelectedLead(null);
                }}
                onLeadUpdate={(lead) => setSelectedLead(lead)}
            />

            <LeadForm
                isOpen={isFormOpen}
                onClose={() => {
                    setIsFormOpen(false);
                    setEditingLead(null);
                }}
                onSubmit={handleSubmitLead}
                initialData={editingLead || undefined}
                mode={editingLead ? 'edit' : 'create'}
            />

            <CrmTour
                tourId="crm-leads"
                steps={leadsTableSteps}
                onComplete={handleLeadsTableComplete}
            />
            {isDetailOpen && (
                <CrmTour
                    tourId="crm-lead-detail"
                    steps={leadDetailSteps}
                    delayMs={1200}
                    onComplete={() => router.push(`/${orgId}/crm/calendar`)}
                />
            )}

            <Toast
                message={toast.message}
                type={toast.type}
                visible={toast.visible}
                onClose={() => setToast(t => ({ ...t, visible: false }))}
            />
        </div>
    );
}
