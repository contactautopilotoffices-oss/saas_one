'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Activity, Building2, ChevronDown, LayoutDashboard, Plus, Ticket } from 'lucide-react';
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

export function RequestsViewSwitcher({ view, onChange, compact = false }: {
    view: RequestsView;
    onChange: (view: RequestsView) => void;
    /** Owner 2026-11-15: the phone/tablet version (below `lg`): List and Board only; Flow Map stays desktop-only. */
    compact?: boolean;
}) {
    if (compact) {
        return (
            <div role="group" aria-label="View" className="flex shrink-0 gap-0.5 rounded-[12px] bg-slate-100 p-[3px]">
                {VIEWS.filter(v => v.id !== 'flow').map(v => {
                    const on = view === v.id;
                    return (
                        <button
                            key={v.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => onChange(v.id)}
                            className={`h-[38px] rounded-[9px] px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${on ? 'bg-white font-bold text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.12)]' : 'font-semibold text-gray-600 hover:text-gray-900'}`}
                        >
                            {v.label}
                        </button>
                    );
                })}
            </div>
        );
    }
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

/**
 * Owner 2026-11-15: the "New" button that sits next to the "Requests" heading in each console's page header on phones.
 * #56737a is a darker shade of the brand teal (owner-approved) so the white text is easy to read.
 */
export function RequestsNewButton({ onClick, className = '' }: { onClick: () => void; className?: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex h-11 shrink-0 items-center gap-1.5 rounded-[12px] bg-[#56737a] px-3.5 text-sm font-bold text-white transition-colors hover:bg-[#4a646a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#56737a] focus-visible:ring-offset-2 ${className}`}
        >
            <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
            New
        </button>
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
    /**
     * Owner 2026-11-15: switches between List and Board. When given, the List / Board switch also shows below `lg`
     * (the header switcher is desktop-only).
     */
    onViewChange?: (view: RequestsView) => void;
}

export default function RequestsWorkspace({
    view, organizationId, selectedPropertyId, propertyName, adminUserName, properties, onPropertyChange,
    initialStatusFilter, showAgentPulse, agentConsoleTab = 'agent_console', onNewRequest, onViewChange,
}: RequestsWorkspaceProps) {
    const propertyId = selectedPropertyId === 'all' ? undefined : selectedPropertyId;
    // Below `lg` the List / Board switch sits in the page, not the header.
    const compactSwitcher = onViewChange && (
        <div className="lg:hidden">
            <RequestsViewSwitcher view={view} onChange={onViewChange} compact />
        </div>
    );
    return (
        <>
            {showAgentPulse && (
                <div className="px-3 lg:px-0">
                    <AgentPulse orgId={organizationId} module="tickets" consoleTab={agentConsoleTab} className="mb-3" />
                </div>
            )}
            {view === 'list' ? (
                <div className="px-3 lg:px-0">
                    {/* Below `lg` the property choice gets its own full-width row (the header has no room for it on a phone). */}
                    {properties.length > 0 && (
                        <div className="relative mb-2.5 lg:hidden">
                            <Building2 className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500" aria-hidden="true" />
                            <select
                                aria-label="Property"
                                value={selectedPropertyId}
                                onChange={(e) => onPropertyChange(e.target.value)}
                                className="h-11 w-full appearance-none truncate rounded-[12px] border border-gray-300 bg-white pl-10 pr-10 text-[15px] font-semibold text-gray-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
                            >
                                <option value="all">All properties</option>
                                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500" aria-hidden="true" />
                        </div>
                    )}
                    <TicketsView
                        propertyId={propertyId}
                        organizationId={selectedPropertyId === 'all' ? organizationId : undefined}
                        canDelete={true}
                        initialStatusFilter={initialStatusFilter}
                        onNewRequest={onNewRequest}
                        showHeading={false}
                        viewSwitcher={compactSwitcher}
                    />
                </div>
            ) : view === 'board' ? (
                <>
                    {compactSwitcher && <div className="mb-2.5 flex px-3 lg:hidden">{compactSwitcher}</div>}
                    <AdminSPOCDashboard
                        organizationId={organizationId || ''}
                        propertyId={propertyId}
                        propertyName={selectedPropertyId === 'all' ? 'All Properties' : propertyName}
                        adminUser={{ full_name: adminUserName, avatar_url: '' }}
                        initialStatusFilter={initialStatusFilter}
                        properties={properties}
                        onPropertyChange={onPropertyChange}
                    />
                </>
            ) : (
                <>
                    {/* Flow Map is desktop-only; below `lg` this lets the page go back to List or Board. */}
                    {compactSwitcher && <div className="mb-4 flex px-3 lg:hidden">{compactSwitcher}</div>}
                    <div className="w-full h-full min-h-[calc(100vh-12rem)] bg-white -mt-2 overflow-hidden flex flex-col rounded-2xl relative">
                        <TicketFlowMap organizationId={organizationId} propertyId={propertyId} isEmbedded={true} />
                    </div>
                </>
            )}
        </>
    );
}
