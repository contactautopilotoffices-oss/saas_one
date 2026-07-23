'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/frontend/context/AuthContext';
import Skeleton from '@/frontend/components/ui/Skeleton';
import { Toast } from '@/frontend/components/ui/Toast';
import { ClipboardCheck, LayoutGrid, History, FileBarChart } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import SOPTemplateManager from './SOPTemplateManager';
import SOPCompletionHistory from './SOPCompletionHistory';
import SOPChecklistRunner from './SOPChecklistRunner';
import SOPCompletionDetail from './SOPCompletionDetail';
import SOPReportSection from './SOPReportSection';
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
    const [activeView, setActiveView] = useState<'list' | 'runner' | 'history' | 'detail' | 'reports'>('list');
    const [returnView, setReturnView] = useState<'list' | 'history' | null>(null);
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
    const [selectedCompletionId, setSelectedCompletionId] = useState<string | null>(null);
    const [selectedCompletionDate, setSelectedCompletionDate] = useState<string | null>(null);
    const [viewingCompletionId, setViewingCompletionId] = useState<string | null>(null);
    const [viewingCompletionTemplateId, setViewingCompletionTemplateId] = useState<string | null>(null);
    const [viewingPropertyId, setViewingPropertyId] = useState<string | null>(null);
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

    // Non-admin users should always land on history view
    useEffect(() => {
        if (!isLoading && userRole && !isAdmin) {
            setActiveView('history');
        }
    }, [isLoading, isAdmin, userRole]);

    const handleStartChecklist = (templateId: string, propertyId: string, completionId?: string, completionDate?: string) => {
        // Remember where we came from (list or history) to return correctly on cancel
        if (activeView === 'list' || activeView === 'history') {
            setReturnView(activeView);
        }
        setSelectedTemplateId(templateId);
        setViewingPropertyId(propertyId);
        setSelectedCompletionId(completionId || null);
        setSelectedCompletionDate(completionDate || null);
        setActiveView('runner');
    };

    const handleChecklistComplete = () => {
        setToast({ message: 'Checklist completed successfully!', type: 'success' });
        // Invalidate all SOP caches for this property
        const cacheKeyPrefix = `sop-`; 
        // We'll just clear all SOP keys for simplicity and safety
        Object.keys(localStorage)
            .filter(k => k.includes('sop-'))
            .forEach(k => localStorage.removeItem(k));
        
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
        setActiveView('detail');
    }, []);

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
                        {isAdmin && (activeView === 'list' || activeView === 'history' || activeView === 'reports') && (
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
                            </div>
                        )}
                        {headerRight && <div className="flex-shrink-0">{headerRight}</div>}
                    </div>
                </div>

                {/* Mobile View Toggle - Separate Row for accessibility */}
                {isAdmin && (activeView === 'list' || activeView === 'history' || activeView === 'reports') && (
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

                                {activeView === 'detail' && viewingCompletionId && (
                                    <SOPCompletionDetail
                                        completionId={viewingCompletionId}
                                        propertyId={viewingPropertyId!}
                                        isAdmin={isAdmin}
                                        onBack={() => {
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
