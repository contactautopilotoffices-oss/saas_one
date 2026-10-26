'use client';

import React, { useState } from 'react';
import { 
    MapPin, 
    Calendar, 
    ChevronDown, 
    Search, 
    Download, 
    FileSpreadsheet, 
    FileText, 
    Sparkles,
    Building2,
    Check,
    ArrowLeft,
    SlidersHorizontal,
    LayoutGrid,
    History,
    FileBarChart,
    Settings
} from 'lucide-react';

interface CADReportHeaderProps {
    templateTitle: string;
    floorName: string;
    templates: Array<{ id: string; title: string }>;
    selectedTemplateId: string;
    onSelectTemplate: (id: string) => void;
    dateRangeMode: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom';
    onSelectDateRange: (mode: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom') => void;
    selectedDate: string;
    onChangeDate: (date: string) => void;
    searchQuery: string;
    onSearchChange: (q: string) => void;
    overallScore: number;
    onExportPDF: () => void;
    onExportExcel: () => void;
    onNavigateView?: (view: string) => void;
    onToggleAIInsights?: () => void;
}

export const CADReportHeader: React.FC<CADReportHeaderProps> = ({
    templateTitle,
    floorName,
    templates,
    selectedTemplateId,
    onSelectTemplate,
    dateRangeMode,
    onSelectDateRange,
    selectedDate,
    onChangeDate,
    searchQuery,
    onSearchChange,
    overallScore,
    onExportPDF,
    onExportExcel,
    onNavigateView,
    onToggleAIInsights,
}) => {
    const [dateMenuOpen, setDateMenuOpen] = useState(false);
    const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
    const [exportMenuOpen, setExportMenuOpen] = useState(false);

    const dateLabels: Record<string, string> = {
        today: 'Today',
        yesterday: 'Yesterday',
        this_week: 'This Week',
        this_month: 'This Month',
        custom: 'Custom Date',
    };

    // Color code overall score
    const scoreColor = overallScore >= 85 
        ? '#10b981' // Emerald
        : overallScore >= 70 
        ? '#f59e0b' // Amber
        : overallScore >= 50 
        ? '#f97316' // Orange
        : '#ef4444'; // Red

    // Semi-circle gauge math (top half arc)
    const arcPercent = Math.min(100, Math.max(0, overallScore)) / 100;
    // Semi-circle perimeter for r=28 is PI * 28 = 87.96
    const r = 28;
    const semiCircumference = Math.PI * r;
    const strokeDashoffset = semiCircumference * (1 - arcPercent);

    return (
        <div className="space-y-2">
            {/* Minimal view switcher strip allowing instant navigation to Templates / History / Settings */}
            {onNavigateView && (
                <div className="flex items-center justify-between px-1">
                    <button
                        type="button"
                        onClick={() => onNavigateView('list')}
                        className="inline-flex items-center gap-1.5 text-xs font-black text-slate-500 hover:text-primary transition-colors cursor-pointer"
                    >
                        <ArrowLeft size={14} />
                        <span>Back to Checklists</span>
                    </button>

                    <div className="flex items-center bg-white p-0.5 rounded-xl border border-slate-200/80 shadow-2xs">
                        <button
                            type="button"
                            onClick={() => onNavigateView('list')}
                            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider text-slate-500 hover:text-slate-800 transition-all cursor-pointer"
                        >
                            <LayoutGrid size={11} />
                            <span>Templates</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => onNavigateView('history')}
                            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider text-slate-500 hover:text-slate-800 transition-all cursor-pointer"
                        >
                            <History size={11} />
                            <span>History</span>
                        </button>
                        <button
                            type="button"
                            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-primary text-white shadow-2xs cursor-default"
                        >
                            <FileBarChart size={11} />
                            <span>Reports</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => onNavigateView('settings')}
                            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider text-slate-500 hover:text-slate-800 transition-all cursor-pointer"
                        >
                            <Settings size={11} />
                            <span>Settings</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Main Header Card */}
            <header className="bg-white rounded-2xl border border-slate-200/80 p-3.5 sm:p-4 shadow-xs">
                <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-3.5">
                    {/* Left: Branding & Subtitle */}
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200/60 flex items-center justify-center text-blue-600 flex-shrink-0 shadow-2xs">
                            <MapPin size={20} className="text-blue-600" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                                    CAD Cleanliness Report
                                </h1>
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-xs">
                                    <Sparkles size={10} />
                                    AI Powered
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-500 font-semibold tracking-wide flex items-center gap-1.5 mt-0.5">
                                <span className="font-black text-slate-800 uppercase">{floorName || 'D WING • 1ST FLOOR'}</span>
                                <span className="text-slate-300">•</span>
                                <span className="text-slate-500 font-medium">Area cleanliness scores, multi-photo proofs & AI insights</span>
                            </p>
                        </div>
                    </div>

                    {/* Right: Single row of controls matching Image 4 */}
                    <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                        {/* 1. Date Range Dropdown */}
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setDateMenuOpen(!dateMenuOpen)}
                                className="flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 transition-all cursor-pointer shadow-2xs"
                            >
                                <Calendar size={13} className="text-slate-400" />
                                <span>{dateLabels[dateRangeMode] || 'This Week'}</span>
                                <ChevronDown size={12} className="text-slate-400" />
                            </button>

