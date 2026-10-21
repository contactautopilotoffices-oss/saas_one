'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/frontend/context/AuthContext';
import Skeleton from '@/frontend/components/ui/Skeleton';
import { Toast } from '@/frontend/components/ui/Toast';
import { ClipboardCheck, LayoutGrid, History, FileBarChart, Settings, FlaskConical } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import SOPTemplateManager from './SOPTemplateManager';
import SOPCompletionHistory from './SOPCompletionHistory';
import SOPChecklistRunner from './SOPChecklistRunner';
import SOPCompletionDetail from './SOPCompletionDetail';
import SOPReportSection from './SOPReportSection';
import { SOPChecklistSettingsSection } from './SOPChecklistSettingsSection';
import { SOPVisionTestingModal } from './SOPVisionTestingModal';
import { useDataCache } from '@/frontend/context/DataCacheContext';

interface SOPDashboardProps {
    propertyId?: string;
    propertyIds?: string[];
    propertySelector?: React.ReactNode;
    headerRight?: React.ReactNode;
}

const SOPDashboard: React.FC<SOPDashboardProps> = ({ propertyId, propertyIds, propertySelector, headerRight }) => {
    const isMultiProperty = !!propertyIds && propertyIds.length > 0;
    const { membership } = useAuth();

    // Parse initial view and parameters from URL or sessionStorage
    const initialParams = (() => {
        if (typeof window === 'undefined') return { view: 'list', templateId: null, completionId: null, completionDate: null, propId: null };
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const explicitView = urlParams.get('view') || urlParams.get('sop_view') || (urlParams.get('tab') !== 'checklist' ? urlParams.get('tab') : null);
            const savedView = sessionStorage.getItem(`sop_active_view_${propertyId || 'global'}`);
            const validViews = ['list', 'runner', 'history', 'detail', 'reports', 'settings'];

            const active = (explicitView && validViews.includes(explicitView))
                ? explicitView
                : (savedView && validViews.includes(savedView))
                    ? savedView
                    : 'list';

            // Check if runner state was saved
            let runnerState: any = null;
            const savedRunner = sessionStorage.getItem(`sop_runner_state_${propertyId || 'global'}`);
            if (savedRunner) {
                try { runnerState = JSON.parse(savedRunner); } catch {}
            }

            // Check if detail state was saved
            let detailState: any = null;
            const savedDetail = sessionStorage.getItem(`sop_detail_state_${propertyId || 'global'}`);
            if (savedDetail) {
                try { detailState = JSON.parse(savedDetail); } catch {}
            }

            const templateId = urlParams.get('templateId') || runnerState?.templateId || detailState?.templateId || null;
            const completionId = urlParams.get('completionId') || runnerState?.completionId || detailState?.completionId || null;
            const completionDate = urlParams.get('completionDate') || runnerState?.completionDate || null;
            const propId = urlParams.get('propId') || runnerState?.propertyId || detailState?.propertyId || propertyId || null;

            return { view: active, templateId, completionId, completionDate, propId };
        } catch {
            return { view: 'list', templateId: null, completionId: null, completionDate: null, propId: null };
        }
    })();

    const [activeView, setActiveView] = useState<'list' | 'runner' | 'history' | 'detail' | 'reports' | 'settings'>(initialParams.view as any);
    const [returnView, setReturnView] = useState<'list' | 'history' | null>(null);
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(initialParams.templateId);
    const [selectedCompletionId, setSelectedCompletionId] = useState<string | null>(initialParams.completionId);
    const [selectedCompletionDate, setSelectedCompletionDate] = useState<string | null>(initialParams.completionDate);
    const [viewingCompletionId, setViewingCompletionId] = useState<string | null>(initialParams.completionId);
    const [viewingCompletionTemplateId, setViewingCompletionTemplateId] = useState<string | null>(initialParams.templateId);
    const [viewingPropertyId, setViewingPropertyId] = useState<string | null>(initialParams.propId);
    const [showVisionLab, setShowVisionLab] = useState(false);

    // Sync active view and parameters to sessionStorage & URL so refreshing stays on the exact current view
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            sessionStorage.setItem(`sop_active_view_${propertyId || 'global'}`, activeView);

            const url = new URL(window.location.href);
            if (url.searchParams.get('tab') === 'checklist') {
                url.searchParams.set('view', activeView);
                if (activeView === 'runner' && selectedTemplateId) {
                    url.searchParams.set('templateId', selectedTemplateId);
                    if (selectedCompletionId) url.searchParams.set('completionId', selectedCompletionId);
                    else url.searchParams.delete('completionId');
                    if (selectedCompletionDate) url.searchParams.set('completionDate', selectedCompletionDate);
                    else url.searchParams.delete('completionDate');
                } else if (activeView === 'detail' && viewingCompletionId) {
                    url.searchParams.set('completionId', viewingCompletionId);
                    if (viewingCompletionTemplateId) url.searchParams.set('templateId', viewingCompletionTemplateId);
                    url.searchParams.delete('completionDate');
                } else {
                    url.searchParams.delete('templateId');
                    url.searchParams.delete('completionId');
                    url.searchParams.delete('completionDate');
                }
                window.history.replaceState(window.history.state, '', url.toString());
            }
        } catch {}
    }, [activeView, propertyId, selectedTemplateId, selectedCompletionId, selectedCompletionDate, viewingCompletionId, viewingCompletionTemplateId]);

    const [isLoading, setIsLoading] = useState(true);
    const [userRole, setUserRole] = useState<string>('');
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [historyFilter, setHistoryFilter] = useState<'all' | 'due' | 'missed' | 'completed'>('all');
    const { invalidateCache } = useDataCache();

    useEffect(() => {
        // Determine user role for this property
        const fetchUserRole = async () => {
            try {
                if (propertyId) {
                    const property = membership?.properties?.find(p => p.id === propertyId);
                    if (property?.role) {
                        setUserRole(property.role);
                    } else if (membership?.org_role) {
                        setUserRole(membership.org_role);
                    } else {
                        setUserRole('staff');
                    }
                } else if (isMultiProperty && propertyIds) {
                    // Check if they are an admin on ANY of the properties being viewed
                    const hasAdminRole = membership?.properties?.some(p => 
                        propertyIds.includes(p.id) && 
                        ['property_admin', 'org_admin', 'org_super_admin', 'master_admin'].includes(p.role?.toLowerCase() || '')
                    );
                    
                    if (hasAdminRole) {
                        setUserRole('property_admin');
                    } else if (membership?.org_role) {
                        setUserRole(membership.org_role);
                    } else {
                        setUserRole('staff');
                    }
                } else {
                    setUserRole(membership?.org_role || 'staff');
                }
            } catch (err) {
                console.error('Error fetching user role:', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchUserRole();
    }, [propertyId, propertyIds, membership, isMultiProperty]);

    const isAdmin = ['property_admin', 'org_admin', 'org_super_admin', 'master_admin'].includes(userRole.toLowerCase());
    const isOrgSuperAdmin = Boolean(
        membership?.is_master_admin ||
        (membership?.org_role && ['org_super_admin', 'master_admin', 'ops_super_admin'].includes(membership.org_role.toLowerCase())) ||
        ['org_super_admin', 'master_admin', 'ops_super_admin'].includes((userRole || '').toLowerCase())
    );

    // Non-admin users should only be defaulted to history if currently on admin-only 'list' view
    useEffect(() => {
        if (!isLoading && userRole && !isAdmin && activeView === 'list') {
            setActiveView('history');
        }
    }, [isLoading, isAdmin, userRole, activeView]);

    const handleStartChecklist = (templateId: string, propertyIdParam: string, completionId?: string, completionDate?: string) => {
        // Remember where we came from (list or history) to return correctly on cancel
        if (activeView === 'list' || activeView === 'history') {
            setReturnView(activeView);
        }
        setSelectedTemplateId(templateId);
        setViewingPropertyId(propertyIdParam);
        setSelectedCompletionId(completionId || null);
        setSelectedCompletionDate(completionDate || null);

        try {
            sessionStorage.setItem(`sop_runner_state_${propertyId || 'global'}`, JSON.stringify({
                templateId,
                propertyId: propertyIdParam,
                completionId: completionId || null,
                completionDate: completionDate || null
            }));
        } catch {}

        setActiveView('runner');
    };

    const handleChecklistComplete = () => {
        setToast({ message: 'Checklist completed successfully!', type: 'success' });
        // Invalidate all SOP caches for this property
        Object.keys(localStorage)
            .filter(k => k.includes('sop-'))
            .forEach(k => localStorage.removeItem(k));
        
        try {
            sessionStorage.removeItem(`sop_runner_state_${propertyId || 'global'}`);
        } catch {}

        invalidateCache(); // Clear memory cache

        setActiveView('history');
        setReturnView(null);
        setSelectedTemplateId(null);
        setSelectedCompletionId(null);
        setSelectedCompletionDate(null);
    };

    const handleViewDetail = useCallback((id: string, templateId: string, propId: string) => {
        setViewingCompletionTemplateId(templateId);
        setViewingCompletionId(id);
        setViewingPropertyId(propId);

        try {
            sessionStorage.setItem(`sop_detail_state_${propertyId || 'global'}`, JSON.stringify({
                completionId: id,
                templateId,
                propertyId: propId
            }));
        } catch {}

        setActiveView('detail');
    }, [propertyId]);

    if (isLoading) {
        return (
            <div className="space-y-6 p-8">
                <Skeleton className="h-12 w-64" />
                <Skeleton className="h-96 w-full" />
            </div>
        );
    }

    return (
        <div className="w-full min-h-screen bg-slate-50/50 rounded-xl md:rounded-[2rem] p-0">

            <div className="max-w-7xl mx-auto space-y-2 md:space-y-3">
                {/* Compact Header */}
                <div className="flex items-center justify-between gap-2 px-3 pt-2 md:px-2 md:pt-0">
                    {/* Left: icon + title (hidden when propertySelector provided) */}
                    {!propertySelector && (
                        <div className="flex items-center gap-2">
                            <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shadow-sm flex-shrink-0">
                                <ClipboardCheck size={16} />
                            </div>
                            <h4 className="text-sm font-black text-slate-900 tracking-tight">{isAdmin ? 'Checklist Manager' : 'My Checklist'}</h4>
                        </div>
                    )}

                    {/* Property selector slot (org admin) */}
                    {propertySelector && (
                        <div className="flex-shrink-0">{propertySelector}</div>
                    )}


                    {/* Right side: headerRight (notification bell etc) */}
                    <div className="flex items-center gap-2">
                        {isAdmin && (activeView === 'list' || activeView === 'history' || activeView === 'reports' || activeView === 'settings') && (
                            <div className="hidden md:flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                                <button
                                    onClick={() => setActiveView('list')}
                                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${activeView === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    <LayoutGrid size={12} />
                                    Templates
                                </button>
                                <button
                                    onClick={() => setActiveView('history')}
                                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${activeView === 'history' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    <History size={12} />
                                    History
                                </button>
                                <button
                                    onClick={() => setActiveView('reports')}
                                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${activeView === 'reports' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    <FileBarChart size={12} />
                                    Reports
                                </button>
                                <button
                                    onClick={() => setActiveView('settings')}
                                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${activeView === 'settings' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    <Settings size={12} />
                                    Settings
                                </button>
                                {isOrgSuperAdmin && (
                                    <button
                                        onClick={() => setShowVisionLab(true)}
                                        className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest text-violet-700 bg-violet-50/80 hover:bg-violet-100/80 border border-violet-200/80 transition-all shadow-2xs"
                                        title="Test AI Cleanliness & Timestamp Scoring on uploaded photos (Org Super Admin Only)"
                                    >
                                        <FlaskConical size={12} className="text-violet-600" />
                                        Vision Lab
                                    </button>
                                )}
                            </div>
                        )}
                        {headerRight && <div className="flex-shrink-0">{headerRight}</div>}
                    </div>
                </div>

                {/* Mobile View Toggle - Separate Row for accessibility */}
                {isAdmin && (activeView === 'list' || activeView === 'history' || activeView === 'reports' || activeView === 'settings') && (
                    <div className="md:hidden px-3 pb-1">
                        <div className="flex bg-slate-100 p-0.5 rounded-xl border border-slate-200 w-full">
                            <button
                                onClick={() => setActiveView('list')}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeView === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                            >
                                <LayoutGrid size={12} />
                                Templates
                            </button>
                            <button
                                onClick={() => setActiveView('history')}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeView === 'history' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                            >
                                <History size={12} />
                                History
                            </button>
                            <button
                                onClick={() => setActiveView('reports')}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeView === 'reports' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                            >
                                <FileBarChart size={12} />
                                Reports
                            </button>
                            <button
                                onClick={() => setActiveView('settings')}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeView === 'settings' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                            >
                                <Settings size={12} />
                                Settings
                            </button>
                            {isOrgSuperAdmin && (
                                <button
                                    onClick={() => setShowVisionLab(true)}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest text-violet-700 bg-violet-50 transition-all border border-violet-200"
                                >
                                    <FlaskConical size={12} />
                                    Vision Lab
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Content Area */}
                <motion.div
                    className="bg-white border border-slate-200 rounded-xl md:rounded-[2rem] shadow-sm overflow-hidden"
                >
                    <div className="p-2 md:p-6">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeView}
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                transition={{ duration: 0.2 }}
                            >
                                {isAdmin && activeView === 'list' && (
                                    <SOPTemplateManager
                                        propertyId={propertyId}
                                        propertyIds={isMultiProperty ? propertyIds : undefined}
                                        isAdmin={isAdmin}
                                        userRole={userRole}
                                        onSelectTemplate={handleStartChecklist}
                                        activeView="list"
                                        onViewChange={setActiveView as any}
                                    />
                                )}

                                {(activeView === 'history' || (!isAdmin && activeView === 'list')) && (
                                    <SOPCompletionHistory
                                        propertyId={propertyId}
                                        propertyIds={isMultiProperty ? propertyIds : undefined}
                                        isAdmin={isAdmin}
                                        userRole={userRole}
                                        onSelectTemplate={handleStartChecklist}
                                        onViewDetail={handleViewDetail}
                                        activeView="history"
                                        onViewChange={isAdmin ? (setActiveView as any) : undefined}
                                        initialFilter={historyFilter}
                                        onFilterChange={setHistoryFilter}
                                    />
                                )}

                                {activeView === 'reports' && isAdmin && (
                                    <SOPReportSection 
                                        propertyId={propertyId!}
                                        isAdmin={isAdmin}
                                    />
                                )}

                                {activeView === 'settings' && isAdmin && propertyId && (
                                    <SOPChecklistSettingsSection 
                                        propertyId={propertyId}
                                        isAdmin={isAdmin}
                                        isOrgSuperAdmin={isOrgSuperAdmin}
                                    />
                                )}

                                {activeView === 'detail' && viewingCompletionId && (
                                    <SOPCompletionDetail
                                        completionId={viewingCompletionId}
                                        propertyId={viewingPropertyId!}
                                        isAdmin={isAdmin}
                                        onBack={() => {
                                            try {
                                                sessionStorage.removeItem(`sop_detail_state_${propertyId || 'global'}`);
                                            } catch {}
                                            setActiveView('history');
                                            setViewingCompletionId(null);
                                            setViewingCompletionTemplateId(null);
                                        }}
                                        onResume={() => {
                                            if (viewingCompletionTemplateId) {
                                                handleStartChecklist(viewingCompletionTemplateId, viewingPropertyId!, viewingCompletionId);
                                            }
                                        }}
                                    />
                                )}

                                {activeView === 'runner' && selectedTemplateId && (
                                    <div className="max-w-3xl mx-auto py-2 md:py-8">
                                        <SOPChecklistRunner
                                            key={`${selectedTemplateId}-${selectedCompletionId || 'new'}-${selectedCompletionDate || 'now'}`}
                                            templateId={selectedTemplateId}
                                            completionId={selectedCompletionId || undefined}
                                            completionDate={selectedCompletionDate || undefined}
                                            isSuperAdmin={['property_admin', 'org_admin', 'org_super_admin', 'master_admin'].includes(userRole.toLowerCase())}
                                            propertyId={viewingPropertyId!}
                                            onComplete={handleChecklistComplete}
                                            onCancel={() => {
                                                try {
                                                    sessionStorage.removeItem(`sop_runner_state_${propertyId || 'global'}`);
                                                } catch {}
                                                const targetView = returnView || (isAdmin ? 'list' : 'history');
                                                setActiveView(targetView as any);
                                                setReturnView(null);
                                                setSelectedTemplateId(null);
                                                setSelectedCompletionId(null);
                                                setSelectedCompletionDate(null);
                                            }}
                                        />
                                    </div>
                                )}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </motion.div>
            </div>


            {/* AI Vision Testing Lab Modal */}
            {isOrgSuperAdmin && (
                <SOPVisionTestingModal
                    isOpen={showVisionLab}
                    onClose={() => setShowVisionLab(false)}
                    propertyId={propertyId || 'all'}
                />
            )}

            {/* Toast Notification */}
            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    visible={true}
                    onClose={() => setToast(null)}
                    duration={3000}
                />
            )}
        </div>
    );
};

export default SOPDashboard;
