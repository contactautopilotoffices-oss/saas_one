'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    FileSpreadsheet, Upload, Download, Plus, Trash2, 
    CheckCircle2, AlertCircle, Building2, IndianRupee, 
    Calendar, ArrowRight, Table, Sparkles, RefreshCw,
    FileText, Check, Shield, Search
} from 'lucide-react';
import { TaskLineItem, TaskCategory, TaskFrequency, TEST_PROPERTIES } from './mockData';

interface TaskSheetUploadViewProps {
    tasks: TaskLineItem[];
    onAddTasks: (newTasks: TaskLineItem[]) => void;
    onOpenNewModal: () => void;
    onSelectTask: (task: TaskLineItem) => void;
}

interface DraftRow {
    id: string;
    title: string;
    property_id: string;
    category: TaskCategory;
    frequency: TaskFrequency;
    amount: string;
    vendor_name: string;
    urgency: 'P1' | 'P2' | 'P3';
}

export default function TaskSheetUploadView({
    tasks,
    onAddTasks,
    onOpenNewModal,
    onSelectTask
}: TaskSheetUploadViewProps) {
    const [subTab, setSubTab] = useState<'sheet_entry' | 'batch_upload' | 'history'>('sheet_entry');
    const [draftRows, setDraftRows] = useState<DraftRow[]>([
        {
            id: 'row-1',
            title: 'Daily Pest Control Spray (Basement Parking)',
            property_id: 'prop-ss-plaza',
            category: 'consumables',
            frequency: 'daily',
            amount: '6500',
            vendor_name: 'PestOShield Commercial Ltd',
            urgency: 'P2'
        },
        {
            id: 'row-2',
            title: 'Weekly Restock of Cafeteria Coffee Beans & Dairy',
            property_id: 'prop-cyber-city',
            category: 'consumables',
            frequency: 'weekly',
            amount: '42000',
            vendor_name: 'Nescafe Vending Supplies',
            urgency: 'P2'
        }
    ]);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitToast, setSubmitToast] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [batchFile, setBatchFile] = useState<File | null>(null);
    const [importedTasksCount, setImportedTasksCount] = useState<number | null>(null);

    const handleAddRow = () => {
        const newRow: DraftRow = {
            id: `row-${Date.now()}`,
            title: '',
            property_id: 'prop-ss-plaza',
            category: 'consumables',
            frequency: 'daily',
            amount: '',
            vendor_name: '',
            urgency: 'P2'
        };
        setDraftRows([...draftRows, newRow]);
    };

    const handleRemoveRow = (id: string) => {
        setDraftRows(draftRows.filter(r => r.id !== id));
    };

    const handleUpdateRow = (id: string, field: keyof DraftRow, value: any) => {
        setDraftRows(draftRows.map(r => r.id === id ? { ...r, [field]: value } : r));
    };

    const handleSubmitSheet = () => {
        const validRows = draftRows.filter(r => r.title.trim() && r.vendor_name.trim() && Number(r.amount) > 0);
        if (validRows.length === 0) {
            alert('Please fill out at least one complete row with Title, Vendor, and Amount.');
            return;
        }

        setIsSubmitting(true);
        setTimeout(() => {
            const newTasks: TaskLineItem[] = validRows.map((row, idx) => {
                const prop = TEST_PROPERTIES.find(p => p.id === row.property_id);
                const propName = prop ? prop.name.split(' (')[0] : 'SS Plaza Tower A';
                const randomCode = `PUT-0821-${Math.floor(10 + Math.random() * 90)}`;

                let tatDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
                let tatLabel = '7 Days TAT';
                if (row.urgency === 'P1') {
                    tatDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                    tatLabel = 'Immediate (< 24h)';
                } else if (row.urgency === 'P3') {
                    tatDeadline = 'Flexible (No SLA)';
                    tatLabel = 'Flexible (No SLA)';
                }

                return {
                    id: `task-${Date.now()}-${idx}`,
                    task_code: randomCode,
                    title: row.title,
                    description: `Submitted via Daily/Weekly Task Sheet for ${propName}.`,
                    property_id: row.property_id,
                    property_name: propName,
                    category: row.category,
                    frequency: row.frequency,
                    urgency_tier: row.urgency,
                    tat_deadline: tatDeadline,
                    tat_label: tatLabel,
                    estimated_amount: Number(row.amount),
                    vendor_name: row.vendor_name,
                    requested_by_name: 'Procurement Team',
                    requested_by_email: 'procurement@autopilotoffices.com',
                    requested_at: new Date().toISOString(),
                    status: 'pending_triage',
                    payment_status: 'unpaid',
                    tags: [row.frequency, row.category.replace('_', ' ')]
                };
            });

            onAddTasks(newTasks);
            setIsSubmitting(false);
            setDraftRows([]);
            setSubmitToast(`Successfully uploaded ${newTasks.length} tasks to Org Super Admin triage queue!`);
            setTimeout(() => setSubmitToast(null), 4000);
        }, 500);
    };

    const handleSimulateBatchImport = () => {
        setIsSubmitting(true);
        setTimeout(() => {
            const batchMock: TaskLineItem[] = [
                {
                    id: `batch-${Date.now()}-1`,
                    task_code: `PUT-0821-B1`,
                    title: 'Weekly Cafeteria Mineral Water Dispenser 50 Cans Refill',
                    description: 'Scheduled batch replenishment for floor pantries.',
                    property_id: 'prop-ss-plaza',
                    property_name: 'SS Plaza Tower A',
                    category: 'consumables',
                    frequency: 'weekly',
                    urgency_tier: 'P2',
                    tat_deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                    tat_label: '7 Days TAT',
                    estimated_amount: 12500,
                    vendor_name: 'Bisleri Commercial Supply',
                    requested_by_name: 'Procurement Excel Batch',
                    requested_by_email: 'procurement@autopilotoffices.com',
                    requested_at: new Date().toISOString(),
                    status: 'pending_triage',
                    payment_status: 'unpaid',
                    tags: ['Excel Import', 'Weekly']
                },
                {
                    id: `batch-${Date.now()}-2`,
                    task_code: `PUT-0821-B2`,
                    title: 'Daily Air Conditioning Filter Wash & Disinfection',
                    description: 'Daily hygiene cycle for air handling units.',
                    property_id: 'prop-golf-course',
                    property_name: 'Golf Course One',
                    category: 'consumables',
                    frequency: 'daily',
                    urgency_tier: 'P2',
                    tat_deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                    tat_label: '7 Days TAT',
                    estimated_amount: 8800,
                    vendor_name: 'CleanAir Tech Services',
                    requested_by_name: 'Procurement Excel Batch',
                    requested_by_email: 'procurement@autopilotoffices.com',
                    requested_at: new Date().toISOString(),
                    status: 'pending_triage',
                    payment_status: 'unpaid',
                    tags: ['Excel Import', 'Daily']
                }
            ];

            onAddTasks(batchMock);
            setIsSubmitting(false);
            setBatchFile(null);
            setImportedTasksCount(batchMock.length);
            setSubmitToast(`Successfully imported ${batchMock.length} tasks from spreadsheet!`);
            setTimeout(() => setSubmitToast(null), 4000);
        }, 600);
    };

    const handleDownloadTemplate = () => {
        const csvContent = "data:text/csv;charset=utf-8,Task_Title,Property_ID,Category,Frequency,Estimated_Amount,Vendor_Name,Urgency_Preference\n" +
            "Daily Diesel Top-Up 200L,prop-ss-plaza,utility_bill,daily,19000,Indian Oil Corporation,P1\n" +
            "Weekly Housekeeping Kit,prop-cyber-city,consumables,weekly,34000,Diversey India,P2\n" +
            "Quarterly Fire Extinguisher Refill,prop-golf-course,vendor_amc,monthly,18500,Ceasefire Industries,P3";
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "Autopilot_Procurement_Task_Sheet_Template.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="space-y-6 font-inter">
            {/* Header Banner & Sub-Navigation */}
            <div className="bg-white p-6 md:p-8 rounded-[2rem] border border-slate-200 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            Procurement Operations Hub
                        </p>
                    </div>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                        Daily & Weekly Task Sheet Submission
                    </h2>
                    <p className="text-xs font-medium text-slate-500 max-w-2xl">
                        Upload daily recurring tasks, weekly vendor requirements, and payment line items.
                        All submissions are routed to the Org Super Admin triage queue for urgency sorting into P1, P2, and P3 tiers.
                    </p>
                </div>

                {/* Sub Tab Buttons */}
                <div className="flex flex-wrap items-center gap-2 bg-slate-100 p-1.5 rounded-2xl">
                    <button
                        onClick={() => setSubTab('sheet_entry')}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                            subTab === 'sheet_entry'
                                ? 'bg-white text-slate-900 shadow-xs'
                                : 'text-slate-500 hover:text-slate-800'
                        }`}
                    >
                        <Table className="w-4 h-4 text-primary" />
                        Interactive Sheet
                    </button>
                    <button
                        onClick={() => setSubTab('batch_upload')}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                            subTab === 'batch_upload'
                                ? 'bg-white text-slate-900 shadow-xs'
                                : 'text-slate-500 hover:text-slate-800'
                        }`}
                    >
                        <Upload className="w-4 h-4 text-indigo-500" />
                        Batch Excel / CSV
                    </button>
                    <button
                        onClick={() => setSubTab('history')}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                            subTab === 'history'
                                ? 'bg-white text-slate-900 shadow-xs'
                                : 'text-slate-500 hover:text-slate-800'
                        }`}
                    >
                        <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                        All Uploaded ({tasks.length})
                    </button>
                </div>
            </div>

            {/* Notification Toast */}
            <AnimatePresence>
                {submitToast && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl flex items-center justify-between shadow-sm"
                    >
                        <div className="flex items-center gap-3">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                            <p className="text-xs font-bold">{submitToast}</p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* TAB 1: Interactive Sheet Entry */}
            {subTab === 'sheet_entry' && (
                <div className="bg-white rounded-[2rem] border border-slate-200 p-6 md:p-8 shadow-xs space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                        <div>
                            <h3 className="text-base font-black text-slate-900 tracking-tight">
                                Quick Line Items Matrix
                            </h3>
                            <p className="text-xs font-medium text-slate-400">
                                Add multiple line items and upload them simultaneously to the task board.
                            </p>
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={handleAddRow}
                                className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-all cursor-pointer"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                Add Row
                            </button>
                            <button
                                type="button"
                                onClick={handleSubmitSheet}
                                disabled={isSubmitting || draftRows.length === 0}
                                className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-xl text-xs font-black shadow-md shadow-primary/20 hover:bg-primary/90 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                            >
                                {isSubmitting ? (
                                    <>
                                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                        Submitting...
                                    </>
                                ) : (
                                    <>
                                        <Check className="w-3.5 h-3.5" />
                                        Submit Task Sheet ({draftRows.length})
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Table View */}
                    <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-left text-xs min-w-[900px]">
                            <thead>
                                <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                    <th className="py-3 px-2">Task Title *</th>
                                    <th className="py-3 px-2">Target Property</th>
                                    <th className="py-3 px-2">Frequency</th>
                                    <th className="py-3 px-2">Category</th>
                                    <th className="py-3 px-2">Est. Amount (₹) *</th>
                                    <th className="py-3 px-2">Vendor / Payee *</th>
                                    <th className="py-3 px-2">Urgency Req.</th>
                                    <th className="py-3 px-2 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                                {draftRows.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="text-center py-12 text-slate-400">
                                            No active draft rows. Click &ldquo;Add Row&rdquo; to start adding daily/weekly tasks.
                                        </td>
                                    </tr>
                                ) : (
                                    draftRows.map(row => (
                                        <tr key={row.id} className="hover:bg-slate-50/60 transition-colors">
                                            {/* Title */}
                                            <td className="py-2.5 px-2 min-w-[200px]">
                                                <input
                                                    type="text"
                                                    value={row.title}
                                                    onChange={(e) => handleUpdateRow(row.id, 'title', e.target.value)}
                                                    placeholder="Task description..."
                                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white"
                                                />
                                            </td>

                                            {/* Property */}
                                            <td className="py-2.5 px-2 min-w-[160px]">
                                                <select
                                                    value={row.property_id}
                                                    onChange={(e) => handleUpdateRow(row.id, 'property_id', e.target.value)}
                                                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-primary/20"
                                                >
                                                    {TEST_PROPERTIES.filter(p => p.id !== 'all').map(p => (
                                                        <option key={p.id} value={p.id}>{p.name.split(' (')[0]}</option>
                                                    ))}
                                                </select>
                                            </td>

                                            {/* Frequency */}
                                            <td className="py-2.5 px-2 min-w-[110px]">
                                                <select
                                                    value={row.frequency}
                                                    onChange={(e) => handleUpdateRow(row.id, 'frequency', e.target.value as TaskFrequency)}
                                                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-primary/20 capitalize"
                                                >
                                                    <option value="daily">Daily</option>
                                                    <option value="weekly">Weekly</option>
                                                    <option value="emergency">Emergency</option>
                                                    <option value="monthly">Monthly</option>
                                                </select>
                                            </td>

                                            {/* Category */}
                                            <td className="py-2.5 px-2 min-w-[140px]">
                                                <select
                                                    value={row.category}
                                                    onChange={(e) => handleUpdateRow(row.id, 'category', e.target.value as TaskCategory)}
                                                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-primary/20"
                                                >
                                                    <option value="consumables">Consumables</option>
                                                    <option value="emergency_repair">Breakdown & Repair</option>
                                                    <option value="utility_bill">Utility / Water</option>
                                                    <option value="vendor_amc">Vendor AMC</option>
                                                    <option value="raw_material">Raw Material</option>
                                                    <option value="general_ops">General Ops</option>
                                                </select>
                                            </td>

                                            {/* Amount */}
                                            <td className="py-2.5 px-2 min-w-[110px]">
                                                <input
                                                    type="number"
                                                    value={row.amount}
                                                    onChange={(e) => handleUpdateRow(row.id, 'amount', e.target.value)}
                                                    placeholder="₹ 15000"
                                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-black text-slate-900 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white"
                                                />
                                            </td>

                                            {/* Vendor */}
                                            <td className="py-2.5 px-2 min-w-[150px]">
                                                <input
                                                    type="text"
                                                    value={row.vendor_name}
                                                    onChange={(e) => handleUpdateRow(row.id, 'vendor_name', e.target.value)}
                                                    placeholder="Vendor Name"
                                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white"
                                                />
                                            </td>

                                            {/* Urgency Preference */}
                                            <td className="py-2.5 px-2 min-w-[90px]">
                                                <select
                                                    value={row.urgency}
                                                    onChange={(e) => handleUpdateRow(row.id, 'urgency', e.target.value as 'P1' | 'P2' | 'P3')}
                                                    className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-black text-slate-800 outline-none focus:ring-2 focus:ring-primary/20"
                                                >
                                                    <option value="P1">P1 (Immediate)</option>
                                                    <option value="P2">P2 (7 Days)</option>
                                                    <option value="P3">P3 (Flexible)</option>
                                                </select>
                                            </td>

                                            {/* Action */}
                                            <td className="py-2.5 px-2 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveRow(row.id)}
                                                    className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 2: Batch Excel / CSV Upload */}
            {subTab === 'batch_upload' && (
                <div className="bg-white rounded-[2rem] border border-slate-200 p-8 shadow-xs space-y-8">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
                        <div>
                            <h3 className="text-lg font-black text-slate-900 tracking-tight">
                                Bulk Upload Tasks via Spreadsheet
                            </h3>
                            <p className="text-xs font-medium text-slate-400">
                                Import dozens of daily or weekly requirements simultaneously using the official CSV/Excel format.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={handleDownloadTemplate}
                            className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-100 transition-all cursor-pointer"
                        >
                            <Download className="w-4 h-4 text-primary" />
                            Download CSV Template
                        </button>
                    </div>

                    {/* Drag and Drop Zone */}
                    <div
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setIsDragging(false);
                            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                                setBatchFile(e.dataTransfer.files[0]);
                            }
                        }}
                        className={`border-2 border-dashed rounded-3xl p-12 text-center transition-all ${
                            isDragging
                                ? 'border-primary bg-primary/5 scale-[1.01]'
                                : batchFile
                                    ? 'border-emerald-300 bg-emerald-50/30'
                                    : 'border-slate-300 bg-slate-50/50 hover:bg-slate-50'
                        }`}
                    >
                        <div className="max-w-md mx-auto space-y-4">
                            <div className={`w-16 h-16 rounded-2xl mx-auto flex items-center justify-center ${
                                batchFile ? 'bg-emerald-100 text-emerald-600' : 'bg-primary/10 text-primary'
                            }`}>
                                <Upload className="w-8 h-8" />
                            </div>

                            {batchFile ? (
                                <div>
                                    <p className="text-sm font-black text-emerald-800 mb-1">
                                        {batchFile.name}
                                    </p>
                                    <p className="text-xs text-slate-400">
                                        Ready to parse and validate tasks.
                                    </p>
                                </div>
                            ) : (
                                <div>
                                    <p className="text-sm font-black text-slate-900 mb-1">
                                        Drag and drop your filled task sheet here
                                    </p>
                                    <p className="text-xs text-slate-400">
                                        Supports .csv, .xlsx, and .xls files up to 10MB
                                    </p>
                                </div>
                            )}

                            <div className="pt-2 flex items-center justify-center gap-3">
                                {batchFile ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={handleSimulateBatchImport}
                                            disabled={isSubmitting}
                                            className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 transition-all cursor-pointer"
                                        >
                                            {isSubmitting ? 'Importing Tasks...' : 'Process & Upload to Kanban'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setBatchFile(null)}
                                            className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-200"
                                        >
                                            Change File
                                        </button>
                                    </>
                                ) : (
                                    <label className="px-5 py-2.5 bg-primary text-white rounded-xl text-xs font-black shadow-md shadow-primary/20 hover:bg-primary/90 transition-all cursor-pointer">
                                        Browse File
                                        <input
                                            type="file"
                                            accept=".csv,.xlsx,.xls"
                                            className="hidden"
                                            onChange={(e) => {
                                                if (e.target.files && e.target.files[0]) {
                                                    setBatchFile(e.target.files[0]);
                                                }
                                            }}
                                        />
                                    </label>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 3: History & Live Tasks */}
            {subTab === 'history' && (
                <div className="bg-white rounded-[2rem] border border-slate-200 p-6 md:p-8 shadow-xs space-y-6">
                    <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                        <div>
                            <h3 className="text-base font-black text-slate-900 tracking-tight">
                                Live Procurement Task Board Master View ({tasks.length} items)
                            </h3>
                            <p className="text-xs font-medium text-slate-400">
                                Tasks sorted and triaged by Org Super Admin with real-time urgency and payment status.
                            </p>
                        </div>
                    </div>

                    <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-left text-xs">
                            <thead>
                                <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                    <th className="py-3 px-3">Code</th>
                                    <th className="py-3 px-3">Task Title</th>
                                    <th className="py-3 px-3">Property</th>
                                    <th className="py-3 px-3">Frequency</th>
                                    <th className="py-3 px-3">Urgency (SLA)</th>
                                    <th className="py-3 px-3">Amount</th>
                                    <th className="py-3 px-3">Vendor</th>
                                    <th className="py-3 px-3">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                                {tasks.map(t => (
                                    <tr
                                        key={t.id}
                                        onClick={() => onSelectTask(t)}
                                        className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                                    >
                                        <td className="py-3 px-3 font-bold text-slate-500">{t.task_code}</td>
                                        <td className="py-3 px-3 font-black text-slate-900">{t.title}</td>
                                        <td className="py-3 px-3 font-bold text-slate-600">{t.property_name}</td>
                                        <td className="py-3 px-3 capitalize">
                                            <span className="px-2 py-0.5 bg-slate-100 rounded text-[10px] font-bold">
                                                {t.frequency}
                                            </span>
                                        </td>
                                        <td className="py-3 px-3">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                                t.urgency_tier === 'P1' ? 'bg-rose-100 text-rose-700' :
                                                t.urgency_tier === 'P2' ? 'bg-amber-100 text-amber-700' :
                                                t.urgency_tier === 'P3' ? 'bg-blue-100 text-blue-700' :
                                                'bg-emerald-100 text-emerald-700'
                                            }`}>
                                                {t.urgency_tier} · {t.tat_label}
                                            </span>
                                        </td>
                                        <td className="py-3 px-3 font-black text-slate-900">
                                            ₹{t.estimated_amount.toLocaleString('en-IN')}
                                        </td>
                                        <td className="py-3 px-3 text-slate-600">{t.vendor_name}</td>
                                        <td className="py-3 px-3">
                                            <span className="px-2 py-0.5 bg-slate-200/60 rounded text-[10px] font-black uppercase text-slate-700">
                                                {t.status.replace(/_/g, ' ')}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
