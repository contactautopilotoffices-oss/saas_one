'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, UserCheck, AlertTriangle, UserPlus, RefreshCw, ShieldCheck, Search, ChevronDown, X, Loader2 } from 'lucide-react';

interface HRReconciliationDashboardProps {
    onRefresh: () => void;
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
        const q = searchQuery.toLowerCase();
        const code = (emp.employee_code || '').toLowerCase();
        const name = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase();
        const email = (emp.email || '').toLowerCase();
        const dept = (emp.department || '').toLowerCase();
        const desig = (emp.designation || '').toLowerCase();
        return code.includes(q) || name.includes(q) || email.includes(q) || dept.includes(q) || desig.includes(q);
    });

    return (
        <div className="relative inline-block text-left" ref={containerRef}>
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className="px-3.5 py-2 rounded-xl border border-[#587e85]/40 bg-[#587e85]/10 hover:bg-[#587e85]/20 dark:bg-[#587e85]/20 text-[#587e85] dark:text-teal-300 text-xs font-semibold flex items-center justify-between gap-2 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#587e85]/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <span className="flex items-center gap-2">
                    {isLoading ? (
                        <Loader2 className="w-3.5 h-3.5 text-[#587e85] animate-spin shrink-0" />
                    ) : (
                        <Search className="w-3.5 h-3.5 text-[#587e85] shrink-0" />
                    )}
                    <span className="truncate">
                        {isLoading ? 'Linking...' : 'Link to Excel Employee...'}
                    </span>
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-[#587e85] shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-1.5 w-72 sm:w-80 bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 z-50 p-2 space-y-2 animate-in fade-in zoom-in-95 duration-150">
                    <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                        <input
                            type="text"
                            autoFocus
                            placeholder="Search by Code, Name, Dept..."
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
                                No matching Excel employee found
                            </div>
                        ) : (
                            filteredEmployees.map((emp: any) => (
                                <button
                                    key={emp.id}
                                    type="button"
                                    onClick={() => {
                                        onSelect(emp.id);
                                        setIsOpen(false);
                                        setSearchQuery('');
                                    }}
                                    className="w-full text-left p-2.5 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors flex items-center justify-between group border border-transparent hover:border-indigo-100 dark:hover:border-indigo-800/40"
                                >
                                    <div className="min-w-0 pr-2">
                                        <div className="font-bold text-slate-900 dark:text-white text-xs truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                                            {emp.first_name} {emp.last_name}
                                        </div>
                                        <div className="text-[10px] text-slate-400 truncate flex items-center gap-1.5 mt-0.5">
                                            {emp.email && <span>{emp.email}</span>}
                                            {emp.department && (
                                                <span className="px-1.5 py-0.2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded font-medium">
                                                    {emp.department}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        {emp.is_app_linked && (
                                            <span className="text-[9px] font-bold px-1.5 py-0.2 bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 rounded">
                                                Linked
                                            </span>
                                        )}
                                        <span className="font-mono text-[10px] font-bold px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 rounded-md">
                                            {emp.employee_code}
                                        </span>
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

export default function HRReconciliationDashboard({ onRefresh }: HRReconciliationDashboardProps) {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [approvingId, setApprovingId] = useState<string | null>(null);
    const [msg, setMsg] = useState('');

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
                onRefresh();
            }
        } catch (err) {
            console.error('Error approving onboarding:', err);
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
                onRefresh();
            } else {
                alert(`Error: ${result.error || 'Failed to link profile'}`);
            }
        } catch (err) {
            console.error('Error creating HR profile:', err);
        } finally {
            setApprovingId(null);
        }
    };

    if (loading) {
        return <div className="p-8 text-center text-slate-400 text-xs">Loading identity reconciliation data...</div>;
    }

    const summary = data?.summary || {};
    const allProfiles = data?.data?.all_profiles || data?.data?.unlinked || [];
    const unlinkedList = data?.data?.unlinked || [];
    const pendingList = data?.data?.pending_approval || [];
    const unmappedAppUsers = data?.data?.unmapped_app_users || [];

    return (
        <div className="space-y-6">
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
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 font-semibold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{msg}</span>
                </div>
            )}

            {/* Section 1: Unmapped Registered App Users (Pending Onboarding HR Verification) */}
            {unmappedAppUsers.length > 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <UserPlus className="w-4 h-4 text-indigo-500" />
                                Registered App Users Pending HR Linking ({unmappedAppUsers.length})
                            </h3>
                            <p className="text-xs text-slate-500">
                                These users are registered in the app but not yet in the HR Directory. You can link them to an existing Excel record or add them as a new employee record.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {unmappedAppUsers.map((u: any) => (
                            <div key={u.id} className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-3">
                                <div className="min-w-0">
                                    <div className="font-bold text-slate-900 dark:text-white truncate">{u.full_name || u.email}</div>
                                    <div className="text-[10px] text-slate-400 truncate">{u.email} • ID: {u.id.substring(0, 8)}...</div>
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
                                        className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-sm transition-all disabled:opacity-50"
                                        title="Add this registered app user into the HR Employee Directory"
                                    >
                                        <UserPlus className="w-3.5 h-3.5" />
                                        <span>+ Add to Directory</span>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}


            {/* Section 2: Excel Employees Awaiting App Registration */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
                <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        Excel Employee Master Records Pending App Account Registration ({unlinkedList.length})
                    </h3>
                    <p className="text-xs text-slate-500">
                        When these employees onboard via the app signup flow, they will automatically link by email/phone.
                    </p>
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
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {unlinkedList.slice(0, 10).map((emp: any) => (
                                <tr key={emp.id} className="hover:bg-slate-50/50">
                                    <td className="p-3 font-mono font-bold text-indigo-600">{emp.employee_code}</td>
                                    <td className="p-3 font-semibold">{emp.first_name} {emp.last_name}</td>
                                    <td className="p-3 text-slate-500">{emp.email || 'N/A'}</td>
                                    <td className="p-3">{emp.department}</td>
                                    <td className="p-3">{emp.reporting_manager_code || 'Unassigned'}</td>
                                    <td className="p-3">
                                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 font-bold rounded text-[10px]">
                                            Pending Onboarding
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
