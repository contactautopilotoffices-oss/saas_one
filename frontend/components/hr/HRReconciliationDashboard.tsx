'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
    CheckCircle2, 
    UserCheck, 
    AlertTriangle, 
    UserPlus, 
    RefreshCw, 
    ShieldCheck, 
    Search, 
    ChevronDown, 
    X, 
    Loader2, 
    ArrowRightLeft, 
    UserMinus, 
    Filter,
    Mail,
    Phone,
    Building2,
    Briefcase
} from 'lucide-react';

interface HRReconciliationDashboardProps {
    orgId?: string;
    organizationId?: string;
    onRefresh?: () => void;
}

interface SearchableEmployeeSelectorProps {
    unlinkedList: any[];
    onSelect: (employeeProfileId: string) => void;
    disabled?: boolean;
    isLoading?: boolean;
}

function SearchableEmployeeSelector({
    unlinkedList,
    onSelect,
    disabled = false,
    isLoading = false
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

    const filteredEmployees = unlinkedList.filter((emp: any) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase().trim();
        const code = (emp.employee_code || '').toLowerCase();
        const name = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase();
        const email = (emp.email || '').toLowerCase();
        const dept = (emp.department || '').toLowerCase();
        const desig = (emp.designation || '').toLowerCase();
        const loc = (emp.location || '').toLowerCase();
        const phone = (emp.phone || '').replace(/\D/g, '');
        return code.includes(q) || name.includes(q) || email.includes(q) || dept.includes(q) || desig.includes(q) || loc.includes(q) || phone.includes(q);
    });

    return (
        <div className="relative inline-block text-left" ref={containerRef}>
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className="px-3 py-1.5 rounded-xl border border-[#587e85]/40 bg-[#587e85]/10 hover:bg-[#587e85]/20 dark:bg-[#587e85]/20 text-[#587e85] dark:text-teal-300 text-xs font-semibold flex items-center justify-between gap-2 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#587e85]/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <span className="flex items-center gap-1.5">
                    {isLoading ? (
                        <Loader2 className="w-3.5 h-3.5 text-[#587e85] animate-spin shrink-0" />
                    ) : (
                        <Search className="w-3.5 h-3.5 text-[#587e85] shrink-0" />
                    )}
                    <span className="truncate max-w-[130px] sm:max-w-none">
                        {isLoading ? 'Linking...' : 'Link to Excel Employee...'}
                    </span>
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-[#587e85] shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-1.5 w-80 sm:w-96 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 z-50 p-2.5 space-y-2 animate-in fade-in zoom-in-95 duration-150">
                    <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                        <input
                            type="text"
                            autoFocus
                            placeholder="Search by Code (e.g. E191), Name, Email..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-8 pr-7 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-[#587e85]"
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

                    <div className="text-[10px] text-slate-400 px-1 flex justify-between items-center">
                        <span>Showing {filteredEmployees.length} of {unlinkedList.length} Excel records</span>
                        {searchQuery && (
                            <button 
                                type="button" 
                                onClick={() => setSearchQuery('')} 
                                className="text-[#587e85] hover:underline"
                            >
                                Clear
                            </button>
                        )}
                    </div>

                    <div className="max-h-64 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                        {filteredEmployees.length === 0 ? (
                            <div className="p-4 text-center text-slate-400 text-xs italic">
                                No matching Excel employee found
                            </div>
                        ) : (
                            filteredEmployees.map((emp: any) => {
                                const isAlreadyLinked = Boolean(emp.user_id || emp.user);
                                return (
                                    <button
                                        key={emp.id}
                                        type="button"
                                        onClick={() => {
                                            if (isAlreadyLinked) {
                                                if (!confirm(`This Excel profile (${emp.first_name} ${emp.last_name} - ${emp.employee_code}) is currently linked to ${emp.user?.email || emp.email}. Do you want to re-link it to this user?`)) {
                                                    return;
                                                }
                                            }
                                            onSelect(emp.id);
                                            setIsOpen(false);
                                            setSearchQuery('');
                                        }}
                                        className="w-full text-left p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors flex items-center justify-between group border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                                    >
                                        <div className="min-w-0 pr-2">
                                            <div className="font-bold text-slate-900 dark:text-white text-xs truncate group-hover:text-[#587e85]">
                                                {emp.first_name} {emp.last_name}
                                            </div>
                                            <div className="text-[10px] text-slate-400 truncate flex items-center gap-1.5 mt-0.5">
                                                {emp.email && <span className="truncate">{emp.email}</span>}
                                                {emp.department && (
                                                    <span className="px-1.5 py-0.2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded font-medium shrink-0">
                                                        {emp.department}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            {isAlreadyLinked ? (
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 rounded">
                                                    Reassign
                                                </span>
                                            ) : (
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 rounded">
                                                    Unlinked
                                                </span>
                                            )}
                                            <span className="font-mono text-[10px] font-bold px-2 py-0.5 bg-[#587e85]/10 text-[#587e85] dark:text-teal-300 rounded-md">
                                                {emp.employee_code}
                                            </span>
                                        </div>
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

interface SearchableAppUserSelectorProps {
    usersList: any[];
    onSelect: (userId: string) => void;
    disabled?: boolean;
    isLoading?: boolean;
    buttonLabel?: string;
    variant?: 'primary' | 'secondary' | 'outline';
}

function SearchableAppUserSelector({
    usersList,
    onSelect,
    disabled = false,
    isLoading = false,
    buttonLabel = 'Link App User...',
    variant = 'outline'
}: SearchableAppUserSelectorProps) {
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

    const filteredUsers = usersList.filter((u: any) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase().trim();
        const name = (u.full_name || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        const phone = (u.phone || '').replace(/\D/g, '');
        const id = (u.id || '').toLowerCase();
        return name.includes(q) || email.includes(q) || phone.includes(q) || id.includes(q);
    });

    return (
        <div className="relative inline-block text-left" ref={containerRef}>
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className={
                    variant === 'outline'
                        ? "px-2.5 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 hover:bg-indigo-100/80 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-xs font-semibold flex items-center justify-between gap-1.5 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
                        : "px-3 py-1.5 rounded-xl border border-indigo-300/60 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-semibold flex items-center justify-between gap-2 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
                }
            >
                <span className="flex items-center gap-1.5">
                    {isLoading ? (
                        <Loader2 className="w-3 h-3 text-indigo-600 animate-spin shrink-0" />
                    ) : (
                        <UserCheck className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    )}
                    <span className="truncate">
                        {isLoading ? 'Linking...' : buttonLabel}
                    </span>
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-1.5 w-80 sm:w-96 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 z-50 p-2.5 space-y-2 animate-in fade-in zoom-in-95 duration-150">
                    <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                        <input
                            type="text"
                            autoFocus
                            placeholder="Search by Name, Email, Phone..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-8 pr-7 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-500"
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

                    <div className="text-[10px] text-slate-400 px-1 flex justify-between items-center">
                        <span>Showing {filteredUsers.length} of {usersList.length} App Users</span>
                        {searchQuery && (
                            <button 
                                type="button" 
                                onClick={() => setSearchQuery('')} 
                                className="text-indigo-600 hover:underline"
                            >
                                Clear
                            </button>
                        )}
                    </div>

                    <div className="max-h-64 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                        {filteredUsers.length === 0 ? (
                            <div className="p-4 text-center text-slate-400 text-xs italic">
                                No matching registered user found
                            </div>
                        ) : (
                            filteredUsers.map((u: any) => (
                                <button
                                    key={u.id}
                                    type="button"
                                    onClick={() => {
                                        onSelect(u.id);
                                        setIsOpen(false);
                                        setSearchQuery('');
                                    }}
                                    className="w-full text-left p-2.5 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors flex items-center justify-between group border border-transparent hover:border-indigo-100 dark:hover:border-indigo-800/40"
                                >
                                    <div className="min-w-0 pr-2">
                                        <div className="font-bold text-slate-900 dark:text-white text-xs truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                                            {u.full_name || 'App User'}
                                        </div>
                                        <div className="text-[10px] text-slate-400 truncate flex items-center gap-1.5 mt-0.5">
                                            <span className="truncate">{u.email}</span>
                                            {u.phone && <span className="shrink-0">• {u.phone}</span>}
                                        </div>
                                    </div>
                                    <div className="shrink-0 font-mono text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                                        {u.id.substring(0, 6)}...
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function HRReconciliationDashboard({ orgId, organizationId, onRefresh }: HRReconciliationDashboardProps) {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [approvingId, setApprovingId] = useState<string | null>(null);
    const [msg, setMsg] = useState('');

    // Search filter states
    const [globalSearch, setGlobalSearch] = useState('');
    const [unmappedSearch, setUnmappedSearch] = useState('');
    const [unlinkedSearch, setUnlinkedSearch] = useState('');
    const [linkedSearch, setLinkedSearch] = useState('');

    useEffect(() => {
        fetchReconciliation();
    }, []);

    const fetchReconciliation = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/hr/admin/reconcile');
            const text = await res.text();
            const result = text ? JSON.parse(text) : {};
            if (result.success) {
                setData(result);
            }
        } catch (err) {
            console.error('Error fetching reconciliation:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleApproveOnboarding = async (employeeProfileId: string, userId: string, managerId?: string) => {
        setApprovingId(employeeProfileId);
        setMsg('');
        try {
            const res = await fetch('/api/hr/admin/reconcile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'approve_onboarding',
                    employee_profile_id: employeeProfileId,
                    user_id: userId,
                    reporting_manager_id: managerId
                })
            });
            const text = await res.text();
            const result = text ? JSON.parse(text) : {};
            if (result.success) {
                setMsg('Employee onboarding approved and linked to HR profile!');
                fetchReconciliation();
                onRefresh?.();
            } else {
                alert(`Error: ${result.error || 'Failed to approve onboarding'}`);
            }
        } catch (err) {
            console.error('Error approving onboarding:', err);
        } finally {
            setApprovingId(null);
        }
    };

    const handleManualLink = async (employeeProfileId: string, userId: string, profileName?: string) => {
        setApprovingId(employeeProfileId);
        setMsg('');
        try {
            const res = await fetch('/api/hr/admin/reconcile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'manual_link',
                    employee_profile_id: employeeProfileId,
                    user_id: userId
                })
            });
            const text = await res.text();
            const result = text ? JSON.parse(text) : {};
            if (result.success) {
                setMsg(profileName ? `Linked ${profileName} successfully!` : 'Profile linked successfully!');
                fetchReconciliation();
                onRefresh?.();
            } else {
                alert(`Error: ${result.error || 'Failed to link profile'}`);
            }
        } catch (err) {
            console.error('Error linking profile:', err);
        } finally {
            setApprovingId(null);
        }
    };

    const handleCreateAndLinkProfile = async (userId: string, userEmail: string) => {
        setApprovingId(userId);
        setMsg('');
        try {
            const res = await fetch('/api/hr/admin/reconcile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_and_link_profile',
                    user_id: userId
                })
            });
            const text = await res.text();
            const result = text ? JSON.parse(text) : {};
            if (result.success) {
                setMsg(`Added ${userEmail} to HR Employee Directory successfully!`);
                fetchReconciliation();
                onRefresh?.();
            } else {
                alert(`Error: ${result.error || 'Failed to link profile'}`);
            }
        } catch (err) {
            console.error('Error creating HR profile:', err);
        } finally {
            setApprovingId(null);
        }
    };

    const handleUnlinkProfile = async (employeeProfileId: string, empName: string) => {
        if (!confirm(`Are you sure you want to unlink ${empName} from their app account?`)) return;
        setApprovingId(employeeProfileId);
        setMsg('');
        try {
            const res = await fetch('/api/hr/admin/reconcile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'unlink_profile',
                    employee_profile_id: employeeProfileId
                })
            });
            const text = await res.text();
            const result = text ? JSON.parse(text) : {};
            if (result.success) {
                setMsg(`Unlinked ${empName} successfully!`);
                fetchReconciliation();
                onRefresh?.();
            } else {
                alert(`Error: ${result.error || 'Failed to unlink profile'}`);
            }
        } catch (err) {
            console.error('Error unlinking profile:', err);
        } finally {
            setApprovingId(null);
        }
    };

    const summary = data?.summary || {};
    const allProfiles = data?.data?.all_profiles || data?.data?.unlinked || [];
    const linkedList = data?.data?.linked || [];
    const unlinkedList = data?.data?.unlinked || [];
    const unmappedAppUsers = data?.data?.unmapped_app_users || [];

    // Filter calculations
    const filteredUnmappedAppUsers = useMemo(() => {
        const filterUser = (u: any, q: string) => {
            if (!q.trim()) return true;
            const query = q.toLowerCase().trim();
            const name = (u.full_name || '').toLowerCase();
            const email = (u.email || '').toLowerCase();
            const phone = (u.phone || '').replace(/\D/g, '');
            const id = (u.id || '').toLowerCase();
            return name.includes(query) || email.includes(query) || phone.includes(query) || id.includes(query);
        };
        return unmappedAppUsers.filter((u: any) => 
            filterUser(u, globalSearch) && filterUser(u, unmappedSearch)
        );
    }, [unmappedAppUsers, globalSearch, unmappedSearch]);

    const filteredUnlinkedList = useMemo(() => {
        const filterProfile = (emp: any, q: string) => {
            if (!q.trim()) return true;
            const query = q.toLowerCase().trim();
            const code = (emp.employee_code || '').toLowerCase();
            const name = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase();
            const email = (emp.email || '').toLowerCase();
            const dept = (emp.department || '').toLowerCase();
            const desig = (emp.designation || '').toLowerCase();
            const loc = (emp.location || '').toLowerCase();
            const phone = (emp.phone || '').replace(/\D/g, '');
            const mgr = (emp.reporting_manager_code || '').toLowerCase();
            return code.includes(query) || name.includes(query) || email.includes(query) || 
                   dept.includes(query) || desig.includes(query) || loc.includes(query) || 
                   phone.includes(query) || mgr.includes(query);
        };
        return unlinkedList.filter((emp: any) => 
            filterProfile(emp, globalSearch) && filterProfile(emp, unlinkedSearch)
        );
    }, [unlinkedList, globalSearch, unlinkedSearch]);

    const filteredLinkedList = useMemo(() => {
        const filterLinkedEmp = (emp: any, q: string) => {
            if (!q.trim()) return true;
            const query = q.toLowerCase().trim();
            const code = (emp.employee_code || '').toLowerCase();
            const name = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase();
            const email = (emp.email || '').toLowerCase();
            const userEmail = (emp.user?.email || '').toLowerCase();
            const userName = (emp.user?.full_name || '').toLowerCase();
            const userPhone = (emp.user?.phone || '').replace(/\D/g, '');
            const dept = (emp.department || '').toLowerCase();
            const desig = (emp.designation || '').toLowerCase();
            const loc = (emp.location || '').toLowerCase();
            const userId = (emp.user_id || '').toLowerCase();
            return code.includes(query) || name.includes(query) || email.includes(query) || 
                   userEmail.includes(query) || userName.includes(query) || userPhone.includes(query) ||
                   dept.includes(query) || desig.includes(query) || loc.includes(query) || userId.includes(query);
        };
        return linkedList.filter((emp: any) => 
            filterLinkedEmp(emp, globalSearch) && filterLinkedEmp(emp, linkedSearch)
        );
    }, [linkedList, globalSearch, linkedSearch]);

    if (loading) {
        return (
            <div className="p-12 flex flex-col items-center justify-center space-y-3">
                <Loader2 className="w-8 h-8 text-[#587e85] animate-spin" />
                <p className="text-slate-400 text-xs">Loading identity reconciliation data...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Global Search Bar */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm space-y-3">
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search all records: Name, Email (e.g. lohitexplores), ECode (e.g. E191), Phone, Dept..."
                        value={globalSearch}
                        onChange={(e) => setGlobalSearch(e.target.value)}
                        className="w-full pl-10 pr-9 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#587e85]"
                    />
                    {globalSearch && (
                        <button
                            type="button"
                            onClick={() => setGlobalSearch('')}
                            className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>

                {globalSearch && (
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                        <span className="text-slate-500 font-medium">Matches found:</span>
                        <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold border border-indigo-200 dark:border-indigo-800">
                            {filteredUnmappedAppUsers.length} Unmapped Users
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-semibold border border-amber-200 dark:border-amber-800">
                            {filteredUnlinkedList.length} Pending Excel Records
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-800">
                            {filteredLinkedList.length} Linked Employees
                        </span>
                        <button
                            type="button"
                            onClick={() => setGlobalSearch('')}
                            className="text-xs text-[#587e85] hover:underline font-semibold ml-auto"
                        >
                            Reset Global Filter
                        </button>
                    </div>
                )}
            </div>

            {/* Summary Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Excel Employee Records</div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">{summary.total_excel_records}</div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/20 dark:bg-emerald-950/20 shadow-sm">
                    <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Linked & Matched</div>
                    <div className="text-2xl font-black text-emerald-700 dark:text-emerald-300 mt-1">{summary.linked_count}</div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-amber-200 dark:border-amber-800/40 bg-amber-50/20 dark:bg-amber-950/20 shadow-sm">
                    <div className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Pending App Account</div>
                    <div className="text-2xl font-black text-amber-700 dark:text-amber-300 mt-1">{summary.unlinked_count}</div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-indigo-200 dark:border-indigo-800/40 bg-indigo-50/20 dark:bg-indigo-950/20 shadow-sm">
                    <div className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">App Users Unmapped</div>
                    <div className="text-2xl font-black text-indigo-700 dark:text-indigo-300 mt-1">{summary.unmapped_app_users_count}</div>
                </div>
            </div>

            {msg && (
                <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 font-semibold flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>{msg}</span>
                    </div>
                    <button type="button" onClick={() => setMsg('')} className="text-emerald-600 hover:text-emerald-800">
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            )}

            {/* Section 1: Unmapped Registered App Users */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <UserPlus className="w-4 h-4 text-indigo-500" />
                            Registered App Users Pending HR Linking ({unmappedAppUsers.length})
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Users registered in the app who are not mapped to an HR profile. Link to existing Excel profile or add as new employee.
                        </p>
                    </div>

                    {/* Section 1 Search */}
                    <div className="relative w-full sm:w-72">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Filter unmapped users..."
                            value={unmappedSearch}
                            onChange={(e) => setUnmappedSearch(e.target.value)}
                            className="w-full pl-8 pr-7 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        {unmappedSearch && (
                            <button
                                type="button"
                                onClick={() => setUnmappedSearch('')}
                                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>

                {filteredUnmappedAppUsers.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs italic bg-slate-50 dark:bg-slate-800/40 rounded-xl">
                        {unmappedAppUsers.length === 0 ? (
                            'All registered app users are successfully linked!'
                        ) : (
                            <div className="space-y-1">
                                <div>No unmapped users matching current filters.</div>
                                <button
                                    type="button"
                                    onClick={() => { setUnmappedSearch(''); setGlobalSearch(''); }}
                                    className="text-xs text-indigo-600 hover:underline font-semibold"
                                >
                                    Clear search filters
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="text-[11px] font-medium text-slate-400">
                            Showing {filteredUnmappedAppUsers.length} of {unmappedAppUsers.length} unmapped users
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            {filteredUnmappedAppUsers.map((u: any) => (
                                <div key={u.id} className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-3">
                                    <div className="min-w-0">
                                        <div className="font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                                            <span>{u.full_name || 'App User'}</span>
                                            {u.phone && <span className="text-[10px] text-slate-400 font-normal">({u.phone})</span>}
                                        </div>
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{u.email}</div>
                                        <div className="text-[9px] font-mono text-slate-400 truncate mt-0.5">ID: {u.id}</div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <SearchableEmployeeSelector
                                            unlinkedList={allProfiles.length > 0 ? allProfiles : unlinkedList}
                                            disabled={approvingId === u.id}
                                            isLoading={approvingId === u.id}
                                            onSelect={(empProfileId) => handleApproveOnboarding(empProfileId, u.id)}
                                        />
                                        <button
                                            type="button"
                                            disabled={approvingId === u.id}
                                            onClick={() => handleCreateAndLinkProfile(u.id, u.email)}
                                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-sm transition-all disabled:opacity-50"
                                            title="Add this registered app user into the HR Employee Directory"
                                        >
                                            <UserPlus className="w-3.5 h-3.5" />
                                            <span>+ Add</span>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Section 2: Excel Employees Awaiting App Registration */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <Briefcase className="w-4 h-4 text-amber-500" />
                            Excel Employee Master Records Pending App Account Registration ({unlinkedList.length})
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Master records without an active app link. They can be manually linked to any app user or will auto-link upon signup.
                        </p>
                    </div>

                    {/* Section 2 Search */}
                    <div className="relative w-full sm:w-72">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Filter pending Excel records..."
                            value={unlinkedSearch}
                            onChange={(e) => setUnlinkedSearch(e.target.value)}
                            className="w-full pl-8 pr-7 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                        {unlinkedSearch && (
                            <button
                                type="button"
                                onClick={() => setUnlinkedSearch('')}
                                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>

                {filteredUnlinkedList.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs italic bg-slate-50 dark:bg-slate-800/40 rounded-xl">
                        {unlinkedList.length === 0 ? (
                            'No pending unlinked master records!'
                        ) : (
                            <div className="space-y-1">
                                <div>No Excel records matching current filters.</div>
                                <button
                                    type="button"
                                    onClick={() => { setUnlinkedSearch(''); setGlobalSearch(''); }}
                                    className="text-xs text-amber-600 hover:underline font-semibold"
                                >
                                    Clear search filters
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="text-[11px] font-medium text-slate-400">
                            Showing {filteredUnlinkedList.length} of {unlinkedList.length} records
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold">
                                        <th className="p-3">ECode</th>
                                        <th className="p-3">Name</th>
                                        <th className="p-3">Email</th>
                                        <th className="p-3">Department</th>
                                        <th className="p-3">Reporting Manager</th>
                                        <th className="p-3">Status</th>
                                        <th className="p-3 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {filteredUnlinkedList.map((emp: any) => (
                                        <tr key={emp.id} className="hover:bg-slate-50/50">
                                            <td className="p-3 font-mono font-bold text-indigo-600">{emp.employee_code}</td>
                                            <td className="p-3 font-semibold">{emp.first_name} {emp.last_name}</td>
                                            <td className="p-3 text-slate-500">{emp.email || 'N/A'}</td>
                                            <td className="p-3">
                                                <div>{emp.department}</div>
                                                {emp.designation && <div className="text-[10px] text-slate-400">{emp.designation}</div>}
                                            </td>
                                            <td className="p-3">{emp.reporting_manager_code || 'Unassigned'}</td>
                                            <td className="p-3">
                                                <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-bold rounded text-[10px]">
                                                    Pending Onboarding
                                                </span>
                                            </td>
                                            <td className="p-3 text-right">
                                                <SearchableAppUserSelector
                                                    usersList={unmappedAppUsers}
                                                    buttonLabel="Link App User..."
                                                    disabled={approvingId === emp.id}
                                                    isLoading={approvingId === emp.id}
                                                    onSelect={(userId) => handleManualLink(emp.id, userId, `${emp.first_name} ${emp.last_name}`)}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* Section 3: Linked & Matched Employees */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-emerald-500" />
                            Linked & Matched Employees ({linkedList.length})
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Employee profiles currently linked to app user accounts. You can unlink or switch the linked account at any time.
                        </p>
                    </div>

                    {/* Section 3 Search */}
                    <div className="relative w-full sm:w-72">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Filter linked employees..."
                            value={linkedSearch}
                            onChange={(e) => setLinkedSearch(e.target.value)}
                            className="w-full pl-8 pr-7 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        {linkedSearch && (
                            <button
                                type="button"
                                onClick={() => setLinkedSearch('')}
                                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>

                {filteredLinkedList.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs italic bg-slate-50 dark:bg-slate-800/40 rounded-xl">
                        {linkedList.length === 0 ? (
                            'No linked employees yet!'
                        ) : (
                            <div className="space-y-1">
                                <div>No linked employees matching current filters.</div>
                                <button
                                    type="button"
                                    onClick={() => { setLinkedSearch(''); setGlobalSearch(''); }}
                                    className="text-xs text-emerald-600 hover:underline font-semibold"
                                >
                                    Clear search filters
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="text-[11px] font-medium text-slate-400">
                            Showing {filteredLinkedList.length} of {linkedList.length} linked employees
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold">
                                        <th className="p-3">ECode</th>
                                        <th className="p-3">Excel Profile Name</th>
                                        <th className="p-3">Linked App User</th>
                                        <th className="p-3">Department</th>
                                        <th className="p-3">Status</th>
                                        <th className="p-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {filteredLinkedList.map((emp: any) => (
                                        <tr key={emp.id} className="hover:bg-slate-50/50">
                                            <td className="p-3 font-mono font-bold text-indigo-600">{emp.employee_code}</td>
                                            <td className="p-3 font-semibold">{emp.first_name} {emp.last_name}</td>
                                            <td className="p-3">
                                                <div className="text-slate-900 dark:text-white font-medium">
                                                    {emp.user?.email || emp.email || 'N/A'}
                                                </div>
                                                {emp.user?.full_name && (
                                                    <div className="text-[10px] text-slate-400">
                                                        {emp.user.full_name}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-3">
                                                <div>{emp.department}</div>
                                                {emp.designation && <div className="text-[10px] text-slate-400">{emp.designation}</div>}
                                            </td>
                                            <td className="p-3">
                                                <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold rounded text-[10px]">
                                                    Linked
                                                </span>
                                            </td>
                                            <td className="p-3 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <SearchableAppUserSelector
                                                        usersList={unmappedAppUsers}
                                                        buttonLabel="Change User"
                                                        disabled={approvingId === emp.id}
                                                        isLoading={approvingId === emp.id}
                                                        onSelect={(userId) => handleManualLink(emp.id, userId, `${emp.first_name} ${emp.last_name}`)}
                                                    />
                                                    <button
                                                        type="button"
                                                        disabled={approvingId === emp.id}
                                                        onClick={() => handleUnlinkProfile(emp.id, `${emp.first_name} ${emp.last_name}`)}
                                                        className="px-2.5 py-1 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 rounded-lg transition-colors border border-rose-200 dark:border-rose-900/50 disabled:opacity-50 flex items-center gap-1"
                                                        title="Unlink this Excel employee profile from their app account"
                                                    >
                                                        <UserMinus className="w-3 h-3" />
                                                        <span>Unlink</span>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

