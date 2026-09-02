'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    Save, Calendar, Fuel, Zap, Clock, Download, Upload, X,
    FileSpreadsheet, ClipboardPaste, AlertTriangle, Layers, Filter, Check, Copy, Scissors, Trash2, Plus, Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Toast } from '../ui/Toast';

interface Generator {
    id: string;
    name: string;
    make?: string;
    capacity_kva?: number;
    tank_capacity_litres?: number;
    status: string;
    initial_kwh_reading?: number;
    initial_run_hours?: number;
    initial_diesel_level?: number;
}

interface DGTariff {
    id: string;
    cost_per_litre: number;
    effective_from: string;
}

interface DieselReading {
    id?: string;
    generator_id: string;
    reading_date: string;
    opening_hours: number | string;
    closing_hours: number | string | null;
    opening_kwh: number | string;
    closing_kwh: number | string | null;
    opening_diesel_level: number | string;
    closing_diesel_level: number | string | null;
    diesel_added_litres: number | string;
    computed_consumed_litres?: number | null;
    tariff_id?: string;
    tariff_rate_used?: number;
    computed_cost?: number;
    notes?: string | null;
}

type MetricViewMode = 'all' | 'hours' | 'kwh' | 'fuel' | 'cost';
type EditableField = 'closing_hours' | 'closing_kwh' | 'diesel_added_litres' | 'closing_diesel_level' | 'notes' | 'opening_diesel_level' | 'opening_kwh' | 'opening_hours';

interface DieselSpreadsheetLoggerProps {
    propertyId: string;
    isDark?: boolean;
    generators?: Generator[];
    activeTariffs?: Record<string, DGTariff>;
    onSaveSuccess?: () => void;
}

