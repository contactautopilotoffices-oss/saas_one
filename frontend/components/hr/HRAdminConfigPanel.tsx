'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Settings, Plus, Check, Edit3, Shield, Clock, Trash2, X, AlertTriangle, GitFork, Table as TableIcon, Search, ChevronDown, User } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import HREscalationTreeVisualizer from '@/frontend/components/hr/HREscalationTreeVisualizer';
import { matchCategorySearch, HighlightedCategoryText } from '@/frontend/utils/categorySearch';

interface HRAdminConfigPanelProps {
    orgId?: string;
}

export interface SearchableEmployeeSelectorProps {
    placeholder: string;
    employees: any[];
    selectedIds: string[];
    onSelect: (id: string) => void;
    accentColor?: 'blue' | 'purple' | 'red' | 'indigo' | 'emerald';
}

export function formatSlaDisplay(valInDays: number | string | null | undefined): string {
    if (valInDays === null || valInDays === undefined || isNaN(Number(valInDays))) return '-';
    const numDays = Number(valInDays);
    if (numDays <= 0) return '0m';

    const totalMins = Math.round(numDays * 24 * 60);
    if (totalMins < 60) {
        return `${totalMins}m`;
    }

    const totalHours = Math.round((totalMins / 60) * 10) / 10;
    if (totalHours < 24 || totalMins % (24 * 60) !== 0) {
        return `${totalHours}h`;
    }
    return `${totalHours / 24}d`;
}

export function SlaInputCell({
    valueInDays,
    onChange
}: {
    valueInDays: number | undefined;
    onChange: (newDays: number) => void;
}) {
    const safeDays = valueInDays !== undefined && !isNaN(Number(valueInDays)) ? Number(valueInDays) : 1;
    const totalMins = Math.round(safeDays * 24 * 60);

    let initialUnit: 'mins' | 'hours' | 'days' = 'days';
    let initialVal = Math.round(safeDays);

    if (totalMins < 60) {
        initialUnit = 'mins';
        initialVal = totalMins;
    } else if (totalMins % 60 !== 0 || (totalMins / 60) % 24 !== 0) {
        initialUnit = 'hours';
        initialVal = Math.round((totalMins / 60) * 10) / 10;
    } else {
        initialUnit = 'days';
        initialVal = Math.round(safeDays);
    }

    const [numVal, setNumVal] = useState<number | string>(initialVal || 1);
    const [unit, setUnit] = useState<'mins' | 'hours' | 'days'>(initialUnit);

    useEffect(() => {
        const mins = Math.round(safeDays * 24 * 60);
        let u: 'mins' | 'hours' | 'days' = 'days';
        let v = Math.round(safeDays);

        if (mins < 60) {
            u = 'mins';
            v = mins;
        } else if (mins % 60 !== 0 || (mins / 60) % 24 !== 0) {
            u = 'hours';
            v = Math.round((mins / 60) * 10) / 10;
        } else {
            u = 'days';
            v = Math.round(safeDays);
        }

        // Avoid overwriting numVal if current input value already matches valueInDays within tolerance
        const currentParsed = typeof numVal === 'number' ? numVal : parseFloat(numVal as string);
        if (!isNaN(currentParsed)) {
            const currentDays = unit === 'mins' ? currentParsed / (24 * 60) : unit === 'hours' ? currentParsed / 24 : currentParsed;
            if (Math.abs(currentDays - safeDays) < 0.0001) {
                return;
            }
        }

        setNumVal(v);
        setUnit(u);
    }, [valueInDays]);

    const handleValChange = (valStr: string, currentUnit: 'mins' | 'hours' | 'days') => {
        setNumVal(valStr);
        if (valStr.trim() === '') return;
        const parsed = parseFloat(valStr);
        if (isNaN(parsed)) return;

        const days = currentUnit === 'mins' ? parsed / (24 * 60) : currentUnit === 'hours' ? parsed / 24 : parsed;
        onChange(days);
    };

    const handleUnitChange = (newUnit: 'mins' | 'hours' | 'days') => {
        setUnit(newUnit);
        const parsed = typeof numVal === 'number' ? numVal : parseFloat(numVal as string) || 0;
        const currentDays = unit === 'mins' ? parsed / (24 * 60) : unit === 'hours' ? parsed / 24 : parsed;

        let convertedVal: number;
        if (newUnit === 'mins') {
            convertedVal = Math.round(currentDays * 24 * 60) || 1;
        } else if (newUnit === 'hours') {
            convertedVal = Math.round((currentDays * 24) * 10) / 10 || 1;
        } else {
            convertedVal = Math.round(currentDays * 10) / 10 || 1;
        }
        setNumVal(convertedVal);
        const days = newUnit === 'mins' ? convertedVal / (24 * 60) : newUnit === 'hours' ? convertedVal / 24 : convertedVal;
        onChange(days);
    };

    return (
        <div className="flex items-center gap-1">
            <input
                type="number"
                step="any"
                min={0}
                value={numVal}
                onChange={(e) => handleValChange(e.target.value, unit)}
                className="w-16 px-1.5 py-1 border border-slate-300 dark:border-slate-700 rounded text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <select
                value={unit}
                onChange={(e) => handleUnitChange(e.target.value as 'mins' | 'hours' | 'days')}
                className="px-1.5 py-1 border border-slate-300 dark:border-slate-700 rounded text-[11px] bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold outline-none cursor-pointer"
            >
                <option value="mins">mins</option>
                <option value="hours">hrs</option>
                <option value="days">days</option>
            </select>
        </div>
    );
}

