"use client";

import React, { useState, useEffect } from 'react';
import {
    FlaskConical,
    Shield,
    CheckCircle2,
    AlertCircle,
    UserCheck,
    UserX,
    Users,
    Send,
    RefreshCw,
    Search,
    Phone,
    Mail,
    Building2,
    Sparkles,
    ArrowRight,
    MessageSquare,
    HelpCircle
} from 'lucide-react';

interface EmployeeItem {
    id: string;
    user_id?: string;
    first_name: string;
    last_name?: string;
    email: string;
    phone: string;
    department: string;
    department_id: string;
    task_role: 'employee' | 'reporting_manager' | 'superuser';
    is_active: boolean;
}

interface TechSummary {
    manager: EmployeeItem | null;
    members: EmployeeItem[];
}

export default function TaskManagerTestingDashboard({ orgId }: { orgId?: string }) {
    const [employees, setEmployees] = useState<EmployeeItem[]>([]);
    const [techSummary, setTechSummary] = useState<TechSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
    const [sendKickoff, setSendKickoff] = useState(true);
    const [statusMessage, setStatusMessage] = useState<{
        type: 'success' | 'error';
        title: string;
        details?: string;
    } | null>(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/task-manager/manager-role');
            const data = await res.json();
            if (data.success) {
                setEmployees(data.employees || []);
                setTechSummary(data.techSummary || null);

                // Auto-select Sahil Gorde if nothing selected
                if (!selectedEmployeeId) {
                    const sahil = (data.employees || []).find((e: EmployeeItem) =>
                        e.phone?.includes('8433649199') ||
                        (e.first_name?.toLowerCase().includes('sahil') && e.last_name?.toLowerCase().includes('gorde'))
                    );
                    if (sahil) setSelectedEmployeeId(sahil.id);
                    else if (data.employees?.[0]) setSelectedEmployeeId(data.employees[0].id);
                }
            }
        } catch (err: any) {
            console.error('Failed to load employee list:', err);
            setStatusMessage({
                type: 'error',
                title: 'Error loading employees',
                details: err.message
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // Filter employees for dropdown
    const filteredEmployees = employees.filter(e => {
        const full = `${e.first_name || ''} ${e.last_name || ''} ${e.email || ''} ${e.phone || ''} ${e.department || ''}`.toLowerCase();
        return full.includes(searchQuery.toLowerCase());
    });

    const selectedEmployee = employees.find(e => e.id === selectedEmployeeId);

    // Handle Assign, Remove Role, or Employee Kickoff
    const handleRoleAction = async (action: 'assign_manager' | 'remove_manager' | 'send_employee_kickoff') => {
        if (!selectedEmployee) return;
        setActionLoading(true);
        setStatusMessage(null);

        try {
            const res = await fetch('/api/task-manager/manager-role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employeeId: selectedEmployee.id,
                    action,
                    sendKickoff
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to execute action');
            }

            setStatusMessage({
                type: 'success',
                title: data.message,
                details: data.whatsappDetails || (data.details ? JSON.stringify(data.details) : undefined)
            });

            // Refresh data
            await fetchData();
        } catch (err: any) {
            setStatusMessage({
                type: 'error',
                title: 'Operation Failed',
                details: err.message
            });
        } finally {
            setActionLoading(false);
        }
    };

    // Quick select helper
    const quickSelect = (term: string) => {
        const found = employees.find(e =>
            e.phone?.includes(term) ||
            e.first_name?.toLowerCase().includes(term.toLowerCase()) ||
            e.email?.toLowerCase().includes(term.toLowerCase())
        );
        if (found) setSelectedEmployeeId(found.id);
    };

    return (
        <div className="p-6 md:p-8 space-y-6 max-w-6xl mx-auto">
            {/* Header Banner */}
            <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/20 rounded-3xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-amber-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/30 flex-shrink-0">
                        <FlaskConical className="w-6 h-6" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
                                Task Manager Testing & Manager Role Manager
                            </h1>
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-amber-500 text-white">
                                Beta
                            </span>
                        </div>
                        <p className="text-slate-500 text-sm mt-0.5">
                            Test the reporting manager workflow, switch roles on the fly, and send official WhatsApp kickoff templates.
                        </p>
                    </div>
                </div>

                <button
                    onClick={fetchData}
                    disabled={loading || actionLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-bold text-xs shadow-sm transition-all self-start md:self-auto"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {/* Notification / Toast Alert */}
            {statusMessage && (
                <div className={`p-4 rounded-2xl border flex items-start gap-3 transition-all ${
                    statusMessage.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}>
                    {statusMessage.type === 'success' ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                    ) : (
                        <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 text-sm">
                        <p className="font-bold">{statusMessage.title}</p>
                        {statusMessage.details && (
                            <p className="text-xs mt-0.5 opacity-90 font-mono">{statusMessage.details}</p>
                        )}
                    </div>
                    <button
                        onClick={() => setStatusMessage(null)}
                        className="text-xs font-bold opacity-60 hover:opacity-100"
                    >
                        Dismiss
                    </button>
                </div>
            )}

            {/* Top Grid: Department Live Status */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Tech Manager Card */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-primary" /> Active Tech Manager
                    </p>
                    {techSummary?.manager ? (
                        <div>
                            <h3 className="text-base font-bold text-slate-900">
                                {techSummary.manager.first_name} {techSummary.manager.last_name || ''}
                            </h3>
                            <p className="text-xs text-slate-500 font-mono mt-0.5 flex items-center gap-1">
                                <Phone className="w-3 h-3 text-slate-400" />
                                {techSummary.manager.phone || 'No phone'}
                            </p>
                            <span className="inline-block mt-2 px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-[10px] font-bold">
                                Active Reporting Manager
                            </span>
                        </div>
                    ) : (
                        <div>
                            <p className="text-sm font-bold text-amber-600">No Manager Assigned</p>
                            <p className="text-xs text-slate-400 mt-1">Assign yourself or Lohit below.</p>
                        </div>
                    )}
                </div>

                {/* Team Members in Tech */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm md:col-span-2">
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-primary" /> Tech Department Members ({techSummary?.members?.length || 0})
                    </p>
                    <div className="flex flex-wrap gap-2 mt-1">
                        {techSummary?.members?.map(m => (
                            <button
                                key={m.id}
                                onClick={() => setSelectedEmployeeId(m.id)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
                                    selectedEmployeeId === m.id
                                        ? 'bg-primary text-white border-primary shadow-sm'
                                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                                }`}
                            >
                                <span>{m.first_name} {m.last_name || ''}</span>
                                <span className={`text-[9px] px-1.5 py-0.2 rounded font-extrabold uppercase ${
                                    m.task_role === 'reporting_manager'
                                        ? selectedEmployeeId === m.id ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-800'
                                        : selectedEmployeeId === m.id ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
                                }`}>
                                    {m.task_role === 'reporting_manager' ? 'Manager' : 'Employee'}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Main Interactive Control Card */}
            <div className="bg-white border border-slate-200 rounded-3xl p-6 md:p-8 shadow-sm space-y-6">
                <div>
                    <h2 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
                        <UserCheck className="w-5 h-5 text-primary" />
                        Manager Role Assignment & WhatsApp Kickoff
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                        Select an employee to promote to Reporting Manager or demote back to Employee. When promoted, an official Meta-approved kickoff template is sent to open their 24h WhatsApp window.
                    </p>
                </div>

                {/* Quick Shortcuts */}
                <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="font-bold text-slate-400">Quick Select:</span>
                    <button
                        type="button"
                        onClick={() => quickSelect('8433649199')}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold transition-colors"
                    >
                        👤 Myself (Sahil Gorde)
                    </button>
                    <button
                        type="button"
                        onClick={() => quickSelect('9100256500')}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold transition-colors"
                    >
                        👑 Lohitaksha Ranganathan
                    </button>
                    <button
                        type="button"
                        onClick={() => quickSelect('7028232515')}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold transition-colors"
                    >
                        ⚡ Harsh Patil
                    </button>
                </div>

                {/* Dropdown Selector */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                            Select Employee
                        </label>
                        <select
                            value={selectedEmployeeId}
                            onChange={(e) => setSelectedEmployeeId(e.target.value)}
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                        >
                            {employees.map(emp => (
                                <option key={emp.id} value={emp.id}>
                                    {emp.first_name} {emp.last_name || ''} ({emp.department || 'No Dept'}) — [{emp.task_role}]
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Kickoff Template Toggle */}
                    <div className="flex items-center">
                        <label className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer w-full hover:bg-slate-100/70 transition-colors">
                            <input
                                type="checkbox"
                                checked={sendKickoff}
                                onChange={(e) => setSendKickoff(e.target.checked)}
                                className="w-4 h-4 text-primary rounded border-slate-300 focus:ring-primary"
                            />
                            <div>
                                <span className="text-xs font-bold text-slate-900 block">
                                    Send Meta-approved WhatsApp Kickoff Template
                                </span>
                                <span className="text-[11px] text-slate-500 block">
                                    Dispatches campaign template to invite the user and open the 24-hr session.
                                </span>
                            </div>
                        </label>
                    </div>
                </div>

                {/* Selected Employee Card */}
                {selectedEmployee && (
                    <div className="p-4 bg-slate-50/80 border border-slate-200 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-black text-slate-900">
                                    {selectedEmployee.first_name} {selectedEmployee.last_name || ''}
                                </span>
                                <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                                    selectedEmployee.task_role === 'reporting_manager'
                                        ? 'bg-emerald-500 text-white'
                                        : 'bg-slate-300 text-slate-700'
                                }`}>
                                    Current: {selectedEmployee.task_role}
                                </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 font-medium">
                                <span className="flex items-center gap-1 font-mono">
                                    <Phone className="w-3 h-3 text-slate-400" />
                                    {selectedEmployee.phone || 'No phone set'}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Mail className="w-3 h-3 text-slate-400" />
                                    {selectedEmployee.email}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Building2 className="w-3 h-3 text-slate-400" />
                                    {selectedEmployee.department || 'Unassigned'}
                                </span>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
                            {/* Assign Role Button */}
                            <button
                                type="button"
                                disabled={actionLoading || !selectedEmployee.phone}
                                onClick={() => handleRoleAction('assign_manager')}
                                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-sm hover:shadow transition-all disabled:opacity-50"
                            >
                                <UserCheck className="w-4 h-4" />
                                {actionLoading ? 'Assigning...' : 'Assign Reporting Manager & Kickoff'}
                            </button>

                            {/* Send Employee Kickoff Button */}
                            <button
                                type="button"
                                disabled={actionLoading || !selectedEmployee.phone}
                                onClick={() => {
                                    if (window.confirm(`Send official Employee Kickoff (tm_employee_kickoff_v1) to ${selectedEmployee.first_name} on ${selectedEmployee.phone}?`)) {
                                        handleRoleAction('send_employee_kickoff');
                                    }
                                }}
                                className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-sm hover:shadow transition-all disabled:opacity-50"
                            >
                                <Send className="w-4 h-4" />
                                Send Employee Kickoff
                            </button>

                            {/* Remove Role Button */}
                            <button
                                type="button"
                                disabled={actionLoading}
                                onClick={() => handleRoleAction('remove_manager')}
                                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-50"
                            >
                                <UserX className="w-4 h-4 text-rose-500" />
                                Remove Manager Role (Revert)
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Meta Approved Templates & WhatsApp Quick Reply Cheatsheet */}
            <div className="bg-slate-900 text-white rounded-3xl p-6 md:p-8 space-y-5">
                <div className="flex items-center justify-between">
                    <h3 className="text-base font-black tracking-tight flex items-center gap-2 text-white">
                        <Sparkles className="w-5 h-5 text-emerald-400" />
                        Meta Approved Templates & Quick Reply Actions
                    </h3>
                    <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/80 px-2.5 py-1 rounded-lg border border-emerald-800">
                        Meta Approved
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Template 1: Manager */}
                    <div className="bg-slate-800/80 border border-slate-700/80 p-4 rounded-2xl space-y-2.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-emerald-400 uppercase tracking-wider">
                                Template 1: Manager Kickoff
                            </span>
                            <span className="text-[10px] font-mono bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded border border-emerald-800">
                                tm_manager_kickoff_v1
                            </span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed font-sans">
                            &quot;Greetings from Autopilot Offices 👋<br/>
                            Hello <strong>[Manager]</strong>, you have been assigned as Reporting Manager for <strong>[Tech]</strong>.<br/>
                            Team members: <strong>[Sahil, Harsh]</strong>...&quot;
                        </p>
                        <div className="pt-2 border-t border-slate-700/60 flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-bold text-slate-400">Interactive Buttons:</span>
                            <span className="text-[11px] font-mono px-2 py-0.5 bg-slate-700 text-emerald-300 rounded border border-slate-600">
                                [View Team Tasks] → team status
                            </span>
                            <span className="text-[11px] font-mono px-2 py-0.5 bg-slate-700 text-emerald-300 rounded border border-slate-600">
                                [Assign Task] → assign guide
                            </span>
                        </div>
                    </div>

                    {/* Template 2: Employee */}
                    <div className="bg-slate-800/80 border border-slate-700/80 p-4 rounded-2xl space-y-2.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-indigo-400 uppercase tracking-wider">
                                Template 2: Employee Kickoff
                            </span>
                            <span className="text-[10px] font-mono bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded border border-indigo-800">
                                tm_employee_kickoff_v1
                            </span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed font-sans">
                            &quot;Greetings from Autopilot Offices 👋<br/>
                            Hello <strong>[Employee]</strong>, welcome to Autopilot Task Manager.<br/>
                            Department: <strong>[Tech]</strong>. Reporting Manager: <strong>[Lohitaksha]</strong>...&quot;
                        </p>
                        <div className="pt-2 border-t border-slate-700/60 flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-bold text-slate-400">Interactive Buttons:</span>
                            <span className="text-[11px] font-mono px-2 py-0.5 bg-slate-700 text-indigo-300 rounded border border-slate-600">
                                [View Tasks] → my tasks list
                            </span>
                        </div>
                    </div>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center gap-2 text-xs text-slate-400">
                    <MessageSquare className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span>Tapping any quick reply button immediately opens Meta&apos;s 24-hour conversational window for rich interactive task management.</span>
                </div>
            </div>
        </div>
    );
}
