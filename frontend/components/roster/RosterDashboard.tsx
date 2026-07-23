'use client';

import React, { useState, useEffect } from 'react';
import { RosterBoard } from './RosterBoard';
import { ShiftConfigModal, ShiftConfig } from './ShiftConfigModal';
import { AddOfflineStaffModal } from './AddOfflineStaffModal';
import { CustomTimeModal } from './CustomTimeModal';
import { Button } from '@/frontend/components/ui/button';
import { Settings, Download, Save, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Toast } from '@/frontend/components/ui/Toast';
import { useDataCache } from '@/frontend/context/DataCacheContext';

interface Props {
    propertyId: string;
}

export function RosterDashboard({ propertyId }: Props) {
    const { getCachedData, setCachedData } = useDataCache();
    const [currentDate, setCurrentDate] = useState(new Date());
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStr = `${year}-${(month + 1).toString().padStart(2, '0')}`;
    
    const fetchKey = `dashboard-roster-${propertyId}-${monthStr}`;
    const initialCached = React.useMemo(() => getCachedData(fetchKey), [fetchKey]);

    const [viewMode, setViewMode] = useState<'monthly' | 'daily'>('monthly');
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const [isAddOfflineOpen, setIsAddOfflineOpen] = useState(false);
    const [customTimePrompt, setCustomTimePrompt] = useState<{userId: string, dateStr: string} | null>(null);
    
    const [staff, setStaff] = useState<any[]>(initialCached?.staff || []);
    const [rosters, setRosters] = useState<any[]>(initialCached?.rosters || []);
    const [configs, setConfigs] = useState<ShiftConfig[]>(initialCached?.configs || []);
    
    const [loading, setLoading] = useState(!initialCached);
    const [saving, setSaving] = useState(false);
    
    // Import Modal State
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importMonth, setImportMonth] = useState(new Date().getMonth());
    const [importYear, setImportYear] = useState(new Date().getFullYear());
    const [isImporting, setIsImporting] = useState(false);
    
    const [notification, setNotification] = useState<{message: string, type: 'success'|'error'|'info'} | null>(null);
    const [isCustomExportOpen, setIsCustomExportOpen] = useState(false);
    const [customExportStart, setCustomExportStart] = useState('');
    const [customExportEnd, setCustomExportEnd] = useState('');
    
    // Track unsaved changes
    const [unsavedAssignments, setUnsavedAssignments] = useState<Record<string, any>>({});

    const fetchData = async (isInitial = false) => {
        if (!isInitial || !initialCached) {
            setLoading(true);
        }
        try {
            // Fetch Configs
            const configRes = await fetch(`/api/roster/config?propertyId=${propertyId}`);
            const configData = await configRes.json();
            
            // Fetch Data
            const dataRes = await fetch(`/api/roster?propertyId=${propertyId}&month=${monthStr}`);
            const dataData = await dataRes.json();
            
            setConfigs(configData.data || []);
            setStaff(dataData.staff || []);
            setRosters(dataData.rosters || []);
            
            setCachedData(fetchKey, {
                configs: configData.data || [],
                staff: dataData.staff || [],
                rosters: dataData.rosters || []
            });
            
            setUnsavedAssignments({});
        } catch (error) {
            console.error(error);
            setNotification({ message: 'Failed to load roster data', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (propertyId) {
            fetchData(true);
        }
    }, [propertyId, monthStr]);

    const handleMonthChange = (offset: number) => {
        const newDate = new Date(currentDate);
        newDate.setMonth(newDate.getMonth() + offset);
        setCurrentDate(newDate);
    };

    // Combine saved rosters with unsaved changes for the board
    const currentRosters = [...rosters];
    Object.values(unsavedAssignments).forEach(ua => {
        const existingIdx = currentRosters.findIndex(r => r.user_id === ua.user_id && r.roster_date === ua.roster_date);
        if (existingIdx >= 0) {
            currentRosters[existingIdx] = { ...currentRosters[existingIdx], ...ua };
        } else {
            currentRosters.push(ua);
        }
    });

    const handleCellChange = (userId: string, dateStr: string, shiftId: string) => {
        if (shiftId === 'custom_time') {
            setCustomTimePrompt({ userId, dateStr });
            return;
        }

        const key = `${userId}_${dateStr}`;

        setUnsavedAssignments(prev => ({
            ...prev,
            [key]: {
                ...(prev[key] || rosters.find(r => r.user_id === userId && r.roster_date === dateStr) || {}),
                user_id: userId,
                roster_date: dateStr,
                shift_id: shiftId || null // Set to null to indicate unassigning
            }
        }));
    };

    const handleCustomTimeSubmit = async (startTime: string, endTime: string) => {
        if (!customTimePrompt) return;
        
        try {
            setNotification({ message: 'Creating custom shift...', type: 'info' });
            
            // Format code and name
            const timeCode = `${startTime} to ${endTime}`;
            
            // Check if it already exists locally
            let existingConfig = configs.find(c => c.start_time?.startsWith(startTime) && c.end_time?.startsWith(endTime));
            
            if (!existingConfig) {
                // Auto-create in DB
                const payload = [{
                    property_id: propertyId,
                    code: timeCode.substring(0, 20),
                    name: timeCode,
                    start_time: startTime + ':00',
                    end_time: endTime + ':00',
                    color: '#cbd5e1',
                    is_working_day: true
                }];
                
                const res = await fetch('/api/roster/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ propertyId, configs: payload })
                });
                
                if (!res.ok) throw new Error('Failed to create custom shift');
                
                const data = await res.json();
                if (data.data && data.data.length > 0) {
                    existingConfig = data.data[0];
                    setConfigs(prev => [...prev, existingConfig!]);
                }
            }
            
            if (existingConfig) {
                // Apply the new shift ID to the cell
                const key = `${customTimePrompt.userId}_${customTimePrompt.dateStr}`;
                setUnsavedAssignments(prev => ({
                    ...prev,
                    [key]: {
                        ...(prev[key] || rosters.find(r => r.user_id === customTimePrompt.userId && r.roster_date === customTimePrompt.dateStr) || {}),
                        user_id: customTimePrompt.userId,
                        roster_date: customTimePrompt.dateStr,
                        shift_id: existingConfig!.id
                    }
                }));
                setNotification({ message: 'Custom shift applied', type: 'success' });
            }
        } catch (err) {
            console.error(err);
            setNotification({ message: 'Failed to create custom shift', type: 'error' });
        } finally {
            setCustomTimePrompt(null);
        }
    };

    const handleToggleReliever = (userId: string, dateStr: string) => {
        const key = `${userId}_${dateStr}`;
        const existing = unsavedAssignments[key] || rosters.find(r => r.user_id === userId && r.roster_date === dateStr);
        if (!existing || !existing.shift_id) return;

        setUnsavedAssignments(prev => ({
            ...prev,
            [key]: {
                ...existing,
                is_reliever: !existing.is_reliever
            }
        }));
    };

    const handleDeleteOfflineStaff = async (userId: string) => {
        if (!confirm('Are you sure you want to delete this offline staff member? This will remove them from all rosters.')) return;

        try {
            setNotification({ message: 'Deleting staff...', type: 'info' });
            const res = await fetch(`/api/roster/offline?id=${userId}`, { method: 'DELETE' });
            
            if (!res.ok) throw new Error('Failed to delete staff');

            setStaff(prev => prev.filter(s => s.user_id !== userId));
            setNotification({ message: 'Staff deleted successfully!', type: 'success' });
        } catch (error) {
            console.error(error);
            setNotification({ message: 'Failed to delete staff', type: 'error' });
        }
    };

    const handleRenameOfflineStaff = async (userId: string, newName: string) => {
        if (!newName.trim()) return;

        try {
            setNotification({ message: 'Renaming staff...', type: 'info' });
            const res = await fetch('/api/roster/offline', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ offlineStaffId: userId, fullName: newName })
            });

            if (!res.ok) throw new Error('Failed to rename staff');

            // Optimistically update the UI
            setStaff(prev => prev.map(s => {
                if (s.user_id === userId) {
                    return { ...s, users: { ...s.users, full_name: newName.trim() } };
                }
                return s;
            }));

            setNotification({ message: 'Staff renamed successfully!', type: 'success' });
        } catch (error) {
            console.error(error);
            setNotification({ message: 'Failed to rename staff', type: 'error' });
        }
    };

    const handleRemoveStaff = async (userId: string, isOffline: boolean) => {
        try {
            setNotification({ message: 'Removing staff...', type: 'info' });
            if (isOffline) {
                await handleDeleteOfflineStaff(userId);
                return;
            }

            // Remove registered staff
            const res = await fetch(`/api/roster/remove-staff?propertyId=${propertyId}&userId=${userId}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to remove staff');
            
            setStaff(prev => prev.filter(s => s.user_id !== userId));
            setNotification({ message: 'Staff removed successfully', type: 'success' });
        } catch (error) {
            console.error(error);
            setNotification({ message: 'Failed to remove staff', type: 'error' });
        }
    };

    const handleUpdateDesignation = async (userId: string, designation: string) => {
        try {
            const member = staff.find(s => s.user_id === userId);
            const isOffline = member?.role === 'offline';
            const endpoint = isOffline ? '/api/roster/offline' : '/api/roster/designation';
            const bodyPayload = isOffline 
                ? { propertyId, offlineStaffId: userId, designation }
                : { propertyId, userId, designation };

            const res = await fetch(endpoint, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload)
            });
            if (!res.ok) throw new Error('Failed to update designation');
            
            // Update local state instantly so it regroups
            setStaff(prev => prev.map(s => s.user_id === userId ? { ...s, custom_designation: designation } : s));
            setNotification({ message: 'Role updated successfully', type: 'success' });
        } catch (error) {
            console.error(error);
            setNotification({ message: 'Failed to update role', type: 'error' });
        }
    };

    const handleAddOffline = async (fullName: string, designation: string) => {
        const res = await fetch('/api/roster/offline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ propertyId, fullName, designation })
        });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to add offline staff');
        }
        setNotification({ message: 'Offline staff added successfully', type: 'success' });
        fetchData(); // Reload roster to fetch the new staff
    };

    const handleSave = async () => {
        const changes = Object.values(unsavedAssignments);
        if (changes.length === 0) return;

        setSaving(true);
        try {
            const res = await fetch('/api/roster/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ propertyId, assignments: changes })
            });
            if (!res.ok) throw new Error('Failed to save');
            
            setNotification({ message: 'Roster saved successfully', type: 'success' });
            fetchData(); // Reload
        } catch (error) {
            console.error(error);
            setNotification({ message: 'Failed to save roster', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const handleExport = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const type = e.target.value;
        if (!type) return;

        if (type === 'custom') {
            setIsCustomExportOpen(true);
            e.target.value = '';
            return;
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const dateParam = (type === 'weekly' || type === 'daily') ? `&date=${todayStr}` : '';
        
        window.open(`/api/roster/export?propertyId=${propertyId}&exportType=${type}&month=${monthStr}${dateParam}`, '_blank');
        e.target.value = ''; // reset dropdown
    };

    const handleCopyDay = (fromStr: string) => {
        const fromDate = new Date(fromStr);
        const toDate = new Date(fromDate);
        toDate.setDate(toDate.getDate() + 1);

        const toStr = `${toDate.getFullYear()}-${(toDate.getMonth() + 1).toString().padStart(2, '0')}-${toDate.getDate().toString().padStart(2, '0')}`;

        const newUnsaved = { ...unsavedAssignments };
        let copiedCount = 0;

        staff.forEach(s => {
            const userId = s.user_id;
            let fromShift = unsavedAssignments[`${userId}_${fromStr}`];
            if (!fromShift) {
                fromShift = rosters.find(r => r.user_id === userId && r.roster_date === fromStr);
            }

            if (fromShift && fromShift.shift_id) {
                const key = `${userId}_${toStr}`;
                newUnsaved[key] = {
                    ...(unsavedAssignments[key] || rosters.find(r => r.user_id === userId && r.roster_date === toStr) || {}),
                    user_id: userId,
                    roster_date: toStr,
                    shift_id: fromShift.shift_id,
                    is_reliever: fromShift.is_reliever
                };
                copiedCount++;
            }
        });

        if (copiedCount > 0) {
            setUnsavedAssignments(newUnsaved);
            setNotification({ message: `Copied ${copiedCount} shifts to the next day. Don't forget to save!`, type: 'success' });
        } else {
            setNotification({ message: 'No shifts found on this day to copy.', type: 'error' });
        }
    };

    const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImportFile(file);
        setImportMonth(month);
        setImportYear(year);
        e.target.value = ''; // Reset file input so same file can be picked again
    };

    const confirmImport = async () => {
        if (!importFile) return;
        
        try {
            setIsImporting(true);
            setNotification({ message: 'Uploading and parsing Excel file...', type: 'info' });
            
            const formData = new FormData();
            formData.append('file', importFile);
            
            const fetchUrl = `/api/roster/import?propertyId=${propertyId}&year=${importYear}&month=${importMonth + 1}`;
            const res = await fetch(fetchUrl, {
                method: 'POST',
                body: formData
            });
            
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to import file');

            // Merge imported assignments into unsavedAssignments
            const newUnsaved = { ...unsavedAssignments };
            data.assignments.forEach((a: any) => {
                const key = `${a.user_id}_${a.roster_date}`;
                newUnsaved[key] = {
                    ...newUnsaved[key],
                    ...a,
                    is_reliever: a.is_reliever || false
                };
            });

            setUnsavedAssignments(newUnsaved);
            setNotification({ message: `Successfully imported shifts!`, type: 'success' });
            
            // Navigate the calendar to the imported month/year
            const newDate = new Date(importYear, importMonth, 1);
            setCurrentDate(newDate);
            
            setImportFile(null); // Close modal
        } catch (error: any) {
            console.error(error);
            setNotification({ message: error.message || 'Error parsing import file', type: 'error' });
        } finally {
            setIsImporting(false);
        }
    };

    return (
        <div className="space-y-4">
            <Toast 
                message={notification?.message || ''} 
                type={notification?.type || 'info'} 
                visible={!!notification} 
                onClose={() => setNotification(null)} 
            />
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-3">
                    <div className="flex items-center bg-gray-100 rounded-full p-1 shadow-sm">
                        <button onClick={() => handleMonthChange(-1)} className="p-1 hover:bg-white rounded-full transition-colors">
                            <ChevronLeft className="w-4 h-4 text-gray-600" />
                        </button>
                        <h2 className="text-sm font-semibold w-24 text-center">
                            {currentDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                        </h2>
                        <button onClick={() => handleMonthChange(1)} className="p-1 hover:bg-white rounded-full transition-colors">
                            <ChevronRight className="w-4 h-4 text-gray-600" />
                        </button>
                    </div>
                    
                    <div className="flex items-center gap-1 border rounded-full p-1 bg-gray-100 shadow-sm">
                        <button 
                            onClick={() => setViewMode('monthly')}
                            className={`px-3 py-1 text-xs rounded-full transition-all ${viewMode === 'monthly' ? 'bg-white shadow font-medium text-black' : 'text-gray-500 hover:text-black'}`}
                        >
                            Monthly
                        </button>
                        <button 
                            onClick={() => setViewMode('daily')}
                            className={`px-3 py-1 text-xs rounded-full transition-all ${viewMode === 'daily' ? 'bg-white shadow font-medium text-black' : 'text-gray-500 hover:text-black'}`}
                        >
                            Today
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => setIsAddOfflineOpen(true)} className="rounded-full h-8 text-xs px-3 bg-white">
                        + Add Offline Staff
                    </Button>
                    <Button variant="outline" onClick={() => setIsConfigOpen(true)} className="rounded-full h-8 text-xs px-3 bg-white">
                        <Settings className="w-3 h-3 mr-1.5" /> Shift Codes
                    </Button>
                    
                    <label className="flex items-center justify-center border rounded-full text-xs hover:bg-gray-50 cursor-pointer bg-white px-3 h-8 border-gray-200">
                        <input type="file" accept=".xlsx" className="hidden" onChange={handleImportFile} />
                        Import Excel
                    </label>

                    <select 
                        onChange={handleExport}
                        className="h-8 px-3 border rounded-full text-xs hover:bg-gray-50 focus:outline-none cursor-pointer bg-white"
                    >
                        <option value="">Export Excel...</option>
                        <option value="monthly">Export Monthly</option>
                        <option value="weekly">Export Weekly</option>
                        <option value="daily">Export Today</option>
                        <option value="custom">Export Custom Dates</option>
                    </select>
                    <Button 
                        onClick={handleSave} 
                        disabled={Object.keys(unsavedAssignments).length === 0 || saving}
                        className={`rounded-full h-8 text-xs px-3 transition-all duration-300 ${Object.keys(unsavedAssignments).length > 0 && !saving ? 'animate-pulse bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-500/30 ring-2 ring-green-500 ring-offset-2' : ''}`}
                    >
                        {saving ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Save className="w-3 h-3 mr-1.5" />}
                        Save Changes
                    </Button>
                </div>
            </div>

            {isCustomExportOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden p-6 border border-gray-200">
                        <h3 className="text-lg font-bold mb-4">Export Custom Date Range</h3>
                        <div className="space-y-4 mb-6">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">Start Date</label>
                                <input type="date" value={customExportStart} onChange={e => setCustomExportStart(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-500" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">End Date</label>
                                <input type="date" value={customExportEnd} onChange={e => setCustomExportEnd(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-500" />
                            </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                            <Button variant="outline" onClick={() => setIsCustomExportOpen(false)}>Cancel</Button>
                            <Button 
                                onClick={() => {
                                    if (!customExportStart || !customExportEnd) {
                                        setNotification({ message: 'Please select both start and end dates', type: 'error' });
                                        return;
                                    }
                                    if (new Date(customExportStart) > new Date(customExportEnd)) {
                                        setNotification({ message: 'Start date cannot be after end date', type: 'error' });
                                        return;
                                    }
                                    window.open(`/api/roster/export?propertyId=${propertyId}&exportType=custom&startDate=${customExportStart}&endDate=${customExportEnd}`, '_blank');
                                    setIsCustomExportOpen(false);
                                }}
                            >
                                Export
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="h-64 flex items-center justify-center border rounded-lg bg-gray-50">
                    <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                </div>
            ) : configs.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center border rounded-lg bg-yellow-50 text-yellow-800 space-y-4">
                    <p>No Shift Codes are configured for this property.</p>
                    <Button onClick={() => setIsConfigOpen(true)}>Configure Shift Codes First</Button>
                </div>
            ) : (
                <RosterBoard 
                    staff={staff}
                    rosters={currentRosters}
                    configs={configs}
                    year={year}
                    month={month}
                    viewDate={viewMode === 'daily' ? new Date() : undefined}
                    onCellChange={handleCellChange}
                    onToggleReliever={handleToggleReliever}
                    onUpdateDesignation={handleUpdateDesignation}
                    onRenameOfflineStaff={handleRenameOfflineStaff}
                    onRemoveStaff={handleRemoveStaff}
                    onCopyDay={handleCopyDay}
                />
            )}

            <ShiftConfigModal 
                open={isConfigOpen} 
                onOpenChange={setIsConfigOpen} 
                propertyId={propertyId}
                onSaved={fetchData}
            />

            {importFile && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-6">
                        <div className="space-y-2">
                            <h3 className="text-lg font-bold text-gray-900">Import Roster</h3>
                            <p className="text-sm text-gray-500">Select the target month and year for this file.</p>
                            <p className="text-xs text-blue-600 font-medium truncate bg-blue-50 px-2 py-1 rounded">
                                {importFile.name}
                            </p>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-gray-700">Month</label>
                                <select 
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                                    value={importMonth}
                                    onChange={(e) => setImportMonth(parseInt(e.target.value))}
                                    disabled={isImporting}
                                >
                                    {Array.from({ length: 12 }).map((_, i) => (
                                        <option key={i} value={i}>{new Date(2000, i).toLocaleString('default', { month: 'long' })}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-gray-700">Year</label>
                                <input 
                                    type="number"
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                    value={importYear}
                                    onChange={(e) => setImportYear(parseInt(e.target.value))}
                                    disabled={isImporting}
                                />
                            </div>
                        </div>

                        <div className="flex space-x-3 pt-2">
                            <button
                                onClick={() => setImportFile(null)}
                                disabled={isImporting}
                                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmImport}
                                disabled={isImporting}
                                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center"
                            >
                                {isImporting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                Import
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <AddOfflineStaffModal 
                isOpen={isAddOfflineOpen} 
                onClose={() => setIsAddOfflineOpen(false)} 
                onSave={handleAddOffline} 
                offlineStaff={staff.filter(s => s.role === 'offline')}
                onRename={handleRenameOfflineStaff}
                onUpdateDesignation={handleUpdateDesignation}
                onDelete={handleDeleteOfflineStaff}
            />

            <CustomTimeModal
                isOpen={customTimePrompt !== null}
                onClose={() => setCustomTimePrompt(null)}
                onSubmit={handleCustomTimeSubmit}
                title="Custom Shift Time"
            />
        </div>
    );
}
