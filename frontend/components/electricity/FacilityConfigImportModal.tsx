'use client';

import React, { useState } from 'react';
import { Upload, X, CheckCircle, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';

interface FacilityConfigImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    propertyId: string;
    onSuccess: () => void;
    isDark?: boolean;
}

export default function FacilityConfigImportModal({ isOpen, onClose, propertyId, onSuccess, isDark = false }: FacilityConfigImportModalProps) {
    const [file, setFile] = useState<File | null>(null);
    const [parsedData, setParsedData] = useState<any[]>([]);
    const [isParsing, setIsParsing] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

        setFile(selectedFile);
        setIsParsing(true);
        setError(null);

        try {
            const buffer = await selectedFile.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });
            
            // Assume the first sheet is the template
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            
            // Convert to JSON
            const data: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            if (data.length < 2) throw new Error("File is empty or invalid format.");
            
            // Expected columns: [Sheet Name, Location Group, Meter Name, Unit]
            const headers = data[0].map((h: string) => h?.toString().toLowerCase().trim());
            
            const rows = data.slice(1).filter(row => row.length > 0 && row[0]);
            
            const structuredData = rows.map(row => ({
                sheetName: row[0]?.toString().trim() || 'Unnamed Sheet',
                locationGroup: row[1]?.toString().trim() || 'Default Group',
                meterName: row[2]?.toString().trim() || 'Unknown Meter',
                unit: row[3]?.toString().trim() || 'kWh',
                meterConstant: 1.0 // Defaulting to 1.0, user manages it later
            }));

            // Convert to Hierarchy format: [{ sheetName, groups: [{ locationName, meters: [] }] }]
            const hierarchyMap = new Map();

            structuredData.forEach(item => {
                if (!hierarchyMap.has(item.sheetName)) {
                    hierarchyMap.set(item.sheetName, new Map());
                }
                const sheetMap = hierarchyMap.get(item.sheetName);
                
                if (!sheetMap.has(item.locationGroup)) {
                    sheetMap.set(item.locationGroup, []);
                }
                const metersArr = sheetMap.get(item.locationGroup);
                
                metersArr.push({
                    name: item.meterName,
                    unit: item.unit,
                    meterConstant: item.meterConstant
                });
            });

            // Convert Maps to Arrays
            const finalHierarchy = Array.from(hierarchyMap.entries()).map(([sheetName, groupsMap]) => ({
                sheetName,
                groups: Array.from((groupsMap as Map<string, any[]>).entries()).map(([locationName, meters]) => ({
                    locationName,
                    meters
                }))
            }));

            setParsedData(finalHierarchy);

        } catch (err: any) {
            setError(err.message || "Failed to parse file.");
        } finally {
            setIsParsing(false);
        }
    };

    const handleSubmit = async () => {
        if (parsedData.length === 0) return;
        
        setIsSubmitting(true);
        setError(null);

        try {
            const res = await fetch(`/api/properties/${propertyId}/facility-meters/bulk-config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hierarchy: parsedData })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to save configuration');
            }

            onSuccess();
            onClose();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const downloadTemplate = () => {
        const wb = XLSX.utils.book_new();
        const ws_data = [
            ['Sheet Name', 'Location Group', 'Meter Name', 'Unit'],
            ['Floor Panel', 'Ground Floor', 'AC Panel', 'kWh'],
            ['Floor Panel', 'Ground Floor', 'LTP Panel', 'kWh'],
            ['Transformer', 'Main Grid', 'TX-1', 'kVA']
        ];
        const ws = XLSX.utils.aoa_to_sheet(ws_data);
        XLSX.utils.book_append_sheet(wb, ws, "Template");
        XLSX.writeFile(wb, "Facility_Meters_Template.xlsx");
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={`w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${isDark ? 'bg-[#161b22] border border-[#30363d]' : 'bg-white border border-slate-200'}`}
                >
                    <div className={`flex items-center justify-between p-4 border-b ${isDark ? 'border-[#30363d]' : 'border-slate-200'}`}>
                        <h2 className={`text-lg font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>Import Meter Configuration</h2>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-[#21262d] text-slate-500">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="p-6 overflow-y-auto">
                        {!file ? (
                            <div className="space-y-6">
                                <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                                    Upload a CSV or Excel file containing your meter structure. To ensure a successful import, please use our template.
                                </p>
                                
                                <button 
                                    onClick={downloadTemplate}
                                    className="text-primary text-sm font-bold hover:underline"
                                >
                                    Download Template File
                                </button>

                                <label className={`flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${isDark ? 'border-[#30363d] bg-[#0d1117] hover:bg-[#21262d]' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'}`}>
                                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                        <Upload className="w-10 h-10 mb-3 text-slate-400" />
                                        <p className="mb-2 text-sm text-slate-500"><span className="font-semibold">Click to upload</span> or drag and drop</p>
                                        <p className="text-xs text-slate-500">XLSX, CSV up to 10MB</p>
                                    </div>
                                    <input type="file" className="hidden" accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" onChange={handleFileChange} />
                                </label>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {isParsing ? (
                                    <div className="text-center py-12">Parsing file...</div>
                                ) : error ? (
                                    <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg flex items-start gap-3">
                                        <AlertTriangle className="w-5 h-5 shrink-0" />
                                        <p className="text-sm">{error}</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-lg">
                                            <CheckCircle className="w-5 h-5" />
                                            <span className="font-bold text-sm">Successfully parsed {parsedData.length} Sheets</span>
                                        </div>

                                        <div className={`border rounded-lg overflow-hidden ${isDark ? 'border-[#30363d]' : 'border-slate-200'}`}>
                                            <div className="max-h-60 overflow-y-auto p-4 space-y-4 text-sm">
                                                {parsedData.map((sheet, idx) => (
                                                    <div key={idx} className="space-y-2">
                                                        <div className="font-bold text-primary">📁 {sheet.sheetName}</div>
                                                        <div className="pl-4 space-y-2">
                                                            {sheet.groups.map((group: any, gIdx: number) => (
                                                                <div key={gIdx}>
                                                                    <div className={`font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>└─ {group.locationName}</div>
                                                                    <div className="pl-6 flex flex-wrap gap-2 mt-1">
                                                                        {group.meters.map((meter: any, mIdx: number) => (
                                                                            <span key={mIdx} className={`px-2 py-1 rounded-md text-xs border ${isDark ? 'bg-[#21262d] border-[#30363d]' : 'bg-slate-100 border-slate-200'}`}>
                                                                                {meter.name}
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className={`p-4 border-t flex justify-end gap-3 ${isDark ? 'border-[#30363d] bg-[#161b22]' : 'border-slate-200 bg-slate-50'}`}>
                        <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-300">
                            Cancel
                        </button>
                        <button 
                            onClick={handleSubmit}
                            disabled={!file || parsedData.length === 0 || isSubmitting || !!error}
                            className="px-6 py-2 text-sm font-bold text-white bg-primary rounded-lg shadow-lg shadow-primary/20 hover:bg-primary/90 disabled:opacity-50"
                        >
                            {isSubmitting ? 'Saving...' : 'Confirm & Build Hierarchy'}
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
