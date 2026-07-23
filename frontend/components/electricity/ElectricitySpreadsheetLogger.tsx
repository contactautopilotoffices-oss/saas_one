'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Save, Calendar, ArrowRight, Activity, Download, Upload, X, Plus, Trash2, Settings, LayoutTemplate } from 'lucide-react';
import { motion } from 'framer-motion';
import FacilityConfigImportModal from './FacilityConfigImportModal';

interface Meter {
    id: string;
    name: string;
    unit: string;
    meter_constant: number;
}

interface Group {
    id: string;
    name: string;
    meters: Meter[];
}

interface Category {
    id: string;
    name: string;
    groups: Group[];
}

interface Reading {
    meter_id: string;
    reading_date: string;
    initial_reading: number | string | null;
    final_reading: number | string | null;
    consumption: number | null;
    meter_constant_used: number;
    is_rollover: boolean;
}

export default function ElectricitySpreadsheetLogger({ propertyId, isDark = false }: { propertyId: string, isDark?: boolean }) {
    const [month, setMonth] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    
    const [categories, setCategories] = useState<Category[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    const [editingEntity, setEditingEntity] = useState<{ id: string, type: 'sheet' | 'group' | 'meter', currentName: string } | null>(null);
    const [readings, setReadings] = useState<Record<string, Record<string, Reading>>>({}); // { '2026-06-01': { 'meter-1': Reading } }
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isMigrating, setIsMigrating] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);

    // Custom Modal State
    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        title: string;
        fields: { name: string; label: string; type: string; defaultValue?: string; placeholder?: string }[];
        onSubmit: (values: Record<string, string>) => void;
    } | null>(null);

    // Generate days of the month
    const daysInMonth = useMemo(() => {
        const [year, m] = month.split('-');
        const date = new Date(parseInt(year), parseInt(m), 0);
        const days = [];
        for (let i = 1; i <= date.getDate(); i++) {
            const d = new Date(parseInt(year), parseInt(m) - 1, i);
            const dateStr = `${year}-${m}-${String(i).padStart(2, '0')}`;
            days.push({ 
                dateStr, 
                dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
                dateNum: i
            });
        }
        return days;
    }, [month]);

    const activeCategory = useMemo(() => categories.find(c => c.id === activeTabId), [categories, activeTabId]);

    const fetchConfig = async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/properties/${propertyId}/facility-meters`);
            const data = await res.json();
            if (Array.isArray(data)) {
                setCategories(data);
                if (data.length > 0) {
                    setActiveTabId(prev => {
                        if (prev && data.some(c => c.id === prev)) return prev;
                        return data[0].id;
                    });
                }
            } else {
                console.error("API did not return an array:", data);
                setCategories([]);
            }
        } catch (error) {
            console.error("Error fetching config", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchConfig();
    }, [propertyId]);

    useEffect(() => {
        const fetchReadings = async () => {
            if (!activeTabId) return;
            setIsLoading(true);
            try {
                const res = await fetch(`/api/properties/${propertyId}/facility-readings?month=${month}&categoryId=${activeTabId}`);
                const data: Reading[] = await res.json();
                
                const newReadings: Record<string, Record<string, Reading>> = {};
                daysInMonth.forEach(day => newReadings[day.dateStr] = {});
                
                data.forEach(r => {
                    if (!newReadings[r.reading_date]) newReadings[r.reading_date] = {};
                    newReadings[r.reading_date][r.meter_id] = r;
                });
                
                // Carry-forward logic: populate missing INITIAL readings linearly across the month
                // This ensures if a day is skipped, the next day's INITIAL perfectly matches the last recorded FINAL
                const lastKnownFinal: Record<string, number> = {};
                
                // First, try to seed lastKnownFinal from previous month's data (which the API now includes)
                data.forEach(r => {
                    if (r.reading_date < month + '-01' && r.final_reading !== null) {
                        lastKnownFinal[r.meter_id] = Number(r.final_reading);
                    }
                });

                // Iterate chronologically through the current month
                daysInMonth.forEach(day => {
                    activeCategory?.groups.forEach(grp => {
                        grp.meters.forEach(m => {
                            const existingRecord = newReadings[day.dateStr][m.id];
                            
                            if (existingRecord) {
                                // If reading exists but has no initial, populate it
                                if (existingRecord.initial_reading === null && lastKnownFinal[m.id] !== undefined) {
                                    existingRecord.initial_reading = lastKnownFinal[m.id];
                                }
                                // Update tracker for the next day
                                if (existingRecord.final_reading !== null) {
                                    lastKnownFinal[m.id] = Number(existingRecord.final_reading);
                                } else {
                                    // If there's an existing record but no final reading, we still want to carry forward
                                    // the last known final to the next day's initial reading, so we don't delete it.
                                }
                            } else {
                                // If reading row is totally empty, inject a 'ghost' record just to show the initial reading!
                                if (lastKnownFinal[m.id] !== undefined) {
                                    newReadings[day.dateStr][m.id] = {
                                        meter_id: m.id,
                                        reading_date: day.dateStr,
                                        initial_reading: lastKnownFinal[m.id],
                                        final_reading: null,
                                        consumption: null,
                                        meter_constant_used: m.meter_constant,
                                        is_rollover: false
                                    };
                                    // Do not delete lastKnownFinal, allow it to carry forward to subsequent missing days
                                }
                            }
                        });
                    });
                });
                
                setReadings(newReadings);
                
                // Auto-scroll to today
                setTimeout(() => {
                    const todayStr = new Date().toISOString().split('T')[0];
                    const todayRow = document.getElementById(`row-${todayStr}`);
                    if (todayRow) {
                        todayRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 300);

            } catch (error) {
                console.error("Error fetching readings", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchReadings();
    }, [propertyId, activeTabId, month, daysInMonth]);

    const handleValueChange = (dateStr: string, meterId: string, field: 'initial_reading' | 'final_reading', valueStr: string, meterConstant: number) => {
        const val = valueStr === '' ? null : valueStr;
        setReadings(prev => {
            const newState = { ...prev };
            if (!newState[dateStr]) newState[dateStr] = {};
            
            const currentReading = newState[dateStr][meterId] || {
                meter_id: meterId,
                reading_date: dateStr,
                initial_reading: null,
                final_reading: null,
                consumption: null,
                meter_constant_used: meterConstant,
                is_rollover: false
            };
            
            const updatedReading = { ...currentReading, [field]: val };
            
            // Auto calculate consumption
            if (updatedReading.initial_reading !== null && updatedReading.initial_reading !== '' && updatedReading.final_reading !== null && updatedReading.final_reading !== '') {
                const initVal = typeof updatedReading.initial_reading === 'string' ? parseFloat(updatedReading.initial_reading) : updatedReading.initial_reading;
                const finalVal = typeof updatedReading.final_reading === 'string' ? parseFloat(updatedReading.final_reading) : updatedReading.final_reading;
                
                if (!isNaN(initVal) && !isNaN(finalVal)) {
                    let diff = finalVal - initVal;
                    if (diff < 0) {
                        updatedReading.is_rollover = true; // Auto-detect rollover edge case
                    } else {
                        updatedReading.is_rollover = false;
                        updatedReading.consumption = Number((diff * updatedReading.meter_constant_used).toFixed(2));
                    }
                } else {
                    updatedReading.consumption = null;
                }
            } else {
                updatedReading.consumption = null;
            }
            
            newState[dateStr][meterId] = updatedReading;
            
            // Auto fill next day's initial reading if modifying today's final reading
            if (field === 'final_reading') {
                const currDate = new Date(dateStr);
                currDate.setDate(currDate.getDate() + 1);
                const nextDateStr = currDate.toISOString().split('T')[0];
                
                if (newState[nextDateStr]) {
                    const nextDay = newState[nextDateStr][meterId] || {
                        meter_id: meterId,
                        reading_date: nextDateStr,
                        initial_reading: null,
                        final_reading: null,
                        consumption: null,
                        meter_constant_used: meterConstant,
                        is_rollover: false
                    };
                    
                    nextDay.initial_reading = val;
                    if (nextDay.final_reading !== null && nextDay.final_reading !== '') {
                        const initVal = val !== null && val !== '' ? parseFloat(val as string) : NaN;
                        const finalVal = typeof nextDay.final_reading === 'string' ? parseFloat(nextDay.final_reading) : nextDay.final_reading;
                        
                        if (!isNaN(initVal) && !isNaN(finalVal)) {
                            const diff = finalVal - initVal;
                            nextDay.consumption = diff >= 0 ? Number((diff * nextDay.meter_constant_used).toFixed(2)) : null;
                        } else {
                            nextDay.consumption = null;
                        }
                    } else {
                        nextDay.consumption = null;
                    }
                    newState[nextDateStr][meterId] = nextDay;
                }
            }
            
            return newState;
        });
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const payload: Reading[] = [];
            Object.values(readings).forEach(dayObj => {
                Object.values(dayObj).forEach(reading => {
                    if (reading.initial_reading !== null && reading.initial_reading !== '' && reading.final_reading !== null && reading.final_reading !== '') {
                        payload.push({
                            ...reading,
                            initial_reading: typeof reading.initial_reading === 'string' ? parseFloat(reading.initial_reading) : reading.initial_reading,
                            final_reading: typeof reading.final_reading === 'string' ? parseFloat(reading.final_reading) : reading.final_reading,
                        });
                    }
                });
            });
            
            if (payload.length === 0) {
                alert("No data to save.");
                return;
            }

            const res = await fetch(`/api/properties/${propertyId}/facility-readings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ readings: payload })
            });
            
            if (!res.ok) throw new Error("Save failed");
            alert("Saved successfully!");
        } catch (error) {
            console.error("Save error", error);
            alert("Error saving data");
        } finally {
            setIsSaving(false);
        }
    };

    const handleMigrateLegacy = async () => {
        if (!confirm("This will automatically copy all your existing electricity meters and historical readings into the new spreadsheet. Continue?")) return;
        setIsMigrating(true);
        try {
            const res = await fetch(`/api/properties/${propertyId}/facility-meters/migrate-legacy`, { method: 'POST' });
            if (!res.ok) {
                const text = await res.text();
                try {
                    const err = JSON.parse(text);
                    throw new Error(err.error || 'Failed to migrate');
                } catch (e) {
                    throw new Error(`Server returned error: ${res.status}. Output: ${text.substring(0, 100)}...`);
                }
            }
            const data = await res.json();
            alert(`Migration Successful! Migrated ${data.count} meters and ${data.readingCount} historical readings.`);
            fetchConfig(); // Reload the UI to show the new data
        } catch (error: any) {
            console.error("Migration error", error);
            alert(`Migration failed: ${error.message}`);
        } finally {
            setIsMigrating(false);
        }
    };

    const handleEditConstant = async (meter: Meter) => {
        setModalConfig({
            isOpen: true,
            title: `Update Constant for ${meter.name}`,
            fields: [
                { name: 'meterConstant', label: 'New Meter Constant', type: 'number', defaultValue: String(meter.meter_constant) }
            ],
            onSubmit: async (values) => {
                const parsed = parseFloat(values.meterConstant);
                if (isNaN(parsed) || parsed <= 0) {
                    alert("Invalid meter constant.");
                    return;
                }
                try {
                    const res = await fetch(`/api/properties/${propertyId}/facility-meters`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ meterId: meter.id, meterConstant: parsed })
                    });
                    if (!res.ok) throw new Error("Failed to update meter constant");
                    fetchConfig(); 
                    
                    setReadings(prev => {
                        const newState = { ...prev };
                        Object.keys(newState).forEach(dateStr => {
                            if (newState[dateStr][meter.id]) {
                                const reading = { ...newState[dateStr][meter.id] };
                                reading.meter_constant_used = parsed;
                                if (reading.initial_reading !== null && reading.final_reading !== null) {
                                    let diff = Number(reading.final_reading) - Number(reading.initial_reading);
                                    if (diff >= 0) {
                                        reading.consumption = Number((diff * parsed).toFixed(2));
                                        reading.is_rollover = false;
                                    } else {
                                        reading.is_rollover = true;
                                    }
                                }
                                newState[dateStr] = { ...newState[dateStr], [meter.id]: reading };
                            }
                        });
                        return newState;
                    });
                } catch (error) {
                    console.error(error);
                    alert("Error updating meter constant.");
                }
            }
        });
    };

    const handleAddMeter = (groupId: string, groupName: string) => {
        setModalConfig({
            isOpen: true,
            title: `Add Meter to '${groupName}'`,
            fields: [
                { name: 'meterName', label: 'Meter Name', type: 'text', placeholder: 'e.g., HVAC Chiller' },
                { name: 'meterConstant', label: 'Meter Constant (MF)', type: 'number', defaultValue: '1' }
            ],
            onSubmit: async (values) => {
                const { meterName, meterConstant: mfStr } = values;
                if (!meterName) return;
                
                const meterConstant = parseFloat(mfStr || '1');
                if (isNaN(meterConstant) || meterConstant <= 0) {
                    alert("Invalid meter constant.");
                    return;
                }

                try {
                    const res = await fetch(`/api/properties/${propertyId}/facility-meters`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'add_meter', groupId, meterName, meterConstant })
                    });
                    
                    if (!res.ok) {
                        const err = await res.json();
                        throw new Error(err.error || "Failed to add meter");
                    }
                    fetchConfig(); 
                } catch (error: any) {
                    console.error(error);
                    alert(error.message || "Error adding meter.");
                }
            }
        });
    };

    const handleAddSheet = () => {
        setModalConfig({
            isOpen: true,
            title: `Create New Sheet`,
            fields: [
                { name: 'sheetName', label: 'Sheet Name', type: 'text', placeholder: 'e.g., Gas Meters' }
            ],
            onSubmit: async (values) => {
                const { sheetName } = values;
                if (!sheetName) return;
                try {
                    const res = await fetch(`/api/properties/${propertyId}/facility-meters`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'add_sheet', sheetName })
                    });
                    if (!res.ok) throw new Error("Failed to add sheet");
                    fetchConfig(); 
                } catch (error: any) {
                    alert("Error adding sheet.");
                }
            }
        });
    };

    const handleAddLocation = (categoryId: string, categoryName: string) => {
        setModalConfig({
            isOpen: true,
            title: `Add Location to '${categoryName}'`,
            fields: [
                { name: 'locationName', label: 'Location Name', type: 'text', placeholder: 'e.g., North Wing' }
            ],
            onSubmit: async (values) => {
                const { locationName } = values;
                if (!locationName) return;
                try {
                    const res = await fetch(`/api/properties/${propertyId}/facility-meters`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'add_location', categoryId, locationName })
                    });
                    if (!res.ok) throw new Error("Failed to add location");
                    fetchConfig(); 
                } catch (error: any) {
                    alert("Error adding location.");
                }
            }
        });
    };

    const handleDelete = async (action: 'delete_sheet' | 'delete_location' | 'delete_meter', id: string, name: string) => {
        if (!window.confirm(`Are you sure you want to permanently delete '${name}'? This will also remove any underlying data.`)) return;
        
        try {
            const res = await fetch(`/api/properties/${propertyId}/facility-meters?action=${action}&id=${id}`, {
                method: 'DELETE'
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || `Failed to delete ${name}`);
            }
            fetchConfig();
        } catch (error: any) {
            alert(error.message);
        }
    };

    const handleRenameSubmit = async (newName: string) => {
        if (!editingEntity || !newName.trim() || newName.trim() === editingEntity.currentName) {
            setEditingEntity(null);
            return;
        }

        const actionMap = {
            'sheet': 'rename_sheet',
            'group': 'rename_group',
            'meter': 'rename_meter'
        };

        try {
            const res = await fetch(`/api/properties/${propertyId}/facility-meters`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: actionMap[editingEntity.type],
                    targetId: editingEntity.id,
                    newName: newName.trim()
                })
            });
            
            if (!res.ok) throw new Error("Rename failed");
            await fetchConfig();
        } catch (error: any) {
            alert("Error renaming.");
        } finally {
            setEditingEntity(null);
        }
    };

    if (isLoading && categories.length === 0) {
        return <div className="p-12 text-center">Loading Spreadsheet...</div>;
    }

    if (categories.length === 0) {
        return (
            <div className={`p-12 text-center rounded-2xl border ${isDark ? 'bg-[#161b22] border-[#30363d]' : 'bg-white border-slate-200'}`}>
                <h3 className="text-xl font-bold mb-2">No Spreadsheet Configured</h3>
                <p className="text-slate-500 mb-6">Import a configuration CSV to set up the facility meters, or automatically migrate your existing loggers.</p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mx-auto">
                    <button 
                        onClick={() => setShowImportModal(true)}
                        className="px-6 py-3 bg-primary text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors"
                    >
                        <Upload className="w-5 h-5" /> Import Config
                    </button>
                    
                    <button 
                        onClick={handleMigrateLegacy}
                        disabled={isMigrating}
                        className="px-6 py-3 bg-white border border-slate-200 text-slate-700 dark:bg-[#21262d] dark:border-[#30363d] dark:text-slate-200 font-bold rounded-xl shadow-sm flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-[#30363d] disabled:opacity-50"
                    >
                        {isMigrating ? <Activity className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                        Migrate Old Data
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={`flex flex-col h-[calc(100vh-120px)] min-h-[400px] rounded-2xl overflow-hidden border ${isDark ? 'bg-[#0d1117] border-[#30363d]' : 'bg-slate-50 border-slate-200'}`}>
            
            {/* Unified Custom Modal */}
            {modalConfig?.isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <form 
                        onSubmit={(e) => {
                            e.preventDefault();
                            const formData = new FormData(e.currentTarget);
                            const values: Record<string, string> = {};
                            modalConfig.fields.forEach(f => values[f.name] = formData.get(f.name) as string);
                            modalConfig.onSubmit(values);
                            setModalConfig(null);
                        }}
                        className={`p-6 rounded-2xl shadow-xl w-full max-w-md ${isDark ? 'bg-[#161b22] border border-[#30363d]' : 'bg-white'}`}
                    >
                        <h3 className={`text-lg font-bold mb-4 ${isDark ? 'text-white' : 'text-slate-900'}`}>{modalConfig.title}</h3>
                        <div className="space-y-4">
                            {modalConfig.fields.map(field => (
                                <div key={field.name}>
                                    <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{field.label}</label>
                                    <input 
                                        name={field.name}
                                        type={field.type} 
                                        defaultValue={field.defaultValue}
                                        placeholder={field.placeholder}
                                        step="any"
                                        required
                                        className={`w-full px-4 py-2 rounded-lg border focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all ${
                                            isDark 
                                            ? 'bg-[#0d1117] border-[#30363d] text-white placeholder-slate-600' 
                                            : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'
                                        }`}
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="mt-6 flex justify-end gap-3">
                            <button type="button" onClick={() => setModalConfig(null)} className={`px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-slate-100 text-slate-600'}`}>Cancel</button>
                            <button type="submit" className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium transition-colors shadow-sm">Save</button>
                        </div>
                    </form>
                </div>
            )}

            {/* Header / Controls */}
            <div className={`p-4 border-b flex items-center justify-between ${isDark ? 'bg-[#161b22] border-[#30363d]' : 'bg-white border-slate-200'}`}>
                <div className="flex items-center gap-4">
                    
                    <button
                        onClick={() => setShowImportModal(true)}
                        className={`px-3 py-2 rounded-lg font-bold text-sm whitespace-nowrap transition-colors flex items-center gap-1 border border-dashed ${
                            isDark ? 'border-primary/50 text-primary hover:text-white hover:bg-primary/20' : 'border-primary/30 text-primary hover:bg-primary/10'
                        }`}
                        title="Bulk Import Spreadsheet Layout from CSV"
                    >
                        <LayoutTemplate className="w-4 h-4" />
                        Import Layout
                    </button>
                    
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${isDark ? 'bg-[#0d1117] border-[#30363d]' : 'bg-slate-50 border-slate-200'}`}>
                        <Calendar className="w-4 h-4 text-slate-500" />
                        <input 
                            type="month" 
                            value={month}
                            onChange={(e) => setMonth(e.target.value)}
                            className="bg-transparent text-sm font-bold focus:outline-none"
                        />
                    </div>
                </div>

                <button 
                    onClick={handleSave}
                    disabled={isSaving}
                    className="px-6 py-2 bg-emerald-500 text-white font-bold rounded-lg shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                    {isSaving ? <Activity className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Readings
                </button>
            </div>

            {/* Spreadsheet Grid */}
            <div className="flex-1 overflow-auto relative">
                {isLoading ? (
                    <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-50">
                        <Activity className="w-8 h-8 text-primary animate-spin" />
                    </div>
                ) : null}
                
                <table className="w-full border-collapse min-w-max text-sm">
                    <thead className={`sticky top-0 z-40 ${isDark ? 'bg-[#161b22] text-slate-200' : 'bg-white text-slate-700'} shadow-sm`}>
                        {/* Group Header Row */}
                        <tr>
                            <th colSpan={2} className={`sticky left-0 z-50 border-r border-b p-2 ${isDark ? 'bg-[#161b22] border-[#30363d]' : 'bg-white border-slate-200'}`}>
                                {activeCategory && (
                                    <button 
                                        onClick={() => handleAddLocation(activeCategory.id, activeCategory.name)}
                                        className={`text-[10px] uppercase font-bold px-2 py-1.5 rounded border border-dashed flex items-center justify-center gap-1.5 mx-auto transition-colors ${isDark ? 'border-slate-600 text-slate-400 hover:text-white hover:border-slate-400' : 'border-slate-300 text-slate-500 hover:text-emerald-600 hover:border-emerald-500 hover:bg-emerald-50'}`}
                                        title="Create a new meter grouping"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                        Add Group
                                    </button>
                                )}
                            </th>
                            {activeCategory?.groups.map(grp => (
                                <th key={grp.id} colSpan={Math.max(grp.meters.length * 3, 3)} className={`border-r border-b p-2 text-center text-sm font-black tracking-wider ${isDark ? 'bg-[#161b22] border-[#30363d] text-white' : 'bg-slate-100/50 border-slate-200 text-black'}`}>
                                    <div className="flex items-center justify-center gap-2 uppercase group/grp relative">
                                        {editingEntity?.id === grp.id ? (
                                            <input 
                                                autoFocus
                                                defaultValue={grp.name}
                                                onBlur={(e) => handleRenameSubmit(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit(e.currentTarget.value)}
                                                className={`text-center bg-transparent border-b outline-none ${isDark ? 'border-emerald-500/50 text-white' : 'border-emerald-500 text-black'}`}
                                            />
                                        ) : (
                                            <span 
                                                onDoubleClick={() => setEditingEntity({ id: grp.id, type: 'group', currentName: grp.name })}
                                                className="cursor-text"
                                                title="Double-click to rename"
                                            >
                                                {grp.name}
                                            </span>
                                        )}
                                        <button 
                                            onClick={() => handleAddMeter(grp.id, grp.name)} 
                                            className={`p-1 rounded-md border shadow-sm transition-colors flex items-center justify-center ${isDark ? 'bg-[#21262d] border-slate-700 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50' : 'bg-white border-slate-200 text-emerald-600 hover:bg-emerald-50 hover:border-emerald-300'}`}
                                            title={`Add new Meter to ${grp.name}`}
                                        >
                                            <Plus className="w-3.5 h-3.5" />
                                        </button>
                                        <button 
                                            onClick={() => handleDelete('delete_location', grp.id, grp.name)} 
                                            className={`p-1 rounded-md border shadow-sm transition-colors flex items-center justify-center ${isDark ? 'bg-[#21262d] border-slate-700 text-red-400 hover:bg-red-500/20 hover:border-red-500/50' : 'bg-white border-slate-200 text-red-500 hover:bg-red-50 hover:border-red-300'}`}
                                            title={`Delete Group '${grp.name}'`}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </th>
                            ))}
                        </tr>
                        {/* Meter Header Row */}
                        <tr>
                            <th colSpan={2} className={`sticky left-0 z-50 border-r border-b p-2 ${isDark ? 'bg-[#161b22] border-[#30363d]' : 'bg-white border-slate-200'}`}></th>
                            {activeCategory?.groups.map(grp => (
                                grp.meters.map(meter => (
                                    <th key={meter.id} colSpan={3} className={`border-r border-b p-1 text-center font-bold bg-blue-500/5 border-blue-500/20 whitespace-nowrap`}>
                                        <div className="flex flex-col items-center group/meter">
                                            <div className="flex items-center gap-1.5">
                                                {editingEntity?.id === meter.id ? (
                                                    <input 
                                                        autoFocus
                                                        defaultValue={meter.name}
                                                        onBlur={(e) => handleRenameSubmit(e.target.value)}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit(e.currentTarget.value)}
                                                        className={`text-center text-[13px] leading-tight font-black bg-transparent border-b outline-none w-24 ${isDark ? 'border-emerald-500/50 text-white' : 'border-emerald-500 text-black'}`}
                                                    />
                                                ) : (
                                                    <span 
                                                        onDoubleClick={() => setEditingEntity({ id: meter.id, type: 'meter', currentName: meter.name })}
                                                        className={`text-[13px] leading-tight font-black cursor-text ${isDark ? 'text-white' : 'text-black'}`}
                                                        title="Double-click to rename"
                                                    >
                                                        {meter.name}
                                                    </span>
                                                )}
                                                <button 
                                                    onClick={() => handleDelete('delete_meter', meter.id, meter.name)}
                                                    className={`p-0.5 rounded border shadow-sm transition-colors opacity-0 group-hover:opacity-100 flex items-center justify-center ${isDark ? 'bg-[#21262d] border-slate-700 text-red-400 hover:bg-red-500/20' : 'bg-white border-slate-200 text-red-500 hover:bg-red-50'}`}
                                                    title={`Delete Meter '${meter.name}'`}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            </div>
                                            <button 
                                                onClick={() => handleEditConstant(meter)}
                                                className="mt-1 flex items-center justify-center gap-1 text-[9px] font-semibold tracking-wide bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/30 px-1.5 py-0.5 rounded transition-colors hover:bg-blue-100 dark:hover:bg-blue-500/20"
                                                title={`Edit Meter Constant for ${meter.name}`}
                                            >
                                                <Settings className="w-2.5 h-2.5" />
                                                MF: {meter.meter_constant}
                                            </button>
                                        </div>
                                    </th>
                                ))
                            ))}
                        </tr>
                        {/* Columns Header Row */}
                        <tr>
                            <th className={`sticky left-0 z-50 border-r border-b p-1 w-20 text-center text-[10px] ${isDark ? 'bg-[#161b22] border-[#30363d]' : 'bg-white border-slate-200'}`}>Date</th>
                            <th className={`sticky left-[80px] z-50 border-r border-b p-1 w-12 text-center text-[10px] ${isDark ? 'bg-[#161b22] border-[#30363d]' : 'bg-white border-slate-200'}`}>Day</th>
                            {activeCategory?.groups.map(grp => (
                                grp.meters.map(meter => (
                                    <React.Fragment key={meter.id}>
                                        <th className={`border-r border-b p-1 text-[9px] text-slate-500 font-semibold w-16 text-center ${isDark ? 'border-[#30363d]' : 'border-slate-200'}`}>INITIAL</th>
                                        <th className={`border-r border-b p-1 text-[9px] text-slate-500 font-semibold w-20 text-center ${isDark ? 'border-[#30363d]' : 'border-slate-200'}`}>FINAL</th>
                                        <th className={`border-r border-b p-1 text-[9px] text-emerald-600 font-bold w-16 text-center ${isDark ? 'bg-emerald-500/5 border-[#30363d]' : 'bg-emerald-50 border-slate-200'}`}>CONS</th>
                                    </React.Fragment>
                                ))
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {daysInMonth.map((day, rowIndex) => {
                            const isWeekend = day.dayName === 'Sat' || day.dayName === 'Sun';
                            const rowBg = isWeekend ? (isDark ? 'bg-[#21262d]/50' : 'bg-slate-50') : (isDark ? 'bg-[#0d1117]' : 'bg-white');
                            
                            return (
                                <tr key={day.dateStr} id={`row-${day.dateStr}`} className={`hover:bg-primary/5 transition-colors ${rowBg}`}>
                                    <td className={`sticky left-0 z-30 border-r border-b p-1 text-center text-xs font-medium whitespace-nowrap ${isDark ? 'border-[#30363d] bg-inherit' : 'border-slate-200 bg-inherit'}`}>
                                        {day.dateStr.split('-').reverse().join('/')}
                                    </td>
                                    <td className={`sticky left-[80px] z-30 border-r border-b p-1 text-center text-[10px] font-medium text-slate-500 ${isDark ? 'border-[#30363d] bg-inherit' : 'border-slate-200 bg-inherit'}`}>
                                        {day.dayName}
                                    </td>
                                    
                                    {activeCategory?.groups.map(grp => (
                                        grp.meters.map(meter => {
                                            const reading = readings[day.dateStr]?.[meter.id];
                                            return (
                                                <React.Fragment key={meter.id}>
                                                    <td className={`border-r border-b p-1 text-center text-xs font-bold bg-transparent ${isDark ? 'border-[#30363d] text-white' : 'border-slate-200 text-black'}`}>
                                                        {reading?.initial_reading !== undefined && reading?.initial_reading !== null ? Number(Number(reading.initial_reading).toFixed(2)) : '-'}
                                                    </td>
                                                    <td className={`border-r border-b p-0 bg-transparent ${isDark ? 'border-[#30363d]' : 'border-slate-200'}`}>
                                                        <input 
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={reading?.final_reading ?? ''}
                                                            onChange={(e) => handleValueChange(day.dateStr, meter.id, 'final_reading', e.target.value, meter.meter_constant)}
                                                            className={`w-full h-full p-1 text-xs bg-transparent text-center focus:outline-none focus:bg-primary/10 transition-colors font-bold ${isDark ? 'text-white placeholder:text-slate-600' : 'text-black placeholder:text-slate-300'}`}
                                                            placeholder="-"
                                                        />
                                                    </td>
                                                    <td className={`border-r border-b p-1 text-xs text-center font-bold ${isDark ? 'bg-emerald-500/5 border-[#30363d] text-emerald-400' : 'bg-emerald-50 border-slate-200 text-emerald-700'}`}>
                                                        {reading?.consumption !== undefined && reading?.consumption !== null ? Number(reading.consumption.toFixed(2)) : '-'}
                                                        {reading?.is_rollover && <span className="text-[9px] text-orange-500 block">Roll</span>}
                                                    </td>
                                                </React.Fragment>
                                            );
                                        })
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Excel-style Bottom Sheet Tabs */}
            <div className={`sticky bottom-0 z-50 flex items-center border-t px-2 h-10 shrink-0 ${isDark ? 'bg-[#0d1117] border-[#30363d]' : 'bg-[#f3f2f1] border-slate-300'}`}>
                <div className="flex items-center h-full pt-1">
                    {categories.map(cat => (
                        <div key={cat.id} className="relative flex items-center group h-full">
                            {editingEntity?.id === cat.id ? (
                                <input 
                                    autoFocus
                                    defaultValue={cat.name}
                                    onBlur={(e) => handleRenameSubmit(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit(e.currentTarget.value)}
                                    className={`h-full px-5 text-sm font-bold border-x border-t rounded-t-lg outline-none ${isDark ? 'bg-[#161b22] border-[#30363d] text-emerald-400' : 'bg-white border-slate-300 text-emerald-600'}`}
                                />
                            ) : (
                                <button
                                    onClick={() => setActiveTabId(cat.id)}
                                    onDoubleClick={() => setEditingEntity({ id: cat.id, type: 'sheet', currentName: cat.name })}
                                    className={`h-full px-5 text-sm transition-all border-x border-t rounded-t-lg -ml-px ${isDark ? 'border-[#30363d]' : 'border-slate-300'} ${activeTabId === cat.id ? `bg-white dark:bg-[#161b22] font-bold text-emerald-600 dark:text-emerald-400 border-b-0 shadow-sm pr-10 relative z-10 cursor-text` : 'text-slate-600 bg-slate-200/50 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-[#161b22] dark:bg-[#12161c] font-medium border-b'}`}
                                    style={{ marginBottom: activeTabId === cat.id ? '-1px' : '0' }}
                                    title={activeTabId === cat.id ? "Double-click to rename" : ""}
                                >
                                    {cat.name}
                                </button>
                            )}
                            {activeTabId === cat.id && editingEntity?.id !== cat.id && (
                                <button 
                                    onClick={() => handleDelete('delete_sheet', cat.id, cat.name)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 z-20 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/20 rounded transition-colors"
                                    title="Delete Sheet"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    ))}
                    <button
                        onClick={handleAddSheet}
                        className={`h-7 w-7 ml-2 rounded transition-colors flex items-center justify-center ${isDark ? 'text-slate-400 hover:bg-[#161b22] hover:text-white' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`}
                        title="Add New Sheet"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <FacilityConfigImportModal
                isOpen={showImportModal}
                onClose={() => setShowImportModal(false)}
                propertyId={propertyId}
                isDark={isDark}
                onSuccess={() => {
                    fetchConfig();
                }}
            />
        </div>
    );
}
