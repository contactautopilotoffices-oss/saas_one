"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/frontend/context/AuthContext';
import {
    ClipboardList,
    Plus,
    CheckCircle2,
    Clock,
    UserCheck,
    Building2,
    Calendar,
    Search,
    Filter,
    Shield,
    RefreshCw,
    X,
    Layers,
    AlertCircle,
    User,
    Check,
    TrendingUp,
    BarChart3,
    Trash2
} from 'lucide-react';

interface Department {
    id: string;
    name: string;
    code?: string;
}

interface Employee {
    id: string;
    profile_id?: string;
    name: string;
    phone_number: string;
    department_id: string | null;
    department_name: string | null;
    role: 'employee' | 'reporting_manager' | 'superuser';
}

interface TaskTemplate {
    id: string;
    title: string;
    description: string | null;
    department_id: string | null;
    task_type: 'fixed' | 'assigned';
}

interface TaskAssignmentItem {
    id: string;
    task_template_id: string | null;
    title: string;
    description: string | null;
    employee_id: string;
    assigned_date: string;
    status: 'pending' | 'in_progress' | 'completed';
    assigned_by: string | null;
    completed_at: string | null;
    created_at: string;
    employee?: {
        id: string;
        full_name: string;
        phone: string;
    };
    template?: TaskTemplate;
}

