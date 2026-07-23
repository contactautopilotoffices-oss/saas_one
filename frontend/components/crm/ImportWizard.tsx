'use client';

import React, { useState, useRef } from 'react';
import { X, Upload, FileText, CheckCircle, AlertCircle, Download, Loader2, FileSpreadsheet, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

interface ImportWizardProps {
    isOpen: boolean;
    onClose: () => void;
    onComplete?: (results: any) => void;
}

type ImportStep = 'upload' | 'mapping' | 'preview' | 'importing' | 'complete';

interface ImportError {
    row: number;
    field: string;
    message: string;
}

interface ColumnMapping {
    excelColumn: string;
    crmField: string;
}

// Column mapping configuration
const CRM_FIELDS = [
    { value: 'skip', label: '-- Skip this column --' },
    { value: 'first_name', label: 'First Name', required: true },
    { value: 'last_name', label: 'Last Name' },
    { value: 'full_name', label: 'Full Name' },
    { value: 'email', label: 'Email Address', required: true },
    { value: 'phone', label: 'Phone Number', required: true },
    { value: 'company_name', label: 'Company Name', required: true },
    { value: 'job_title', label: 'Job Title / Designation' },
    { value: 'requirement', label: 'Requirement / Notes' },
    { value: 'location', label: 'Location / Territory' },
    { value: 'status', label: 'Lead Status' },
    { value: 'lead_source', label: 'Lead Source' },
    { value: 'handled_by', label: 'Handled By (POC)' },
    { value: 'campaign', label: 'Campaign Name' },
    { value: 'update_notes', label: 'Activity Log / Updates' },
    { value: 'follow_up_date', label: 'Follow-up Date' },
    { value: 'budget', label: 'Budget' },
    { value: 'seats', label: 'Number of Seats' },
];

// Auto-detect mappings based on header names
const AUTO_DETECT_MAP: Record<string, string> = {
    'first name': 'first_name',
    'firstname': 'first_name',
    'fname': 'first_name',
    'last name': 'last_name',
    'lastname': 'last_name',
    'lname': 'last_name',
    'name': 'full_name',
    'full name': 'full_name',
    'lead name': 'full_name',
    'email': 'email',
    'email id': 'email',
    'e-mail': 'email',
    'contact': 'phone',
    'phone': 'phone',
    'phone number': 'phone',
    'contact number': 'phone',
    'mobile': 'phone',
    'company': 'company_name',
    'company name': 'company_name',
    'company name ': 'company_name',
    'designation': 'job_title',
    'title': 'job_title',
    'role': 'job_title',
    'requirement': 'requirement',
    'requirements': 'requirement',
    'requirement ': 'requirement',
    'requirement/notes': 'requirement',
    'notes': 'requirement',
    'location': 'location',
    'loc': 'location',
    'status': 'status',
    'lead status': 'status',
    'lead_source': 'lead_source',
    'source': 'lead_source',
    'campaign': 'campaign',
    'campaign name': 'campaign',
    'handled by': 'handled_by',
    'handledby': 'handled_by',
    'poc': 'handled_by',
    'who\'s handling': 'handled_by',
    'update': 'update_notes',
    'updates': 'update_notes',
    'activity log': 'update_notes',
    'interaction log': 'update_notes',
    'follow up': 'follow_up_date',
    'followup': 'follow_up_date',
    'follow up date': 'follow_up_date',
    'next follow up': 'follow_up_date',
    'budget': 'budget',
    'seats': 'seats',
    'seats requested': 'seats',
    'number of seats': 'seats',
    'date': 'date',
};

export default function ImportWizard({ isOpen, onClose, onComplete }: ImportWizardProps) {
    const [step, setStep] = useState<ImportStep>('upload');
    const [file, setFile] = useState<File | null>(null);
    const [fileType, setFileType] = useState<'csv' | 'xlsx'>('csv');
    const [rawData, setRawData] = useState<string[][]>([]);
    const [headers, setHeaders] = useState<string[]>([]);
    const [mappings, setMappings] = useState<ColumnMapping[]>([]);
    const [duplicates, setDuplicates] = useState<number[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [results, setResults] = useState<{
        total_rows: number;
        success_count: number;
        error_count: number;
        errors: ImportError[];
        skipped_duplicates: number;
    } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

        setFile(selectedFile);
        const extension = selectedFile.name.split('.').pop()?.toLowerCase();
        const type = extension === 'xlsx' || extension === 'xls' ? 'xlsx' : 'csv';
        setFileType(type);

        if (type === 'xlsx') {
            parseXLSX(selectedFile);
        } else {
            parseCSV(selectedFile);
        }
    };

    const parseCSV = (file: File) => {
        Papa.parse(file, {
            complete: (results) => {
                const data = results.data as string[][];
                if (data.length > 0) {
                    // Filter out empty rows
                    const filteredData = data.filter(row => row.some(cell => cell && cell.trim()));
                    const detectedHeaders = filteredData[0] || [];
                    setHeaders(detectedHeaders);
                    setRawData(filteredData.slice(1));

                    // Auto-detect column mappings
                    const autoMappings = detectMappings(detectedHeaders);
                    setMappings(autoMappings);

                    setStep('mapping');
                }
            },
            error: (error) => {
                console.error('CSV parse error:', error);
            }
        });
    };

    const parseXLSX = async (file: File) => {
        try {
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });

            // Get first sheet
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];

            // Convert to JSON with header row
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as (string | number | null)[][];

            if (jsonData.length > 0) {
                // Find the actual header row (skip empty rows at start)
                let headerRowIndex = 0;
                for (let i = 0; i < Math.min(5, jsonData.length); i++) {
                    if (jsonData[i] && jsonData[i].some(cell => cell !== null && cell !== '')) {
                        headerRowIndex = i;
                        break;
                    }
                }

                const headers = (jsonData[headerRowIndex] || []).map(h => String(h || '').trim());
                const dataRows = jsonData.slice(headerRowIndex + 1).filter(row =>
                    row.some(cell => cell !== null && cell !== '')
                );

                setHeaders(headers);
                setRawData(dataRows.map(row => row.map(cell => cell !== null ? String(cell) : '')));

                // Auto-detect column mappings
                const autoMappings = detectMappings(headers);
                setMappings(autoMappings);

                setStep('mapping');
            }
        } catch (error) {
            console.error('XLSX parse error:', error);
        }
    };

    const detectMappings = (headers: string[]): ColumnMapping[] => {
        return headers.map(header => {
            const normalizedHeader = header.toLowerCase().trim();
            const crmField = AUTO_DETECT_MAP[normalizedHeader] || 'skip';
            return {
                excelColumn: header,
                crmField
            };
        });
    };

    const updateMapping = (index: number, crmField: string) => {
        const newMappings = [...mappings];
        newMappings[index] = { ...newMappings[index], crmField };
        setMappings(newMappings);
    };

    const checkDuplicates = async () => {
        // Get email/phone columns for duplicate detection
        const emailIdx = mappings.findIndex(m => m.crmField === 'email');
        const phoneIdx = mappings.findIndex(m => m.crmField === 'phone');

        if (emailIdx === -1 && phoneIdx === -1) {
            setStep('preview');
            return;
        }

        setIsProcessing(true);
        try {
            const res = await fetch('/api/crm/import/check-duplicates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    rows: rawData.map(row => ({
                        email: emailIdx >= 0 ? row[emailIdx] : null,
                        phone: phoneIdx >= 0 ? cleanPhone(row[phoneIdx]) : null
                    }))
                })
            });

            if (res.ok) {
                const data = await res.json();
                setDuplicates(data.duplicate_indices || []);
            }
        } catch (error) {
            console.error('Duplicate check error:', error);
        } finally {
            setIsProcessing(false);
            setStep('preview');
        }
    };

    const cleanPhone = (phone: string | undefined): string => {
        if (!phone) return '';
        return phone.replace(/[^\d+]/g, '').replace(/^0+/, '');
    };

    const handleImport = async () => {
        if (!file) return;

        setIsProcessing(true);
        setStep('importing');

        try {
            const res = await fetch('/api/crm/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    file_type: fileType,
                    headers,
                    mappings,
                    rows: rawData,
                    skip_duplicates: true,
                    duplicate_indices: duplicates
                })
            });

            if (res.ok) {
                const data = await res.json();
                setResults(data);
                setStep('complete');
                onComplete?.(data);
            } else {
                const error = await res.json();
                setResults({
                    total_rows: 0,
                    success_count: 0,
                    error_count: 1,
                    errors: [{ row: 0, field: 'general', message: error.error || 'Import failed' }],
                    skipped_duplicates: 0
                });
                setStep('complete');
            }
        } catch (error) {
            console.error('Import error:', error);
            setResults({
                total_rows: 0,
                success_count: 0,
                error_count: 1,
                errors: [{ row: 0, field: 'general', message: 'Network error' }],
                skipped_duplicates: 0
            });
            setStep('complete');
        } finally {
            setIsProcessing(false);
        }
    };

    const downloadTemplate = async (type: 'csv' | 'xlsx' = 'csv') => {
        try {
            const res = await fetch(`/api/crm/import/template?format=${type}`);
            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `crm_leads_template.${type}`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            }
        } catch (error) {
            console.error('Download error:', error);
        }
    };

    const reset = () => {
        setStep('upload');
        setFile(null);
        setFileType('csv');
        setRawData([]);
        setHeaders([]);
        setMappings([]);
        setDuplicates([]);
        setResults(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    if (!isOpen) return null;

    const previewData = rawData.slice(0, 50);

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                        <h2 className="text-lg font-bold text-text-primary">Import Leads</h2>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5 text-text-secondary" />
                        </button>
                    </div>

                    {/* Progress Steps */}
                    <div className="flex items-center justify-center gap-4 px-6 py-4 bg-slate-50 border-b border-slate-200">
                        {['upload', 'mapping', 'preview', 'importing', 'complete'].map((s, i) => (
                            <React.Fragment key={s}>
                                <div className={`flex items-center gap-2 ${
                                    step === s ? 'text-primary' :
                                    ['mapping', 'preview', 'importing', 'complete'].indexOf(step) > i ? 'text-success' : 'text-text-tertiary'
                                }`}>
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                                        step === s ? 'bg-primary text-white' :
                                        ['mapping', 'preview', 'importing', 'complete'].indexOf(step) > i ? 'bg-success text-white' : 'bg-slate-200'
                                    }`}>
                                        {['mapping', 'preview', 'importing', 'complete'].indexOf(step) > i ? (
                                            <CheckCircle className="w-4 h-4" />
                                        ) : i + 1}
                                    </div>
                                    <span className="text-sm font-medium capitalize">{s}</span>
                                </div>
                                {i < 4 && <div className="w-12 h-px bg-slate-200" />}
                            </React.Fragment>
                        ))}
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-6">
                        {step === 'upload' && (
                            <div className="space-y-6">
                                <div className="text-center">
                                    <h3 className="text-lg font-semibold text-text-primary mb-2">Upload Lead Data</h3>
                                    <p className="text-sm text-text-secondary">
                                        Upload a CSV or Excel file with your leads data. Maximum 5000 rows.
                                    </p>
                                </div>

                                <div
                                    onClick={() => fileInputRef.current?.click()}
                                    className="border-2 border-dashed border-slate-300 rounded-2xl p-12 text-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors"
                                >
                                    <Upload className="w-12 h-12 mx-auto mb-4 text-slate-400" />
                                    <p className="text-text-primary font-medium mb-2">
                                        Click to upload or drag and drop
                                    </p>
                                    <p className="text-sm text-text-secondary">
                                        CSV or Excel files (.csv, .xlsx)
                                    </p>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".csv,.xlsx,.xls"
                                        onChange={handleFileSelect}
                                        className="hidden"
                                    />
                                </div>

                                <div className="flex justify-center gap-4">
                                    <button
                                        onClick={() => downloadTemplate('csv')}
                                        className="flex items-center gap-2 text-primary text-sm font-medium hover:underline"
                                    >
                                        <FileText className="w-4 h-4" />
                                        Download CSV Template
                                    </button>
                                    <button
                                        onClick={() => downloadTemplate('xlsx')}
                                        className="flex items-center gap-2 text-primary text-sm font-medium hover:underline"
                                    >
                                        <FileSpreadsheet className="w-4 h-4" />
                                        Download Excel Template
                                    </button>
                                </div>
                            </div>
                        )}

                        {step === 'mapping' && (
                            <div className="space-y-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-lg font-semibold text-text-primary">Map Columns</h3>
                                        <p className="text-sm text-text-secondary mt-1">
                                            Match your file columns to CRM fields. Auto-detected mappings are highlighted.
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm bg-slate-100 px-3 py-1.5 rounded-lg">
                                        <FileSpreadsheet className="w-4 h-4 text-text-tertiary" />
                                        <span className="text-text-secondary">{file?.name}</span>
                                        <span className="text-text-tertiary">({rawData.length} rows)</span>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    {mappings.map((mapping, i) => (
                                        <div key={i} className="flex items-center gap-4 bg-slate-50 rounded-xl p-3">
                                            <div className="flex-1">
                                                <span className="font-medium text-text-primary">{mapping.excelColumn}</span>
                                            </div>
                                            <div className="text-text-tertiary">→</div>
                                            <select
                                                value={mapping.crmField}
                                                onChange={(e) => updateMapping(i, e.target.value)}
                                                className="flex-[2] px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                                            >
                                                {CRM_FIELDS.map(field => (
                                                    <option key={field.value} value={field.value}>
                                                        {field.label}
                                                    </option>
                                                ))}
                                            </select>
                                            {mapping.crmField !== 'skip' && (
                                                <CheckCircle className="w-5 h-5 text-green-500" />
                                            )}
                                        </div>
                                    ))}
                                </div>

                                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                                    <h4 className="font-medium text-blue-800 mb-2">Required Fields</h4>
                                    <p className="text-sm text-blue-700">
                                        At minimum, you need either: <strong>Email</strong> or <strong>Phone</strong>, plus <strong>Company Name</strong>.
                                    </p>
                                </div>
                            </div>
                        )}

                        {step === 'preview' && (
                            <div className="space-y-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-lg font-semibold text-text-primary">Preview & Validate</h3>
                                        <p className="text-sm text-text-secondary mt-1">
                                            Showing first 50 rows of {rawData.length} total rows
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm">
                                        <FileText className="w-4 h-4 text-text-tertiary" />
                                        <span className="text-text-secondary">{file?.name}</span>
                                    </div>
                                </div>

                                {duplicates.length > 0 && (
                                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                                        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                                        <div>
                                            <h4 className="font-medium text-amber-800">Potential Duplicates Found</h4>
                                            <p className="text-sm text-amber-700">
                                                {duplicates.length} leads may already exist in the CRM and will be skipped.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-slate-50">
                                                <th className="px-3 py-3 text-left text-xs font-medium text-text-secondary w-12">#</th>
                                                {mappings.filter(m => m.crmField !== 'skip').map((mapping, i) => (
                                                    <th key={i} className="px-3 py-3 text-left text-xs font-medium text-text-secondary">
                                                        {CRM_FIELDS.find(f => f.value === mapping.crmField)?.label || mapping.crmField}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {previewData.map((row, i) => {
                                                const isDuplicate = duplicates.includes(i);
                                                return (
                                                    <tr key={i} className={isDuplicate ? 'bg-amber-50' : ''}>
                                                        <td className="px-3 py-2 text-text-tertiary">
                                                            {i + 1}
                                                            {isDuplicate && <span className="ml-1 text-amber-600">*</span>}
                                                        </td>
                                                        {mappings.filter(m => m.crmField !== 'skip').map((mapping, j) => {
                                                            const colIdx = mappings.findIndex(m => m === mapping);
                                                            const value = row[colIdx] || '';
                                                            return (
                                                                <td key={j} className="px-3 py-2 text-text-primary max-w-[200px] truncate">
                                                                    {value}
                                                                </td>
                                                            );
                                                        })}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {step === 'importing' && (
                            <div className="text-center py-12">
                                <Loader2 className="w-16 h-16 mx-auto mb-4 text-primary animate-spin" />
                                <h3 className="text-lg font-semibold text-text-primary mb-2">Importing Leads...</h3>
                                <p className="text-sm text-text-secondary">
                                    Please wait while we process your data
                                </p>
                            </div>
                        )}

                        {step === 'complete' && results && (
                            <div className="space-y-6">
                                <div className="text-center">
                                    {results.success_count > 0 && results.error_count === 0 ? (
                                        <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
                                            <CheckCircle className="w-8 h-8 text-green-600" />
                                        </div>
                                    ) : results.error_count > 0 ? (
                                        <div className="w-16 h-16 mx-auto mb-4 bg-amber-100 rounded-full flex items-center justify-center">
                                            <AlertCircle className="w-8 h-8 text-amber-600" />
                                        </div>
                                    ) : (
                                        <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
                                            <AlertCircle className="w-8 h-8 text-red-600" />
                                        </div>
                                    )}
                                    <h3 className="text-lg font-semibold text-text-primary mb-2">
                                        {results.success_count > 0 && results.error_count === 0
                                            ? 'Import Complete!'
                                            : results.error_count > 0
                                                ? 'Import Completed with Errors'
                                                : 'Import Failed'}
                                    </h3>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div className="bg-slate-50 rounded-xl p-4 text-center">
                                        <p className="text-2xl font-bold text-text-primary">{results.total_rows}</p>
                                        <p className="text-sm text-text-secondary">Total Rows</p>
                                    </div>
                                    <div className="bg-green-50 rounded-xl p-4 text-center">
                                        <p className="text-2xl font-bold text-green-600">{results.success_count}</p>
                                        <p className="text-sm text-green-600">Imported</p>
                                    </div>
                                    <div className="bg-red-50 rounded-xl p-4 text-center">
                                        <p className="text-2xl font-bold text-red-600">{results.error_count}</p>
                                        <p className="text-sm text-red-600">Errors</p>
                                    </div>
                                </div>

                                {results.errors.length > 0 && (
                                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                                        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                                            <h4 className="font-medium text-text-primary">Errors</h4>
                                        </div>
                                        <div className="max-h-48 overflow-y-auto">
                                            {results.errors.slice(0, 20).map((error, i) => (
                                                <div key={i} className="px-4 py-2 border-b border-slate-100 text-sm">
                                                    <span className="text-text-tertiary">Row {error.row}:</span>{' '}
                                                    <span className="text-text-primary">{error.message}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50">
                        <div className="text-sm text-text-secondary">
                            {step === 'preview' && `${rawData.length - duplicates.length} leads to import`}
                            {step === 'complete' && results && `${results.success_count} leads imported successfully`}
                        </div>
                        <div className="flex items-center gap-3">
                            {step === 'upload' && (
                                <button
                                    onClick={onClose}
                                    className="px-6 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-text-secondary hover:bg-white transition-colors"
                                >
                                    Cancel
                                </button>
                            )}
                            {step === 'mapping' && (
                                <>
                                    <button
                                        onClick={reset}
                                        className="px-6 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-text-secondary hover:bg-white transition-colors"
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={checkDuplicates}
                                        disabled={isProcessing}
                                        className="px-6 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {isProcessing && <Loader2 className="w-4 h-4 animate-spin" />}
                                        Continue to Preview
                                    </button>
                                </>
                            )}
                            {step === 'preview' && (
                                <>
                                    <button
                                        onClick={() => setStep('mapping')}
                                        className="px-6 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-text-secondary hover:bg-white transition-colors"
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={handleImport}
                                        disabled={isProcessing}
                                        className="px-6 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {isProcessing && <Loader2 className="w-4 h-4 animate-spin" />}
                                        Import {rawData.length - duplicates.length} Leads
                                    </button>
                                </>
                            )}
                            {step === 'complete' && (
                                <>
                                    <button
                                        onClick={reset}
                                        className="px-6 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-text-secondary hover:bg-white transition-colors"
                                    >
                                        Import More
                                    </button>
                                    <button
                                        onClick={onClose}
                                        className="px-6 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors"
                                    >
                                        Done
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}