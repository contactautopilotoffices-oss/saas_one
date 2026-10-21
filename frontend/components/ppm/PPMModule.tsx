'use client';
import { useState } from 'react';
import { CalendarDays, BarChart2, FileText, Shield, Wrench, SearchCheck } from 'lucide-react';
import dynamic from 'next/dynamic';
import PPMCalendar from './PPMCalendar';
import TabLoading from '@/frontend/components/dashboard/TabLoading';
import { usePreloadTabs } from '@/frontend/lib/dashboard/preloadTabs';

// Calendar is the view PPM opens on, so it stays in this file. The other sub-tabs (Excel export and charts among them)
// load only once PPM is opened: downloaded quietly in the background as soon as it is on screen, so switching
// sub-tabs shows no extra spinner (performance plan Phase 8).
const PPMReports = dynamic(() => import('./PPMReports'), { loading: TabLoading });
const AMCContracts = dynamic(() => import('./AMCContracts'), { loading: TabLoading });
const PPMCompliance = dynamic(() => import('./PPMCompliance'), { loading: TabLoading });
const VendorManagement = dynamic(() => import('@/frontend/components/vendors/VendorManagement'), { loading: TabLoading });
const AuditDashboard = dynamic(() => import('@/frontend/components/audit/AuditDashboard'), { loading: TabLoading });
const SUB_TAB_PRELOADS = [
    () => import('./PPMReports'),
    () => import('./AMCContracts'),
    () => import('./PPMCompliance'),
    () => import('@/frontend/components/vendors/VendorManagement'),
    () => import('@/frontend/components/audit/AuditDashboard'),
];

interface Props {
    organizationId: string;
    propertyId?: string;
    properties?: { id: string; name: string }[];
}

type TabId = 'calendar' | 'reports' | 'amc' | 'compliance' | 'audit' | 'vendors';

export default function PPMModule({ organizationId, propertyId, properties = [] }: Props) {
    usePreloadTabs(SUB_TAB_PRELOADS);
    const [tab, setTab] = useState<TabId>('calendar');

    const tabs = [
        { id: 'calendar', label: 'Calendar', icon: CalendarDays },
        { id: 'reports', label: 'Reports', icon: BarChart2 },
        { id: 'amc', label: 'Annual Maintenance Contracts', icon: FileText },
        { id: 'compliance', label: 'Compliance', icon: Shield },
        { id: 'audit', label: 'Digital Audit', icon: SearchCheck },
        { id: 'vendors', label: 'Vendors', icon: Wrench },
    ];

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Tab bar */}
            <div className="flex items-center gap-1 px-4 pt-3 border-b border-slate-100 bg-white overflow-x-auto">
                {tabs.map(t => {
                    const Icon = t.icon;
                    const active = tab === t.id;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id as TabId)}
                            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-t-xl transition-all border-b-2 whitespace-nowrap
                                ${active ? 'text-primary border-primary bg-primary/5' : 'text-slate-500 border-transparent hover:text-slate-700'}`}
                        >
                            <Icon className="w-4 h-4" />
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
                {tab === 'calendar' && <PPMCalendar organizationId={organizationId} propertyId={propertyId} properties={properties} />}
                {tab === 'reports' && <PPMReports organizationId={organizationId} propertyId={propertyId} properties={properties} />}
                {tab === 'amc' && <AMCContracts organizationId={organizationId} propertyId={propertyId} properties={properties} />}
                {tab === 'compliance' && <PPMCompliance organizationId={organizationId} propertyId={propertyId} />}
                {tab === 'audit' && (
                    <div className="p-6 bg-slate-900 min-h-full">
                        <AuditDashboard organizationId={organizationId} propertyId={propertyId} />
                    </div>
                )}
                {tab === 'vendors' && <VendorManagement organizationId={organizationId} propertyId={propertyId} properties={properties} />}
            </div>
        </div>
    );
}
