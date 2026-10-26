'use client';

import React, { useState } from 'react';
import Skeleton from '@/frontend/components/ui/Skeleton';
import { Toast } from '@/frontend/components/ui/Toast';
import { useCADReportData } from './reports/useCADReportData';
import { CADReportHeader } from './reports/CADReportHeader';
import { CADFloorPlanViewport } from './reports/CADFloorPlanViewport';
import { CADAreaInspector } from './reports/CADAreaInspector';
import { CADReportAnalyticsRow } from './reports/CADReportAnalyticsRow';

interface SOPReportSectionProps {
    propertyId: string;
    isAdmin: boolean;
}

const SOPReportSection: React.FC<SOPReportSectionProps> = ({ propertyId, isAdmin }) => {
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

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
        statusCounts,
        categoryMetrics,
        recentAudits,
        aiInsights,
        isLoading,
    } = useCADReportData(propertyId, isAdmin);

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
                        />
                    </div>

                    {/* Right Column: Selected Area Detailed Inspector (~42% width on desktop) */}
                    <div className="lg:col-span-5 xl:col-span-5 2xl:col-span-5">
                        <CADAreaInspector
                            area={selectedArea}
                            floorName={`${cadTemplate?.title || 'D Wing'} • ${selectedFloor}`}
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