                            {dateMenuOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setDateMenuOpen(false)} />
                                    <div className="absolute left-0 sm:right-0 sm:left-auto top-full mt-1.5 w-48 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-1.5 space-y-1">
                                        {(['today', 'yesterday', 'this_week', 'this_month', 'custom'] as const).map(mode => (
                                            <button
                                                key={mode}
                                                type="button"
                                                onClick={() => {
                                                    onSelectDateRange(mode);
                                                    setDateMenuOpen(false);
                                                }}
                                                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-between ${
                                                    dateRangeMode === mode
                                                        ? 'bg-primary/10 text-primary'
                                                        : 'text-slate-700 hover:bg-slate-50'
                                                }`}
                                            >
                                                <span>{dateLabels[mode]}</span>
                                                {dateRangeMode === mode && <Check size={13} />}
                                            </button>
                                        ))}
                                        {dateRangeMode === 'custom' && (
                                            <div className="pt-1.5 border-t border-slate-100 px-1">
                                                <input
                                                    type="date"
                                                    value={selectedDate}
                                                    onChange={e => onChangeDate(e.target.value)}
                                                    className="w-full text-xs font-bold border border-slate-200 rounded-lg p-1.5 text-slate-800"
                                                />
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>

                        {/* 2. Checklist / Floor Selector Dropdown */}
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setTemplateMenuOpen(!templateMenuOpen)}
                                className="flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 transition-all cursor-pointer shadow-2xs max-w-[190px] sm:max-w-[220px] truncate"
                            >
                                <Building2 size={13} className="text-slate-400 flex-shrink-0" />
                                <span className="truncate">{templateTitle || 'D Wing - 1st Floor'}</span>
                                <ChevronDown size={12} className="text-slate-400 flex-shrink-0" />
                            </button>

                            {templateMenuOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setTemplateMenuOpen(false)} />
                                    <div className="absolute left-0 sm:right-0 sm:left-auto top-full mt-1.5 w-64 max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-1.5 space-y-1">
                                        {templates.map(t => (
                                            <button
                                                key={t.id}
                                                type="button"
                                                onClick={() => {
                                                    onSelectTemplate(t.id);
                                                    setTemplateMenuOpen(false);
                                                }}
                                                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-between truncate ${
                                                    selectedTemplateId === t.id
                                                        ? 'bg-primary/10 text-primary'
                                                        : 'text-slate-700 hover:bg-slate-50'
                                                }`}
                                            >
                                                <span className="truncate">{t.title}</span>
                                                {selectedTemplateId === t.id && <Check size={13} className="flex-shrink-0" />}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

                        {/* 3. Search Bar */}
                        <div className="relative min-w-[160px] sm:min-w-[210px] xl:min-w-[240px]">
                            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search area, room or checklist..."
                                value={searchQuery}
                                onChange={e => onSearchChange(e.target.value)}
                                className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-primary focus:bg-white transition-all shadow-2xs"
                            />
                        </div>

                        {/* 4. Overall Score Radial Arc Gauge (Matching Image 4) */}
                        <div className="flex items-center gap-2.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl shadow-2xs">
                            <div className="flex flex-col text-right">
                                <span className="text-[8px] font-black uppercase tracking-wider text-slate-400">Overall Score</span>
                                <div className="flex items-baseline gap-0.5 justify-end">
                                    <span className="text-sm font-black text-slate-900 leading-none">{overallScore}</span>
                                    <span className="text-[9px] font-bold text-slate-400">/100</span>
                                </div>
                            </div>

                            {/* Prominent Radial Arc Gauge */}
                            <div className="relative w-12 h-7 flex items-end justify-center overflow-visible">
                                <svg className="w-12 h-12 -rotate-90 transform overflow-visible" viewBox="0 0 64 64">
                                    {/* Track Arc */}
                                    <path
                                        d="M 4 32 A 28 28 0 0 1 60 32"
                                        fill="none"
                                        stroke="#e2e8f0"
                                        strokeWidth="6"
                                        strokeLinecap="round"
                                    />
                                    {/* Score Progress Arc */}
                                    <path
                                        d="M 4 32 A 28 28 0 0 1 60 32"
                                        fill="none"
                                        stroke={scoreColor}
                                        strokeWidth="6"
                                        strokeDasharray={`${semiCircumference} ${semiCircumference}`}
                                        strokeDashoffset={strokeDashoffset}
                                        strokeLinecap="round"
                                        className="transition-all duration-700 ease-out"
                                    />
                                </svg>
                            </div>
                        </div>

                        {/* 5. Export Report Button */}
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                                className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-bold shadow-2xs transition-all cursor-pointer"
                            >
                                <Download size={13} className="text-slate-500" />
                                <span>Export Report</span>
                                <ChevronDown size={12} className="text-slate-400" />
                            </button>

                            {exportMenuOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setExportMenuOpen(false)} />
                                    <div className="absolute right-0 top-full mt-1.5 w-44 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-1.5 space-y-1">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onExportPDF();
                                                setExportMenuOpen(false);
                                            }}
                                            className="w-full text-left px-2.5 py-2 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-all cursor-pointer"
                                        >
                                            <FileText size={14} className="text-rose-500" />
                                            <span>Export PDF Audit</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onExportExcel();
                                                setExportMenuOpen(false);
                                            }}
                                            className="w-full text-left px-2.5 py-2 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-all cursor-pointer"
                                        >
                                            <FileSpreadsheet size={14} className="text-emerald-600" />
                                            <span>Export Excel Sheet</span>
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* 6. AI Insights Action Button (Matching Image 4) */}
                        <button
                            type="button"
                            onClick={onToggleAIInsights}
                            className="flex items-center gap-1.5 px-3.5 py-2 bg-[#0f172a] hover:bg-slate-800 text-white rounded-xl text-xs font-black shadow-xs hover:shadow-md transition-all cursor-pointer"
                        >
                            <Sparkles size={13} className="text-purple-400" />
                            <span>AI Insights</span>
                        </button>
                    </div>
                </div>
            </header>
        </div>
    );
};
