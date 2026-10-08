'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, UserCheck, Edit2, Edit3, UserCog, Check, AlertCircle, RefreshCw, UserPlus, Eye, ShieldCheck, AlertTriangle, Info, X, Trash2, ChevronDown } from 'lucide-react';
import { formatAppRole } from '../../lib/accounts/roles';

interface SearchableManagerDropdownProps {
    value: string;
    onChange: (id: string) => void;
    employees: any[];
    currentEmpId?: string;
    placeholder?: string;
}

function SearchableManagerDropdown({
    value,
    onChange,
    employees = [],
    currentEmpId,
    placeholder = 'Select Manager...'
}: SearchableManagerDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [mounted, setMounted] = useState(false);
    const [coords, setCoords] = useState<{ top: number; left: number; width: number; openUp: boolean }>({ top: 0, left: 0, width: 240, openUp: false });
    
    const buttonRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    const updateCoords = () => {
        if (buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            const openUp = spaceBelow < 260 && rect.top > 260;
            setCoords({
                top: openUp ? rect.top - 4 : rect.bottom + 4,
                left: rect.left,
                width: Math.max(rect.width, 260),
                openUp
            });
        }
    };

    useEffect(() => {
        if (isOpen) {
            updateCoords();
            const handleScrollOrResize = () => updateCoords();
            window.addEventListener('scroll', handleScrollOrResize, true);
            window.addEventListener('resize', handleScrollOrResize);

            const handleClickOutside = (event: MouseEvent) => {
                const target = event.target as Node;
                if (
                    buttonRef.current && !buttonRef.current.contains(target) &&
                    dropdownRef.current && !dropdownRef.current.contains(target)
                ) {
                    setIsOpen(false);
                }
            };
            document.addEventListener('mousedown', handleClickOutside);

            return () => {
                window.removeEventListener('scroll', handleScrollOrResize, true);
                window.removeEventListener('resize', handleScrollOrResize);
                document.removeEventListener('mousedown', handleClickOutside);
            };
        }
    }, [isOpen]);

    const eligibleEmployees = employees.filter(m => !currentEmpId || m.id !== currentEmpId);

    const filtered = eligibleEmployees.filter(emp => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return true;
        const name = (emp.full_name || `${emp.first_name || ''} ${emp.last_name || ''}`).toLowerCase();
        const code = (emp.employee_code || '').toLowerCase();
        const email = (emp.email || emp.user?.email || '').toLowerCase();
        const desig = (emp.designation || emp.department || '').toLowerCase();
        return name.includes(q) || code.includes(q) || email.includes(q) || desig.includes(q);
    });

    const selectedEmp = eligibleEmployees.find(m => (m.user_id && m.user_id === value) || m.id === value);
    const selectedLabel = selectedEmp
        ? `${selectedEmp.first_name || ''} ${selectedEmp.last_name || ''}`.trim() + (selectedEmp.employee_code ? ` (${selectedEmp.employee_code})` : '')
        : null;

    const dropdownMenu = isOpen && mounted ? (
        <div
            ref={dropdownRef}
            style={{
                position: 'fixed',
                top: coords.openUp ? 'auto' : `${coords.top}px`,
                bottom: coords.openUp ? `${window.innerHeight - coords.top}px` : 'auto',
                left: `${coords.left}px`,
                width: `${coords.width}px`,
                zIndex: 99999
            }}
            className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-2.5 space-y-2 animate-in fade-in zoom-in-95 duration-100"
        >
            <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                    type="text"
                    autoFocus
                    placeholder="Search manager by name, code, dept..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-[#587e85]/30 focus:border-[#587e85]"
                />
                {searchQuery && (
                    <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            <div className="max-h-52 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                <button
                    type="button"
                    onClick={() => {
                        onChange('');
                        setIsOpen(false);
                        setSearchQuery('');
                    }}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                        !value
                            ? 'bg-[#587e85]/10 text-[#587e85] dark:text-teal-300 font-bold border border-[#587e85]/20'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-500'
                    }`}
                >
                    -- Unassigned --
                </button>

                {filtered.length === 0 ? (
                    <div className="p-3 text-center text-slate-400 text-xs italic">
                        No matching managers found
                    </div>
                ) : (
                    filtered.map((emp) => {
                        const targetVal = emp.user_id || emp.id;
                        const isSelected = value === targetVal || value === emp.id || value === emp.user_id;
                        const name = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.email || 'Unnamed';

                        return (
                            <button
                                key={emp.id}
                                type="button"
                                onClick={() => {
                                    onChange(targetVal);
                                    setIsOpen(false);
                                    setSearchQuery('');
                                }}
                                className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-all flex items-center justify-between gap-2 ${
                                    isSelected
                                        ? 'bg-[#587e85] text-white font-bold shadow-sm'
                                        : 'hover:bg-[#587e85]/10 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 font-medium'
                                }`}
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="truncate font-semibold flex items-center gap-1.5">
                                        <span>{name}</span>
                                        {emp.employee_code && (
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono ${
                                                isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold'
                                            }`}>
                                                {emp.employee_code}
                                            </span>
                                        )}
                                    </div>
                                    {emp.designation && (
                                        <div className={`text-[10px] truncate mt-0.5 ${isSelected ? 'text-teal-100' : 'text-slate-400'}`}>
                                            {emp.designation} {emp.department ? `• ${emp.department}` : ''}
                                        </div>
                                    )}
                                </div>
                                {isSelected && <Check className="w-4 h-4 shrink-0" />}
                            </button>
                        );
                    })
                )}
            </div>
        </div>
    ) : null;

    return (
        <div className="w-full min-w-[210px]">
            <button
                ref={buttonRef}
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center justify-between gap-2 shadow-xs hover:border-[#587e85] focus:outline-none focus:ring-2 focus:ring-[#587e85]/20 transition-all"
            >
                <span className="truncate">
                    {selectedLabel ? (
                        <span className="text-[#587e85] dark:text-teal-300 font-bold">{selectedLabel}</span>
                    ) : (
                        <span className="text-slate-400 font-normal">{placeholder}</span>
                    )}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {mounted && createPortal(dropdownMenu, document.body)}
        </div>
    );
}

interface HREmployeeDirectoryProps {
    orgId?: string;
    organizationId?: string;
    onRefresh?: () => void;
}

export default function HREmployeeDirectory({ orgId, organizationId, onRefresh }: HREmployeeDirectoryProps) {
    const [employees, setEmployees] = useState<any[]>([]);
    const [allManagers, setAllManagers] = useState<any[]>([]);
    const [unlinkedUsers, setUnlinkedUsers] = useState<any[]>([]);
    const [departmentsList, setDepartmentsList] = useState<{ id: string; name: string; code: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [deptFilter, setDeptFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
    const [editingEmpId, setEditingEmpId] = useState<string | null>(null);
    const [selectedManagerId, setSelectedManagerId] = useState<string>('');
    const [updating, setUpdating] = useState(false);
    const [successMsg, setSuccessMsg] = useState('');
    const [selectedEmpForInfo, setSelectedEmpForInfo] = useState<any | null>(null);
    const [deletingEmp, setDeletingEmp] = useState<{ id: string; name: string; code: string } | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [editingEmpData, setEditingEmpData] = useState<any | null>(null);
    const [editFormData, setEditFormData] = useState({
        id: '',
        employee_code: '',
        first_name: '',
        last_name: '',
        email: '',
        contact_number: '',
        department: '',
        department_id: '',
        designation: '',
        location: '',
        reporting_manager_id: ''
    });
    const [savingEdit, setSavingEdit] = useState(false);
    const [editError, setEditError] = useState('');

    const handleOpenEditModal = (emp: any) => {
        setEditError('');
        setEditingEmpData(emp);
        setEditFormData({
            id: emp.id,
            employee_code: emp.employee_code || '',
            first_name: emp.first_name || '',
            last_name: emp.last_name || '',
            email: emp.email || emp.user?.email || '',
            contact_number: emp.contact_number || emp.phone || emp.user?.phone || '',
            department: emp.department || '',
            department_id: emp.department_id || '',
            designation: emp.designation || '',
            location: emp.location || '',
            reporting_manager_id: emp.reporting_manager_id || ''
        });
    };

    const handleSaveEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingEmpData) return;
        setSavingEdit(true);
        setEditError('');
        try {
            const payload = {
                employee_id: editingEmpData.id,
                employee_code: editFormData.employee_code.trim(),
                first_name: editFormData.first_name.trim(),
                last_name: editFormData.last_name.trim(),
                email: editFormData.email.trim(),
                contact_number: editFormData.contact_number.trim(),
                phone: editFormData.contact_number.trim(),
                department: editFormData.department.trim(),
                department_id: editFormData.department_id || null,
                designation: editFormData.designation.trim(),
                location: editFormData.location.trim(),
                reporting_manager_id: editFormData.reporting_manager_id || null,
                sync_open_tickets: true
            };

            const res = await fetch('/api/hr/admin/employees', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (data.success) {
                setSuccessMsg(`Employee ${payload.first_name} ${payload.last_name} (${payload.employee_code}) updated successfully!`);
                setEditingEmpData(null);
                fetchEmployees();
                fetchAllManagers();
                onRefresh?.();
            } else {
                setEditError(data.error || 'Failed to update employee information');
            }
        } catch (err: any) {
            console.error('Error saving employee edit:', err);
            setEditError(err.message || 'An unexpected error occurred while saving.');
        } finally {
            setSavingEdit(false);
        }
    };

    // Normalize manager name variations for accurate reportees matching
    const normalizeManagerName = (str: string): string => {
        if (!str) return '';
        let s = str.trim().toLowerCase();
        if (s.includes('shailesh') && (s.includes('kashyap') || s === 'shailesh k')) return 'shailesh kumar kashyap';
        if (s.includes('chavan meena') || s.includes('meena chavan')) return 'meena chavan';
        if (s.includes('rajesh') && s.includes('kadam')) return 'rajesh kadam';
        if (s.includes('mehul') && s.includes('kapadia')) return 'mehul kapadia';
        if (s.includes('shrihari') || s.includes('gardas')) return 'shrihari gardas';
        if (s.includes('roohi') && (s.includes('idirishi') || s.includes('idrishi'))) return 'roohi idirishi';
        if (s.includes('siddhalingappa')) return 'siddhalingappa nagond';
        if (s.includes('suraj') && (s.includes('nandavadekar') || s.includes('nandavadkar'))) return 'suraj nandavadekar';
        if (s.includes('altamash')) return 'altamash chaugule';
        if (s.includes('abhiram')) return 'abhiram k';
        if (s.includes('kiran') && (s.includes('kumar') || s === 'kiran')) return 'kiran kumar';
        return s;
    };

    const getDirectReportees = (mgr: any, allList: any[]): any[] => {
        if (!mgr) return [];
        const mgrUid = mgr.user_id || mgr.id;
        const mgrCode = (mgr.employee_code || '').toLowerCase().trim();
        const mgrFullName = `${mgr.first_name || ''} ${mgr.last_name || ''}`.trim();
        const normMgrFullName = normalizeManagerName(mgrFullName);

        return allList.filter(e => {
            const eUid = e.user_id || e.id;
            if (mgrUid && eUid === mgrUid) return false;

            const rId = e.reporting_manager_id || '';
            const rCode = (e.reporting_manager_code || '').trim();
            const rName = (e.reporting_manager_name || '').trim();
            const rStr = (rName || rCode).trim();
            const normRStr = normalizeManagerName(rStr);

            if (!rStr && !rId) return false;

            if (mgrUid && rId && (rId === mgrUid || rId === mgr.id)) return true;
            if (mgrCode && mgrCode.length > 1 && (rCode.toLowerCase() === mgrCode || rName.toLowerCase() === mgrCode)) return true;
            if (normMgrFullName && normRStr && normRStr === normMgrFullName) return true;
            if (mgrFullName && rStr && rStr.toLowerCase() === mgrFullName.toLowerCase()) return true;

            return false;
        });
    };

    const getAllSubTreeReportees = (mgr: any, allList: any[], visited = new Set<string>()): any[] => {
        if (!mgr) return [];
        const mgrKey = mgr.user_id || mgr.id || (mgr.employee_code || '').toLowerCase().trim() || `${mgr.first_name || ''} ${mgr.last_name || ''}`.trim().toLowerCase();
        if (!mgrKey || visited.has(mgrKey)) return [];
        const nextVisited = new Set(visited);
        nextVisited.add(mgrKey);

        const direct = getDirectReportees(mgr, allList);
        let all = [...direct];

        for (const child of direct) {
            const sub = getAllSubTreeReportees(child, allList, nextVisited);
            for (const s of sub) {
                const sKey = s.user_id || s.id || (s.employee_code || '').toLowerCase().trim();
                if (!all.some(item => (item.id === s.id || (sKey && (item.user_id || item.id || (item.employee_code || '').toLowerCase().trim()) === sKey)))) {
                    all.push(s);
                }
            }
        }
        return all;
    };

    useEffect(() => {
        fetchAllManagers();
    }, []);

    const fetchAllManagers = async () => {
        try {
            const res = await fetch('/api/hr/admin/employees');
            if (res.ok) {
                const text = await res.text();
                const data = text ? JSON.parse(text) : {};
                if (data.success) {
                    setAllManagers(data.data || []);
                    if (data.unlinked_users) {
                        setUnlinkedUsers(data.unlinked_users);
                    }
                    if (data.departments) {
                        setDepartmentsList(data.departments);
                    }
                }
            }
        } catch (err) {
            console.error('Error fetching all managers:', err);
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchEmployees();
        }, 200);
        return () => clearTimeout(timer);
    }, [deptFilter, searchQuery]);

    const fetchEmployees = async () => {
        setLoading(true);
        try {
            const url = new URL('/api/hr/admin/employees', window.location.origin);
            if (deptFilter) url.searchParams.append('department', deptFilter);
            if (searchQuery) url.searchParams.append('q', searchQuery);

            const res = await fetch(url.toString());
            if (res.ok) {
                const text = await res.text();
                const data = text ? JSON.parse(text) : {};
                if (data.success) {
                    const list = data.data || [];
                    setEmployees(list);
                    if (data.unlinked_users) {
                        setUnlinkedUsers(data.unlinked_users);
                    }
                    if (data.departments) {
                        setDepartmentsList(data.departments);
                    }
                    if (!deptFilter && !searchQuery) {
                        setAllManagers(list);
                    }
                }
            }
        } catch (err) {
            console.error('Error fetching employees:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        fetchEmployees();
    };

    const handleDeleteEmployee = async () => {
        if (!deletingEmp) return;
        setDeleting(true);
        try {
            const res = await fetch(`/api/hr/admin/employees?id=${deletingEmp.id}`, {
                method: 'DELETE'
            });
            const text = await res.text();
            const data = text ? JSON.parse(text) : {};
            if (data.success) {
                setSuccessMsg(`Employee ${deletingEmp.name} (${deletingEmp.code}) removed successfully.`);
                setDeletingEmp(null);
                // Reset search query so the UI re-fetches and displays all remaining employees
                setSearchQuery('');
                fetchEmployees();
                onRefresh?.();
            } else {
                alert(`Failed to remove employee: ${data.error || 'Unknown error'}`);
            }
        } catch (err) {
            console.error('Error deleting employee:', err);
            alert('An error occurred while deleting the employee.');
        } finally {
            setDeleting(false);
        }
    };

    const handleSaveManager = async (employeeId: string) => {
        setUpdating(true);
        setSuccessMsg('');
        try {
            const res = await fetch('/api/hr/admin/employees', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employee_id: employeeId,
                    reporting_manager_id: selectedManagerId,
                    sync_open_tickets: true
                })
            });

            const text = await res.text();
            const data = text ? JSON.parse(text) : {};
            if (data.success) {
                setSuccessMsg(`Manager updated successfully! ${data.synced_tickets_count > 0 ? `(${data.synced_tickets_count} open L1 tickets re-assigned)` : ''}`);
                setEditingEmpId(null);
                fetchEmployees();
                onRefresh?.();
            }
        } catch (err) {
            console.error('Error updating manager:', err);
        } finally {
            setUpdating(false);
        }
    };

    const departments = Array.from(new Set(employees.map(e => e.department).filter(Boolean)));

    const linkedCount = employees.filter(e => e.is_app_linked).length;
    const unlinkedCount = employees.filter(e => !e.is_app_linked).length;

    const [showAddModal, setShowAddModal] = useState(false);
    const [newEmpData, setNewEmpData] = useState({
        user_id: '',
        employee_code: '',
        first_name: '',
        last_name: '',
        email: '',
        contact_number: '',
        department: 'Operations',
        department_id: '',
        designation: 'Senior Executive',
        location: 'Lower Parel',
        reporting_manager_id: '',
        create_app_account: true,
        role: 'staff'
    });
    const [adding, setAdding] = useState(false);

    const selectedDeptObj = departmentsList.find(d => 
        (newEmpData.department_id && d.id === newEmpData.department_id) ||
        (newEmpData.department && d.name.toLowerCase() === newEmpData.department.toLowerCase())
    );

    const matchedAppUser = unlinkedUsers.find(u => 
        (newEmpData.user_id && u.id === newEmpData.user_id) ||
        (newEmpData.email && u.email && u.email.toLowerCase().trim() === newEmpData.email.toLowerCase().trim())
    );

    const handleSelectExistingUser = (userId: string) => {
        if (!userId) {
            setNewEmpData(prev => ({ ...prev, user_id: '', create_app_account: true }));
            return;
        }
        const selected = unlinkedUsers.find(u => u.id === userId);
        if (selected) {
            const nameParts = (selected.full_name || '').trim().split(' ');
            const fName = nameParts[0] || '';
            const lName = nameParts.slice(1).join(' ') || '';
            setNewEmpData(prev => ({
                ...prev,
                user_id: selected.id,
                email: selected.email || prev.email,
                first_name: fName || prev.first_name,
                last_name: lName || prev.last_name,
                contact_number: selected.phone || prev.contact_number,
                create_app_account: false
            }));
        }
    };

    const handleCreateEmployee = async (e: React.FormEvent) => {
        e.preventDefault();
        setAdding(true);
        setSuccessMsg('');
        try {
            const payload = {
                ...newEmpData,
                user_id: newEmpData.user_id || matchedAppUser?.id || undefined,
                organization_id: orgId || organizationId || '211e1330-ad83-446d-941f-dcea48396798'
            };

            const res = await fetch('/api/hr/admin/employees', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                const empName = data.data.full_name || `${data.data.first_name || ''} ${data.data.last_name || ''}`.trim();
                const linkNotice = data.is_linked || data.data.user_id ? ' (Linked to App Account)' : '';
                setSuccessMsg(`Employee ${empName} (${data.data.employee_code}) onboarded successfully!${linkNotice}`);
                setShowAddModal(false);
                setNewEmpData({
                    user_id: '',
                    employee_code: '',
                    first_name: '',
                    last_name: '',
                    email: '',
                    contact_number: '',
                    department: 'Operations',
                    department_id: '',
                    designation: 'Senior Executive',
                    location: 'Lower Parel',
                    reporting_manager_id: '',
                    create_app_account: true,
                    role: 'staff'
                });
                fetchEmployees();
                onRefresh?.();
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (err) {
            console.error('Error creating employee:', err);
        } finally {
            setAdding(false);
        }
    };

    const filteredEmployees = employees.filter(e => {
        if (statusFilter === 'linked' && !e.is_app_linked) return false;
        if (statusFilter === 'unlinked' && e.is_app_linked) return false;
        return true;
    });

    return (
        <div className="space-y-4">
            {/* Summary Statistics Bar (Clickable KPI Filter Cards) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div
                    onClick={() => setStatusFilter('all')}
                    className={`p-3.5 bg-white dark:bg-slate-900 rounded-2xl cursor-pointer transition-all hover:scale-[1.01] active:scale-95 ${
                        statusFilter === 'all'
                            ? 'border-2 border-[#587e85] bg-[#587e85]/5 shadow-md ring-2 ring-[#587e85]/20'
                            : 'border border-slate-200 dark:border-slate-800 shadow-sm hover:border-[#587e85]/50'
                    } flex items-center justify-between group`}
                >
                    <div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Total Employees</span>
                            {statusFilter === 'all' && (
                                <span className="px-1.5 py-0.2 rounded bg-[#587e85] text-white text-[9px] font-bold">Active Filter</span>
                            )}
                        </div>
                        <div className="text-xl font-black text-slate-900 dark:text-white mt-0.5">{employees.length}</div>
                        <div className="text-[10px] text-slate-400 mt-1 font-medium group-hover:text-[#587e85] transition-colors">
                            Click to show all employees
                        </div>
                    </div>
                    <div className={`p-2.5 rounded-xl transition-colors ${statusFilter === 'all' ? 'bg-[#587e85] text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
                        <UserCheck className="w-5 h-5" />
                    </div>
                </div>

                <div
                    onClick={() => setStatusFilter('linked')}
                    className={`p-3.5 bg-white dark:bg-slate-900 rounded-2xl cursor-pointer transition-all hover:scale-[1.01] active:scale-95 ${
                        statusFilter === 'linked'
                            ? 'border-2 border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/40 shadow-md ring-2 ring-emerald-500/20'
                            : 'border border-emerald-200/80 dark:border-emerald-900/40 shadow-sm hover:border-emerald-400'
                    } flex items-center justify-between group`}
                >
                    <div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Linked in App</span>
                            {statusFilter === 'linked' && (
                                <span className="px-1.5 py-0.2 rounded bg-emerald-600 text-white text-[9px] font-bold">Active Filter</span>
                            )}
                        </div>
                        <div className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5">{linkedCount}</div>
                        <div className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 mt-1 font-medium group-hover:underline">
                            Click to filter linked app users
                        </div>
                    </div>
                    <div className={`p-2.5 rounded-xl transition-colors ${statusFilter === 'linked' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'}`}>
                        <Check className="w-5 h-5" />
                    </div>
                </div>

                <div
                    onClick={() => setStatusFilter('unlinked')}
                    className={`p-3.5 bg-white dark:bg-slate-900 rounded-2xl cursor-pointer transition-all hover:scale-[1.01] active:scale-95 ${
                        statusFilter === 'unlinked'
                            ? 'border-2 border-amber-500 bg-amber-50/50 dark:bg-amber-950/40 shadow-md ring-2 ring-amber-500/20'
                            : 'border border-amber-200/80 dark:border-amber-900/40 shadow-sm hover:border-amber-400'
                    } flex items-center justify-between group`}
                >
                    <div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400">In Excel (Not in App)</span>
                            {statusFilter === 'unlinked' && (
                                <span className="px-1.5 py-0.2 rounded bg-amber-600 text-white text-[9px] font-bold">Active Filter</span>
                            )}
                        </div>
                        <div className="text-xl font-black text-amber-600 dark:text-amber-400 mt-0.5">{unlinkedCount}</div>
                        <div className="text-[10px] text-amber-600/80 dark:text-amber-400/80 mt-1 font-medium group-hover:underline">
                            Click to filter unlinked profiles
                        </div>
                    </div>
                    <div className={`p-2.5 rounded-xl transition-colors ${statusFilter === 'unlinked' ? 'bg-amber-500 text-white shadow-sm' : 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'}`}>
                        <AlertTriangle className="w-5 h-5" />
                    </div>
                </div>
            </div>

            {/* Active KPI Filter Banner */}
            {statusFilter !== 'all' && (
                <div className="flex items-center justify-between px-4 py-2 bg-[#587e85]/10 border border-[#587e85]/20 rounded-xl text-xs font-semibold text-[#587e85] dark:text-teal-300 animate-in fade-in duration-150">
                    <div className="flex items-center gap-2">
                        <Info className="w-4 h-4 text-[#587e85]" />
                        <span>
                            Showing <strong>{statusFilter === 'linked' ? `Linked App Accounts (${filteredEmployees.length})` : `In Excel - Not in App (${filteredEmployees.length})`}</strong>
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setStatusFilter('all')}
                        className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-[11px] font-bold hover:bg-slate-100"
                    >
                        Reset Filter (Show All {employees.length})
                    </button>
                </div>
            )}

            {/* Top Toolbar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <form onSubmit={handleSearch} className="flex-1 flex gap-2">
                    <div className="relative flex-1">
                        <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search by ECode, Name, Email..."
                            className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-[#587e85] outline-none"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                                title="Clear search"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                    <button
                        type="submit"
                        className="px-4 py-2 bg-[#587e85] hover:bg-[#48686e] text-white rounded-xl text-xs font-bold shadow-sm transition-colors"
                    >
                        Search
                    </button>
                </form>

                <div className="flex items-center gap-2">
                    <select
                        value={deptFilter}
                        onChange={(e) => setDeptFilter(e.target.value)}
                        className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-[#587e85] outline-none"
                    >
                        <option value="">All Departments</option>
                        {departments.map(d => (
                            <option key={d} value={d}>{d}</option>
                        ))}
                    </select>

                    <button
                        onClick={() => setShowAddModal(true)}
                        className="px-4 py-2 bg-[#aa895f] hover:bg-[#8f7350] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm shrink-0 transition-colors"
                    >
                        <UserPlus className="w-4 h-4" />
                        Onboard New Employee
                    </button>
                </div>
            </div>

            {successMsg && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 font-semibold flex items-center gap-2">
                    <Check className="w-4 h-4 shrink-0" />
                    <span>{successMsg}</span>
                </div>
            )}

            {/* Employee Directory Table */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                        <thead>
                            <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold">
                                <th className="p-3.5 pl-4">ECode</th>
                                <th className="p-3.5">Employee Name</th>
                                <th className="p-3.5">Department & Designation</th>
                                <th className="p-3.5">App Account Status</th>
                                <th className="p-3.5">Reporting Manager</th>
                                <th className="p-3.5 pr-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                            {loading ? (
                                <tr>
                                    <td colSpan={6} className="p-8 text-center text-slate-400">Loading directory...</td>
                                </tr>
                            ) : filteredEmployees.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="p-8 text-center text-slate-400">No employees found matching status filter ({statusFilter}).</td>
                                </tr>
                            ) : (
                                filteredEmployees.map((emp) => {
                                    const isEditing = editingEmpId === emp.id;
                                    return (
                                        <tr key={emp.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                            <td className="p-3.5 pl-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                                                {emp.employee_code}
                                            </td>
                                            <td className="p-3.5 font-bold text-slate-900 dark:text-white">
                                                <div>{emp.first_name} {emp.last_name}</div>
                                                <div className="text-[10px] text-slate-400 font-normal">{emp.email}</div>
                                            </td>
                                            <td className="p-3.5">
                                                <div className="font-semibold text-slate-900 dark:text-white">{emp.designation}</div>
                                                <div className="text-[10px] text-slate-400 font-normal">{emp.department} • {emp.location}</div>
                                            </td>
                                            <td className="p-3.5">
                                                {emp.is_app_linked ? (
                                                    <div>
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold border border-emerald-200 dark:border-emerald-800">
                                                            <Check className="w-3 h-3" />
                                                            Linked in App
                                                        </span>
                                                        <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                                                            {emp.app_email || emp.user?.email || emp.email} • <span className="font-bold text-indigo-600 dark:text-indigo-400 uppercase">{formatAppRole(emp)}</span>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div>
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-[10px] font-bold border border-amber-200 dark:border-amber-800">
                                                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                                                            In Excel (Not in App)
                                                        </span>
                                                        <div className="text-[10px] text-amber-600/80 dark:text-amber-400/80 mt-0.5 font-medium">
                                                            Pending Registration
                                                        </div>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-3.5">
                                                {isEditing ? (
                                                     <SearchableManagerDropdown
                                                         value={selectedManagerId}
                                                         onChange={(id) => setSelectedManagerId(id)}
                                                         employees={allManagers.length > 0 ? allManagers : employees}
                                                         currentEmpId={emp.id}
                                                         placeholder="Select Manager..."
                                                     />
                                                ) : (
                                                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                                                        {emp.reporting_manager_code || emp.reporting_manager?.raw_user_meta_data?.full_name || 'Unassigned'}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-3.5 pr-4 text-right">
                                                {isEditing ? (
                                                    <div className="flex justify-end gap-1.5">
                                                        <button
                                                            onClick={() => handleSaveManager(emp.id)}
                                                            disabled={updating}
                                                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-[11px]"
                                                        >
                                                            Save
                                                        </button>
                                                        <button
                                                            onClick={() => setEditingEmpId(null)}
                                                            className="px-2.5 py-1 bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-[11px]"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <button
                                                            onClick={() => setSelectedEmpForInfo(emp)}
                                                            className="px-2 py-1 text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors inline-flex items-center gap-1 text-[11px] font-semibold border border-slate-200/80 dark:border-slate-700"
                                                            title="View App Account Info"
                                                        >
                                                            <Eye className="w-3.5 h-3.5 text-indigo-500" />
                                                            <span>App Info</span>
                                                        </button>

                                                        <button
                                                            onClick={() => handleOpenEditModal(emp)}
                                                            className="px-2 py-1 text-[#587e85] hover:text-[#3d5a5f] dark:text-teal-300 dark:hover:text-teal-200 rounded-lg hover:bg-[#587e85]/10 dark:hover:bg-teal-950/40 transition-colors inline-flex items-center gap-1 text-[11px] font-semibold border border-[#587e85]/30"
                                                            title="Edit Employee Information (Code, Name, Department, etc.)"
                                                        >
                                                            <Edit3 className="w-3.5 h-3.5 text-[#587e85] dark:text-teal-400" />
                                                            <span>Edit</span>
                                                        </button>

                                                        <button
                                                            onClick={() => {
                                                                setEditingEmpId(emp.id);
                                                                setSelectedManagerId(emp.reporting_manager_id || '');
                                                            }}
                                                            className="px-2 py-1 text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors inline-flex items-center gap-1 text-[11px] font-semibold"
                                                        >
                                                            <Edit2 className="w-3.5 h-3.5" />
                                                            <span>Manager</span>
                                                        </button>

                                                        <button
                                                            onClick={() => setDeletingEmp({ id: emp.id, name: `${emp.first_name} ${emp.last_name}`, code: emp.employee_code })}
                                                            className="px-2 py-1 text-red-600 hover:text-red-700 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors inline-flex items-center gap-1 text-[11px] font-semibold border border-red-200/60 dark:border-red-900/40"
                                                            title="Remove Employee Record"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5 text-red-500" />
                                                            <span>Remove</span>
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

            {/* App Account Info Details Modal */}
            {selectedEmpForInfo && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-3 sm:p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl max-w-lg sm:max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                    <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                                    App Account & Link Info
                                </h3>
                                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                                    {selectedEmpForInfo.employee_code} • {selectedEmpForInfo.first_name} {selectedEmpForInfo.last_name}
                                </p>
                            </div>
                            <button
                                onClick={() => setSelectedEmpForInfo(null)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-5 overflow-y-auto space-y-4 text-xs">
                            {/* Link Banner */}
                            {selectedEmpForInfo.is_app_linked ? (
                                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center gap-3">
                                    <div className="p-2 rounded-xl bg-emerald-500 text-white shrink-0">
                                        <Check className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <div className="font-bold text-emerald-900 dark:text-emerald-200 text-xs">
                                            Active App User Account Linked
                                        </div>
                                        <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                                            Employee profile is synced with live app account credentials.
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl flex items-center gap-3">
                                    <div className="p-2 rounded-xl bg-amber-500 text-white shrink-0">
                                        <AlertTriangle className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <div className="font-bold text-amber-900 dark:text-amber-200 text-xs">
                                            In Excel (Not Registered in App Yet)
                                        </div>
                                        <div className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                                            Record exists in master HR sheet, but no active app login is linked.
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Excel HR Database Info */}
                            <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3">
                                <div className="font-bold text-slate-900 dark:text-white uppercase tracking-wider text-[10px] text-slate-400">
                                    Master HR Database Record (Excel)
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                    <div className="min-w-0">
                                        <span className="text-slate-400 font-medium block text-[10px] uppercase tracking-wider mb-0.5">Full Name</span>
                                        <span className="font-bold text-slate-800 dark:text-slate-200 block break-words">{selectedEmpForInfo.first_name} {selectedEmpForInfo.last_name}</span>
                                    </div>
                                    <div className="min-w-0">
                                        <span className="text-slate-400 font-medium block text-[10px] uppercase tracking-wider mb-0.5">Employee Code</span>
                                        <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 block">{selectedEmpForInfo.employee_code}</span>
                                    </div>
                                    <div className="min-w-0">
                                        <span className="text-slate-400 font-medium block text-[10px] uppercase tracking-wider mb-0.5">HR Email</span>
                                        <span className="font-semibold text-slate-800 dark:text-slate-200 block break-all leading-snug" title={selectedEmpForInfo.email}>
                                            {selectedEmpForInfo.email || 'N/A'}
                                        </span>
                                    </div>
                                    <div className="min-w-0">
                                        <span className="text-slate-400 font-medium block text-[10px] uppercase tracking-wider mb-0.5">Contact Number</span>
                                        <span className="font-semibold text-slate-800 dark:text-slate-200 block break-words">
                                            {selectedEmpForInfo.contact_number || selectedEmpForInfo.phone || 'N/A'}
                                        </span>
                                    </div>
                                    <div className="min-w-0">
                                        <span className="text-slate-400 font-medium block text-[10px] uppercase tracking-wider mb-0.5">Department</span>
                                        <span className="font-semibold text-slate-800 dark:text-slate-200 block break-words leading-snug">
                                            {selectedEmpForInfo.department || 'N/A'}
                                        </span>
                                    </div>
                                    <div className="min-w-0">
                                        <span className="text-slate-400 font-medium block text-[10px] uppercase tracking-wider mb-0.5">Designation & Location</span>
                                        <span className="font-semibold text-slate-800 dark:text-slate-200 block break-words leading-snug">
                                            {selectedEmpForInfo.designation} ({selectedEmpForInfo.location})
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Live App Account Credentials */}
                            <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3">
                                <div className="font-bold text-slate-900 dark:text-white uppercase tracking-wider text-[10px] text-slate-400">
                                    Live App User Credentials
                                </div>
                                {selectedEmpForInfo.is_app_linked ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                        <div className="min-w-0">
                                            <span className="text-slate-400 font-medium block text-[10px] uppercase tracking-wider mb-0.5">App Email</span>
                                            <span className="font-semibold text-slate-900 dark:text-white block break-all leading-snug">
                                                {selectedEmpForInfo.app_email || selectedEmpForInfo.user?.email || 'N/A'}
                                            </span>
                                        </div>
                                        <div className="min-w-0">
                                            <span className="text-slate-400 font-medium block text-[10px] uppercase tracking-wider mb-0.5">App Role</span>
                                            <span className="font-bold text-indigo-600 dark:text-indigo-400 uppercase block">
                                                {selectedEmpForInfo.app_role || 'Staff'}
                                            </span>
                                        </div>
                                        <div className="col-span-1 sm:col-span-2 min-w-0 pt-1 border-t border-slate-100 dark:border-slate-700/60">
                                            <span className="text-slate-400 font-medium block text-[10px] uppercase tracking-wider mb-0.5">App User ID</span>
                                            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 block break-all">
                                                {selectedEmpForInfo.user_id}
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 text-center text-slate-400 py-4">
                                        No registered app login account linked to this employee.
                                    </div>
                                )}
                            </div>

                            {/* Reportees & Reporting Hierarchy Stats */}
                            {(() => {
                                const allList = allManagers.length > 0 ? allManagers : employees;
                                const directList = getDirectReportees(selectedEmpForInfo, allList);
                                const totalList = getAllSubTreeReportees(selectedEmpForInfo, allList);
                                const indirectCount = totalList.length - directList.length;

                                return (
                                    <div className="bg-[#587e85]/5 dark:bg-[#587e85]/10 p-4 rounded-2xl border border-[#587e85]/20 space-y-2">
                                        <div className="font-bold text-[#587e85] dark:text-teal-300 uppercase tracking-wider text-[10px]">
                                            Reporting Hierarchy Breakdown
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                                            <div className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                                <span className="text-[9.5px] font-extrabold uppercase text-slate-400 block">Direct</span>
                                                <span className="text-sm font-black text-slate-900 dark:text-white">{directList.length}</span>
                                            </div>
                                            <div className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                                <span className="text-[9.5px] font-extrabold uppercase text-indigo-500 block">Indirect</span>
                                                <span className="text-sm font-black text-indigo-600 dark:text-indigo-400">{indirectCount}</span>
                                            </div>
                                            <div className="p-2 rounded-xl bg-[#587e85] text-white">
                                                <span className="text-[9.5px] font-extrabold uppercase text-teal-100 block">Total</span>
                                                <span className="text-sm font-black">{totalList.length}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Footer */}
                        <div className="shrink-0 flex items-center justify-between px-5 py-3.5 bg-slate-50/50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => {
                                        const empToEdit = selectedEmpForInfo;
                                        setSelectedEmpForInfo(null);
                                        handleOpenEditModal(empToEdit);
                                    }}
                                    className="px-3.5 py-2 bg-[#587e85] hover:bg-[#47676d] text-white rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                                >
                                    <Edit3 className="w-3.5 h-3.5" />
                                    Edit Details
                                </button>

                                {!selectedEmpForInfo.is_app_linked ? (
                                    <button
                                        onClick={() => {
                                            const empToOnboard = selectedEmpForInfo;
                                            setSelectedEmpForInfo(null);
                                            setNewEmpData({
                                                user_id: empToOnboard.user_id || '',
                                                employee_code: empToOnboard.employee_code || '',
                                                first_name: empToOnboard.first_name || '',
                                                last_name: empToOnboard.last_name || '',
                                                email: empToOnboard.email || '',
                                                contact_number: empToOnboard.contact_number || empToOnboard.phone || '',
                                                department: empToOnboard.department || 'Operations',
                                                department_id: empToOnboard.department_id || '',
                                                designation: empToOnboard.designation || 'Staff',
                                                location: empToOnboard.location || 'Main Site',
                                                reporting_manager_id: empToOnboard.reporting_manager_id || '',
                                                create_app_account: !empToOnboard.is_app_linked,
                                                role: 'staff'
                                            });
                                            setShowAddModal(true);
                                        }}
                                        className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-sm"
                                    >
                                        <UserPlus className="w-3.5 h-3.5" />
                                        Onboard App User
                                    </button>
                                ) : (
                                    <div className="text-[11px] text-slate-400 font-medium">
                                        Synced with active user database
                                    </div>
                                )}
                            </div>

                            <button
                                onClick={() => setSelectedEmpForInfo(null)}
                                className="px-4 py-2 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-semibold text-xs hover:bg-slate-300"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Onboard New Employee Modal */}
            {showAddModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-2 sm:p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl max-w-lg w-full max-h-[92vh] sm:max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-auto">
                        {/* Header */}
                        <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <UserPlus className="w-5 h-5 text-emerald-600" />
                                Onboard New Employee
                            </h3>
                            <button
                                onClick={() => setShowAddModal(false)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors shrink-0"
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleCreateEmployee} className="flex flex-col flex-1 min-h-0 text-xs">
                            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3.5">
                                {unlinkedUsers.length > 0 && (
                                    <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/80 space-y-1.5">
                                        <label className="block text-slate-700 dark:text-slate-300 font-semibold text-xs">
                                            Link Existing App User (Optional)
                                        </label>
                                        <select
                                            value={newEmpData.user_id}
                                            onChange={(e) => handleSelectExistingUser(e.target.value)}
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500 text-xs"
                                        >
                                            <option value="">-- Manual Entry or Select App User --</option>
                                            {unlinkedUsers.map(u => (
                                                <option key={u.id} value={u.id}>
                                                    {u.full_name || 'Unnamed'} ({u.email || 'No email'}) {u.phone ? `• ${u.phone}` : ''}
                                                </option>
                                            ))}
                                        </select>
                                        <div className="text-[11px] text-slate-400">
                                            Select an existing user from the database to link their ID directly to this HR profile.
                                        </div>
                                    </div>
                                )}

                                {matchedAppUser && (
                                    <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 rounded-xl flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-300 animate-in fade-in duration-150">
                                        <div className="flex items-center gap-2">
                                            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                                            <div>
                                                <span className="font-bold">App User Found: </span>
                                                <span>{matchedAppUser.full_name || matchedAppUser.email}</span>
                                                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block font-mono">
                                                    User ID: {matchedAppUser.id}
                                                </span>
                                            </div>
                                        </div>
                                        <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/60 font-bold px-2 py-0.5 rounded-full text-emerald-700 dark:text-emerald-300 shrink-0">
                                            Will Link ID
                                        </span>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">First Name *</label>
                                        <input
                                            type="text"
                                            required
                                            value={newEmpData.first_name}
                                            onChange={e => setNewEmpData({ ...newEmpData, first_name: e.target.value })}
                                            placeholder="e.g. Meena"
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Last Name *</label>
                                        <input
                                            type="text"
                                            required
                                            value={newEmpData.last_name}
                                            onChange={e => setNewEmpData({ ...newEmpData, last_name: e.target.value })}
                                            placeholder="e.g. Chavan"
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">ECode (Optional)</label>
                                        <input
                                            type="text"
                                            value={newEmpData.employee_code}
                                            onChange={e => setNewEmpData({ ...newEmpData, employee_code: e.target.value })}
                                            placeholder="e.g. E097 (Auto if empty)"
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Mobile Number</label>
                                        <input
                                            type="tel"
                                            value={newEmpData.contact_number}
                                            onChange={e => setNewEmpData({ ...newEmpData, contact_number: e.target.value })}
                                            placeholder="e.g. 9820645092"
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Email Address *</label>
                                    <input
                                        type="email"
                                        required
                                        value={newEmpData.email}
                                        onChange={e => setNewEmpData({ ...newEmpData, email: e.target.value })}
                                        placeholder="e.g. employee@company.com"
                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                                    />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <label className="block font-semibold text-slate-700 dark:text-slate-300">Department</label>
                                            {selectedDeptObj && (
                                                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                                    ID Linked ({selectedDeptObj.code || 'VALID'})
                                                </span>
                                            )}
                                        </div>
                                        {departmentsList.length > 0 ? (
                                            <select
                                                value={newEmpData.department_id || (departmentsList.find(d => d.name.toLowerCase() === (newEmpData.department || '').toLowerCase())?.id || '')}
                                                onChange={e => {
                                                    const chosenId = e.target.value;
                                                    const chosen = departmentsList.find(d => d.id === chosenId);
                                                    if (chosen) {
                                                        setNewEmpData({
                                                            ...newEmpData,
                                                            department: chosen.name,
                                                            department_id: chosen.id
                                                        });
                                                    } else {
                                                        setNewEmpData({
                                                            ...newEmpData,
                                                            department: chosenId,
                                                            department_id: ''
                                                        });
                                                    }
                                                }}
                                                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500 text-xs"
                                            >
                                                <option value="">Select Department...</option>
                                                {departmentsList.map(d => (
                                                    <option key={d.id} value={d.id}>
                                                        {d.name} {d.code ? `(${d.code})` : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input
                                                type="text"
                                                value={newEmpData.department}
                                                onChange={e => setNewEmpData({ ...newEmpData, department: e.target.value })}
                                                placeholder="e.g. Operations, Tech..."
                                                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                                            />
                                        )}
                                    </div>
                                    <div>
                                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Designation</label>
                                        <input
                                            type="text"
                                            value={newEmpData.designation}
                                            onChange={e => setNewEmpData({ ...newEmpData, designation: e.target.value })}
                                            placeholder="e.g. Assistant Manager"
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Location</label>
                                        <input
                                            type="text"
                                            value={newEmpData.location}
                                            onChange={e => setNewEmpData({ ...newEmpData, location: e.target.value })}
                                            placeholder="e.g. Lower Parel"
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Reporting Manager</label>
                                        <SearchableManagerDropdown
                                            value={newEmpData.reporting_manager_id}
                                            onChange={(id) => setNewEmpData({ ...newEmpData, reporting_manager_id: id })}
                                            employees={allManagers.length > 0 ? allManagers : employees}
                                            placeholder="Select Manager..."
                                        />
                                    </div>
                                </div>

                                {matchedAppUser ? (
                                    <div className="p-3 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-800/40 rounded-xl text-xs flex items-center gap-2.5 text-emerald-800 dark:text-emerald-300">
                                        <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                                        <span>User account is already active. This HR profile will be linked directly to user ID: <span className="font-mono font-bold">{matchedAppUser.id}</span></span>
                                    </div>
                                ) : (
                                    <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl space-y-2 border border-slate-200 dark:border-slate-700">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={newEmpData.create_app_account}
                                                onChange={e => setNewEmpData({ ...newEmpData, create_app_account: e.target.checked })}
                                                className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                                            />
                                            <span className="font-bold text-slate-900 dark:text-white">Create Active App Account Now</span>
                                        </label>

                                        {newEmpData.create_app_account && (
                                            <div>
                                                <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">Assign App Role</label>
                                                <select
                                                    value={newEmpData.role}
                                                    onChange={e => setNewEmpData({ ...newEmpData, role: e.target.value })}
                                                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                                                >
                                                    <option value="staff">Staff / Employee</option>
                                                    <option value="hr">HR Executive</option>
                                                    <option value="hr_head">HR Head</option>
                                                    <option value="property_admin">Property Admin</option>
                                                    <option value="org_super_admin">Org Super Admin</option>
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="shrink-0 flex items-center justify-end gap-2 px-4 sm:px-6 py-3 bg-slate-50/50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setShowAddModal(false)}
                                    className="px-4 py-2 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-semibold hover:bg-slate-300"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={adding}
                                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-md disabled:opacity-50"
                                >
                                    {adding ? 'Onboarding...' : 'Complete Onboarding'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* Delete Employee Confirmation Modal */}
            {deletingEmp && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 animate-in zoom-in-95 duration-200">
                        <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
                            <div className="p-3 bg-red-100 dark:bg-red-950/60 rounded-2xl">
                                <AlertTriangle className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-slate-900 dark:text-white">Remove Employee Record</h3>
                                <p className="text-xs text-slate-500 font-mono mt-0.5">{deletingEmp.code}</p>
                            </div>
                        </div>

                        <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            Are you sure you want to remove <strong className="text-slate-900 dark:text-white">{deletingEmp.name}</strong> ({deletingEmp.code}) from the HR Employee Directory?
                            <br />
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 block">
                                💡 This will only remove their HR employee record. Their app account and user role (e.g. Org Super Admin / Property Admin) will remain completely intact.
                            </span>
                        </div>

                        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <button
                                type="button"
                                onClick={() => setDeletingEmp(null)}
                                disabled={deleting}
                                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-xl font-semibold text-xs transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDeleteEmployee}
                                disabled={deleting}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-xs shadow-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                {deleting ? 'Removing...' : 'Confirm Remove'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Edit Employee Info Modal */}
            {editingEmpData && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-2 sm:p-4 animate-in fade-in duration-150">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl max-w-lg w-full max-h-[92vh] sm:max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 my-auto">
                        {/* Header */}
                        <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                            <div className="flex items-center gap-2.5">
                                <div className="p-2 bg-[#587e85]/10 dark:bg-[#587e85]/20 text-[#587e85] dark:text-teal-300 rounded-xl">
                                    <UserCog className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                                        Edit Employee Information
                                    </h3>
                                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                                        {editingEmpData.employee_code} • {editingEmpData.first_name} {editingEmpData.last_name}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setEditingEmpData(null)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors shrink-0"
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleSaveEdit} className="flex flex-col flex-1 min-h-0 text-xs">
                            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3.5">
                                {/* Error Banner */}
                                {editError && (
                                    <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/80 rounded-xl flex items-center gap-2 text-xs text-red-700 dark:text-red-300">
                                        <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                                        <span>{editError}</span>
                                    </div>
                                )}

                                {/* App Link Status Notice */}
                                {editingEmpData.is_app_linked ? (
                                    <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-xl flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-300">
                                        <div className="flex items-center gap-2">
                                            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                                            <div>
                                                <span className="font-bold">Linked App Account: </span>
                                                <span>{editingEmpData.app_email || editingEmpData.user?.email || editingEmpData.email}</span>
                                            </div>
                                        </div>
                                        <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/60 font-bold px-2 py-0.5 rounded-full text-emerald-700 dark:text-emerald-300 uppercase">
                                            {formatAppRole(editingEmpData)}
                                        </span>
                                    </div>
                                ) : (
                                    <div className="p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
                                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                                        <span>In Excel / Directory only (no linked app login).</span>
                                    </div>
                                )}

                                {/* Employee Code & Location */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                            Employee Code *
                                        </label>
                                        <input
                                            type="text"
                                            required
                                            value={editFormData.employee_code}
                                            onChange={e => setEditFormData({ ...editFormData, employee_code: e.target.value })}
                                            placeholder="e.g. E005"
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold outline-none focus:ring-2 focus:ring-[#587e85]"
                                        />
                                    </div>
                                    <div>
                                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                            Location / Site
                                        </label>
                                        <input
                                            type="text"
                                            value={editFormData.location}
                                            onChange={e => setEditFormData({ ...editFormData, location: e.target.value })}
                                            placeholder="e.g. Lower Parel"
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#587e85]"
                                        />
                                    </div>
                                </div>

                                {/* Name */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                            First Name *
                                        </label>
                                        <input
                                            type="text"
                                            required
                                            value={editFormData.first_name}
                                            onChange={e => setEditFormData({ ...editFormData, first_name: e.target.value })}
                                            placeholder="e.g. Sahil"
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#587e85]"
                                        />
                                    </div>
                                    <div>
                                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                            Last Name *
                                        </label>
                                        <input
                                            type="text"
                                            required
                                            value={editFormData.last_name}
                                            onChange={e => setEditFormData({ ...editFormData, last_name: e.target.value })}
                                            placeholder="e.g. Sitaprao"
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#587e85]"
                                        />
                                    </div>
                                </div>

                                {/* Email & Phone */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                            Email Address *
                                        </label>
                                        <input
                                            type="email"
                                            required
                                            value={editFormData.email}
                                            onChange={e => setEditFormData({ ...editFormData, email: e.target.value })}
                                            placeholder="e.g. employee@company.com"
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#587e85]"
                                        />
                                    </div>
                                    <div>
                                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                            Contact / Mobile Number
                                        </label>
                                        <input
                                            type="tel"
                                            value={editFormData.contact_number}
                                            onChange={e => setEditFormData({ ...editFormData, contact_number: e.target.value })}
                                            placeholder="e.g. 9820000000"
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#587e85]"
                                        />
                                    </div>
                                </div>

                                {/* Department & Designation */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <label className="block font-semibold text-slate-700 dark:text-slate-300">
                                                Department *
                                            </label>
                                            {departmentsList.some(d => d.name.toLowerCase() === (editFormData.department || '').toLowerCase() || d.id === editFormData.department_id) && (
                                                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/60 text-[#587e85] dark:text-teal-300 border border-[#587e85]/30">
                                                    Matched
                                                </span>
                                            )}
                                        </div>
                                        {departmentsList.length > 0 ? (
                                            <select
                                                value={editFormData.department_id || (departmentsList.find(d => d.name.toLowerCase() === (editFormData.department || '').toLowerCase())?.id || '')}
                                                onChange={e => {
                                                    const chosenId = e.target.value;
                                                    const chosen = departmentsList.find(d => d.id === chosenId);
                                                    if (chosen) {
                                                        setEditFormData({
                                                            ...editFormData,
                                                            department: chosen.name,
                                                            department_id: chosen.id
                                                        });
                                                    } else {
                                                        setEditFormData({
                                                            ...editFormData,
                                                            department: chosenId,
                                                            department_id: ''
                                                        });
                                                    }
                                                }}
                                                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#587e85] text-xs"
                                            >
                                                <option value="">Select Department...</option>
                                                {departmentsList.map(d => (
                                                    <option key={d.id} value={d.id}>
                                                        {d.name} {d.code ? `(${d.code})` : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input
                                                type="text"
                                                value={editFormData.department}
                                                onChange={e => setEditFormData({ ...editFormData, department: e.target.value })}
                                                placeholder="e.g. Operations, Procurement..."
                                                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#587e85]"
                                            />
                                        )}
                                    </div>
                                    <div>
                                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                            Designation
                                        </label>
                                        <input
                                            type="text"
                                            value={editFormData.designation}
                                            onChange={e => setEditFormData({ ...editFormData, designation: e.target.value })}
                                            placeholder="e.g. Executive, Senior Manager..."
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#587e85]"
                                        />
                                    </div>
                                </div>

                                {/* Reporting Manager */}
                                <div>
                                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                        Reporting Manager
                                    </label>
                                    <SearchableManagerDropdown
                                        value={editFormData.reporting_manager_id}
                                        onChange={(id) => setEditFormData({ ...editFormData, reporting_manager_id: id })}
                                        employees={allManagers.length > 0 ? allManagers : employees}
                                        currentEmpId={editingEmpData.id}
                                        placeholder="Select Manager..."
                                    />
                                    <div className="text-[11px] text-slate-400 mt-1">
                                        Reassigning will automatically route any new HR grievances or escalation workflows to this manager.
                                    </div>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="shrink-0 flex items-center justify-end gap-2 px-4 sm:px-6 py-3 bg-slate-50/50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setEditingEmpData(null)}
                                    className="px-4 py-2 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-semibold hover:bg-slate-300 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={savingEdit}
                                    className="px-5 py-2 bg-[#587e85] hover:bg-[#47676d] text-white rounded-xl font-bold shadow-md disabled:opacity-50 transition-colors flex items-center gap-1.5"
                                >
                                    {savingEdit ? (
                                        <>
                                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                            <span>Saving...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Check className="w-3.5 h-3.5" />
                                            <span>Save Changes</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}