export default function DieselSpreadsheetLogger({
    propertyId,
    isDark = false,
    generators: initialGenerators,
    activeTariffs: initialTariffs,
    onSaveSuccess
}: DieselSpreadsheetLoggerProps) {
    const [month, setMonth] = useState<string>(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    const [viewMetric, setViewMetric] = useState<MetricViewMode>('fuel'); // Default to Fuel view (Initial, Added, Final, Cons)
    const [generators, setGenerators] = useState<Generator[]>(initialGenerators || []);
    const [activeTariffs, setActiveTariffs] = useState<Record<string, DGTariff>>(initialTariffs || {});
    const [readings, setReadings] = useState<Record<string, Record<string, DieselReading>>>({}); // { '2026-08-01': { 'gen-id': DieselReading } }
    
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Excel Mouse Selection State
    const [selectionStart, setSelectionStart] = useState<{ dayIndex: number; genId: string; field: EditableField } | null>(null);
    const [selectionEnd, setSelectionEnd] = useState<{ dayIndex: number; genId: string; field: EditableField } | null>(null);
    const [isMouseDownSelecting, setIsMouseDownSelecting] = useState(false);

    // Excel Import Modal State (Fallback helper)
    const [showPasteModal, setShowPasteModal] = useState(false);
    const [pasteTargetGenId, setPasteTargetGenId] = useState<string>('');
    const [pasteStartDay, setPasteStartDay] = useState<string>('');
    const [pasteField, setPasteField] = useState<EditableField>('closing_diesel_level');
    const [pasteRawText, setPasteRawText] = useState<string>('');

    // Toast State
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; visible: boolean }>({
        message: '',
        type: 'success',
        visible: false
    });

    // Inputs ref map for arrow key navigation: `cell-${dateStr}-${genId}-${field}`
    const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

    // Generate days of the month
    const daysInMonth = useMemo(() => {
        const [yearStr, monthStr] = month.split('-');
        const year = parseInt(yearStr, 10);
        const m = parseInt(monthStr, 10);
        const date = new Date(year, m, 0);
        const days = [];
        for (let i = 1; i <= date.getDate(); i++) {
            const d = new Date(year, m - 1, i);
            const dateStr = `${yearStr}-${monthStr}-${String(i).padStart(2, '0')}`;
            days.push({
                dateStr,
                dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
                dateNum: i
            });
        }
        return days;
    }, [month]);

    // Active editable fields list based on view mode
    const editableFields = useMemo<EditableField[]>(() => {
        if (viewMetric === 'hours') return ['opening_hours', 'closing_hours'];
        if (viewMetric === 'kwh') return ['opening_kwh', 'closing_kwh'];
        if (viewMetric === 'fuel') return ['diesel_added_litres', 'opening_diesel_level', 'closing_diesel_level'];
        if (viewMetric === 'cost') return ['notes'];
        return ['diesel_added_litres', 'opening_diesel_level', 'closing_diesel_level', 'opening_kwh', 'closing_kwh', 'opening_hours', 'closing_hours', 'notes'];
    }, [viewMetric]);

    // Flat list of target columns for multi-column horizontal paste mapping
    const flatColumns = useMemo(() => {
        const cols: { genId: string; genName: string; field: EditableField }[] = [];
        generators.forEach(gen => {
            editableFields.forEach(field => {
                cols.push({ genId: gen.id, genName: gen.name, field });
            });
        });
        return cols;
    }, [generators, editableFields]);

    // Fetch Generators if not provided via props
    const fetchGenerators = useCallback(async () => {
        try {
            const res = await fetch(`/api/properties/${propertyId}/generators`);
            if (res.ok) {
                const data = await res.json();
                setGenerators(data || []);
            }
        } catch (err) {
            console.error('Error fetching generators', err);
        }
    }, [propertyId]);

    // Fetch Tariffs
    const fetchTariffs = useCallback(async (gens: Generator[]) => {
        if (!gens || gens.length === 0) return;
        const today = new Date().toISOString().split('T')[0];
        const tariffsMap: Record<string, DGTariff> = {};
        await Promise.all(gens.map(async (gen) => {
            try {
                const res = await fetch(`/api/properties/${propertyId}/dg-tariffs?generatorId=${gen.id}&date=${today}`);
                if (res.ok) {
                    const t = await res.json();
                    if (t && t.id) tariffsMap[gen.id] = t;
                }
            } catch (e) {
                // silent
            }
        }));
        setActiveTariffs(tariffsMap);
    }, [propertyId]);

    useEffect(() => {
        if (!initialGenerators || initialGenerators.length === 0) {
            fetchGenerators();
        } else {
            setGenerators(initialGenerators);
        }
    }, [propertyId, initialGenerators, fetchGenerators]);

    useEffect(() => {
        if (generators.length > 0 && (!initialTariffs || Object.keys(initialTariffs).length === 0)) {
            fetchTariffs(generators);
        }
    }, [generators, initialTariffs, fetchTariffs]);

    // Fetch monthly readings & carry-forward
    const fetchMonthlyReadings = useCallback(async () => {
        if (!generators || generators.length === 0) {
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        try {
            const startDate = `${month}-01`;
            const [yearStr, monthStr] = month.split('-');
            const lastDay = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10), 0).getDate();
            const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

            const res = await fetch(`/api/properties/${propertyId}/diesel-readings?startDate=${startDate}&endDate=${endDate}`);
            const fetchedData: DieselReading[] = res.ok ? await res.json() : [];

            const monthAgoDate = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 2, 1).toISOString().split('T')[0];
            const prevRes = await fetch(`/api/properties/${propertyId}/diesel-readings?startDate=${monthAgoDate}&endDate=${startDate}`);
            const prevData: DieselReading[] = prevRes.ok ? await prevRes.json() : [];

            const rawReadings: Record<string, Record<string, DieselReading>> = {};
            daysInMonth.forEach(day => { rawReadings[day.dateStr] = {}; });

            fetchedData.forEach(r => {
                if (!rawReadings[r.reading_date]) rawReadings[r.reading_date] = {};
                rawReadings[r.reading_date][r.generator_id] = r;
            });

            const lastKnownState: Record<string, { hours: number; kwh: number; diesel: number }> = {};
            generators.forEach(gen => {
                lastKnownState[gen.id] = {
                    hours: gen.initial_run_hours || 0,
                    kwh: gen.initial_kwh_reading || 0,
                    diesel: gen.initial_diesel_level || 0
                };
            });

            const sortedPrev = [...prevData].sort((a, b) => a.reading_date.localeCompare(b.reading_date));
            sortedPrev.forEach(r => {
                if (r.closing_hours !== null && r.closing_hours !== undefined && !isNaN(Number(r.closing_hours))) {
                    lastKnownState[r.generator_id].hours = Number(r.closing_hours);
                }
                if (r.closing_kwh !== null && r.closing_kwh !== undefined && !isNaN(Number(r.closing_kwh))) {
                    lastKnownState[r.generator_id].kwh = Number(r.closing_kwh);
                }
                if (r.closing_diesel_level !== null && r.closing_diesel_level !== undefined && !isNaN(Number(r.closing_diesel_level))) {
                    lastKnownState[r.generator_id].diesel = Number(r.closing_diesel_level);
                }
            });

            const processedReadings: Record<string, Record<string, DieselReading>> = {};
            const todayStr = new Date().toISOString().split('T')[0];

            daysInMonth.forEach(day => {
                processedReadings[day.dateStr] = {};
                const isFutureDay = day.dateStr > todayStr;

                generators.forEach(gen => {
                    const existing = rawReadings[day.dateStr]?.[gen.id];

                    // For Day 1 of the month, preserve saved initial opening readings if present
                    if (day.dateNum === 1 && existing) {
                        if (existing.opening_hours !== null && existing.opening_hours !== undefined) {
                            lastKnownState[gen.id].hours = Math.round(Number(existing.opening_hours) * 100) / 100;
                        }
                        if (existing.opening_kwh !== null && existing.opening_kwh !== undefined) {
                            lastKnownState[gen.id].kwh = Math.round(Number(existing.opening_kwh) * 100) / 100;
                        }
                        if (existing.opening_diesel_level !== null && existing.opening_diesel_level !== undefined) {
                            lastKnownState[gen.id].diesel = Math.round(Number(existing.opening_diesel_level) * 100) / 100;
                        }
                    }

                    const openState = { ...lastKnownState[gen.id] };

                    if (existing) {
                        const closingHours = existing.closing_hours !== null && existing.closing_hours !== undefined ? existing.closing_hours : '';
                        const closingKwh = existing.closing_kwh !== null && existing.closing_kwh !== undefined ? existing.closing_kwh : '';
                        const closingDiesel = existing.closing_diesel_level !== null && existing.closing_diesel_level !== undefined ? existing.closing_diesel_level : '';
                        const added = existing.diesel_added_litres !== undefined ? existing.diesel_added_litres : 0;

                        processedReadings[day.dateStr][gen.id] = {
                            id: existing.id,
                            generator_id: gen.id,
                            reading_date: day.dateStr,
                            opening_hours: openState.hours,
                            closing_hours: closingHours,
                            opening_kwh: openState.kwh,
                            closing_kwh: closingKwh,
                            opening_diesel_level: openState.diesel,
                            closing_diesel_level: closingDiesel,
                            diesel_added_litres: added,
                            notes: existing.notes || ''
                        };

                        if (closingHours !== '' && !isNaN(Number(closingHours))) lastKnownState[gen.id].hours = Math.round(Number(closingHours) * 100) / 100;
                        if (closingKwh !== '' && !isNaN(Number(closingKwh))) lastKnownState[gen.id].kwh = Math.round(Number(closingKwh) * 100) / 100;
                        if (closingDiesel !== '' && !isNaN(Number(closingDiesel))) lastKnownState[gen.id].diesel = Math.round(Number(closingDiesel) * 100) / 100;
                    } else {
                        processedReadings[day.dateStr][gen.id] = {
                            generator_id: gen.id,
                            reading_date: day.dateStr,
                            opening_hours: openState.hours,
                            closing_hours: '',
                            opening_kwh: openState.kwh,
                            closing_kwh: '',
                            opening_diesel_level: openState.diesel,
                            closing_diesel_level: '',
                            diesel_added_litres: 0,
                            notes: ''
                        };
                    }
                });
            });

            setReadings(processedReadings);
        } catch (err) {
            console.error('Error fetching monthly readings', err);
            setToast({ message: 'Failed to load monthly readings', type: 'error', visible: true });
        } finally {
            setIsLoading(false);
        }
    }, [propertyId, month, generators, daysInMonth]);

    useEffect(() => {
        fetchMonthlyReadings();
    }, [fetchMonthlyReadings]);

    // Single value change
    const handleCellChange = (
        dateStr: string,
        genId: string,
        field: EditableField,
        value: string
    ) => {
        applyBatchValues([{ dateStr, genId, field, value }]);
    };

    // Batch Value Application & Carry-Forward Engine
    const applyBatchValues = (entries: { dateStr: string; genId: string; field: EditableField; value: string }[]) => {
        setReadings(prev => {
            const nextState = { ...prev };

            entries.forEach(({ dateStr, genId, field, value }) => {
                if (!nextState[dateStr]) nextState[dateStr] = {};

                const cur = nextState[dateStr][genId] || {
                    generator_id: genId,
                    reading_date: dateStr,
                    opening_hours: 0,
                    closing_hours: '',
                    opening_kwh: 0,
                    closing_kwh: '',
                    opening_diesel_level: 0,
                    closing_diesel_level: '',
                    diesel_added_litres: 0,
                    notes: ''
                };

                const updatedEntry = { ...cur };

                if (field === 'notes') {
                    updatedEntry.notes = value;
                } else {
                    updatedEntry[field] = value;
                }

                nextState[dateStr][genId] = updatedEntry;
            });

            const todayStr = new Date().toISOString().split('T')[0];

            // Recalculate carry-forward across all generators chronologically
            generators.forEach(gen => {
                let runningHours = nextState[daysInMonth[0]?.dateStr]?.[gen.id]?.opening_hours || gen.initial_run_hours || 0;
                let runningKwh = nextState[daysInMonth[0]?.dateStr]?.[gen.id]?.opening_kwh || gen.initial_kwh_reading || 0;
                let runningDiesel = nextState[daysInMonth[0]?.dateStr]?.[gen.id]?.opening_diesel_level || gen.initial_diesel_level || 0;

                daysInMonth.forEach((d, idx) => {
                    if (nextState[d.dateStr]?.[gen.id]) {
                        const rowEntry = { ...nextState[d.dateStr][gen.id] };

                        if (idx === 0) {
                            if (rowEntry.opening_hours !== null && rowEntry.opening_hours !== undefined && !isNaN(Number(rowEntry.opening_hours))) {
                                runningHours = Math.round(Number(rowEntry.opening_hours) * 100) / 100;
                            }
                            if (rowEntry.opening_kwh !== null && rowEntry.opening_kwh !== undefined && !isNaN(Number(rowEntry.opening_kwh))) {
                                runningKwh = Math.round(Number(rowEntry.opening_kwh) * 100) / 100;
                            }
                            if (rowEntry.opening_diesel_level !== null && rowEntry.opening_diesel_level !== undefined && !isNaN(Number(rowEntry.opening_diesel_level))) {
                                runningDiesel = Math.round(Number(rowEntry.opening_diesel_level) * 100) / 100;
                            }
                        }

                        rowEntry.opening_hours = runningHours;
                        rowEntry.opening_kwh = runningKwh;
                        rowEntry.opening_diesel_level = runningDiesel;

                        if (rowEntry.closing_hours !== '' && rowEntry.closing_hours !== null && !isNaN(Number(rowEntry.closing_hours))) {
                            runningHours = Math.round(Number(rowEntry.closing_hours) * 100) / 100;
                        }
                        if (rowEntry.closing_kwh !== '' && rowEntry.closing_kwh !== null && !isNaN(Number(rowEntry.closing_kwh))) {
                            runningKwh = Math.round(Number(rowEntry.closing_kwh) * 100) / 100;
                        }
                        if (rowEntry.closing_diesel_level !== '' && rowEntry.closing_diesel_level !== null && !isNaN(Number(rowEntry.closing_diesel_level))) {
                            runningDiesel = Math.round(Number(rowEntry.closing_diesel_level) * 100) / 100;
                        }

                        nextState[d.dateStr][gen.id] = rowEntry;
                    }
                });
            });

            return nextState;
        });
    };

    // Direct Native Excel Clipboard Paste (`Ctrl+V`) on cell input
    const handleInCellPaste = (
        e: React.ClipboardEvent<HTMLInputElement>,
        startDateStr: string,
        startGenId: string,
        startField: EditableField
    ) => {
        const rawText = e.clipboardData.getData('text');
        if (!rawText) return;

        const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
        if (lines.length <= 1 && !lines[0]?.includes('\t')) {
            return;
        }

        e.preventDefault();

        const startDayIdx = daysInMonth.findIndex(d => d.dateStr === startDateStr);
        const startColIdx = flatColumns.findIndex(c => c.genId === startGenId && c.field === startField);

        if (startDayIdx === -1 || startColIdx === -1) return;

        const entries: { dateStr: string; genId: string; field: EditableField; value: string }[] = [];

        lines.forEach((line, rowOffset) => {
            const targetDayIdx = startDayIdx + rowOffset;
            if (targetDayIdx >= daysInMonth.length) return;
            const targetDateStr = daysInMonth[targetDayIdx].dateStr;

            const colValues = line.split('\t');
            colValues.forEach((valStr, colOffset) => {
                const targetColIdx = startColIdx + colOffset;
                if (targetColIdx >= flatColumns.length) return;

                const targetCol = flatColumns[targetColIdx];
                const cleanVal = valStr.trim().replace(/,/g, '');

                entries.push({
                    dateStr: targetDateStr,
                    genId: targetCol.genId,
                    field: targetCol.field,
                    value: cleanVal
                });
            });
        });

        if (entries.length > 0) {
            applyBatchValues(entries);
            setToast({ message: `📋 Pasted ${entries.length} cells from Excel!`, type: 'success', visible: true });
        }
    };

    // Keyboard Arrow / Tab / Enter Navigation
    const handleCellKeyDown = (
        e: React.KeyboardEvent<HTMLInputElement>,
        dateStr: string,
        genId: string,
        field: EditableField
    ) => {
        const dayIdx = daysInMonth.findIndex(d => d.dateStr === dateStr);
        const colIdx = flatColumns.findIndex(c => c.genId === genId && c.field === field);

        if (dayIdx === -1 || colIdx === -1) return;

        let targetDayIdx = dayIdx;
        let targetColIdx = colIdx;
        let shouldNavigate = false;

        if (e.key === 'Enter') {
            e.preventDefault();
            shouldNavigate = true;
            targetDayIdx = e.shiftKey ? Math.max(0, dayIdx - 1) : Math.min(daysInMonth.length - 1, dayIdx + 1);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            shouldNavigate = true;
            targetDayIdx = Math.min(daysInMonth.length - 1, dayIdx + 1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            shouldNavigate = true;
            targetDayIdx = Math.max(0, dayIdx - 1);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            shouldNavigate = true;
            if (e.shiftKey) {
                targetColIdx = colIdx > 0 ? colIdx - 1 : flatColumns.length - 1;
                if (colIdx === 0 && dayIdx > 0) targetDayIdx = dayIdx - 1;
            } else {
                targetColIdx = colIdx < flatColumns.length - 1 ? colIdx + 1 : 0;
                if (colIdx === flatColumns.length - 1 && dayIdx < daysInMonth.length - 1) targetDayIdx = dayIdx + 1;
            }
        }

        if (shouldNavigate) {
            const targetCol = flatColumns[targetColIdx];
            const targetDateStr = daysInMonth[targetDayIdx].dateStr;
            const refKey = `cell-${targetDateStr}-${targetCol.genId}-${targetCol.field}`;
            const targetInput = inputRefs.current[refKey];
            if (targetInput) {
                targetInput.focus();
                targetInput.select();
            }
        }
    };

    // Excel Mouse Selection Logic
    const selectedRangeBounds = useMemo(() => {
        if (!selectionStart || !selectionEnd) return null;
        const startDayIdx = Math.min(selectionStart.dayIndex, selectionEnd.dayIndex);
        const endDayIdx = Math.max(selectionStart.dayIndex, selectionEnd.dayIndex);

        const startColIdx = flatColumns.findIndex(c => c.genId === selectionStart.genId && c.field === selectionStart.field);
        const endColIdx = flatColumns.findIndex(c => c.genId === selectionEnd.genId && c.field === selectionEnd.field);

        if (startColIdx === -1 || endColIdx === -1) return null;

        const minColIdx = Math.min(startColIdx, endColIdx);
        const maxColIdx = Math.max(startColIdx, endColIdx);

        return { startDayIdx, endDayIdx, minColIdx, maxColIdx };
    }, [selectionStart, selectionEnd, flatColumns]);

    const isCellSelected = (dayIndex: number, genId: string, field: EditableField) => {
        if (!selectedRangeBounds) return false;
        if (dayIndex < selectedRangeBounds.startDayIdx || dayIndex > selectedRangeBounds.endDayIdx) return false;
        const colIdx = flatColumns.findIndex(c => c.genId === genId && c.field === field);
        if (colIdx === -1) return false;
        return colIdx >= selectedRangeBounds.minColIdx && colIdx <= selectedRangeBounds.maxColIdx;
    };

    const handleCellMouseDown = (dayIndex: number, genId: string, field: EditableField) => {
        setSelectionStart({ dayIndex, genId, field });
        setSelectionEnd({ dayIndex, genId, field });
        setIsMouseDownSelecting(true);
    };

    const handleCellMouseEnter = (dayIndex: number, genId: string, field: EditableField) => {
        if (isMouseDownSelecting) {
            setSelectionEnd({ dayIndex, genId, field });
        }
    };

    useEffect(() => {
        const handleGlobalMouseUp = () => { setIsMouseDownSelecting(false); };
        window.addEventListener('mouseup', handleGlobalMouseUp);
        return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }, []);

    // Global Hotkeys (`Ctrl+C`, `Ctrl+X`, `Delete`)
    useEffect(() => {
        const handleGlobalHotkeys = (e: KeyboardEvent) => {
            if (!selectedRangeBounds) return;
            const activeElem = document.activeElement;
            if (activeElem && activeElem.tagName === 'TEXTAREA') return;

            const { startDayIdx, endDayIdx, minColIdx, maxColIdx } = selectedRangeBounds;
            const rowCount = endDayIdx - startDayIdx + 1;
            const colCount = maxColIdx - minColIdx + 1;

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
                const lines: string[] = [];
                for (let dIdx = startDayIdx; dIdx <= endDayIdx; dIdx++) {
                    const dateStr = daysInMonth[dIdx]?.dateStr;
                    if (!dateStr) continue;
                    const rowVals: string[] = [];
                    for (let cIdx = minColIdx; cIdx <= maxColIdx; cIdx++) {
                        const col = flatColumns[cIdx];
                        if (!col) continue;
                        const r = readings[dateStr]?.[col.genId];
                        const val = r?.[col.field] ?? '';
                        rowVals.push(String(val));
                    }
                    lines.push(rowVals.join('\t'));
                }
                const tsvText = lines.join('\n');
                navigator.clipboard.writeText(tsvText);
                setToast({ message: `Copied ${rowCount}×${colCount} cells to clipboard`, type: 'success', visible: true });
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
                e.preventDefault();
                const lines: string[] = [];
                const clearEntries: { dateStr: string; genId: string; field: EditableField; value: string }[] = [];

                for (let dIdx = startDayIdx; dIdx <= endDayIdx; dIdx++) {
                    const dateStr = daysInMonth[dIdx]?.dateStr;
                    if (!dateStr) continue;
                    const rowVals: string[] = [];
                    for (let cIdx = minColIdx; cIdx <= maxColIdx; cIdx++) {
                        const col = flatColumns[cIdx];
                        if (!col) continue;
                        const r = readings[dateStr]?.[col.genId];
                        const val = r?.[col.field] ?? '';
                        rowVals.push(String(val));
                        clearEntries.push({ dateStr, genId: col.genId, field: col.field, value: '' });
                    }
                    lines.push(rowVals.join('\t'));
                }
                navigator.clipboard.writeText(lines.join('\n'));
                applyBatchValues(clearEntries);
                setToast({ message: `Cut ${rowCount}×${colCount} cells to clipboard`, type: 'success', visible: true });
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                if (activeElem && activeElem.tagName === 'INPUT') return;
                e.preventDefault();
                const clearEntries: { dateStr: string; genId: string; field: EditableField; value: string }[] = [];
                for (let dIdx = startDayIdx; dIdx <= endDayIdx; dIdx++) {
                    const dateStr = daysInMonth[dIdx]?.dateStr;
                    if (!dateStr) continue;
                    for (let cIdx = minColIdx; cIdx <= maxColIdx; cIdx++) {
                        const col = flatColumns[cIdx];
                        if (col) clearEntries.push({ dateStr, genId: col.genId, field: col.field, value: '' });
                    }
                }
                applyBatchValues(clearEntries);
                setToast({ message: `Cleared ${rowCount}×${colCount} cells`, type: 'success', visible: true });
            }
        };

        window.addEventListener('keydown', handleGlobalHotkeys);
        return () => window.removeEventListener('keydown', handleGlobalHotkeys);
    }, [selectedRangeBounds, daysInMonth, flatColumns, readings]);

    // Batch Save Spreadsheet Data
    const handleSaveAll = async () => {
        setIsSaving(true);
        try {
            const readingsToSave: any[] = [];

            Object.keys(readings).forEach(dateStr => {
                Object.keys(readings[dateStr]).forEach(genId => {
                    const r = readings[dateStr][genId];
                    const hasClosingHours = r.closing_hours !== '' && r.closing_hours !== null && r.closing_hours !== undefined;
                    const hasClosingKwh = r.closing_kwh !== '' && r.closing_kwh !== null && r.closing_kwh !== undefined;
                    const hasClosingDiesel = r.closing_diesel_level !== '' && r.closing_diesel_level !== null && r.closing_diesel_level !== undefined;
                    const hasAdded = Number(r.diesel_added_litres) > 0;

                    if (hasClosingHours || hasClosingKwh || hasClosingDiesel || hasAdded) {
                        const openingDiesel = Number(r.opening_diesel_level) || 0;
                        const added = Number(r.diesel_added_litres) || 0;
                        const closingDiesel = hasClosingDiesel ? Number(r.closing_diesel_level) : openingDiesel;
                        const consumedLitres = Math.max(0, (openingDiesel + added) - closingDiesel);

                        readingsToSave.push({
                            generator_id: genId,
                            reading_date: dateStr,
                            opening_hours: Number(r.opening_hours) || 0,
                            closing_hours: r.closing_hours !== '' ? Number(r.closing_hours) : null,
                            opening_kwh: Number(r.opening_kwh) || 0,
                            closing_kwh: r.closing_kwh !== '' ? Number(r.closing_kwh) : null,
                            opening_diesel_level: openingDiesel,
                            closing_diesel_level: closingDiesel,
                            diesel_added_litres: added,
                            computed_consumed_litres: consumedLitres,
                            notes: r.notes || null
                        });
                    }
                });
            });

            if (readingsToSave.length === 0) {
                setToast({ message: 'No entries to save', type: 'error', visible: true });
                setIsSaving(false);
                return;
            }

            const res = await fetch(`/api/properties/${propertyId}/diesel-readings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ readings: readingsToSave })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to save readings');
            }

            setToast({ message: `Successfully saved ${readingsToSave.length} daily logs!`, type: 'success', visible: true });
            if (onSaveSuccess) onSaveSuccess();
            fetchMonthlyReadings();
        } catch (err: any) {
            console.error('Error saving readings:', err);
            setToast({ message: err.message || 'Failed to save spreadsheet data', type: 'error', visible: true });
        } finally {
            setIsSaving(false);
        }
    };

    // Excel Modal Helper Paste Execution
    const handleApplyPasteModal = () => {
        if (!pasteRawText.trim() || !pasteTargetGenId || !pasteStartDay) {
            setToast({ message: 'Please select target generator, start date, and paste content', type: 'error', visible: true });
            return;
        }

        const lines = pasteRawText.trim().split(/\r?\n/);
        const values = lines.map(line => line.split('\t')[0].trim()).filter(Boolean);

        if (values.length === 0) return;

        const startIdx = daysInMonth.findIndex(d => d.dateStr === pasteStartDay);
        if (startIdx === -1) return;

        const entries: { dateStr: string; genId: string; field: EditableField; value: string }[] = [];
        values.forEach((valStr, i) => {
            const targetDay = daysInMonth[startIdx + i];
            if (!targetDay) return;
            entries.push({ dateStr: targetDay.dateStr, genId: pasteTargetGenId, field: pasteField, value: valStr });
        });

        applyBatchValues(entries);
        setToast({ message: `Pasted ${entries.length} entries starting ${pasteStartDay}!`, type: 'success', visible: true });
        setShowPasteModal(false);
        setPasteRawText('');
    };

    // Export to Excel / CSV
    const handleExportCSV = () => {
        let csv = 'Date,Day,Generator Name,Opening Hours,Closing Hours,Run Hours,Opening kWh,Closing kWh,kWh Consumed,Opening Tank Level (L),Added Today (L),Closing Level (L),Consumed Litres (L),Tariff Rate (Rs/L),Computed Cost (Rs),Notes\n';

        daysInMonth.forEach(day => {
            generators.forEach(gen => {
                const r = readings[day.dateStr]?.[gen.id];
                if (r) {
                    const openH = Number(r.opening_hours) || 0;
                    const closeH = r.closing_hours !== '' && r.closing_hours !== null ? Number(r.closing_hours) : openH;
                    const runH = Math.max(0, closeH - openH);

                    const openK = Number(r.opening_kwh) || 0;
                    const closeK = r.closing_kwh !== '' && r.closing_kwh !== null ? Number(r.closing_kwh) : openK;
                    const runK = Math.max(0, closeK - openK);

                    const openD = Number(r.opening_diesel_level) || 0;
                    const addedD = Number(r.diesel_added_litres) || 0;
                    const closeD = r.closing_diesel_level !== '' && r.closing_diesel_level !== null ? Number(r.closing_diesel_level) : openD;
                    const consD = Math.max(0, (openD + addedD) - closeD);

                    const rate = activeTariffs[gen.id]?.cost_per_litre || 0;
                    const cost = consD * rate;

                    csv += `${day.dateStr},${day.dayName},"${gen.name}",${openH},${closeH},${runH},${openK},${closeK},${runK},${openD},${addedD},${closeD},${consD},${rate},${cost.toFixed(2)},"${r.notes || ''}"\n`;
                }
            });
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Diesel_Log_${month}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (isLoading) {
        return (
            <div className={`p-8 text-center rounded-3xl border ${isDark ? 'bg-[#161b22] border-[#30363d]' : 'bg-white border-slate-200'} shadow-sm`}>
                <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-sm font-bold text-slate-500">Loading Diesel Spreadsheet Grid...</p>
            </div>
        );
    }

    return (
        <div className={`flex flex-col h-[calc(100vh-140px)] min-h-[450px] rounded-2xl overflow-hidden border ${isDark ? 'bg-[#0d1117] border-[#30363d]' : 'bg-slate-50 border-slate-200'} select-none`}>
            {/* Top Controls Bar */}
            <div className={`p-3 border-b flex flex-wrap items-center justify-between gap-3 ${isDark ? 'bg-[#161b22] border-[#30363d]' : 'bg-white border-slate-200'}`}>
                {/* Left Controls */}
                <div className="flex flex-wrap items-center gap-3">
                    {/* Month Selector */}
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${isDark ? 'bg-[#0d1117] border-[#30363d]' : 'bg-slate-50 border-slate-200'}`}>
                        <Calendar className="w-4 h-4 text-slate-500" />
                        <input
                            type="month"
                            value={month}
                            onChange={(e) => setMonth(e.target.value)}
                            className="bg-transparent text-sm font-bold focus:outline-none cursor-pointer"
                        />
                    </div>

                    {/* Metric View Mode Toggle */}
                    <div className={`flex items-center p-0.5 rounded-lg border text-xs font-bold ${isDark ? 'bg-[#0d1117] border-[#30363d]' : 'bg-slate-100 border-slate-200'}`}>
                        <button
                            onClick={() => setViewMetric('fuel')}
                            className={`px-2.5 py-1 rounded-md transition-all ${viewMetric === 'fuel' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
                        >
                            Diesel Fuel (L)
                        </button>
                        <button
                            onClick={() => setViewMetric('hours')}
                            className={`px-2.5 py-1 rounded-md transition-all ${viewMetric === 'hours' ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
                        >
                            Run Hours
                        </button>
                        <button
                            onClick={() => setViewMetric('kwh')}
                            className={`px-2.5 py-1 rounded-md transition-all ${viewMetric === 'kwh' ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
                        >
                            kWh Energy
                        </button>
                        <button
                            onClick={() => setViewMetric('all')}
                            className={`px-2.5 py-1 rounded-md transition-all ${viewMetric === 'all' ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
                        >
                            All Metrics
                        </button>
                    </div>
                </div>

                {/* Right Action Buttons */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => {
                            if (generators.length > 0) setPasteTargetGenId(generators[0].id);
                            if (daysInMonth.length > 0) setPasteStartDay(daysInMonth[0].dateStr);
                            setPasteRawText('');
                            setShowPasteModal(true);
                        }}
                        className={`px-3 py-1.5 rounded-lg font-bold text-xs whitespace-nowrap transition-colors flex items-center gap-1.5 border border-dashed ${
                            isDark ? 'border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10' : 'border-emerald-500/40 text-emerald-700 bg-emerald-50/50 hover:bg-emerald-100/60'
                        }`}
                        title="Paste column data copied from Excel"
                    >
                        <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                        Paste from Excel
                    </button>

                    <button
                        onClick={handleExportCSV}
                        className={`px-3 py-1.5 rounded-lg font-bold text-xs whitespace-nowrap transition-colors flex items-center gap-1.5 border ${
                            isDark ? 'border-[#30363d] text-slate-300 hover:bg-slate-800' : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                    >
                        <Download className="w-4 h-4" />
                        Export CSV
                    </button>

                    <button
                        onClick={handleSaveAll}
                        disabled={isSaving}
                        className="px-5 py-1.5 bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-md shadow-emerald-500/20 hover:bg-emerald-600 transition-all flex items-center gap-1.5 disabled:opacity-50"
                    >
                        {isSaving ? <Activity className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Readings
                    </button>
                </div>
            </div>

            {/* Main Spreadsheet Grid (Visual Parity with Electricity Logger) */}
            <div className="flex-1 overflow-auto relative">
                <table className="w-full border-collapse min-w-max text-sm">
                    <thead className={`sticky top-0 z-40 ${isDark ? 'bg-[#161b22] text-slate-200' : 'bg-white text-slate-700'} shadow-sm`}>
                        {/* Group Header Row (Daily Totals & Generators) */}
                        <tr>
                            <th colSpan={2} className={`sticky left-0 z-50 border-r border-b p-2 ${isDark ? 'bg-[#161b22] border-[#30363d]' : 'bg-white border-slate-200'}`}></th>
                            {/* Summary Header */}
                            <th colSpan={3} className={`border-r border-b p-2 text-center text-xs font-black uppercase tracking-wider ${isDark ? 'bg-sky-950/60 border-[#30363d] text-sky-200' : 'bg-sky-100/90 border-slate-300 text-sky-950'}`}>
                                Daily Totals Summary
                            </th>
                            {generators.map((gen) => {
                                let colSpan = 3;
                                if (viewMetric === 'fuel') colSpan = 4;
                                if (viewMetric === 'all') colSpan = 11;

                                return (
                                    <th
                                        key={gen.id}
                                        colSpan={colSpan}
                                        className={`border-r border-b p-2 text-center text-sm font-black tracking-wider ${isDark ? 'bg-[#161b22] border-[#30363d] text-white' : 'bg-slate-100/50 border-slate-200 text-black'}`}
                                    >
                                        <div className="flex items-center justify-center gap-2 uppercase">
                                            <Fuel className="w-4 h-4 text-amber-500" />
                                            <span>{gen.name}</span>
                                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-600'}`}>
                                                {gen.capacity_kva ? `${gen.capacity_kva} kVA` : 'DG'}
                                            </span>
                                        </div>
                                    </th>
                                );
                            })}
                        </tr>

                        {/* Column Titles Header Row */}
                        <tr>
                            <th className={`sticky left-0 z-50 border-r border-b p-1.5 w-24 text-center text-[10px] uppercase font-bold ${isDark ? 'bg-[#161b22] border-[#30363d] text-slate-400' : 'bg-white border-slate-200 text-slate-600'}`}>
                                Date
                            </th>
                            <th className={`sticky left-[96px] z-50 border-r border-b p-1.5 w-14 text-center text-[10px] uppercase font-bold ${isDark ? 'bg-[#161b22] border-[#30363d] text-slate-400' : 'bg-white border-slate-200 text-slate-600'}`}>
                                Day
                            </th>
                            
                            {/* Summary Columns Header */}
                            <th className={`border-r border-b p-1 text-[9px] text-orange-800 dark:text-orange-300 font-extrabold w-24 text-center ${isDark ? 'bg-orange-950/40 border-[#30363d]' : 'bg-orange-100/60 border-slate-300'}`}>Total Cons (L)</th>
                            <th className={`border-r border-b p-1 text-[9px] text-amber-900 dark:text-amber-300 font-extrabold w-28 text-center ${isDark ? 'bg-amber-950/40 border-[#30363d]' : 'bg-amber-100/60 border-slate-300'}`}>Total KWH Consumption</th>
                            <th className={`border-r border-b p-1 text-[9px] text-sky-900 dark:text-sky-300 font-extrabold w-24 text-center ${isDark ? 'bg-sky-950/40 border-[#30363d]' : 'bg-sky-100/60 border-slate-300'}`}>Total Run Hrs</th>

                            {generators.map((gen) => (
                                <React.Fragment key={gen.id}>
                                    {(viewMetric === 'fuel') && (
                                        <>
                                            <th className={`border-r border-b p-1 text-[9px] text-red-600 dark:text-red-400 font-bold w-14 text-center ${isDark ? 'bg-red-500/10 border-[#30363d]' : 'bg-red-50 border-slate-200'}`}>Add</th>
                                            <th className={`border-r border-b p-1 text-[9px] text-emerald-800 dark:text-emerald-300 font-semibold w-16 text-center ${isDark ? 'bg-emerald-500/10 border-[#30363d]' : 'bg-emerald-50/80 border-slate-200'}`}>open</th>
                                            <th className={`border-r border-b p-1 text-[9px] text-emerald-800 dark:text-emerald-300 font-semibold w-20 text-center ${isDark ? 'bg-emerald-500/10 border-[#30363d]' : 'bg-emerald-50/80 border-slate-200'}`}>Close</th>
                                            <th className={`border-r border-b p-1 text-[9px] text-orange-800 dark:text-orange-300 font-extrabold w-16 text-center ${isDark ? 'bg-orange-950/40 border-[#30363d]' : 'bg-orange-100/60 border-slate-200'}`}>Cons</th>
                                        </>
                                    )}
                                    {(viewMetric === 'hours') && (
                                        <>
                                            <th className={`border-r border-b p-1 text-[9px] text-emerald-800 dark:text-emerald-300 font-semibold w-20 text-center ${isDark ? 'bg-emerald-500/10 border-[#30363d]' : 'bg-emerald-50/80 border-slate-200'}`}>Run Hrs Opening</th>
                                            <th className={`border-r border-b p-1 text-[9px] text-emerald-800 dark:text-emerald-300 font-semibold w-20 text-center ${isDark ? 'bg-emerald-500/10 border-[#30363d]' : 'bg-emerald-50/80 border-slate-200'}`}>Run Hrs Closing</th>
                                            <th className={`border-r border-b p-1 text-[9px] text-orange-800 dark:text-orange-300 font-extrabold w-20 text-center ${isDark ? 'bg-orange-950/40 border-[#30363d]' : 'bg-orange-100/60 border-slate-200'}`}>Consumption</th>
                                        </>
                                    )}
                                    {(viewMetric === 'kwh') && (
                                        <>
                                            <th className={`border-r border-b p-1 text-[9px] text-emerald-800 dark:text-emerald-300 font-semibold w-20 text-center ${isDark ? 'bg-emerald-500/10 border-[#30363d]' : 'bg-emerald-50/80 border-slate-200'}`}>KWH Opening</th>
                                            <th className={`border-r border-b p-1 text-[9px] text-emerald-800 dark:text-emerald-300 font-semibold w-20 text-center ${isDark ? 'bg-emerald-500/10 border-[#30363d]' : 'bg-emerald-50/80 border-slate-200'}`}>KWH Closing</th>
                                            <th className={`border-r border-b p-1 text-[9px] text-orange-800 dark:text-orange-300 font-extrabold w-20 text-center ${isDark ? 'bg-orange-950/40 border-[#30363d]' : 'bg-orange-100/60 border-slate-200'}`}>Consumption</th>
                                        </>
                                    )}
                                    {(viewMetric === 'all') && (
                                        <>
                                            <th className={`border-r border-b p-1 text-[9px] text-red-600 dark:text-red-400 font-bold w-14 text-center ${isDark ? 'bg-red-500/10 border-[#30363d]' : 'bg-red-50 border-slate-200'}`}>Add</th>
                                            <th className={`border-r border-b p-1 text-[9px] text-emerald-800 dark:text-emerald-300 font-semibold w-16 text-center ${isDark ? 'bg-emerald-500/10 border-[#30363d]' : 'bg-emerald-50/80 border-slate-200'}`}>open</th>
                                            <th className={`border-r border-b p-1 text-[9px] text-emerald-800 dark:text-emerald-300 font-semibold w-16 text-center ${isDark ? 'bg-emerald-500/10 border-[#30363d]' : 'bg-emerald-50/80 border-slate-200'}`}>Close</th>
                                            <th className={`border-r border-b p-1 text-[9px] text-orange-800 dark:text-orange-300 font-extrabold w-16 text-center ${isDark ? 'bg-orange-950/40 border-[#30363d]' : 'bg-orange-100/60 border-slate-200'}`}>Cons</th>
                                            <th className={`border-r border-b p-1 text-[9px] text-emerald-800 dark:text-emerald-300 font-semibold w-20 text-center ${isDark ? 'bg-emerald-500/10 border-[#30363d]' : 'bg-emerald-50/80 border-slate-200'}`}>KWH Opening</th>
                                            <th className={`border-r border-b p-1 text-[9px] text-emerald-800 dark:text-emerald-300 font-semibold w-20 text-center ${isDark ? 'bg-emerald-500/10 border-[#30363d]' : 'bg-emerald-50/80 border-slate-200'}`}>KWH Closing</th>
                                            <th className={`border-r border-b p-1 text-[9px] text-orange-800 dark:text-orange-300 font-extrabold w-20 text-center ${isDark ? 'bg-orange-950/40 border-[#30363d]' : 'bg-orange-100/60 border-slate-200'}`}>KWH Cons</th>
                                            <th className={`border-r border-b p-1 text-[9px] text-emerald-800 dark:text-emerald-300 font-semibold w-20 text-center ${isDark ? 'bg-emerald-500/10 border-[#30363d]' : 'bg-emerald-50/80 border-slate-200'}`}>Run Hrs Opening</th>
                                            <th className={`border-r border-b p-1 text-[9px] text-emerald-800 dark:text-emerald-300 font-semibold w-20 text-center ${isDark ? 'bg-emerald-500/10 border-[#30363d]' : 'bg-emerald-50/80 border-slate-200'}`}>Run Hrs Closing</th>
                                            <th className={`border-r border-b p-1 text-[9px] text-orange-800 dark:text-orange-300 font-extrabold w-20 text-center ${isDark ? 'bg-orange-950/40 border-[#30363d]' : 'bg-orange-100/60 border-slate-200'}`}>Run Hrs Cons</th>
                                            <th className={`border-r border-b p-1 text-[9px] text-slate-500 font-semibold w-24 text-center ${isDark ? 'border-[#30363d]' : 'border-slate-200'}`}>Remarks</th>
                                        </>
                                    )}
                                </React.Fragment>
                            ))}
                        </tr>
                    </thead>

                    {/* Table Body */}
                    <tbody>
                        {daysInMonth.map((day, rowIndex) => {
                            const isWeekend = day.dayName === 'Sat' || day.dayName === 'Sun';
                            const rowBg = isWeekend ? (isDark ? 'bg-[#21262d]/50' : 'bg-slate-50') : (isDark ? 'bg-[#0d1117]' : 'bg-white');
                            const formattedDate = day.dateStr.split('-').reverse().join('/');

                            // Calculate daily summary totals across all generators
                            let dailyTotalDieselCons = 0;
                            let dailyTotalKwhCons = 0;
                            let dailyTotalRunHrs = 0;
                            let hasDieselCons = false;
                            let hasKwhCons = false;
                            let hasRunHrs = false;

                            generators.forEach((gen) => {
                                const r = readings[day.dateStr]?.[gen.id];
                                if (!r) return;

                                const openD = Math.round((Number(r.opening_diesel_level) || 0) * 100) / 100;
                                const addedD = Number(r.diesel_added_litres) || 0;
                                const closeD = r.closing_diesel_level !== '' && r.closing_diesel_level !== null ? Number(r.closing_diesel_level) : null;
                                if (closeD !== null) {
                                    dailyTotalDieselCons += Math.max(0, (openD + addedD) - closeD);
                                    hasDieselCons = true;
                                }

                                const openK = Math.round((Number(r.opening_kwh) || 0) * 100) / 100;
                                const closeK = r.closing_kwh !== '' && r.closing_kwh !== null ? Number(r.closing_kwh) : null;
                                if (closeK !== null) {
                                    dailyTotalKwhCons += Math.max(0, closeK - openK);
                                    hasKwhCons = true;
                                }

                                const openH = Math.round((Number(r.opening_hours) || 0) * 100) / 100;
                                const closeH = r.closing_hours !== '' && r.closing_hours !== null ? Number(r.closing_hours) : null;
                                if (closeH !== null) {
                                    dailyTotalRunHrs += Math.max(0, closeH - openH);
                                    hasRunHrs = true;
                                }
                            });

                            dailyTotalDieselCons = Math.round(dailyTotalDieselCons * 100) / 100;
                            dailyTotalKwhCons = Math.round(dailyTotalKwhCons * 100) / 100;
                            dailyTotalRunHrs = Math.round(dailyTotalRunHrs * 100) / 100;

                            return (
                                <tr key={day.dateStr} id={`row-${day.dateStr}`} className={`hover:bg-primary/5 transition-colors ${rowBg}`}>
                                    {/* Date Column: DD/MM/YYYY */}
                                    <td className={`sticky left-0 z-30 border-r border-b p-1 text-center text-xs font-medium whitespace-nowrap ${isDark ? 'border-[#30363d] bg-inherit' : 'border-slate-200 bg-inherit'}`}>
                                        {formattedDate}
                                    </td>
                                    {/* Day Column: Mon, Tue */}
                                    <td className={`sticky left-[96px] z-30 border-r border-b p-1 text-center text-[10px] font-medium text-slate-500 ${isDark ? 'border-[#30363d] bg-inherit' : 'border-slate-200 bg-inherit'}`}>
                                        {day.dayName}
                                    </td>

                                    {/* Daily Totals Summary Cells */}
                                    <td className={`border-r border-b p-1 text-center text-xs font-black ${isDark ? 'bg-orange-950/20 border-[#30363d] text-orange-400' : 'bg-orange-50/70 border-slate-200 text-orange-800'}`}>
                                        {hasDieselCons ? dailyTotalDieselCons : '-'}
                                    </td>
                                    <td className={`border-r border-b p-1 text-center text-xs font-black ${isDark ? 'bg-amber-950/20 border-[#30363d] text-amber-400' : 'bg-amber-50/70 border-slate-200 text-amber-900'}`}>
                                        {hasKwhCons ? dailyTotalKwhCons : '-'}
                                    </td>
                                    <td className={`border-r border-b p-1 text-center text-xs font-black ${isDark ? 'bg-sky-950/20 border-[#30363d] text-sky-400' : 'bg-sky-50/70 border-slate-200 text-sky-800'}`}>
                                        {hasRunHrs ? dailyTotalRunHrs : '-'}
                                    </td>

                                    {/* Generator Sub-Columns */}
                                    {generators.map((gen) => {
                                        const r = readings[day.dateStr]?.[gen.id] || {
                                            generator_id: gen.id,
                                            reading_date: day.dateStr,
                                            opening_hours: 0,
                                            closing_hours: '',
                                            opening_kwh: 0,
                                            closing_kwh: '',
                                            opening_diesel_level: 0,
                                            closing_diesel_level: '',
                                            diesel_added_litres: 0,
                                            notes: ''
                                        };

                                        const openH = Math.round((Number(r.opening_hours) || 0) * 100) / 100;
                                        const closeH = r.closing_hours !== '' && r.closing_hours !== null ? Number(r.closing_hours) : null;
                                        const runH = closeH !== null ? Math.round(Math.max(0, closeH - openH) * 100) / 100 : null;

                                        const openK = Math.round((Number(r.opening_kwh) || 0) * 100) / 100;
                                        const closeK = r.closing_kwh !== '' && r.closing_kwh !== null ? Number(r.closing_kwh) : null;
                                        const runK = closeK !== null ? Math.round(Math.max(0, closeK - openK) * 100) / 100 : null;

                                        const openD = Math.round((Number(r.opening_diesel_level) || 0) * 100) / 100;
                                        const addedD = Number(r.diesel_added_litres) || 0;
                                        const closeD = r.closing_diesel_level !== '' && r.closing_diesel_level !== null ? Number(r.closing_diesel_level) : null;
                                        const consD = closeD !== null ? Math.round(Math.max(0, (openD + addedD) - closeD) * 100) / 100 : null;

                                        const renderCellInput = (field: EditableField, value: any, placeholder: string) => {
                                             const refKey = `cell-${day.dateStr}-${gen.id}-${field}`;
                                             const selected = isCellSelected(rowIndex, gen.id, field);
                                             const isOpening = field === 'opening_diesel_level' || field === 'opening_kwh' || field === 'opening_hours';

                                             return (
                                                 <td
                                                     key={field}
                                                     onMouseDown={() => handleCellMouseDown(rowIndex, gen.id, field)}
                                                     onMouseEnter={() => handleCellMouseEnter(rowIndex, gen.id, field)}
                                                     className={`border-r border-b p-0 relative transition-all ${
                                                         selected 
                                                             ? 'bg-blue-500/20 dark:bg-blue-500/30 ring-2 ring-blue-500 z-20' 
                                                             : (isOpening ? (isDark ? 'bg-amber-500/15' : 'bg-amber-50/80') : 'bg-transparent')
                                                     } ${isDark ? 'border-[#30363d]' : 'border-slate-200'}`}
                                                 >
                                                     <input
                                                         ref={(el) => { inputRefs.current[refKey] = el; }}
                                                         type="text"
                                                         inputMode="decimal"
                                                         value={value ?? ''}
                                                         onChange={(e) => handleCellChange(day.dateStr, gen.id, field, e.target.value)}
                                                         onPaste={(e) => handleInCellPaste(e, day.dateStr, gen.id, field)}
                                                         onKeyDown={(e) => handleCellKeyDown(e, day.dateStr, gen.id, field)}
                                                         onMouseDown={() => handleCellMouseDown(rowIndex, gen.id, field)}
                                                         onMouseEnter={() => handleCellMouseEnter(rowIndex, gen.id, field)}
                                                         className={`w-full h-full p-1 text-xs bg-transparent text-center focus:outline-none focus:bg-primary/10 transition-colors font-bold ${
                                                             selected 
                                                                 ? (isDark ? 'text-white font-black' : 'text-blue-950 font-black') 
                                                                 : (isOpening ? (isDark ? 'text-amber-300 font-black' : 'text-amber-950 font-black') : (isDark ? 'text-white placeholder:text-slate-600' : 'text-black placeholder:text-slate-300'))
                                                         }`}
                                                         placeholder={placeholder}
                                                         title={isOpening ? "Editable Initial Reading for Day 1" : undefined}
                                                     />
                                                 </td>
                                             );
                                         };

                                        const isDay1 = rowIndex === 0 || day.dateNum === 1;

                                        return (
                                            <React.Fragment key={gen.id}>
                                                {/* 1. Fuel View: Add, open, Close, Cons */}
                                                {(viewMetric === 'fuel') && (
                                                    <>
                                                        {renderCellInput('diesel_added_litres', r.diesel_added_litres, '0')}
                                                        {isDay1 ? (
                                                            renderCellInput('opening_diesel_level', r.opening_diesel_level ?? openD, 'Initial...')
                                                        ) : (
                                                            <td className={`border-r border-b p-1 text-center text-xs font-bold ${isDark ? 'bg-emerald-950/20 border-[#30363d] text-white' : 'bg-emerald-50/50 border-slate-200 text-black'}`}>
                                                                {openD}
                                                            </td>
                                                        )}
                                                        {renderCellInput('closing_diesel_level', r.closing_diesel_level, '-')}
                                                        <td className={`border-r border-b p-1 text-xs text-center font-extrabold ${isDark ? 'bg-orange-950/30 border-[#30363d] text-orange-400' : 'bg-orange-100/60 border-slate-200 text-orange-800'}`}>
                                                            {consD !== null ? consD : '-'}
                                                        </td>
                                                    </>
                                                )}

                                                {/* 2. Run Hours View: Run Hrs Opening, Run Hrs Closing, Consumption */}
                                                {(viewMetric === 'hours') && (
                                                    <>
                                                        {isDay1 ? (
                                                            renderCellInput('opening_hours', r.opening_hours ?? openH, 'Initial...')
                                                        ) : (
                                                            <td className={`border-r border-b p-1 text-center text-xs font-bold ${isDark ? 'bg-emerald-950/20 border-[#30363d] text-white' : 'bg-emerald-50/50 border-slate-200 text-black'}`}>
                                                                {openH.toFixed(1)}
                                                            </td>
                                                        )}
                                                        {renderCellInput('closing_hours', r.closing_hours, '-')}
                                                        <td className={`border-r border-b p-1 text-xs text-center font-extrabold ${isDark ? 'bg-orange-950/30 border-[#30363d] text-orange-400' : 'bg-orange-100/60 border-slate-200 text-orange-800'}`}>
                                                            {runH !== null ? runH.toFixed(1) : '-'}
                                                        </td>
                                                    </>
                                                )}

                                                {/* 3. kWh Energy View: KWH Opening, KWH Closing, Consumption */}
                                                {(viewMetric === 'kwh') && (
                                                    <>
                                                        {isDay1 ? (
                                                            renderCellInput('opening_kwh', r.opening_kwh ?? openK, 'Initial...')
                                                        ) : (
                                                            <td className={`border-r border-b p-1 text-center text-xs font-bold ${isDark ? 'bg-emerald-950/20 border-[#30363d] text-white' : 'bg-emerald-50/50 border-slate-200 text-black'}`}>
                                                                {openK.toLocaleString()}
                                                            </td>
                                                        )}
                                                        {renderCellInput('closing_kwh', r.closing_kwh, '-')}
                                                        <td className={`border-r border-b p-1 text-xs text-center font-extrabold ${isDark ? 'bg-orange-950/30 border-[#30363d] text-orange-400' : 'bg-orange-100/60 border-slate-200 text-orange-800'}`}>
                                                            {runK !== null ? runK.toLocaleString() : '-'}
                                                        </td>
                                                    </>
                                                )}

                                                {/* 4. All Metrics View */}
                                                {(viewMetric === 'all') && (
                                                    <>
                                                        {renderCellInput('diesel_added_litres', r.diesel_added_litres, '0')}
                                                        {isDay1 ? (
                                                            renderCellInput('opening_diesel_level', r.opening_diesel_level ?? openD, 'Initial...')
                                                        ) : (
                                                            <td className={`border-r border-b p-1 text-center text-xs font-bold ${isDark ? 'bg-emerald-950/20 border-[#30363d] text-white' : 'bg-emerald-50/50 border-slate-200 text-black'}`}>
                                                                {openD}
                                                            </td>
                                                        )}
                                                        {renderCellInput('closing_diesel_level', r.closing_diesel_level, '-')}
                                                        <td className={`border-r border-b p-1 text-xs text-center font-extrabold ${isDark ? 'bg-orange-950/30 border-[#30363d] text-orange-400' : 'bg-orange-100/60 border-slate-200 text-orange-800'}`}>
                                                            {consD !== null ? consD : '-'}
                                                        </td>

                                                        {isDay1 ? (
                                                            renderCellInput('opening_kwh', r.opening_kwh ?? openK, 'Initial...')
                                                        ) : (
                                                            <td className={`border-r border-b p-1 text-center text-xs font-bold ${isDark ? 'bg-emerald-950/20 border-[#30363d] text-white' : 'bg-emerald-50/50 border-slate-200 text-black'}`}>
                                                                {openK.toLocaleString()}
                                                            </td>
                                                        )}
                                                        {renderCellInput('closing_kwh', r.closing_kwh, '-')}
                                                        <td className={`border-r border-b p-1 text-xs text-center font-extrabold ${isDark ? 'bg-orange-950/30 border-[#30363d] text-orange-400' : 'bg-orange-100/60 border-slate-200 text-orange-800'}`}>
                                                            {runK !== null ? runK.toLocaleString() : '-'}
                                                        </td>

                                                        {isDay1 ? (
                                                            renderCellInput('opening_hours', r.opening_hours ?? openH, 'Initial...')
                                                        ) : (
                                                            <td className={`border-r border-b p-1 text-center text-xs font-bold ${isDark ? 'bg-emerald-950/20 border-[#30363d] text-white' : 'bg-emerald-50/50 border-slate-200 text-black'}`}>
                                                                {openH.toFixed(1)}
                                                            </td>
                                                        )}
                                                        {renderCellInput('closing_hours', r.closing_hours, '-')}
                                                        <td className={`border-r border-b p-1 text-xs text-center font-extrabold ${isDark ? 'bg-orange-950/30 border-[#30363d] text-orange-400' : 'bg-orange-100/60 border-slate-200 text-orange-800'}`}>
                                                            {runH !== null ? runH.toFixed(1) : '-'}
                                                        </td>

                                                        {renderCellInput('notes', r.notes, 'Remarks...')}
                                                    </>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Excel-style Bottom Sheet Tab Bar */}
            <div className={`sticky bottom-0 z-50 flex items-center justify-between border-t px-3 h-10 shrink-0 ${isDark ? 'bg-[#0d1117] border-[#30363d]' : 'bg-[#f3f2f1] border-slate-300'}`}>
                <div className="flex items-center h-full pt-1 gap-1">
                    <div className={`px-4 py-1.5 text-xs font-extrabold rounded-t-lg border-t border-x flex items-center gap-2 shadow-sm ${isDark ? 'bg-[#161b22] border-[#30363d] text-emerald-400' : 'bg-white border-slate-300 text-emerald-700'}`}>
                        <Fuel className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Diesel Generators</span>
                    </div>
                </div>

                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden sm:block">
                    Auto Carry-Forward Active · Double-click cell or Ctrl+V to paste from Excel
                </div>
            </div>

            {/* Excel Paste Helper Modal */}
            <AnimatePresence>
                {showPasteModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.95, y: 10 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.95, y: 10 }}
                            className={`w-full max-w-lg p-6 rounded-3xl border shadow-2xl ${isDark ? 'bg-[#161b22] border-[#30363d]' : 'bg-white border-slate-200'}`}
                        >
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <ClipboardPaste className="w-5 h-5 text-emerald-500" />
                                    <h3 className={`text-base font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Excel Paste Helper</h3>
                                </div>
                                <button onClick={() => setShowPasteModal(false)} className="p-1 rounded-lg hover:bg-slate-800 text-slate-400">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <p className="text-xs text-slate-500 mb-4">
                                Tip: You can also paste directly into any grid cell using <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 font-mono">Ctrl+V</kbd>!
                            </p>

                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Target Generator</label>
                                        <select
                                            value={pasteTargetGenId}
                                            onChange={(e) => setPasteTargetGenId(e.target.value)}
                                            className={`w-full p-2 text-xs font-bold rounded-xl border outline-none ${isDark ? 'bg-[#0d1117] border-[#30363d] text-white' : 'bg-slate-50 border-slate-200 text-slate-800'}`}
                                        >
                                            {generators.map(g => (
                                                <option key={g.id} value={g.id}>{g.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Target Field</label>
                                        <select
                                            value={pasteField}
                                            onChange={(e) => setPasteField(e.target.value as any)}
                                            className={`w-full p-2 text-xs font-bold rounded-xl border outline-none ${isDark ? 'bg-[#0d1117] border-[#30363d] text-white' : 'bg-slate-50 border-slate-200 text-slate-800'}`}
                                        >
                                            <option value="closing_diesel_level">Closing Diesel Level</option>
                                            <option value="diesel_added_litres">Diesel Added Today</option>
                                            <option value="closing_hours">Closing Run Hours</option>
                                            <option value="closing_kwh">Closing kWh</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Start Date</label>
                                    <select
                                        value={pasteStartDay}
                                        onChange={(e) => setPasteStartDay(e.target.value)}
                                        className={`w-full p-2 text-xs font-bold rounded-xl border outline-none ${isDark ? 'bg-[#0d1117] border-[#30363d] text-white' : 'bg-slate-50 border-slate-200 text-slate-800'}`}
                                    >
                                        {daysInMonth.map(d => (
                                            <option key={d.dateStr} value={d.dateStr}>{d.dateStr} ({d.dayName})</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Paste Raw Column (Ctrl+V)</label>
                                    <textarea
                                        rows={6}
                                        value={pasteRawText}
                                        onChange={(e) => setPasteRawText(e.target.value)}
                                        placeholder={`Paste column values here, e.g.:\n450\n440\n435\n...`}
                                        className={`w-full p-3 font-mono text-xs rounded-xl border outline-none ${isDark ? 'bg-[#0d1117] border-[#30363d] text-white' : 'bg-slate-50 border-slate-200 text-slate-800'}`}
                                    />
                                </div>

                                <div className="flex items-center justify-end gap-3 pt-2">
                                    <button
                                        onClick={() => setShowPasteModal(false)}
                                        className={`px-4 py-2 text-xs font-bold rounded-xl border ${isDark ? 'border-[#30363d] text-slate-400' : 'border-slate-200 text-slate-600'}`}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleApplyPasteModal}
                                        className="px-5 py-2 text-xs font-bold uppercase tracking-wider text-white bg-emerald-600 rounded-xl shadow-md hover:bg-emerald-500 transition-all"
                                    >
                                        Apply Values
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Toast Notification */}
            <Toast
                message={toast.message}
                type={toast.type}
                visible={toast.visible}
                onClose={() => setToast(prev => ({ ...prev, visible: false }))}
            />
        </div>
    );
}
