'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { Sparkles, Briefcase, Target } from 'lucide-react';
import ExecutiveImpactReport from '@/frontend/components/crm/ExecutiveImpactReport';
import PerformanceMarketingDashboard from '@/frontend/components/crm/PerformanceMarketingDashboard';
import { useAuth } from '@/frontend/context/AuthContext';

type ReportsTab = 'funnel' | 'campaigns';

export default function ReportsPage() {
    const params = useParams();
    const orgId = params?.orgId as string;
    const { user, membership } = useAuth();
    const [tab, setTab] = useState<ReportsTab>('funnel');

    const role = membership?.org_role;
    const isAdmin = membership?.is_master_admin ||
        (role && ['bd_admin', 'bd_super_admin', 'org_admin', 'org_super_admin'].includes(role)) ||
        (membership?.properties || []).some((p: any) =>
            p.organization_id === orgId &&
            ['bd_admin', 'bd_super_admin', 'org_admin', 'org_super_admin'].includes(p.role)
        );

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
                        <Sparkles className="h-6 w-6 text-primary" />
                        CRM Reports
                    </h1>
                    <p className="mt-1 text-sm text-text-secondary">
                        Decision-maker view · leads in, revenue out, by campaign, rep, status.
                    </p>
                </div>
                <div className="text-xs text-text-secondary flex items-center gap-1.5">
                    <Briefcase className="h-4 w-4" />
                    Signed in as <span className="font-semibold text-text-primary">{user?.email || '—'}</span>
                </div>
            </div>

            <div className="flex overflow-x-auto no-scrollbar gap-2 pb-2">
                <button
                    onClick={() => setTab('funnel')}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                        tab === 'funnel' ? 'bg-primary text-white' : 'bg-slate-100 text-text-secondary hover:bg-slate-200'
                    }`}
                >
                    <Sparkles className="w-4 h-4" /> Funnel &amp; Revenue
                </button>
                <button
                    onClick={() => setTab('campaigns')}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                        tab === 'campaigns' ? 'bg-primary text-white' : 'bg-slate-100 text-text-secondary hover:bg-slate-200'
                    }`}
                >
                    <Target className="w-4 h-4" /> Campaigns &amp; AI
                </button>
            </div>

            {tab === 'funnel' ? (
                <ExecutiveImpactReport orgId={orgId} orgName={membership?.org_name || 'Organization'} />
            ) : (
                isAdmin
                    ? <PerformanceMarketingDashboard />
                    : <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-text-secondary text-sm">
                        The Campaigns &amp; AI tab is restricted to BD admins.
                    </div>
            )}
        </div>
    );
}