export default function TaskAssignmentDashboard({ orgId }: { orgId?: string }) {
    const { user } = useAuth();
    const actorId = user?.id || '';

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Core Data
    const [actor, setActor] = useState<Employee | null>(null);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [tasks, setTasks] = useState<TaskAssignmentItem[]>([]);
    const [templates, setTemplates] = useState<TaskTemplate[]>([]);
    const [progressData, setProgressData] = useState<any>(null);

    // Filters
    const [selectedDeptId, setSelectedDeptId] = useState<string>('all');
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));

    // Modals
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [showTemplateModal, setShowTemplateModal] = useState(false);

    // Form: Assign Task
    const [assignTargetEmpId, setAssignTargetEmpId] = useState('');
    const [assignTitle, setAssignTitle] = useState('');
    const [assignDesc, setAssignDesc] = useState('');
    const [assignTemplateId, setAssignTemplateId] = useState<string>('');
    const [isSubmittingAssign, setIsSubmittingAssign] = useState(false);

    // Form: Create Template
    const [newTemplateTitle, setNewTemplateTitle] = useState('');
    const [newTemplateDesc, setNewTemplateDesc] = useState('');
    const [newTemplateType, setNewTemplateType] = useState<'fixed' | 'assigned'>('fixed');
    const [isSubmittingTemplate, setIsSubmittingTemplate] = useState(false);

    // Fetch dashboard data
    const fetchData = async (isManualRefresh = false) => {
        if (!actorId) return;
        if (isManualRefresh) setRefreshing(true);
        else setLoading(true);
        setError(null);

        try {
            const params = new URLSearchParams({
                actorId,
                date: selectedDate,
            });
            if (selectedDeptId && selectedDeptId !== 'all') {
                params.set('departmentId', selectedDeptId);
            }
            if (selectedEmployeeId && selectedEmployeeId !== 'all') {
                params.set('employeeId', selectedEmployeeId);
            }
            if (statusFilter !== 'all') {
                params.set('status', statusFilter);
            }

            const res = await fetch(`/api/task-manager/tasks?${params.toString()}`);
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to load task dashboard data');
            }

            setActor(data.actor);
            setDepartments(data.departments || []);
            setEmployees(data.employees || []);
            setTasks(data.tasks || []);
            setTemplates(data.templates || []);

            // Fetch 3-Level Progress Hierarchy
            try {
                const progRes = await fetch(`/api/task-manager/progress?actorId=${actorId}&date=${selectedDate}`);
                const progJson = await progRes.json();
                if (progJson.success) {
                    setProgressData(progJson.data);
                }
            } catch (progErr) {
                console.warn('[TaskAssignmentDashboard] Progress load error:', progErr);
            }

            // Set initial selected department for manager if locked
            if (data.actor?.role === 'reporting_manager' && data.actor.department_id) {
                setSelectedDeptId(data.actor.department_id);
            }
        } catch (err: any) {
            console.error('[TaskAssignmentDashboard] Fetch error:', err);
            setError(err.message || 'Error loading dashboard');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [actorId, selectedDate, selectedDeptId, selectedEmployeeId, statusFilter]);

    // Derived: Employees available for task assignment
    const assignableEmployees = useMemo(() => {
        if (!actor) return [];
        let list = employees;
        if (actor.role === 'reporting_manager') {
            list = employees.filter(e => e.department_id === actor.department_id);
        } else if (actor.role === 'superuser' && selectedDeptId !== 'all') {
            list = employees.filter(e => e.department_id === selectedDeptId);
        }
        const seen = new Set<string>();
        return list.filter(e => {
            if (!e.id || seen.has(e.id)) return false;
            seen.add(e.id);
            return true;
        });
    }, [employees, actor, selectedDeptId]);

    // Handle Task Assignment Submit
    const handleAssignTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!assignTargetEmpId || !assignTitle.trim()) {
            alert('Please select an employee and provide a task title.');
            return;
        }

        setIsSubmittingAssign(true);
        try {
            const res = await fetch('/api/task-manager/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'assign_task',
                    actorId,
                    targetEmployeeId: assignTargetEmpId,
                    title: assignTitle.trim(),
                    description: assignDesc.trim() || undefined,
                    templateId: assignTemplateId || undefined,
                    assignedDate: selectedDate
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to assign task');
            }

            // Reset form and refresh list
            setAssignTitle('');
            setAssignDesc('');
            setAssignTemplateId('');
            setShowAssignModal(false);
            await fetchData(true);
        } catch (err: any) {
            alert(`Error: ${err.message}`);
        } finally {
            setIsSubmittingAssign(false);
        }
    };

    // Handle Create Template Submit
    const handleCreateTemplate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTemplateTitle.trim()) return;

        setIsSubmittingTemplate(true);
        try {
            const deptId = actor?.role === 'reporting_manager' ? actor.department_id : (selectedDeptId !== 'all' ? selectedDeptId : undefined);

            const res = await fetch('/api/task-manager/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_template',
                    actorId,
                    title: newTemplateTitle.trim(),
                    description: newTemplateDesc.trim() || undefined,
                    departmentId: deptId,
                    taskType: newTemplateType
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to create template');
            }

            setNewTemplateTitle('');
            setNewTemplateDesc('');
            setShowTemplateModal(false);
            await fetchData(true);
        } catch (err: any) {
            alert(`Error: ${err.message}`);
        } finally {
            setIsSubmittingTemplate(false);
        }
    };

    // Handle Complete Task
    const handleToggleTaskStatus = async (taskId: string, currentStatus: string) => {
        const nextStatus = currentStatus === 'completed' ? 'pending' : 'completed';
        try {
            const res = await fetch('/api/task-manager/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_status',
                    actorId,
                    taskId,
                    status: nextStatus
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to update task status');
            }

            // Optimistic update
            setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: nextStatus, completed_at: nextStatus === 'completed' ? new Date().toISOString() : null } : t));
        } catch (err: any) {
            alert(`Action failed: ${err.message}`);
        }
    };

    const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

    const handleDeleteTask = async (taskId: string, title: string) => {
        if (!window.confirm(`Are you sure you want to delete task: "${title}"?`)) return;
        setDeletingTaskId(taskId);
        try {
            const res = await fetch('/api/task-manager/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete_task',
                    actorId,
                    taskId
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to delete task');
            }

            // Remove task from state optimistically
            setTasks(prev => prev.filter(t => t.id !== taskId));
        } catch (err: any) {
            alert(`Delete failed: ${err.message}`);
        } finally {
            setDeletingTaskId(null);
        }
    };

    // Filtered tasks display
    const filteredTasks = useMemo(() => {
        return tasks.filter(t => {
            if (searchQuery) {
                const match = t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                              (t.employee?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()));
                if (!match) return false;
            }
            return true;
        });
    }, [tasks, searchQuery]);

    const isReportingManager = actor?.role === 'reporting_manager';
    const isSuperuser = actor?.role === 'superuser';

    return (
        <div className="w-full space-y-6 p-6">
            {/* ── Top Header / Role Bar ────────────────────────────────────────── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                        <ClipboardList className="w-6 h-6" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                                {isReportingManager ? 'Reporting Manager Task Console' : isSuperuser ? 'Superuser Task Console' : 'Daily Task Console'}
                            </h1>
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                isSuperuser ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' :
                                isReportingManager ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300' :
                                'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300'
                            }`}>
                                <Shield className="w-3 h-3" />
                                {actor?.role ? actor.role.replace('_', ' ').toUpperCase() : 'USER'}
                            </span>
                        </div>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                            {isReportingManager ? `Managing Department: ${actor?.department_name || 'My Department'}` :
                             isSuperuser ? 'Organisation-wide Task Assignment & Oversight' : 'Your Personal Tasks'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                    {/* Date Picker */}
                    <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800/80 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm">
                        <Calendar className="w-4 h-4 text-zinc-500" />
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="bg-transparent border-none text-zinc-800 dark:text-zinc-200 font-medium focus:outline-none"
                        />
                    </div>

                    {/* Refresh */}
                    <button
                        onClick={() => fetchData(true)}
                        disabled={refreshing}
                        className="p-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                        title="Refresh"
                    >
                        <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>

                    {/* Quick Create Actions */}
                    {(isReportingManager || isSuperuser) && (
                        <>
                            <button
                                onClick={() => setShowTemplateModal(true)}
                                className="flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition"
                            >
                                <Layers className="w-4 h-4 text-zinc-500" />
                                Add Template
                            </button>
                            <button
                                onClick={() => {
                                    setAssignTargetEmpId(assignableEmployees[0]?.id || '');
                                    setShowAssignModal(true);
                                }}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition"
                            >
                                <Plus className="w-4 h-4" />
                                Assign Task
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Error banner */}
            {error && (
                <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-sm flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* ── 3-Level Progress Hierarchy Banner (Phases 11 & 12) ──────────── */}
            {progressData && (
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                                <TrendingUp className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                                    {isSuperuser ? 'Level 3: Organisation Progress' : isReportingManager ? `Level 2: ${actor?.department_name || 'Department'} Progress` : 'Your Task Progress'}
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 font-bold">
                                        {progressData.percentage ?? 0}% Completed
                                    </span>
                                </h2>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                    {isSuperuser ? `Consolidated status across ${progressData.totalDepartments ?? departments.length} departments` : 'Real-time daily task completion status'}
                                </p>
                            </div>
                        </div>

                        {/* Metric Counter Badges */}
                        <div className="flex items-center gap-3 text-xs font-semibold">
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                                <Layers className="w-3.5 h-3.5 text-zinc-400" />
                                <span>Total: {progressData.total ?? tasks.length}</span>
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                <span>Done: {progressData.completed ?? 0}</span>
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
                                <Clock className="w-3.5 h-3.5 text-amber-500" />
                                <span>Pending: {progressData.pending ?? 0}</span>
                            </div>
                        </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-2.5 rounded-full overflow-hidden">
                        <div
                            className="bg-gradient-to-r from-indigo-500 via-emerald-500 to-teal-400 h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, progressData.percentage ?? 0)}%` }}
                        />
                    </div>

                    {/* Level 2: Department Breakdown Grid (Superuser View) */}
                    {isSuperuser && progressData.departmentProgress && progressData.departmentProgress.length > 0 && (
                        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
                            <div className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2.5 flex items-center justify-between">
                                <span>Department Progress Matrix ({progressData.departmentProgress.length})</span>
                                <span className="text-[11px] font-normal lowercase text-zinc-400">click to filter</span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
                                {progressData.departmentProgress.map((dp: any) => {
                                    const isDeptActive = selectedDeptId === dp.departmentId;
                                    return (
                                        <button
                                            key={dp.departmentId}
                                            onClick={() => {
                                                setSelectedDeptId(isDeptActive ? 'all' : dp.departmentId);
                                                setSelectedEmployeeId('all');
                                            }}
                                            className={`p-2.5 rounded-xl border text-left transition text-xs flex flex-col justify-between gap-1.5 ${
                                                isDeptActive
                                                    ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-700 text-indigo-900 dark:text-indigo-200'
                                                    : 'bg-zinc-50/70 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700/60 hover:border-zinc-300 text-zinc-700 dark:text-zinc-300'
                                            }`}
                                        >
                                            <div className="font-semibold truncate">{dp.departmentName}</div>
                                            <div className="flex items-center justify-between text-[11px]">
                                                <span className="text-zinc-500 dark:text-zinc-400">{dp.completed}/{dp.total}</span>
                                                <span className={`font-bold ${dp.percentage === 100 ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                                                    {dp.percentage}%
                                                </span>
                                            </div>
                                            <div className="w-full bg-zinc-200 dark:bg-zinc-700 h-1.5 rounded-full overflow-hidden">
                                                <div
                                                    className="bg-indigo-500 h-full rounded-full"
                                                    style={{ width: `${dp.percentage}%` }}
                                                />
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Selection Flow (Hierarchy Navigation) ────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Column: Scope Selector (Department -> Employee) */}
                <div className="lg:col-span-4 space-y-6">
                    {/* Department Selector */}
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">1. Department Scope</span>
                            <Building2 className="w-4 h-4 text-zinc-400" />
                        </div>

                        {isReportingManager ? (
                            <div className="p-3 bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900 rounded-xl">
                                <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">My Department</span>
                                <div className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                                    {actor?.department_name || 'Assigned Department'}
                                </div>
                                <span className="text-xs text-zinc-400 mt-1 block">Scope strictly locked to your managed department.</span>
                            </div>
                        ) : isSuperuser ? (
                            <div className="space-y-1">
                                <label className="text-xs text-zinc-500 font-medium">Select Department</label>
                                <select
                                    value={selectedDeptId}
                                    onChange={(e) => {
                                        setSelectedDeptId(e.target.value);
                                        setSelectedEmployeeId('all');
                                    }}
                                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-2.5 text-sm text-zinc-800 dark:text-zinc-200 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                >
                                    <option value="all">All Departments ({departments.length})</option>
                                    {departments.map(d => (
                                        <option key={d.id} value={d.id}>{d.name}</option>
                                    ))}
                                </select>
                            </div>
                        ) : null}
                    </div>

                    {/* Employee Selector */}
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                                2. Employees ({assignableEmployees.length})
                            </span>
                            <UserCheck className="w-4 h-4 text-zinc-400" />
                        </div>

                        <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                            <button
                                onClick={() => setSelectedEmployeeId('all')}
                                className={`w-full text-left p-3 rounded-xl transition text-sm flex items-center justify-between ${
                                    selectedEmployeeId === 'all'
                                        ? 'bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 font-semibold text-indigo-700 dark:text-indigo-300'
                                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60 border border-transparent text-zinc-700 dark:text-zinc-300'
                                }`}
                            >
                                <span className="flex items-center gap-2">
                                    <Layers className="w-4 h-4 text-zinc-400" />
                                    All Department Staff
                                </span>
                                <span className="text-xs bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                                    {tasks.length}
                                </span>
                            </button>

                            {assignableEmployees.map(emp => {
                                const empTasks = tasks.filter(t => t.employee_id === emp.id);
                                const empCompleted = empTasks.filter(t => t.status === 'completed').length;
                                const empPct = empTasks.length > 0 ? Math.round((empCompleted / empTasks.length) * 100) : null;
                                const isSelected = selectedEmployeeId === emp.id;
                                return (
                                    <button
                                        key={emp.id}
                                        onClick={() => setSelectedEmployeeId(emp.id)}
                                        className={`w-full text-left p-3 rounded-xl transition text-sm flex items-center justify-between ${
                                            isSelected
                                                ? 'bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 font-semibold text-indigo-700 dark:text-indigo-300'
                                                : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60 border border-transparent text-zinc-700 dark:text-zinc-300'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center font-bold text-xs">
                                                {emp.name.slice(0, 1).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className="text-sm leading-tight">{emp.name}</div>
                                                <div className="text-[11px] text-zinc-400 leading-tight">
                                                    {emp.department_name || 'Staff'}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            {empPct !== null ? (
                                                <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                                                    empPct === 100
                                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                                        : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300'
                                                }`}>
                                                    {empPct}%
                                                </span>
                                            ) : (
                                                <span className="text-[11px] text-zinc-400 font-medium">0 tasks</span>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Right Column: Today's Tasks */}
                <div className="lg:col-span-8 space-y-4">
                    {/* Filter bar */}
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Today's Tasks:</span>
                            <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-xl">
                                {(['all', 'pending', 'completed'] as const).map(tab => (
                                    <button
                                        key={tab}
                                        onClick={() => setStatusFilter(tab)}
                                        className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition ${
                                            statusFilter === tab
                                                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm font-semibold'
                                                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
                                        }`}
                                    >
                                        {tab}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="relative w-full sm:w-64">
                            <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-400" />
                            <input
                                type="text"
                                placeholder="Search deliverables..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-3 py-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                        </div>
                    </div>

                    {/* Task Cards */}
                    {loading ? (
                        <div className="p-12 text-center text-zinc-400 flex flex-col items-center gap-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl">
                            <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
                            <span className="text-sm">Loading task deliverables...</span>
                        </div>
                    ) : filteredTasks.length === 0 ? (
                        <div className="p-12 text-center text-zinc-400 flex flex-col items-center gap-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl">
                            <ClipboardList className="w-8 h-8 text-zinc-300 dark:text-zinc-700" />
                            <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">No tasks assigned for this date</div>
                            <p className="text-xs text-zinc-400">Click "Assign Task" above to delegate a deliverable to an employee.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredTasks.map(task => {
                                const isDone = task.status === 'completed';
                                return (
                                    <div
                                        key={task.id}
                                        className={`p-4 rounded-2xl border transition bg-white dark:bg-zinc-900 flex items-start justify-between gap-4 shadow-sm ${
                                            isDone
                                                ? 'border-emerald-200 dark:border-emerald-950/60 bg-emerald-50/10'
                                                : 'border-zinc-200 dark:border-zinc-800'
                                        }`}
                                    >
                                        <div className="flex items-start gap-3 flex-1 min-w-0">
                                            <button
                                                onClick={() => handleToggleTaskStatus(task.id, task.status)}
                                                className={`mt-0.5 w-6 h-6 rounded-lg border flex items-center justify-center transition flex-shrink-0 ${
                                                    isDone
                                                        ? 'bg-emerald-600 border-emerald-600 text-white'
                                                        : 'border-zinc-300 dark:border-zinc-600 hover:border-indigo-500 text-transparent'
                                                }`}
                                                title={isDone ? 'Mark as pending' : 'Mark as completed'}
                                            >
                                                <Check className="w-3.5 h-3.5" />
                                            </button>

                                            <div className="space-y-1 min-w-0 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className={`font-semibold text-sm leading-snug ${isDone ? 'line-through text-zinc-400' : 'text-zinc-900 dark:text-zinc-100'}`}>
                                                        {task.title}
                                                    </span>
                                                    {task.template && (
                                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
                                                            {task.template.task_type.toUpperCase()}
                                                        </span>
                                                    )}
                                                </div>

                                                {task.description && (
                                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                                                        {task.description}
                                                    </p>
                                                )}

                                                <div className="flex items-center gap-3 text-xs text-zinc-400 pt-1">
                                                    <span className="flex items-center gap-1 font-medium text-zinc-600 dark:text-zinc-300">
                                                        <User className="w-3.5 h-3.5 text-zinc-400" />
                                                        {task.employee?.full_name || 'Staff Member'}
                                                    </span>
                                                    <span>•</span>
                                                    <span>{task.assigned_date}</span>
                                                    {task.completed_at && (
                                                        <>
                                                            <span>•</span>
                                                            <span className="text-emerald-600 dark:text-emerald-400">
                                                                Done at {new Date(task.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                            </span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                                                isDone
                                                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                                    : 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                                            }`}>
                                                {isDone ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                                                {task.status.toUpperCase()}
                                            </span>

                                            {(actor?.role === 'reporting_manager' || actor?.role === 'superuser' || task.assigned_by === actorId) && (
                                                <button
                                                    type="button"
                                                    disabled={deletingTaskId === task.id}
                                                    onClick={() => handleDeleteTask(task.id, task.title)}
                                                    className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-all"
                                                    title="Delete task"
                                                >
                                                    <Trash2 className={`w-4 h-4 ${deletingTaskId === task.id ? 'animate-spin' : ''}`} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Modal: Assign Task ───────────────────────────────────────────── */}
            {showAssignModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5">
                        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-4">
                            <div>
                                <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Assign New Task</h3>
                                <p className="text-xs text-zinc-500">Assign a deliverable to an employee for {selectedDate}.</p>
                            </div>
                            <button
                                onClick={() => setShowAssignModal(false)}
                                className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleAssignTask} className="space-y-4">
                            {/* Employee Selection */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase">
                                    Assignee <span className="text-red-500">*</span>
                                </label>
                                <select
                                    value={assignTargetEmpId}
                                    onChange={(e) => setAssignTargetEmpId(e.target.value)}
                                    required
                                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-2.5 text-sm text-zinc-900 dark:text-zinc-100 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                >
                                    {assignableEmployees.map(emp => (
                                        <option key={emp.id} value={emp.id}>
                                            {emp.name} ({emp.department_name || 'Staff'})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Template Quick-Select */}
                            {templates.length > 0 && (
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase">
                                        Choose from Template (Optional)
                                    </label>
                                    <select
                                        value={assignTemplateId}
                                        onChange={(e) => {
                                            const tId = e.target.value;
                                            setAssignTemplateId(tId);
                                            const tmpl = templates.find(t => t.id === tId);
                                            if (tmpl) {
                                                setAssignTitle(tmpl.title);
                                                if (tmpl.description) setAssignDesc(tmpl.description);
                                            }
                                        }}
                                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-2.5 text-xs text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                    >
                                        <option value="">-- Custom Task / None --</option>
                                        {templates.map(tmpl => (
                                            <option key={tmpl.id} value={tmpl.id}>
                                                [{tmpl.task_type.toUpperCase()}] {tmpl.title}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Title */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase">
                                    Task Title <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. Clean Room 101, Prepare Q3 audit"
                                    value={assignTitle}
                                    onChange={(e) => setAssignTitle(e.target.value)}
                                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-2.5 text-sm text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                />
                            </div>

                            {/* Description */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase">
                                    Description / Details
                                </label>
                                <textarea
                                    rows={2}
                                    placeholder="Optional instructions or notes"
                                    value={assignDesc}
                                    onChange={(e) => setAssignDesc(e.target.value)}
                                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-2.5 text-xs text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                                <button
                                    type="button"
                                    onClick={() => setShowAssignModal(false)}
                                    className="px-4 py-2 text-xs font-semibold rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmittingAssign}
                                    className="px-5 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition disabled:opacity-50"
                                >
                                    {isSubmittingAssign ? 'Assigning...' : 'Assign Task'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Modal: Create Template ────────────────────────────────────────── */}
            {showTemplateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5">
                        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-4">
                            <div>
                                <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Create Task Template</h3>
                                <p className="text-xs text-zinc-500">Create a recurring daily or fixed template for your department.</p>
                            </div>
                            <button
                                onClick={() => setShowTemplateModal(false)}
                                className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleCreateTemplate} className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase">
                                    Template Title <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. Clean Meeting Room A, Submit Daily Procurement Report"
                                    value={newTemplateTitle}
                                    onChange={(e) => setNewTemplateTitle(e.target.value)}
                                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-2.5 text-sm text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase">
                                    Task Type
                                </label>
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setNewTemplateType('fixed')}
                                        className={`p-2.5 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-2 ${
                                            newTemplateType === 'fixed'
                                                ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                                                : 'border-zinc-200 dark:border-zinc-700 text-zinc-500'
                                        }`}
                                    >
                                        Fixed Daily Routine
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setNewTemplateType('assigned')}
                                        className={`p-2.5 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-2 ${
                                            newTemplateType === 'assigned'
                                                ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                                                : 'border-zinc-200 dark:border-zinc-700 text-zinc-500'
                                        }`}
                                    >
                                        Ad-Hoc / Assigned
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase">
                                    Description / SOP Note
                                </label>
                                <textarea
                                    rows={2}
                                    placeholder="Optional standard instructions"
                                    value={newTemplateDesc}
                                    onChange={(e) => setNewTemplateDesc(e.target.value)}
                                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-2.5 text-xs text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                                <button
                                    type="button"
                                    onClick={() => setShowTemplateModal(false)}
                                    className="px-4 py-2 text-xs font-semibold rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmittingTemplate}
                                    className="px-5 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition disabled:opacity-50"
                                >
                                    {isSubmittingTemplate ? 'Saving...' : 'Save Template'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
