'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Activity, LayoutDashboard, Ticket } from 'lucide-react';
import AgentPulse from '@/frontend/components/agents/AgentPulse';
import TabLoading from '@/frontend/components/dashboard/TabLoading';
import TicketsView from '@/frontend/components/dashboard/TicketsView';

/**
 * The Requests tab shared by the Super Admin console (OrgAdminDashboard) and the Tech console (TechDashboard)
 * (owner 2026-11-03: Tech gets exactly the Super Admin Requests tab). One component, so a change here shows in both.
 *   RequestsViewSwitcher : the List / Board / Flow Map buttons in the page header
 *   RequestsWorkspace    : the tickets agent strip + the chosen view, for the organisation or one property
 * The page keeps the chosen view and the property dropdown (each console has its own header).
 */

const AdminSPOCDashboard = dynamic(() => import('./AdminSPOCDashboard'), { loading: TabLoading });
const TicketFlowMap = dynamic(() => import('../ops/TicketFlowMap'), { loading: TabLoading });

export type RequestsView = 'list' | 'board' | 'flow';

export const isRequestsView = (v: string | null | undefined): v is RequestsView => v === 'list' || v === 'board' || v === 'flow';

const VIEWS: Array<{ id: RequestsView; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'list', label: 'List', icon: Ticket },
    { id: 'board', label: 'Board', icon: LayoutDashboard },
    { id: 'flow', label: 'Flow Map', icon: Activity },
];

export function RequestsViewSwitcher({ view, onChange }: { view: RequestsView; onChange: (view: RequestsView) => void }) {
    return (
        <div className="hidden lg:flex items-center gap-1 bg-surface-elevated border border-border p-1 rounded-xl shadow-sm">
            {VIEWS.map(v => {
                const Icon = v.icon;
                return (
                    <button
                        key={v.id}
                        onClick={() => onChange(v.id)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${view === v.id ? 'bg-primary text-white shadow-md' : 'text-text-secondary hover:bg-background'}`}
                    >
                        <Icon className="w-3.5 h-3.5" />
                        {v.label}
                    </button>
                );
            })}
        </div>
    );
}

interface PropertyOption {
    id: string;
    name: string;
    code: string;
    image_url?: string;
}

export interface RequestsWorkspaceProps {
    view: RequestsView;
    organizationId?: string;
    /** A property id, or 'all' for the whole organisation. */
    selectedPropertyId: string;
    /** Name of the selected property (Board header). */
    propertyName?: string;
    adminUserName: string;
    properties: PropertyOption[];
    onPropertyChange: (propertyId: string) => void;
    initialStatusFilter?: string;
    /** Show the tickets agent strip (the page may keep this mounted while another tab is showing). */
    showAgentPulse: boolean;
    /** The agent console tab the strip links to. */
    agentConsoleTab?: string;
    /** Opens the page's "new ticket" form from the list (optional). */
    onNewRequest?: () => void;
}

export default function RequestsWorkspace({
    view, organizationId, selectedPropertyId, propertyName, adminUserName, properties, onPropertyChange,
    initialStatusFilter, showAgentPulse, agentConsoleTab = 'agent_console', onNewRequest,
}: RequestsWorkspaceProps) {
    const propertyId = selectedPropertyId === 'all' ? undefined : selectedPropertyId;
    return (
        <>
            {showAgentPulse && (
                <AgentPulse orgId={organizationId} module="tickets" consoleTab={agentConsoleTab} className="mb-3" />
            )}
            {view === 'list' ? (
                <TicketsView
                    propertyId={propertyId}
                    organizationId={selectedPropertyId === 'all' ? organizationId : undefined}
                    canDelete={true}
                    initialStatusFilter={initialStatusFilter}
                    onNewRequest={onNewRequest}
                />
            ) : view === 'board' ? (
                <AdminSPOCDashboard
                    organizationId={organizationId || ''}
                    propertyId={propertyId}
                    propertyName={selectedPropertyId === 'all' ? 'All Properties' : propertyName}
                    adminUser={{ full_name: adminUserName, avatar_url: '' }}
                    initialStatusFilter={initialStatusFilter}
                    properties={properties}
                    onPropertyChange={onPropertyChange}
                />
            ) : (
                <div className="w-full h-full min-h-[calc(100vh-12rem)] bg-white -mt-2 overflow-hidden flex flex-col rounded-2xl relative">
                    <TicketFlowMap organizationId={organizationId} propertyId={propertyId} isEmbedded={true} />
                </div>
            )}
        </>
    );
}
