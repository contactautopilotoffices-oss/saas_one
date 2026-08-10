'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Save, Calendar, ArrowRight, Activity, Download, Upload, X, Plus, Trash2, Settings, LayoutTemplate, FileSpreadsheet, ClipboardCheck, ClipboardPaste, Scissors } from 'lucide-react';
import { motion } from 'framer-motion';
import FacilityConfigImportModal from './FacilityConfigImportModal';
import { Toast } from '../ui/Toast';

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

    // Excel Paste State
    const [showPasteModal, setShowPasteModal] = useState(false);
    const [pasteTargetMeterId, setPasteTargetMeterId] = useState<string>('');
    const [pasteStartDay, setPasteStartDay] = useState<string>('');
    const [pasteField, setPasteField] = useState<'final_reading' | 'initial_reading'>('final_reading');
    const [pasteRawText, setPasteRawText] = useState<string>('');
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; visible: boolean }>({ message: '', type: 'success', visible: false });

    // Excel-like Mouse Drag Selection State
    const [selectionStart, setSelectionStart] = useState<{ dayIndex: number; meterId: string } | null>(null);
    const [selectionEnd, setSelectionEnd] = useState<{ dayIndex: number; meterId: string } | null>(null);
    const [isMouseDownSelecting, setIsMouseDownSelecting] = useState(false);

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
                
                // First, seed lastKnownFinal using previous month's final reading (or fallback to initial reading)
                // Filter and sort prev month data chronologically so the latest date wins
                const prevMonthReadings = data
                    .filter(r => r.reading_date < month + '-01')
                    .sort((a, b) => a.reading_date.localeCompare(b.reading_date));

                prevMonthReadings.forEach(r => {
                    const finalVal = r.final_reading !== null && r.final_reading !== undefined ? Number(r.final_reading) : null;
                    const initVal = r.initial_reading !== null && r.initial_reading !== undefined ? Number(r.initial_reading) : null;
                    if (finalVal !== null && !isNaN(finalVal)) {
                        lastKnownFinal[r.meter_id] = finalVal;
                    } else if (initVal !== null && !isNaN(initVal)) {
                        lastKnownFinal[r.meter_id] = initVal;
                    }
                });

                // Find the latest date in this month that has a recorded final_reading
                let maxDateWithReading: string | null = null;
                data.forEach(r => {
                    if (r.reading_date >= month + '-01' && r.final_reading !== null && r.final_reading !== undefined && r.final_reading !== '') {
                        if (!maxDateWithReading || r.reading_date > maxDateWithReading) {
                            maxDateWithReading = r.reading_date;
                        }
                    }
                });

                // Iterate chronologically through the current month
                daysInMonth.forEach(day => {
                    activeCategory?.groups.forEach(grp => {
                        grp.meters.forEach(m => {
                            const existingRecord = newReadings[day.dateStr][m.id];
                            
                            if (existingRecord) {
                                // Day 1 of month always carries over the latest reading from previous month!
                                if (day.dateNum === 1 && lastKnownFinal[m.id] !== undefined) {
                                    existingRecord.initial_reading = lastKnownFinal[m.id];
                                } else if ((!existingRecord.initial_reading || Number(existingRecord.initial_reading) === 0) && lastKnownFinal[m.id] !== undefined) {
                                    existingRecord.initial_reading = lastKnownFinal[m.id];
                                }

                                // Recalculate consumption if both initial and final exist
                                if (existingRecord.initial_reading !== null && existingRecord.initial_reading !== undefined && existingRecord.initial_reading !== '' &&
                                    existingRecord.final_reading !== null && existingRecord.final_reading !== undefined && existingRecord.final_reading !== '') {
                                    const initVal = Number(existingRecord.initial_reading);
                                    const finalVal = Number(existingRecord.final_reading);
                                    if (!isNaN(initVal) && !isNaN(finalVal)) {
                                        const diff = finalVal - initVal;
                                        existingRecord.consumption = diff >= 0 ? Number((diff * (existingRecord.meter_constant_used || m.meter_constant)).toFixed(2)) : null;
                                    }
                                }
                                // Update tracker with final_reading or initial_reading for subsequent days
                                if (existingRecord.final_reading !== null && existingRecord.final_reading !== undefined && existingRecord.final_reading !== '' && !isNaN(Number(existingRecord.final_reading))) {
                                    lastKnownFinal[m.id] = Number(existingRecord.final_reading);
                                } else if (existingRecord.initial_reading !== null && existingRecord.initial_reading !== undefined && existingRecord.initial_reading !== '' && !isNaN(Number(existingRecord.initial_reading))) {
                                    lastKnownFinal[m.id] = Number(existingRecord.initial_reading);
                                }
                            } else {
                                // Only inject initial reading for the immediate day right after a recorded reading
                                // Stop propagating to far future days where no readings exist yet
                                const isNextDayAfterLastReading = maxDateWithReading ? (
                                    new Date(day.dateStr).getTime() <= new Date(maxDateWithReading).getTime() + (86400000 * 1)
                                ) : (day.dateNum === 1); // Or day 1 of the month

                                if (lastKnownFinal[m.id] !== undefined && isNextDayAfterLastReading) {
                                    newReadings[day.dateStr][m.id] = {
                                        meter_id: m.id,
                                        reading_date: day.dateStr,
                                        initial_reading: lastKnownFinal[m.id],
                                        final_reading: null,
                                        consumption: null,
                                        meter_constant_used: m.meter_constant,
                                        is_rollover: false
                                    };
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

    const activeMeters = useMemo(() => {
        const meters: { id: string; name: string; groupName: string; meter_constant: number }[] = [];
        activeCategory?.groups.forEach(g => {
            g.meters.forEach(m => {
                meters.push({ id: m.id, name: m.name, groupName: g.name, meter_constant: m.meter_constant });
            });
        });
        return meters;
    }, [activeCategory]);

    const applyBatchValues = (entries: { dateStr: string; meterId: string; field: 'initial_reading' | 'final_reading'; value: string; meterConstant: number }[]) => {
        setReadings(prev => {
            const newState = { ...prev };
            entries.forEach(entry => {
                const { dateStr, meterId, field, value, meterConstant } = entry;
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

                const val = value === '' ? null : value;
                const updatedReading = { ...currentReading, [field]: val };

                if (updatedReading.initial_reading !== null && updatedReading.initial_reading !== '' && updatedReading.final_reading !== null && updatedReading.final_reading !== '') {
                    const initVal = typeof updatedReading.initial_reading === 'string' ? parseFloat(updatedReading.initial_reading) : updatedReading.initial_reading;
                    const finalVal = typeof updatedReading.final_reading === 'string' ? parseFloat(updatedReading.final_reading) : updatedReading.final_reading;

                    if (!isNaN(initVal) && !isNaN(finalVal)) {
                        const diff = finalVal - initVal;
                        if (diff < 0) {
                            updatedReading.is_rollover = true;
                            updatedReading.consumption = null;
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
            });
            return newState;
        });
    };

    const handleCellPaste = (
        e: React.ClipboardEvent<HTMLInputElement>,
        startDateStr: string,
        startMeterId: string,
        field: 'initial_reading' | 'final_reading',
        meterConstant: number
    ) => {
        const rawText = e.clipboardData.getData('text');
        if (!rawText) return;

        const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
        if (lines.length <= 1 && !lines[0]?.includes('\t')) {
            return;
        }

        e.preventDefault();

        const startMeterIndex = activeMeters.findIndex(m => m.id === startMeterId);
        const startDayIndex = daysInMonth.findIndex(d => d.dateStr === startDateStr);

        if (startDayIndex === -1) return;

        const entries: { dateStr: string; meterId: string; field: 'initial_reading' | 'final_reading'; value: string; meterConstant: number }[] = [];

        lines.forEach((line, lineIdx) => {
            const targetDayIdx = startDayIndex + lineIdx;
            if (targetDayIdx >= daysInMonth.length) return;
            const targetDateStr = daysInMonth[targetDayIdx].dateStr;

            const colValues = line.split('\t');
            colValues.forEach((colVal, colIdx) => {
                const targetMeterIdx = (startMeterIndex !== -1 ? startMeterIndex : 0) + colIdx;
                if (targetMeterIdx >= activeMeters.length) return;
                const targetMeter = activeMeters[targetMeterIdx];
                const cleanVal = colVal.trim().replace(/,/g, '');

                if (cleanVal !== '' && !isNaN(Number(cleanVal))) {
                    entries.push({
                        dateStr: targetDateStr,
                        meterId: targetMeter.id,
                        field,
                        value: cleanVal,
                        meterConstant: targetMeter.meter_constant
                    });
                }
            });
        });

        if (entries.length > 0) {
            applyBatchValues(entries);
            setToast({ message: `Pasted ${entries.length} readings from Excel!`, type: 'success', visible: true });
        }
    };

    const handleCellCut = (
        e: React.ClipboardEvent<HTMLInputElement>,
        dateStr: string,
        meterId: string,
        field: 'initial_reading' | 'final_reading',
        meterConstant: number
    ) => {
        const target = e.currentTarget;
        const currentVal = target.value;
        if (!currentVal) return;

        e.clipboardData.setData('text/plain', currentVal);
        e.preventDefault();

        handleValueChange(dateStr, meterId, field, '', meterConstant);
        setToast({ message: 'Cut reading to clipboard', type: 'success', visible: true });
    };

    const handleClearMeterColumn = (meterId: string, meterName: string) => {
        if (!confirm(`Clear all readings for ${meterName} in ${month}?`)) return;

        setReadings(prev => {
            const newState = { ...prev };
            Object.keys(newState).forEach(dateStr => {
                if (newState[dateStr]?.[meterId]) {
                    const reading = { ...newState[dateStr][meterId] };
                    reading.final_reading = null;
                    reading.consumption = null;
                    reading.is_rollover = false;
                    newState[dateStr][meterId] = reading;
                }
            });
            return newState;
        });

        setToast({ message: `Cleared readings for ${meterName}`, type: 'success', visible: true });
    };

    const selectedRangeBounds = useMemo(() => {
        if (!selectionStart || !selectionEnd) return null;
        const startDayIdx = Math.min(selectionStart.dayIndex, selectionEnd.dayIndex);
        const endDayIdx = Math.max(selectionStart.dayIndex, selectionEnd.dayIndex);

        const startMeterIdx = activeMeters.findIndex(m => m.id === selectionStart.meterId);
        const endMeterIdx = activeMeters.findIndex(m => m.id === selectionEnd.meterId);

        if (startMeterIdx === -1 || endMeterIdx === -1) return null;

        const minMeterIdx = Math.min(startMeterIdx, endMeterIdx);
        const maxMeterIdx = Math.max(startMeterIdx, endMeterIdx);

        return { startDayIdx, endDayIdx, minMeterIdx, maxMeterIdx };
    }, [selectionStart, selectionEnd, activeMeters]);

    const isCellSelected = (dayIndex: number, meterId: string) => {
        if (!selectedRangeBounds) return false;
        if (dayIndex < selectedRangeBounds.startDayIdx || dayIndex > selectedRangeBounds.endDayIdx) return false;
        const mIdx = activeMeters.findIndex(m => m.id === meterId);
        if (mIdx === -1) return false;
        return mIdx >= selectedRangeBounds.minMeterIdx && mIdx <= selectedRangeBounds.maxMeterIdx;
    };

    const handleCellMouseDown = (dayIndex: number, meterId: string) => {
        setSelectionStart({ dayIndex, meterId });
        setSelectionEnd({ dayIndex, meterId });
        setIsMouseDownSelecting(true);
    };

    const handleCellMouseEnter = (dayIndex: number, meterId: string) => {
        if (isMouseDownSelecting) {
            setSelectionEnd({ dayIndex, meterId });
        }
    };

    useEffect(() => {
        const handleGlobalMouseUp = () => {
            setIsMouseDownSelecting(false);
        };
        window.addEventListener('mouseup', handleGlobalMouseUp);
        return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!selectedRangeBounds) return;
            const activeElem = document.activeElement;
            if (activeElem && (activeElem.tagName === 'TEXTAREA' || activeElem.tagName === 'SELECT')) return;

            const { startDayIdx, endDayIdx, minMeterIdx, maxMeterIdx } = selectedRangeBounds;
            const rowsCount = endDayIdx - startDayIdx + 1;
            const colsCount = maxMeterIdx - minMeterIdx + 1;

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
                const lines: string[] = [];
                for (let dIdx = startDayIdx; dIdx <= endDayIdx; dIdx++) {
                    const dateStr = daysInMonth[dIdx]?.dateStr;
                    if (!dateStr) continue;
                    const rowVals: string[] = [];
                    for (let mIdx = minMeterIdx; mIdx <= maxMeterIdx; mIdx++) {
                        const meter = activeMeters[mIdx];
                        if (!meter) continue;
                        const reading = readings[dateStr]?.[meter.id];
                        rowVals.push(reading?.final_reading !== null && reading?.final_reading !== undefined ? String(reading.final_reading) : '');
                    }
                    lines.push(rowVals.join('\t'));
                }
                const copyStr = lines.join('\n');
                navigator.clipboard.writeText(copyStr);
                setToast({ message: `Copied ${rowsCount}×${colsCount} cell selection to clipboard`, type: 'success', visible: true });
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
                e.preventDefault();
                const lines: string[] = [];
                const clearEntries: { dateStr: string; meterId: string; field: 'initial_reading' | 'final_reading'; value: string; meterConstant: number }[] = [];

                for (let dIdx = startDayIdx; dIdx <= endDayIdx; dIdx++) {
                    const dateStr = daysInMonth[dIdx]?.dateStr;
                    if (!dateStr) continue;
                    const rowVals: string[] = [];
                    for (let mIdx = minMeterIdx; mIdx <= maxMeterIdx; mIdx++) {
                        const meter = activeMeters[mIdx];
                        if (!meter) continue;
                        const reading = readings[dateStr]?.[meter.id];
                        rowVals.push(reading?.final_reading !== null && reading?.final_reading !== undefined ? String(reading.final_reading) : '');
                        clearEntries.push({
                            dateStr,
                            meterId: meter.id,
                            field: 'final_reading',
                            value: '',
                            meterConstant: meter.meter_constant
                        });
                    }
                    lines.push(rowVals.join('\t'));
                }
                const cutStr = lines.join('\n');
                navigator.clipboard.writeText(cutStr);
                applyBatchValues(clearEntries);
                setToast({ message: `Cut ${rowsCount}×${colsCount} cell selection to clipboard`, type: 'success', visible: true });
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                if (activeElem && activeElem.tagName === 'INPUT') {
                    // Focus is inside input - allow native single-character delete/backspace
                    return;
                }
                const clearEntries: { dateStr: string; meterId: string; field: 'initial_reading' | 'final_reading'; value: string; meterConstant: number }[] = [];
                for (let dIdx = startDayIdx; dIdx <= endDayIdx; dIdx++) {
                    const dateStr = daysInMonth[dIdx]?.dateStr;
                    if (!dateStr) continue;
                    for (let mIdx = minMeterIdx; mIdx <= maxMeterIdx; mIdx++) {
                        const meter = activeMeters[mIdx];
                        if (!meter) continue;
                        clearEntries.push({
                            dateStr,
                            meterId: meter.id,
                            field: 'final_reading',
                            value: '',
                            meterConstant: meter.meter_constant
                        });
                    }
                }
                applyBatchValues(clearEntries);
                setToast({ message: `Cleared ${rowsCount}×${colsCount} selected cells`, type: 'success', visible: true });
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedRangeBounds, daysInMonth, activeMeters, readings]);

    const parsedPastePreview = useMemo(() => {
        if (!pasteRawText.trim() || !pasteStartDay) return [];
        const lines = pasteRawText.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
        const startDayIdx = daysInMonth.findIndex(d => d.dateStr === pasteStartDay);
        if (startDayIdx === -1) return [];

        const targetMeter = activeMeters.find(m => m.id === pasteTargetMeterId) || activeMeters[0];
        if (!targetMeter) return [];

        return lines.map((line, idx) => {
            const targetDayIdx = startDayIdx + idx;
            const dayObj = daysInMonth[targetDayIdx];
            if (!dayObj) return null;

            const firstVal = line.split('\t')[0].trim().replace(/,/g, '');
            const numVal = parseFloat(firstVal);
            return {
                dateStr: dayObj.dateStr,
                dayName: dayObj.dayName,
                meterId: targetMeter.id,
                meterName: targetMeter.name,
                meterConstant: targetMeter.meter_constant,
                value: !isNaN(numVal) ? String(numVal) : null,
                rawInput: firstVal
            };
        }).filter(Boolean) as { dateStr: string; dayName: string; meterId: string; meterName: string; meterConstant: number; value: string | null; rawInput: string }[];
    }, [pasteRawText, pasteStartDay, pasteTargetMeterId, activeMeters, daysInMonth]);

    const handleApplyExcelPaste = () => {
        const validEntries = parsedPastePreview.filter(p => p.value !== null).map(p => ({
            dateStr: p.dateStr,
            meterId: p.meterId,
            field: pasteField,
            value: p.value!,
            meterConstant: p.meterConstant
        }));

        if (validEntries.length === 0) {
            setToast({ message: 'No valid numeric column values found to paste.', type: 'error', visible: true });
            return;
        }

        applyBatchValues(validEntries);
        setShowPasteModal(false);
        setPasteRawText('');
        setToast({ message: `Successfully pasted ${validEntries.length} daily readings!`, type: 'success', visible: true });
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

                    <button
                        onClick={() => {
                            if (activeMeters.length > 0) setPasteTargetMeterId(activeMeters[0].id);
                            if (daysInMonth.length > 0) setPasteStartDay(daysInMonth[0].dateStr);
                            setPasteRawText('');
                            setShowPasteModal(true);
                        }}
                        className={`px-3 py-2 rounded-lg font-bold text-sm whitespace-nowrap transition-colors flex items-center gap-1.5 border border-dashed ${
                            isDark ? 'border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10' : 'border-emerald-500/40 text-emerald-700 bg-emerald-50/50 hover:bg-emerald-100/60'
                        }`}
                        title="Paste column data copied from Excel or Google Sheets"
                    >
                        <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                        Paste from Excel
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
                                            const isSelected = isCellSelected(rowIndex, meter.id);
                                            return (
                                                <React.Fragment key={meter.id}>
                                                    <td className={`border-r border-b p-1 text-center text-xs font-bold bg-transparent ${isDark ? 'border-[#30363d] text-white' : 'border-slate-200 text-black'}`}>
                                                        {reading?.initial_reading !== undefined && reading?.initial_reading !== null ? Number(Number(reading.initial_reading).toFixed(2)) : '-'}
                                                    </td>
                                                    <td 
                                                        onMouseDown={() => handleCellMouseDown(rowIndex, meter.id)}
                                                        onMouseEnter={() => handleCellMouseEnter(rowIndex, meter.id)}
                                                        className={`border-r border-b p-0 relative transition-all ${
                                                            isSelected 
                                                                ? 'bg-blue-500/20 dark:bg-blue-500/30 ring-2 ring-blue-500 z-20' 
                                                                : 'bg-transparent'
                                                        } ${isDark ? 'border-[#30363d]' : 'border-slate-200'}`}
                                                    >
                                                        <input 
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={reading?.final_reading ?? ''}
                                                            onChange={(e) => handleValueChange(day.dateStr, meter.id, 'final_reading', e.target.value, meter.meter_constant)}
                                                            onPaste={(e) => handleCellPaste(e, day.dateStr, meter.id, 'final_reading', meter.meter_constant)}
                                                            onCut={(e) => handleCellCut(e, day.dateStr, meter.id, 'final_reading', meter.meter_constant)}
                                                            onMouseDown={() => handleCellMouseDown(rowIndex, meter.id)}
                                                            onMouseEnter={() => handleCellMouseEnter(rowIndex, meter.id)}
                                                            className={`w-full h-full p-1 text-xs bg-transparent text-center focus:outline-none focus:bg-primary/10 transition-colors font-bold ${
                                                                isSelected 
                                                                    ? (isDark ? 'text-white font-black' : 'text-blue-950 font-black') 
                                                                    : (isDark ? 'text-white placeholder:text-slate-600' : 'text-black placeholder:text-slate-300')
                                                            }`}
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

            {/* Excel Paste Modal */}
            {showPasteModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className={`p-6 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col ${isDark ? 'bg-[#161b22] border border-[#30363d]' : 'bg-white'}`}>
                        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-[#30363d]">
                            <div className="flex items-center gap-2">
                                <FileSpreadsheet className="w-5 h-5 text-emerald-500" />
                                <h3 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Paste Data from Excel / Google Sheets</h3>
                            </div>
                            <button onClick={() => setShowPasteModal(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-4 my-4 overflow-y-auto flex-1 pr-1">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className={`block text-xs font-bold mb-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Target Meter</label>
                                    <select
                                        value={pasteTargetMeterId}
                                        onChange={(e) => setPasteTargetMeterId(e.target.value)}
                                        className={`w-full px-3 py-2 text-xs font-bold rounded-lg border outline-none ${
                                            isDark ? 'bg-[#0d1117] border-[#30363d] text-white' : 'bg-white border-slate-200 text-slate-900'
                                        }`}
                                    >
                                        {activeMeters.map(m => (
                                            <option key={m.id} value={m.id}>{m.groupName} - {m.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className={`block text-xs font-bold mb-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Start Date</label>
                                    <select
                                        value={pasteStartDay}
                                        onChange={(e) => setPasteStartDay(e.target.value)}
                                        className={`w-full px-3 py-2 text-xs font-bold rounded-lg border outline-none ${
                                            isDark ? 'bg-[#0d1117] border-[#30363d] text-white' : 'bg-white border-slate-200 text-slate-900'
                                        }`}
                                    >
                                        {daysInMonth.map(d => (
                                            <option key={d.dateStr} value={d.dateStr}>{d.dateStr.split('-').reverse().join('/')} ({d.dayName})</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className={`block text-xs font-bold mb-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Field</label>
                                    <select
                                        value={pasteField}
                                        onChange={(e) => setPasteField(e.target.value as any)}
                                        className={`w-full px-3 py-2 text-xs font-bold rounded-lg border outline-none ${
                                            isDark ? 'bg-[#0d1117] border-[#30363d] text-white' : 'bg-white border-slate-200 text-slate-900'
                                        }`}
                                    >
                                        <option value="final_reading">Final Reading</option>
                                        <option value="initial_reading">Initial Reading</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className={`block text-xs font-bold mb-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                                    Paste Column Data (Ctrl+V)
                                </label>
                                <textarea
                                    rows={5}
                                    value={pasteRawText}
                                    onChange={(e) => setPasteRawText(e.target.value)}
                                    placeholder="Copy a column from Excel or Google Sheets and paste here (e.g. 105.2, 112.4, 120.1...)"
                                    className={`w-full p-3 text-xs font-mono rounded-lg border outline-none focus:ring-2 focus:ring-emerald-500/50 ${
                                        isDark ? 'bg-[#0d1117] border-[#30363d] text-white placeholder-slate-600' : 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400'
                                    }`}
                                />
                            </div>

                            {parsedPastePreview.length > 0 && (
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                            Live Preview ({parsedPastePreview.filter(p => p.value !== null).length} valid rows found)
                                        </span>
                                    </div>
                                    <div className={`max-h-40 overflow-y-auto rounded-lg border ${isDark ? 'border-[#30363d] bg-[#0d1117]' : 'border-slate-200 bg-white'}`}>
                                        <table className="w-full text-left text-xs border-collapse">
                                            <thead className={`sticky top-0 ${isDark ? 'bg-[#161b22] text-slate-400' : 'bg-slate-100 text-slate-600'}`}>
                                                <tr>
                                                    <th className="p-2 border-b border-r">Date</th>
                                                    <th className="p-2 border-b border-r">Target Meter</th>
                                                    <th className="p-2 border-b">Pasted Value</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {parsedPastePreview.map((row, i) => (
                                                    <tr key={i} className={`border-b border-slate-100 dark:border-slate-800 ${row.value === null ? 'opacity-40' : ''}`}>
                                                        <td className="p-2 border-r font-mono">{row.dateStr.split('-').reverse().join('/')} ({row.dayName})</td>
                                                        <td className="p-2 border-r">{row.meterName}</td>
                                                        <td className="p-2 font-bold text-emerald-600 dark:text-emerald-400">
                                                            {row.value !== null ? row.value : <span className="text-red-400">Invalid ({row.rawInput})</span>}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="pt-4 border-t border-slate-200 dark:border-[#30363d] flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setShowPasteModal(false)}
                                className={`px-4 py-2 rounded-lg font-medium text-xs ${isDark ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-slate-100 text-slate-600'}`}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleApplyExcelPaste}
                                disabled={parsedPastePreview.filter(p => p.value !== null).length === 0}
                                className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-bold text-xs shadow-md transition-all disabled:opacity-50 flex items-center gap-1.5"
                            >
                                <ClipboardCheck className="w-4 h-4" />
                                Apply {parsedPastePreview.filter(p => p.value !== null).length} Readings
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <Toast
                message={toast.message}
                type={toast.type}
                visible={toast.visible}
                onClose={() => setToast(prev => ({ ...prev, visible: false }))}
            />
        </div>
    );
}
