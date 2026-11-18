'use client';

import React, { useState } from 'react';
import Skeleton from '@/frontend/components/ui/Skeleton';
import { Toast } from '@/frontend/components/ui/Toast';
import { ListChecks, Map as MapIcon, Building2 } from 'lucide-react';
import { useCADReportData } from './reports/useCADReportData';
import { CADReportHeader } from './reports/CADReportHeader';
import { CADFloorPlanViewport } from './reports/CADFloorPlanViewport';
import { CADAreaInspector } from './reports/CADAreaInspector';
import { CADReportAnalyticsRow } from './reports/CADReportAnalyticsRow';
import ChecklistCompletionReport from './reports/ChecklistCompletionReport';

interface SOPReportSectionProps {
    /** Single property view. Undefined when the org admin is looking at every property. */
    propertyId?: string;
    propertyIds?: string[];
    isAdmin: boolean;
    onViewRun?: (completionId: string, templateId: string, propertyId: string) => void;
}

type ReportTab = 'completion' | 'area';

const SOPReportSection: React.FC<SOPReportSectionProps> = ({ propertyId, propertyIds, isAdmin, onViewRun }) => {
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
    const [reportTab, setReportTab] = useState<ReportTab>('completion');

    const {
        selectedDate,
        setSelectedDate,
        dateRangeMode,
        setDateRangeMode,
        selectedTemplateId,
        setSelectedTemplateId,
        selectedFloor,
        setSelectedFloor,
        searchQuery,
        setSearchQuery,
        selectedAreaId,
        setSelectedAreaId,
        templates,
        cadTemplate,
        areaAudits,
        filteredAreas,
        selectedArea,
        overallScore,
        scoreCoverage,
        passThreshold,
        statusCounts,
        categoryMetrics,
        recentAudits,
        aiInsights,
        isLoading,
    } = useCADReportData(propertyId || '', isAdmin);

    const handleExportPDF = () => {
        window.open(
            `/api/properties/${propertyId}/sop/report?templateId=${selectedTemplateId}&date=${selectedDate}&format=pdf`,
            '_blank'
        );
        setToast({ message: 'Generating PDF Cleanliness Report...', type: 'info' });
    };

    const handleExportExcel = () => {
        window.open(
            `/api/properties/${propertyId}/sop/report?templateId=${selectedTemplateId}&date=${selectedDate}&format=excel`,
            '_blank'
        );
        setToast({ message: 'Exporting audit spreadsheet...', type: 'info' });
    };

    return (
        <div className="space-y-4">
            {/* Report type switcher: completion summary vs. floor-plan area audit */}
            <div className="flex items-center gap-1 bg-white border border-slate-200/80 p-0.5 rounded-xl shadow-2xs w-fit">
                <button
                    type="button"
                    onClick={() => setReportTab('completion')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${reportTab === 'completion' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                    <ListChecks size={12} />
                    Completion Report
                </button>
                <button
                    type="button"
                    onClick={() => setReportTab('area')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${reportTab === 'area' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                    <MapIcon size={12} />
                    Area Audit
                </button>
            </div>

            {reportTab === 'completion' ? (
                <ChecklistCompletionReport
                    propertyId={propertyId}
                    propertyIds={propertyIds}
                    onViewRun={onViewRun}
                />
            ) : !propertyId ? (
                <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center">
                    <Building2 size={28} className="mx-auto text-slate-300" />
                    <h4 className="mt-2 text-sm font-black text-slate-700">Select a single property</h4>
                    <p className="text-[11px] font-semibold text-slate-400 mt-1">
                        The floor-plan area audit works on one property at a time. Pick a property from the selector above.
                    </p>
                </div>
            ) : (
            <>
            {/* Top Navigation & Global Controls Header */}
            <CADReportHeader
                templateTitle={cadTemplate?.title || 'D Wing - 1st Floor'}
                floorName={`${cadTemplate?.title || 'D WING'} • ${selectedFloor.toUpperCase()}`}
                templates={templates}
                selectedTemplateId={selectedTemplateId}
                onSelectTemplate={setSelectedTemplateId}
                dateRangeMode={dateRangeMode}
                onSelectDateRange={setDateRangeMode}
                selectedDate={selectedDate}
                onChangeDate={setSelectedDate}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                overallScore={overallScore}
                scoreCoverage={scoreCoverage}
                passThreshold={passThreshold}
                onExportPDF={handleExportPDF}
                onExportExcel={handleExportExcel}
            />

            {/* Main Interactive CAD Viewport + Detailed Area Inspector Split */}
            {isLoading ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    <div className="lg:col-span-7 xl:col-span-7 2xl:col-span-7">
                        <Skeleton className="h-[640px] rounded-2xl" />
                    </div>
                    <div className="lg:col-span-5 xl:col-span-5 2xl:col-span-5">
                        <Skeleton className="h-[640px] rounded-2xl" />
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
                    {/* Left Column: Interactive CAD Floor Plan Viewport (~58% width on desktop) */}
                    <div className="lg:col-span-7 xl:col-span-7 2xl:col-span-7">
                        <CADFloorPlanViewport
                            cadImageUrl={cadTemplate?.cadImageUrl}
                            areas={cadTemplate?.areas || []}
                            areaAudits={filteredAreas}
                            selectedAreaId={selectedAreaId}
                            onSelectArea={setSelectedAreaId}
                            selectedFloor={selectedFloor}
                            onSelectFloor={setSelectedFloor}
                            passThreshold={passThreshold}
                        />
                    </div>

                    {/* Right Column: Selected Area Detailed Inspector (~42% width on desktop) */}
                    <div className="lg:col-span-5 xl:col-span-5 2xl:col-span-5">
                        <CADAreaInspector
                            area={selectedArea}
                            floorName={`${cadTemplate?.title || 'D Wing'} • ${selectedFloor}`}
                            propertyId={propertyId}
                            passThreshold={passThreshold}
                        />
                    </div>
                </div>
            )}

            {/* Bottom Row: Executive Intelligence & Analytics Cards */}
            <CADReportAnalyticsRow
                categoryMetrics={categoryMetrics}
                statusCounts={statusCounts}
                recentAudits={recentAudits}
                aiInsights={aiInsights}
                onSelectRecentAudit={(id) => setSelectedAreaId(id)}
            />
            </>
            )}

            {/* Toast Feedback */}
            {toast && (
                <Toast
                    visible={Boolean(toast)}
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}
        </div>
    );
};

export default SOPReportSection;
