'use client';

import React, { useState, useEffect } from 'react';
import { Download, Upload, Plus, Settings, Loader2, Droplets, Coins, FileDown, Clock } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { Toast } from '@/frontend/components/ui/Toast';
import WaterLoggerCard from './WaterLoggerCard';
import WaterSourceConfigModal from './WaterSourceConfigModal';
import WaterTariffModal from './WaterTariffModal';
import WaterReadingHistory from './WaterReadingHistory';
import { useDataCache } from '@/frontend/context/DataCacheContext';

interface Props {
    propertyId: string;
}

interface Source {
    id: string;
    name: string;
    source_type: 'jar' | 'tanker';
    capacity_litres: number;
    water_tariffs: { id: string; rate_per_unit: number; effective_from: string }[];
}

export function WaterDashboard({ propertyId }: Props) {
    const { getCachedData, setCachedData } = useDataCache();
    const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
    
    const fetchKey = `dashboard-water-${propertyId}-${month}`;
    const initialCached = React.useMemo(() => getCachedData(fetchKey), [fetchKey]);

    const [sources, setSources] = useState<Source[]>(initialCached?.sources || []);
    const [readings, setReadings] = useState<any[]>(initialCached?.readings || []);
    const [loading, setLoading] = useState(!initialCached);
    const [uploading, setUploading] = useState(false);
    const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);
    
    // Modals
    const [showConfig, setShowConfig] = useState(false);
    const [showTariffs, setShowTariffs] = useState(false);
    const [showHistorySourceId, setShowHistorySourceId] = useState<string | null>(null);

    const fetchData = async (isInitial = false) => {
        if (isInitial && initialCached) {
            // We have initial cache, only show loading if we don't have it
        } else {
            setLoading(true);
        }
        try {
            const srcRes = await fetch(`/api/properties/${propertyId}/water/sources`);
            const readRes = await fetch(`/api/properties/${propertyId}/water/readings?month=${month}`);
            
            const srcData = await srcRes.json();
            const readData = await readRes.json();

            setSources(srcData);
            setReadings(readData);
            setCachedData(fetchKey, { sources: srcData, readings: readData });
        } catch (error) {
            console.error("Failed to fetch water data", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData(true);
    }, [propertyId, month]);

    const handleLogReading = async (sourceId: string, quantity: number, date: string) => {
        try {
            const res = await fetch(`/api/properties/${propertyId}/water/readings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    readings: [{
                        source_id: sourceId,
                        reading_date: date,
                        quantity: quantity
                    }] 
                })
            });

            if (!res.ok) throw new Error('Failed to save');
            setNotification({ message: 'Entry logged successfully', type: 'success' });
            fetchData();
        } catch (error) {
            setNotification({ message: 'Failed to save entry', type: 'error' });
        }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || !e.target.files[0]) return;
        setUploading(true);
        const formData = new FormData();
        formData.append('file', e.target.files[0]);

        try {
            const res = await fetch(`/api/properties/${propertyId}/water/import`, {
                method: 'POST',
                body: formData
            });
            if (!res.ok) throw new Error('Failed to import');
            const result = await res.json();
            setNotification({ message: `Successfully imported ${result.count} records`, type: 'success' });
            fetchData();
        } catch (error) {
            setNotification({ message: 'Failed to import CSV', type: 'error' });
        } finally {
            setUploading(false);
            e.target.value = ''; // Reset input
        }
    };

    const handleExport = async () => {
        try {
            const res = await fetch(`/api/properties/${propertyId}/water/export?month=${month}`);
            if (!res.ok) throw new Error('Failed to export');
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Water_Export_${month}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            setNotification({ message: 'Failed to export data', type: 'error' });
        }
    };

    const handleDownloadTemplate = async () => {
        try {
            const res = await fetch(`/api/properties/${propertyId}/water/import-template`);
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(errText || 'Failed to download template');
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Water_Import_Template.xlsx';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error: any) {
            setNotification({ message: error.message || 'Failed to download template', type: 'error' });
        }
    };

    // Calculate MTD totals
    let totalExpense = 0;
    sources.forEach(s => {
        totalExpense += readings.filter(r => r.source_id === s.id).reduce((sum, r) => sum + (r.computed_cost || 0), 0);
    });

    return (
        <div className="space-y-6">
            <Toast message={notification?.message || ''} type={notification?.type || 'info'} visible={!!notification} onClose={() => setNotification(null)} />
            
            {/* Action Buttons */}
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
                <div className="relative flex gap-2">
                    <div className="relative">
                        <input 
                            type="file" 
                            accept=".csv, .xlsx, .xls"
                            onChange={handleImport}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            disabled={uploading}
                        />
                        <Button variant="outline" className="w-full sm:w-auto h-9 rounded-full pointer-events-none" disabled={uploading}>
                            {uploading ? <Loader2 className="w-4 h-4 sm:mr-2 animate-spin" /> : <Upload className="w-4 h-4 sm:mr-2" />} <span className="hidden sm:inline">Import Data</span><span className="sm:hidden">Import</span>
                        </Button>
                    </div>
                    <Button variant="outline" onClick={handleDownloadTemplate} className="w-full sm:w-auto h-9 rounded-full" title="Download Excel Template">
                        <FileDown className="w-4 h-4 sm:mr-2 text-blue-600" /> <span className="hidden sm:inline">Template</span>
                    </Button>
                </div>
                <Button variant="outline" onClick={() => setShowHistorySourceId("ALL")} className="w-full sm:w-auto h-9 rounded-full">
                    <Clock className="w-4 h-4 sm:mr-2" /> <span className="hidden sm:inline">History</span><span className="sm:hidden">History</span>
                </Button>
                <Button variant="outline" onClick={() => setShowTariffs(true)} className="w-full sm:w-auto h-9 rounded-full text-emerald-700 border-emerald-200 hover:bg-emerald-50">
                    <Coins className="w-4 h-4 sm:mr-2 text-emerald-500" /> <span className="hidden sm:inline">Water Costs</span><span className="sm:hidden">Costs</span>
                </Button>
                <Button variant="outline" onClick={() => setShowConfig(true)} className="w-full sm:w-auto h-9 rounded-full">
                    <Settings className="w-4 h-4 sm:mr-2" /> <span className="hidden sm:inline">Configure Sources</span><span className="sm:hidden">Configure</span>
                </Button>
                <Button variant="outline" onClick={handleExport} className="w-full sm:w-auto h-9 rounded-full sm:ml-auto">
                    <Download className="w-4 h-4 sm:mr-2" /> <span className="hidden sm:inline">Export Excel</span><span className="sm:hidden">Export</span>
                </Button>
            </div>

            {/* Visualizer Widget */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-6 flex flex-col md:flex-row gap-6 sm:gap-8 items-center shadow-sm relative overflow-hidden">
                {/* Decorative background waves */}
                <div className="absolute bottom-0 left-0 right-0 h-16 opacity-10 pointer-events-none text-blue-500">
                    <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="w-full h-full">
                        <path d="M321.39,56.44c58-10.79,114.16-30.13,172-41.86,82.39-16.72,168.19-17.73,250.45-.39C823.78,31,906.67,72,985.66,92.83c70.05,18.48,146.53,26.09,214.34,3V120H0V95.8C59.71,118,130.85,116.14,188.75,101.44,233.15,90.26,278.43,74.52,321.39,56.44Z" fill="currentColor"></path>
                    </svg>
                </div>

                <div className="relative w-40 h-40 sm:w-48 sm:h-48 rounded-full border-8 border-slate-100 flex items-center justify-center overflow-hidden shrink-0 shadow-inner bg-slate-50">
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none px-2 text-center">
                        <span className="text-[10px] sm:text-xs font-bold text-blue-800 uppercase tracking-widest drop-shadow-md mb-1">MTD Expense</span>
                        <span className={`font-black text-slate-800 drop-shadow-md leading-tight ${
                            totalExpense.toLocaleString().length > 10 ? 'text-lg sm:text-xl' :
                            totalExpense.toLocaleString().length > 7 ? 'text-xl sm:text-2xl' :
                            'text-2xl sm:text-3xl'
                        }`}>
                            ₹{totalExpense.toLocaleString()}
                        </span>
                    </div>
                    {/* Animated Water Fill */}
                    <div className="absolute bottom-0 left-0 right-0 bg-blue-400 w-[200%] h-[200%] origin-bottom transition-all duration-1000" style={{ transform: 'translateY(40%)' }}>
                        <svg className="absolute top-0 w-full animate-[wave_6s_linear_infinite]" viewBox="0 0 1440 320" preserveAspectRatio="none" style={{ marginTop: '-40px', height: '40px' }}>
                            <path fill="#60a5fa" fillOpacity="1" d="M0,160L48,170.7C96,181,192,203,288,197.3C384,192,480,160,576,144C672,128,768,128,864,138.7C960,149,1056,171,1152,165.3C1248,160,1344,128,1392,112L1440,96L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path>
                        </svg>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4 flex-1 w-full z-10">
                    <div className="bg-white/80 backdrop-blur border border-blue-100 p-4 rounded-xl shadow-sm sm:max-w-xs">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Month Selection</h4>
                        <input 
                            type="month" 
                            value={month} 
                            onChange={(e) => setMonth(e.target.value)}
                            className="px-3 py-2 border rounded-lg text-sm font-medium w-full"
                        />
                    </div>
                </div>
            </div>

            {/* Loggers Grid */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-6 items-start">
                {sources.map(s => {
                    const totalUnits = readings.filter(r => r.source_id === s.id).reduce((sum, r) => sum + (r.quantity || 0), 0);
                    const cost = readings.filter(r => r.source_id === s.id).reduce((sum, r) => sum + (r.computed_cost || 0), 0);
                    
                    return (
                        <WaterLoggerCard 
                            key={s.id}
                            source={s}
                            mtdUnits={totalUnits}
                            mtdCost={cost}
                            onSave={handleLogReading}
                            onShowHistory={() => setShowHistorySourceId(s.id)}
                        />
                    );
                })}
                {sources.length === 0 && !loading && (
                    <div className="col-span-full py-12 text-center border-2 border-dashed border-slate-200 rounded-xl">
                        <p className="text-slate-400 font-bold">No water sources configured.</p>
                        <button onClick={() => setShowConfig(true)} className="mt-4 text-blue-600 font-bold hover:underline">Configure Sources</button>
                    </div>
                )}
            </div>

            {/* Modals */}
            <WaterSourceConfigModal 
                isOpen={showConfig}
                onClose={() => setShowConfig(false)}
                propertyId={propertyId}
                sources={sources}
                onSuccess={() => {
                    fetchData();
                }}
            />

            <WaterTariffModal 
                isOpen={showTariffs}
                onClose={() => setShowTariffs(false)}
                propertyId={propertyId}
                sources={sources}
                onSuccess={() => {
                    fetchData();
                }}
            />

            {/* Full Page History Overlay */}
            {showHistorySourceId && (
                <div className={`fixed inset-0 lg:ml-64 z-[60] bg-background animate-in slide-in-from-right duration-300 shadow-2xl border-l border-slate-300 overflow-y-auto`}>
                    <WaterReadingHistory
                        propertyId={propertyId}
                        initialSourceId={showHistorySourceId === 'ALL' ? null : showHistorySourceId}
                        onBack={() => setShowHistorySourceId(null)}
                        onDeleteSuccess={() => fetchData()}
                    />
                </div>
            )}

            <style jsx global>{`
                @keyframes wave {
                    0% { transform: translateX(0); }
                    100% { transform: translateX(-50%); }
                }
            `}</style>
        </div>
    );
}
