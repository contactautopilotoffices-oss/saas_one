'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Settings, Plus, Check, Edit3, Shield, Clock, Trash2, X, AlertTriangle, GitFork, Table as TableIcon, Search, ChevronDown, User } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import HREscalationTreeVisualizer from '@/frontend/components/hr/HREscalationTreeVisualizer';

interface HRAdminConfigPanelProps {
    orgId?: string;
}

interface SearchableEmployeeSelectorProps {
    placeholder: string;
    employees: any[];
    selectedIds: string[];
    onSelect: (id: string) => void;
    accentColor?: 'blue' | 'purple' | 'red' | 'indigo' | 'emerald';
}

function SearchableEmployeeSelector({
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

    const handleSaveAuthorities = async () => {
        setSavingAuthorities(true);
        setAuthoritySaveMsg('');
        setAuthorityErrorMsg('');

        try {
            const res = await fetch('/api/hr/admin/escalation-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hr_manager_profile_ids: selectedHrManagerIds,
                    hr_head_profile_ids: selectedHrHeadIds,
                    director_profile_ids: selectedDirectorIds
                })
            });

            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                setAuthoritySaveMsg(`Saved ${selectedHrManagerIds.length} HR Manager(s), ${selectedHrHeadIds.length} HR Head(s) & ${selectedDirectorIds.length} Director(s)! Future escalations will route to all selected members.`);
                await fetchEscalationConfig();
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
                setSaveMsg('Category SLA & Routing updated successfully!');
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

    if (loading) {
        return <div className="p-8 text-center text-slate-400 text-xs">Loading configuration...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Settings className="w-4 h-4 text-indigo-500" />
                        HR Categories, SLAs & Escalation Settings
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                        Configure request categories, SLA days, owner routing, and escalation authorities without IT changes.
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
                            <span>SLA Table</span>
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

            {/* Designated Escalation Authorities Selection Panel */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                    <div>
                        <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
                            <Shield className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                            Designated Escalation Authorities (Level 3 HR Head & Level 4 Director)
                        </h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Select which active employees act as HR Head and Director. Future automatic and manual ticket escalations route directly to their accounts.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleSaveAuthorities}
                        disabled={savingAuthorities}
                        className="px-4 py-2 bg-[#587e85] hover:bg-[#48686e] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm shrink-0 transition-colors disabled:opacity-50"
                    >
                        <Check className="w-4 h-4" />
                        {savingAuthorities ? 'Saving...' : 'Save Escalation Authorities'}
                    </button>
                </div>

                {authoritySaveMsg && (
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 font-semibold flex items-center gap-2">
                        <Check className="w-4 h-4 shrink-0" />
                        <span>{authoritySaveMsg}</span>
                    </div>
                )}

                {authorityErrorMsg && (
                    <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-700 dark:text-red-300 font-semibold flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{authorityErrorMsg}</span>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Level 2: HR Manager Selection (Supports 2 or more) */}
                    <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-900/80 dark:text-blue-200 rounded text-[10px] font-black uppercase tracking-wider">
                                Level 2 Owners ({selectedHrManagerIds.length} Selected)
                            </span>
                            <span className="text-[11px] font-bold text-slate-500">SLA: Day 3 - 7</span>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                                Designated HR Managers (Add 2 or more)
                            </label>

                            {/* Selected HR Manager Badges */}
                            <div className="flex flex-wrap gap-1.5 mb-2.5">
                                {selectedHrManagerIds.length > 0 ? (
                                    selectedHrManagerIds.map((id) => {
                                        const emp = employeesList.find(e => e.id === id);
                                        return (
                                            <div
                                                key={id}
                                                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-slate-900 border border-blue-300 dark:border-blue-700 text-blue-900 dark:text-blue-200 rounded-lg text-xs font-bold shadow-xs"
                                            >
                                                <User className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                                                <span>{emp ? `${emp.full_name || `${emp.first_name} ${emp.last_name}`} (${emp.employee_code || ''})` : id}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveHrManager(id)}
                                                    className="p-0.5 hover:bg-blue-100 dark:hover:bg-blue-800 rounded-full text-slate-400 hover:text-blue-700 dark:hover:text-blue-200 transition-colors"
                                                    title="Remove HR Manager"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="text-xs text-slate-400 italic">No HR Manager selected. Escalations will default to HR Team.</div>
                                )}
                            </div>

                            {/* Searchable Combobox to add HR Manager */}
                            <SearchableEmployeeSelector
                                placeholder="+ Add HR Manager"
                                employees={employeesList}
                                selectedIds={selectedHrManagerIds}
                                onSelect={handleAddHrManager}
                                accentColor="blue"
                            />
                        </div>
                    </div>

                    {/* Level 3: HR Head Selection (Supports 2 or more) */}
                    <div className="p-4 rounded-xl border border-purple-200 dark:border-purple-900/60 bg-purple-50/40 dark:bg-purple-950/20 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-800 dark:bg-purple-900/80 dark:text-purple-200 rounded text-[10px] font-black uppercase tracking-wider">
                                Level 3 Owners ({selectedHrHeadIds.length} Selected)
                            </span>
                            <span className="text-[11px] font-bold text-slate-500">SLA: Day 7 - 10</span>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                                Designated HR Heads (Add 2 or more)
                            </label>

                            {/* Selected HR Head Badges */}
                            <div className="flex flex-wrap gap-1.5 mb-2.5">
                                {selectedHrHeadIds.length > 0 ? (
                                    selectedHrHeadIds.map((id) => {
                                        const emp = employeesList.find(e => e.id === id);
                                        return (
                                            <div
                                                key={id}
                                                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-700 text-purple-900 dark:text-purple-200 rounded-lg text-xs font-bold shadow-xs"
                                            >
                                                <User className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                                                <span>{emp ? `${emp.full_name || `${emp.first_name} ${emp.last_name}`} (${emp.employee_code || ''})` : id}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveHrHead(id)}
                                                    className="p-0.5 hover:bg-purple-100 dark:hover:bg-purple-800 rounded-full text-slate-400 hover:text-purple-700 dark:hover:text-purple-200 transition-colors"
                                                    title="Remove HR Head"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="text-xs text-slate-400 italic">No HR Head selected.</div>
                                )}
                            </div>

                            {/* Searchable Combobox to add HR Head */}
                            <SearchableEmployeeSelector
                                placeholder="+ Add HR Head"
                                employees={employeesList}
                                selectedIds={selectedHrHeadIds}
                                onSelect={handleAddHrHead}
                                accentColor="purple"
                            />
                        </div>
                    </div>

                    {/* Level 4: Director Selection (Supports 2 or more) */}
                    <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="px-2 py-0.5 bg-red-100 text-red-800 dark:bg-red-900/80 dark:text-red-200 rounded text-[10px] font-black uppercase tracking-wider">
                                Level 4 Owners ({selectedDirectorIds.length} Selected)
                            </span>
                            <span className="text-[11px] font-bold text-slate-500">SLA: Day 10+</span>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                                Designated Directors (Add 2 or more)
                            </label>

                            {/* Selected Director Badges */}
                            <div className="flex flex-wrap gap-1.5 mb-2.5">
                                {selectedDirectorIds.length > 0 ? (
                                    selectedDirectorIds.map((id) => {
                                        const emp = employeesList.find(e => e.id === id);
                                        return (
                                            <div
                                                key={id}
                                                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-slate-900 border border-red-300 dark:border-red-700 text-red-900 dark:text-red-200 rounded-lg text-xs font-bold shadow-xs"
                                            >
                                                <User className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                                                <span>{emp ? `${emp.full_name || `${emp.first_name} ${emp.last_name}`} (${emp.employee_code || ''})` : id}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveDirector(id)}
                                                    className="p-0.5 hover:bg-red-100 dark:hover:bg-red-800 rounded-full text-slate-400 hover:text-red-700 dark:hover:text-red-200 transition-colors"
                                                    title="Remove Director"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="text-xs text-slate-400 italic">No Director selected.</div>
                                )}
                            </div>

                            {/* Searchable Combobox to add Director */}
                            <SearchableEmployeeSelector
                                placeholder="+ Add Director"
                                employees={employeesList}
                                selectedIds={selectedDirectorIds}
                                onSelect={handleAddDirector}
                                accentColor="red"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {saveMsg && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 font-semibold flex items-center gap-2">
                    <Check className="w-4 h-4 shrink-0" />
                    <span>{saveMsg}</span>
                </div>
            )}

            {errorMsg && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-700 dark:text-red-300 font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{errorMsg}</span>
                </div>
            )}

            {/* View 1: Graphical Escalation Tree */}
            {activeTab === 'tree' && (
                <HREscalationTreeVisualizer
                    designatedHrManagers={designatedHrManagers}
                    designatedHrHeads={designatedHrHeads}
                    designatedDirectors={designatedDirectors}
                />
            )}

            {/* View 2: Table View */}
            {activeTab === 'table' && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                        <thead>
                            <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold">
                                <th className="p-3.5 pl-4">Type</th>
                                <th className="p-3.5">Category Name</th>
                                <th className="p-3.5">Sub-Category</th>
                                <th className="p-3.5">Level 1 Owner</th>
                                <th className="p-3.5">L1 SLA</th>
                                <th className="p-3.5">L2 SLA</th>
                                <th className="p-3.5">L3 SLA</th>
                                <th className="p-3.5">L4 SLA</th>
                                <th className="p-3.5 pr-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                            {categories.map((cat) => {
                                const isEditing = editingId === cat.id;
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
                                                cat.category_name
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
                                                cat.sub_category_name || '-'
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
                                        <td className="p-3.5 font-mono">
                                            {isEditing ? (
                                                <input
                                                    type="number"
                                                    value={editForm.l1_sla_days ?? cat.l1_sla_days}
                                                    onChange={(e) => setEditForm({ ...editForm, l1_sla_days: parseInt(e.target.value) })}
                                                    className="w-14 px-2 py-1 border rounded text-xs bg-white dark:bg-slate-800"
                                                />
                                            ) : (
                                                `${cat.l1_sla_days}d`
                                            )}
                                        </td>
                                        <td className="p-3.5 font-mono">
                                            {isEditing ? (
                                                <input
                                                    type="number"
                                                    value={editForm.l2_sla_days ?? cat.l2_sla_days}
                                                    onChange={(e) => setEditForm({ ...editForm, l2_sla_days: parseInt(e.target.value) })}
                                                    className="w-14 px-2 py-1 border rounded text-xs bg-white dark:bg-slate-800"
                                                />
                                            ) : (
                                                `${cat.l2_sla_days}d`
                                            )}
                                        </td>
                                        <td className="p-3.5 font-mono">
                                            {isEditing ? (
                                                <input
                                                    type="number"
                                                    value={editForm.l3_sla_days ?? cat.l3_sla_days}
                                                    onChange={(e) => setEditForm({ ...editForm, l3_sla_days: parseInt(e.target.value) })}
                                                    className="w-14 px-2 py-1 border rounded text-xs bg-white dark:bg-slate-800"
                                                />
                                            ) : (
                                                `${cat.l3_sla_days}d`
                                            )}
                                        </td>
                                        <td className="p-3.5 font-mono">
                                            {isEditing ? (
                                                <input
                                                    type="number"
                                                    value={editForm.l4_sla_days ?? cat.l4_sla_days}
                                                    onChange={(e) => setEditForm({ ...editForm, l4_sla_days: parseInt(e.target.value) })}
                                                    className="w-14 px-2 py-1 border rounded text-xs bg-white dark:bg-slate-800"
                                                />
                                            ) : (
                                                `${cat.l4_sla_days}d`
                                            )}
                                        </td>
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
                                                        Edit SLA
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
                            })}
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
                                            setNewCategory({
                                                ...newCategory,
                                                ticket_type: type,
                                                first_level_owner_type: type === 'grievance' ? 'reporting_manager' : type === 'hr_query' ? 'hr' : 'director',
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

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">L1 SLA (Days)</label>
                                        <input
                                            type="number"
                                            min={1}
                                            value={newCategory.l1_sla_days}
                                            onChange={(e) => setNewCategory({ ...newCategory, l1_sla_days: parseInt(e.target.value) || 1 })}
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">L2 SLA (Days)</label>
                                        <input
                                            type="number"
                                            min={1}
                                            value={newCategory.l2_sla_days}
                                            onChange={(e) => setNewCategory({ ...newCategory, l2_sla_days: parseInt(e.target.value) || 1 })}
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
                                        />
                                    </div>
                                </div>
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