export function SearchableEmployeeSelector({
    placeholder,
    employees = [],
    selectedIds = [],
    onSelect,
    accentColor = 'indigo'
}: SearchableEmployeeSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredEmployees = employees.filter((emp: any) => {
        const q = searchQuery.trim().toLowerCase();
        const code = (emp.employee_code || '').toLowerCase();
        const name = (emp.full_name || `${emp.first_name || ''} ${emp.last_name || ''}`).toLowerCase();
        const email = (emp.email || '').toLowerCase();
        const dept = (emp.department || '').toLowerCase();
        const desig = (emp.designation || '').toLowerCase();

        if (!q) return true;
        return code.includes(q) || name.includes(q) || email.includes(q) || dept.includes(q) || desig.includes(q);
    });

    const getAccentClasses = () => {
        switch (accentColor) {
            case 'blue':
                return 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/60';
            case 'purple':
                return 'bg-white dark:bg-slate-900 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700 hover:bg-purple-50 dark:hover:bg-purple-950/60';
            case 'red':
                return 'bg-white dark:bg-slate-900 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-950/60';
            default:
                return 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800';
        }
    };

    return (
        <div className="relative w-full text-left" ref={containerRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-between gap-2 shadow-xs transition-all ${getAccentClasses()}`}
            >
                <span className="flex items-center gap-1.5 truncate">
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{placeholder} (Select employee to add...)</span>
                </span>
                <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute left-0 right-0 mt-1.5 bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 z-50 p-2 space-y-2 animate-in fade-in zoom-in-95 duration-150">
                    <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                        <input
                            type="text"
                            autoFocus
                            placeholder="Search by Code, Name, Dept, Designation..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-8 pr-7 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    <div className="max-h-56 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                        {filteredEmployees.length === 0 ? (
                            <div className="p-4 text-center text-slate-400 text-xs italic">
                                {employees.length === 0 ? 'No active employees found' : 'No matching employee found'}
                            </div>
                        ) : (
                            filteredEmployees.map((emp: any) => {
                                const isAlreadySelected = selectedIds.includes(emp.id);
                                const displayName = emp.full_name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.email || 'Unnamed';
                                const subInfo = [emp.employee_code, emp.designation || emp.department || emp.email].filter(Boolean).join(' • ');

                                return (
                                    <button
                                        key={emp.id}
                                        type="button"
                                        disabled={isAlreadySelected}
                                        onClick={() => {
                                            onSelect(emp.id);
                                            setIsOpen(false);
                                            setSearchQuery('');
                                        }}
                                        className={`w-full text-left p-2 rounded-xl transition-all flex items-center justify-between gap-2 text-xs ${
                                            isAlreadySelected
                                                ? 'bg-slate-100 dark:bg-slate-800/50 text-slate-400 opacity-60 cursor-not-allowed'
                                                : 'hover:bg-indigo-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200'
                                        }`}
                                    >
                                        <div className="min-w-0">
                                            <div className="font-bold truncate flex items-center gap-1.5">
                                                <span>{displayName}</span>
                                                {emp.employee_code && (
                                                    <span className="text-[10px] px-1.5 py-0.2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded font-mono">
                                                        {emp.employee_code}
                                                    </span>
                                                )}
                                            </div>
                                            {subInfo && (
                                                <div className="text-[10px] text-slate-400 truncate mt-0.5">
                                                    {subInfo}
                                                </div>
                                            )}
                                        </div>
                                        {isAlreadySelected ? (
                                            <span className="text-[10px] font-bold text-slate-400 shrink-0">Selected</span>
                                        ) : (
                                            <Plus className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                        )}
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function HRAdminConfigPanel({ orgId }: HRAdminConfigPanelProps = {}) {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<'tree' | 'table'>('tree');
    const [categories, setCategories] = useState<any[]>([]);
    const [categorySearch, setCategorySearch] = useState('');
    const [categoryTypeFilter, setCategoryTypeFilter] = useState('all');
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<any>({});
    const [saveMsg, setSaveMsg] = useState('');
    const [errorMsg, setErrorMsg] = useState('');

    // Modal state for adding a new dropdown category
    const [showAddModal, setShowAddModal] = useState(false);
    const [newCategory, setNewCategory] = useState({
        ticket_type: 'grievance',
        category_name: '',
        sub_category_name: '',
        first_level_owner_type: 'reporting_manager',
        l1_sla_days: 3,
        l2_sla_days: 7,
        l3_sla_days: 10,
        l4_sla_days: 12,
        is_confidential: false,
        is_anonymous: false
    });
    const [submitting, setSubmitting] = useState(false);

    // Designated Escalation Authorities State (Supports 2 or more per role for Level 2 HR Manager, Level 3 HR Head, Level 4 Director)
    const [employeesList, setEmployeesList] = useState<any[]>([]);
    const [selectedHrManagerIds, setSelectedHrManagerIds] = useState<string[]>([]);
    const [selectedHrHeadIds, setSelectedHrHeadIds] = useState<string[]>([]);
    const [selectedDirectorIds, setSelectedDirectorIds] = useState<string[]>([]);

    const [designatedHrManagers, setDesignatedHrManagers] = useState<any[]>([]);
    const [designatedHrHeads, setDesignatedHrHeads] = useState<any[]>([]);
    const [designatedDirectors, setDesignatedDirectors] = useState<any[]>([]);
    const [flowAssignees, setFlowAssignees] = useState<Record<string, Record<string, any[]>>>({});
    const [flowLevels, setFlowLevels] = useState<Record<string, any[]>>({});

    const [savingAuthorities, setSavingAuthorities] = useState(false);
    const [authoritySaveMsg, setAuthoritySaveMsg] = useState('');
    const [authorityErrorMsg, setAuthorityErrorMsg] = useState('');

    useEffect(() => {
        fetchCategories();
        fetchEscalationConfig();
    }, [orgId]);

    const fetchEscalationConfig = async () => {
        try {
            const url = `/api/hr/admin/escalation-config${orgId ? `?orgId=${orgId}` : ''}`;
            const res = await fetch(url);
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            
            let profiles: any[] = [];
            if (data.success && data.data && Array.isArray(data.data.employees) && data.data.employees.length > 0) {
                profiles = data.data.employees;
            } else {
                // Fallback to employee directory API if escalation-config list is empty
                const empUrl = `/api/hr/admin/employees${orgId ? `?orgId=${orgId}` : ''}`;
                const empRes = await fetch(empUrl);
                const empText = await empRes.text();
                let empData: any = {};
                try { empData = empText ? JSON.parse(empText) : {}; } catch {}
                if (empData.success && Array.isArray(empData.data)) {
                    profiles = empData.data;
                }
            }

            setEmployeesList(profiles);

            if (data.success && data.data) {
                const hrManagers = data.data.designated_hr_managers || [];
                const hrHeads = data.data.designated_hr_heads || (data.data.designated_hr_head ? [data.data.designated_hr_head] : []);
                const directors = data.data.designated_directors || (data.data.designated_director ? [data.data.designated_director] : []);

                setDesignatedHrManagers(hrManagers);
                setSelectedHrManagerIds(hrManagers.map((p: any) => p.id));

                setDesignatedHrHeads(hrHeads);
                setSelectedHrHeadIds(hrHeads.map((p: any) => p.id));

                setDesignatedDirectors(directors);
                setSelectedDirectorIds(directors.map((p: any) => p.id));

                if (data.data.flow_assignees) {
                    setFlowAssignees(data.data.flow_assignees);
                }
                if (data.data.flow_levels) {
                    setFlowLevels(data.data.flow_levels);
                }
            }
        } catch (err) {
            console.error('Error fetching escalation config:', err);
        }
    };

    const handleAddHrManager = (id: string) => {
        if (!id) return;
        if (!selectedHrManagerIds.includes(id)) {
            setSelectedHrManagerIds([...selectedHrManagerIds, id]);
        }
    };

    const handleRemoveHrManager = (id: string) => {
        setSelectedHrManagerIds(selectedHrManagerIds.filter(itemId => itemId !== id));
    };

    const handleAddHrHead = (id: string) => {
        if (!id) return;
        if (!selectedHrHeadIds.includes(id)) {
            setSelectedHrHeadIds([...selectedHrHeadIds, id]);
        }
    };

    const handleRemoveHrHead = (id: string) => {
        setSelectedHrHeadIds(selectedHrHeadIds.filter(itemId => itemId !== id));
    };

    const handleAddDirector = (id: string) => {
        if (!id) return;
        if (!selectedDirectorIds.includes(id)) {
            setSelectedDirectorIds([...selectedDirectorIds, id]);
        }
    };

    const handleRemoveDirector = (id: string) => {
        setSelectedDirectorIds(selectedDirectorIds.filter(itemId => itemId !== id));
    };

    const handleSaveAuthorities = async (customData?: any) => {
        setSavingAuthorities(true);
        setAuthoritySaveMsg('');
        setAuthorityErrorMsg('');

        try {
            let payloadFlowAssignees = flowAssignees;
            let payloadFlowLevels = flowLevels;

            if (customData) {
                if (customData.flow_assignees) {
                    payloadFlowAssignees = customData.flow_assignees;
                } else if (typeof customData === 'object' && !customData.flow_levels) {
                    payloadFlowAssignees = customData;
                }
                if (customData.flow_levels) {
                    payloadFlowLevels = customData.flow_levels;
                }
            }

            const res = await fetch('/api/hr/admin/escalation-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organization_id: orgId,
                    hr_manager_profile_ids: selectedHrManagerIds,
                    hr_head_profile_ids: selectedHrHeadIds,
                    director_profile_ids: selectedDirectorIds,
                    flow_assignees: payloadFlowAssignees,
                    flow_levels: payloadFlowLevels
                })
            });

            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                setAuthoritySaveMsg(`Saved escalation authorities & per-flow step assignees! Future ticket escalations will route to all designated members.`);
                await fetchEscalationConfig();
                await fetchCategories();
            } else {
                setAuthorityErrorMsg(data.error || 'Failed to update escalation authorities');
            }
        } catch (err: any) {
            setAuthorityErrorMsg(err.message || 'Error updating escalation authorities');
        } finally {
            setSavingAuthorities(false);
        }
    };

    const fetchCategories = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/hr/admin/categories');
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                setCategories(data.data || []);
            }
        } catch (err) {
            console.error('Error fetching categories:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (id: string) => {
        setSaveMsg('');
        setErrorMsg('');
        try {
            const res = await fetch('/api/hr/admin/categories', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, actor_user_id: user?.id, ...editForm })
            });
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                setSaveMsg('Category Resolution TAT & Routing updated successfully!');
                setEditingId(null);
                fetchCategories();
            } else {
                setErrorMsg(data.error || 'Failed to update category');
            }
        } catch (err: any) {
            setErrorMsg(err.message || 'Error updating category');
        }
    };

    const handleCreateCategory = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaveMsg('');
        setErrorMsg('');

        if (!newCategory.category_name.trim()) {
            setErrorMsg('Category name is required');
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch('/api/hr/admin/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newCategory)
            });

            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                setSaveMsg(`New category "${newCategory.category_name}" added to dropdown options!`);
                setShowAddModal(false);
                setCategorySearch('');
                setActiveTab('table');
                setNewCategory({
                    ticket_type: 'grievance',
                    category_name: '',
                    sub_category_name: '',
                    first_level_owner_type: 'reporting_manager',
                    l1_sla_days: 3,
                    l2_sla_days: 7,
                    l3_sla_days: 10,
                    l4_sla_days: 12,
                    is_confidential: false,
                    is_anonymous: false
                });
                fetchCategories();
            } else {
                setErrorMsg(data.error || 'Failed to create category');
            }
        } catch (err: any) {
            setErrorMsg(err.message || 'Error creating category');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDeleteCategory = async (id: string, name: string) => {
        if (!confirm(`Are you sure you want to remove the category option "${name}"?`)) return;

        setSaveMsg('');
        setErrorMsg('');
        try {
            const res = await fetch(`/api/hr/admin/categories?id=${id}`, {
                method: 'DELETE'
            });
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                setSaveMsg(`Category "${name}" removed from dropdown options.`);
                fetchCategories();
            } else {
                setErrorMsg(data.error || 'Failed to delete category');
            }
        } catch (err: any) {
            setErrorMsg(err.message || 'Error deleting category');
        }
    };

    const defaultTypeLevels: Record<string, number> = {
        grievance: 4,
        hr_query: 4,
        confidential_feedback: 2,
        anonymous_feedback: 2
    };

    const getLevelCountForType = (type: string) => {
        if (flowLevels && flowLevels[type] && Array.isArray(flowLevels[type]) && flowLevels[type].length > 0) {
            return flowLevels[type].length;
        }
        return defaultTypeLevels[type] || 4;
    };

    const maxLevelsForView = categoryTypeFilter === 'all'
        ? Math.max(
            getLevelCountForType('grievance'),
            getLevelCountForType('hr_query'),
            getLevelCountForType('confidential_feedback'),
            getLevelCountForType('anonymous_feedback')
        )
        : getLevelCountForType(categoryTypeFilter);

    const parseSlaTextToDays = (slaText: string | undefined, defaultDays: number): number => {
        if (!slaText) return defaultDays;
        const clean = slaText.trim();
        const matchMin = clean.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes)/i);
        if (matchMin && matchMin[1]) {
            return Number((parseFloat(matchMin[1]) / 1440).toFixed(6));
        }
        const matchHr = clean.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours)/i);
        if (matchHr && matchHr[1]) {
            return Number((parseFloat(matchHr[1]) / 24).toFixed(6));
        }
        const matchRange = clean.match(/Day\s*\d+\s*-\s*Day\s*(\d+)/i) || clean.match(/0\s*-\s*(\d+)\s*Days?/i);
        if (matchRange && matchRange[1]) {
            return parseFloat(matchRange[1]);
        }
        const matchDay = clean.match(/(\d+(?:\.\d+)?)\s*(?:d|day|days|working days)/i);
        if (matchDay && matchDay[1]) {
            return parseFloat(matchDay[1]);
        }
        const directVal = parseFloat(clean);
        if (!isNaN(directVal)) return directVal;

        return defaultDays;
    };

    const getConfiguredLevelSlaDays = (ticketType: string, levelNum: number, defaultDaysFallback: number): number => {
        const typeLevels = flowLevels?.[ticketType];
        if (typeLevels && Array.isArray(typeLevels) && typeLevels[levelNum - 1]) {
            const lvlObj = typeLevels[levelNum - 1];
            if (lvlObj.sla_days && !isNaN(Number(lvlObj.sla_days))) {
                return Number(lvlObj.sla_days);
            }
            if (lvlObj.slaText) {
                return parseSlaTextToDays(lvlObj.slaText, defaultDaysFallback);
            }
        }
        return defaultDaysFallback;
    };

    if (loading) {
        return <div className="p-8 text-center text-slate-400 text-xs">Loading configuration...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div>                    <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Settings className="w-4 h-4 text-indigo-500" />
                        HR Categories, Resolution TAT & Escalation Settings
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                        Configure request categories, Resolution TAT, owner routing, and escalation authorities without IT changes.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    {/* View Switcher Tabs */}
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                        <button
                            type="button"
                            onClick={() => setActiveTab('tree')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                                activeTab === 'tree'
                                    ? 'bg-white dark:bg-slate-900 text-[#587e85] dark:text-teal-300 shadow-xs'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                            }`}
                        >
                            <GitFork className="w-3.5 h-3.5" />
                            <span>Escalation Tree</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('table')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                                activeTab === 'table'
                                    ? 'bg-white dark:bg-slate-900 text-[#587e85] dark:text-teal-300 shadow-xs'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                            }`}
                        >
                            <TableIcon className="w-3.5 h-3.5" />
                            <span>Resolution TAT Table</span>
                        </button>
                    </div>

                    <button
                        onClick={() => setShowAddModal(true)}
                        className="px-4 py-2 bg-[#587e85] hover:bg-[#48686e] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-[#587e85]/20 shrink-0 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Add Category Option
                    </button>
                </div>
            </div>

            {/* Error Message Alert */}
            {errorMsg && (
                <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{errorMsg}</span>
                </div>
            )}

            {saveMsg && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 font-semibold flex items-center gap-2">
                    <Check className="w-4 h-4 shrink-0" />
                    <span>{saveMsg}</span>
                </div>
            )}

            {/* View 1: Graphical Escalation Tree */}
            {activeTab === 'tree' && (
                <HREscalationTreeVisualizer
                    designatedHrManagers={designatedHrManagers}
                    designatedHrHeads={designatedHrHeads}
                    designatedDirectors={designatedDirectors}
                    employeesList={employeesList}
                    selectedDirectorIds={selectedDirectorIds}
                    onAddDirector={handleAddDirector}
                    onRemoveDirector={handleRemoveDirector}
                    selectedHrHeadIds={selectedHrHeadIds}
                    onAddHrHead={handleAddHrHead}
                    onRemoveHrHead={handleRemoveHrHead}
                    selectedHrManagerIds={selectedHrManagerIds}
                    onAddHrManager={handleAddHrManager}
                    onRemoveHrManager={handleRemoveHrManager}
                    onSaveAuthorities={handleSaveAuthorities}
                    savingAuthorities={savingAuthorities}
                    authoritySaveMsg={authoritySaveMsg}
                    authorityErrorMsg={authorityErrorMsg}
                    flowAssignees={flowAssignees}
                    flowLevels={flowLevels}
                    onFlowLevelsChange={setFlowLevels}
                />
            )}
            {/* View 2: Table View */}
            {activeTab === 'table' && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden space-y-0">
                    {/* Search & Filter Header Bar */}
                    <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        {/* Search Input */}
                        <div className="relative flex-1 max-w-md">
                            <Search className="w-4 h-4 absolute left-3 top-2.5 text-indigo-500" />
                            <input
                                type="text"
                                placeholder="Search category, subcategory, or keyword (e.g. POSH, salary, leave)..."
                                value={categorySearch}
                                onChange={(e) => setCategorySearch(e.target.value)}
                                className="w-full pl-9 pr-8 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
                            />
                            {categorySearch && (
                                <button
                                    type="button"
                                    onClick={() => setCategorySearch('')}
                                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>

                        {/* Classification Type Filter & Counter Badge */}
                        <div className="flex items-center gap-2 flex-wrap">
                            <select
                                value={categoryTypeFilter}
                                onChange={(e) => setCategoryTypeFilter(e.target.value)}
                                className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="all">All Classification Types</option>
                                <option value="grievance">Employee Grievances</option>
                                <option value="hr_query">HR-Related Queries</option>
                                <option value="confidential_feedback">Confidential Feedback</option>
                                <option value="anonymous_feedback">Anonymous Feedback</option>
                            </select>

                            <span className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-mono text-xs font-bold border border-slate-200 dark:border-slate-700 shrink-0">
                                Showing {categories.filter((cat) => {
                                    if (categoryTypeFilter !== 'all' && cat.ticket_type !== categoryTypeFilter) return false;
                                    return matchCategorySearch(cat, categorySearch);
                                }).length} of {categories.length}
                            </span>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold">
                                    <th className="p-3.5 pl-4">Type</th>
                                    <th className="p-3.5">Category Name</th>
                                    <th className="p-3.5">Sub-Category</th>
                                    <th className="p-3.5">Level 1 Owner</th>
                                    {Array.from({ length: maxLevelsForView }, (_, i) => (
                                        <th key={i} className="p-3.5 whitespace-nowrap">L{i + 1} TAT</th>
                                    ))}
                                    <th className="p-3.5 pr-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                                {categories.filter((cat) => {
                                    if (categoryTypeFilter !== 'all' && cat.ticket_type !== categoryTypeFilter) return false;
                                    return matchCategorySearch(cat, categorySearch);
                                }).length === 0 ? (
                                    <tr>
                                        <td colSpan={5 + maxLevelsForView} className="p-8 text-center text-slate-400 text-xs italic">
                                            No categories found matching "{categorySearch}". Try typing words like <strong>salary</strong>, <strong>leave</strong>, <strong>POSH</strong>, <strong>manager</strong>, or <strong>PF</strong>.
                                        </td>
                                    </tr>
                                ) : (
                                    categories.filter((cat) => {
                                        if (categoryTypeFilter !== 'all' && cat.ticket_type !== categoryTypeFilter) return false;
                                        return matchCategorySearch(cat, categorySearch);
                                    }).map((cat) => {
                                        const isEditing = editingId === cat.id;
                                        const rowCatLevelCount = getLevelCountForType(cat.ticket_type);

                                        return (
                                            <tr key={cat.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                                                <td className="p-3.5 pl-4 uppercase font-bold text-[10px]">
                                                    <span className={`px-2 py-0.5 rounded font-extrabold ${
                                                        cat.ticket_type === 'grievance' ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300' :
                                                        cat.ticket_type === 'hr_query' ? 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300' :
                                                        cat.ticket_type === 'confidential_feedback' ? 'bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300' :
                                                        'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                                                    }`}>
                                                        {cat.ticket_type?.replace('_', ' ')}
                                                    </span>
                                                </td>
                                                <td className="p-3.5 font-bold text-slate-900 dark:text-white">
                                                    {isEditing ? (
                                                        <input
                                                            type="text"
                                                            value={editForm.category_name ?? cat.category_name}
                                                            onChange={(e) => setEditForm({ ...editForm, category_name: e.target.value })}
                                                            className="px-2 py-1 border rounded text-xs bg-white dark:bg-slate-800"
                                                        />
                                                    ) : (
                                                        <HighlightedCategoryText text={cat.category_name} query={categorySearch} />
                                                    )}
                                                </td>
                                                <td className="p-3.5 text-slate-500">
                                                    {isEditing ? (
                                                        <input
                                                            type="text"
                                                            value={editForm.sub_category_name ?? cat.sub_category_name ?? ''}
                                                            onChange={(e) => setEditForm({ ...editForm, sub_category_name: e.target.value })}
                                                            className="px-2 py-1 border rounded text-xs bg-white dark:bg-slate-800"
                                                        />
                                                    ) : (
                                                        cat.sub_category_name ? (
                                                            <HighlightedCategoryText text={cat.sub_category_name} query={categorySearch} />
                                                        ) : '-'
                                                    )}
                                                </td>
                                                <td className="p-3.5 capitalize font-semibold">
                                                    {isEditing ? (
                                                        <select
                                                            value={editForm.first_level_owner_type || cat.first_level_owner_type}
                                                            onChange={(e) => setEditForm({ ...editForm, first_level_owner_type: e.target.value })}
                                                            className="px-2 py-1 border rounded text-xs bg-white dark:bg-slate-800"
                                                        >
                                                            <option value="reporting_manager">Reporting Manager</option>
                                                            <option value="hr">HR Dept</option>
                                                            <option value="director">Director</option>
                                                        </select>
                                                    ) : (
                                                        cat.first_level_owner_type?.replace('_', ' ')
                                                    )}
                                                </td>

                                                {/* Dynamic SLA Level Cells */}
                                                {Array.from({ length: maxLevelsForView }, (_, i) => {
                                                    const levelNum = i + 1;
                                                    const slaPropKey = `l${levelNum}_sla_days`;
                                                    const isLevelApplicable = levelNum <= rowCatLevelCount;

                                                    if (!isLevelApplicable) {
                                                        return (
                                                            <td key={levelNum} className="p-3.5 font-mono text-center text-slate-300 dark:text-slate-600 select-none" title={`Level ${levelNum} not applicable for ${cat.ticket_type?.replace('_', ' ')}`}>
                                                                -
                                                            </td>
                                                        );
                                                    }

                                                    const defaultDaysFallback = levelNum === 1 ? 3 : levelNum === 2 ? 7 : levelNum === 3 ? 10 : levelNum === 4 ? 12 : 12 + (levelNum - 4) * 3;
                                                    const configuredLevelDays = getConfiguredLevelSlaDays(cat.ticket_type, levelNum, defaultDaysFallback);
                                                    const currentVal = isEditing
                                                        ? (editForm[slaPropKey] ?? cat[slaPropKey] ?? configuredLevelDays)
                                                        : (cat[slaPropKey] ?? configuredLevelDays);

                                                    return (
                                                        <td key={levelNum} className="p-3.5 font-mono whitespace-nowrap">
                                                            {isEditing ? (
                                                                <SlaInputCell
                                                                    valueInDays={currentVal}
                                                                    onChange={(newDays) => setEditForm({ ...editForm, [slaPropKey]: newDays })}
                                                                />
                                                            ) : (
                                                                formatSlaDisplay(currentVal)
                                                            )}
                                                        </td>
                                                    );
                                                })}

                                                <td className="p-3.5 pr-4 text-right">
                                                    {isEditing ? (
                                                        <div className="flex justify-end gap-1.5">
                                                            <button
                                                                onClick={() => handleSave(cat.id)}
                                                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-semibold"
                                                            >
                                                                Save
                                                            </button>
                                                            <button
                                                                onClick={() => setEditingId(null)}
                                                                className="px-2.5 py-1 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-[11px]"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center justify-end gap-2">
                                                            <button
                                                                onClick={() => {
                                                                    setEditingId(cat.id);
                                                                    setEditForm(cat);
                                                                }}
                                                                className="px-2.5 py-1 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg text-[11px] font-bold"
                                                            >
                                                                Edit TAT
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteCategory(cat.id, cat.category_name)}
                                                                className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
                                                                title="Delete Category Option"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Modal to Add New Category Option */}
            {showAddModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-2 sm:p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl max-w-md w-full max-h-[92vh] sm:max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-auto">
                        {/* Header */}
                        <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <Plus className="w-4 h-4 text-indigo-600" />
                                Add New Dropdown Category Option
                            </h3>
                            <button onClick={() => setShowAddModal(false)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition-colors shrink-0">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <form onSubmit={handleCreateCategory} className="flex flex-col flex-1 min-h-0 text-xs">
                            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3.5">
                                <div>
                                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Classification Type *</label>
                                    <select
                                        value={newCategory.ticket_type}
                                        onChange={(e) => {
                                            const type = e.target.value;
                                            const configuredArr = flowLevels[type];
                                            let l1 = (type === 'hr_query' || type === 'confidential_feedback') ? 2 : 3;
                                            let l2 = (type === 'hr_query' || type === 'confidential_feedback') ? 5 : 7;
                                            let l3 = (type === 'hr_query' || type === 'confidential_feedback') ? 7 : 10;
                                            let l4 = (type === 'hr_query' || type === 'confidential_feedback') ? 10 : 12;

                                            if (configuredArr && Array.isArray(configuredArr) && configuredArr.length > 0) {
                                                const parseDays = (lvl: any, defaultDays: number) => {
                                                    if (!lvl) return defaultDays;
                                                    if (lvl.sla_days && !isNaN(Number(lvl.sla_days))) return Number(lvl.sla_days);
                                                    if (lvl.slaText) {
                                                        const matchR = lvl.slaText.match(/Day\s*\d+\s*-\s*Day\s*(\d+)/i) || lvl.slaText.match(/0\s*-\s*(\d+)\s*Days?/i);
                                                        if (matchR && matchR[1]) return Number(matchR[1]);
                                                        const matchS = lvl.slaText.match(/(\d+)\s*working\s*day/i) || lvl.slaText.match(/(\d+)\s*day/i);
                                                        if (matchS && matchS[1]) return Number(matchS[1]);
                                                    }
                                                    return defaultDays;
                                                };
                                                l1 = parseDays(configuredArr[0], l1);
                                                l2 = parseDays(configuredArr[1], l2);
                                                l3 = parseDays(configuredArr[2], l3);
                                                l4 = parseDays(configuredArr[3], l4);
                                            }

                                            setNewCategory({
                                                ...newCategory,
                                                ticket_type: type,
                                                first_level_owner_type: type === 'grievance' ? 'reporting_manager' : type === 'hr_query' ? 'hr' : 'director',
                                                l1_sla_days: l1,
                                                l2_sla_days: l2,
                                                l3_sla_days: l3,
                                                l4_sla_days: l4,
                                                is_confidential: type === 'confidential_feedback',
                                                is_anonymous: type === 'anonymous_feedback'
                                            });
                                        }}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                                    >
                                        <option value="grievance">Grievance (L1 Reporting Manager)</option>
                                        <option value="hr_query">HR Query (Direct HR)</option>
                                        <option value="confidential_feedback">Confidential Feedback (Director Only)</option>
                                        <option value="anonymous_feedback">Anonymous Feedback (Identity Masked)</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Category Name *</label>
                                    <input
                                        type="text"
                                        required
                                        value={newCategory.category_name}
                                        onChange={(e) => setNewCategory({ ...newCategory, category_name: e.target.value })}
                                        placeholder="e.g. PF / ESIC Discrepancy, Workload Concern"
                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>

                                <div>
                                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Sub-Category Name (Optional)</label>
                                    <input
                                        type="text"
                                        value={newCategory.sub_category_name}
                                        onChange={(e) => setNewCategory({ ...newCategory, sub_category_name: e.target.value })}
                                        placeholder="e.g. Payslip Correction, Work Environment"
                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>

                                <div>
                                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">First-Level Owner</label>
                                    <select
                                        value={newCategory.first_level_owner_type}
                                        onChange={(e) => setNewCategory({ ...newCategory, first_level_owner_type: e.target.value })}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                                    >
                                        <option value="reporting_manager">Reporting Manager / HOD</option>
                                        <option value="hr">HR Department</option>
                                        <option value="director">Director</option>
                                    </select>
                                </div>

                                {/* Dynamic Level TAT Inputs */}
                                {(() => {
                                    const configuredArr = flowLevels[newCategory.ticket_type];
                                    const levelCount = (configuredArr && Array.isArray(configuredArr) && configuredArr.length > 0)
                                        ? configuredArr.length
                                        : (newCategory.ticket_type === 'confidential_feedback' || newCategory.ticket_type === 'anonymous_feedback') ? 2 : 4;

                                    const levelIndices = Array.from({ length: levelCount }, (_, i) => i + 1);

                                    return (
                                        <div className="grid grid-cols-2 gap-3 pt-1">
                                            {levelIndices.map((lvlNum) => {
                                                const fieldKey = `l${lvlNum}_sla_days`;
                                                const defaultFallback = (newCategory.ticket_type === 'hr_query' || newCategory.ticket_type === 'confidential_feedback')
                                                    ? (lvlNum === 1 ? 2 : lvlNum === 2 ? 5 : lvlNum === 3 ? 7 : 10)
                                                    : (lvlNum === 1 ? 3 : lvlNum === 2 ? 7 : lvlNum === 3 ? 10 : 12);
                                                
                                                const valInDays = (newCategory as any)[fieldKey] ?? defaultFallback;

                                                return (
                                                    <div key={lvlNum}>
                                                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                                            L{lvlNum} TAT
                                                        </label>
                                                        <SlaInputCell
                                                            valueInDays={valInDays}
                                                            onChange={(newDays) => setNewCategory({ ...newCategory, [fieldKey]: newDays })}
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* Footer */}
                            <div className="shrink-0 flex justify-end gap-2 px-4 sm:px-6 py-3 bg-slate-50/50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setShowAddModal(false)}
                                    className="px-4 py-2 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-semibold"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md disabled:opacity-50"
                                >
                                    {submitting ? 'Adding...' : 'Add Dropdown Option'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
