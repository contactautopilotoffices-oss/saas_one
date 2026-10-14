"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
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
    Check,
    TrendingUp,
    BarChart3,
    Trash2,
    Zap
} from 'lucide-react';
import TaskProgressGauge from './TaskProgressGauge';
import { createClient } from '@/frontend/utils/supabase/client';

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

// The staged intro plays once per page load. Coming back to this screen later shows it fully drawn, with no replay.
let introPlayed = false;

// Count-up hook — rolls a number from 0 to target over ~750ms easeOut cubic
function useCountUp(target: number, active: boolean, decimals = 0): string {
    const [display, setDisplay] = useState(0);
    const startValRef = useRef(0);
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
        if (!active) {
            setDisplay(0);
            startValRef.current = 0;
            return;
        }
        if (introPlayed) {
            setDisplay(target);
            startValRef.current = target;
            return;
        }

        const startVal = startValRef.current;
        const diff = target - startVal;
        if (diff === 0) {
            setDisplay(target);
            return;
        }

        const start = performance.now();
        const duration = 1400;

        const tick = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            // Cubic easeOut: 1 - (1 - p)^3
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = startVal + diff * eased;
            setDisplay(parseFloat(current.toFixed(decimals)));

            if (progress < 1) {
                rafRef.current = requestAnimationFrame(tick);
            } else {
                setDisplay(target);
                startValRef.current = target;
            }
        };

        rafRef.current = requestAnimationFrame(tick);
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [target, active, decimals]);

    return decimals > 0 ? display.toFixed(decimals) : Math.round(display).toString();
}

export default function TaskAssignmentDashboard({ 
    orgId,
    isSuperuserView = false
}: { 
    orgId?: string;
    isSuperuserView?: boolean;
}) {
    const { user } = useAuth();
    const actorId = user?.id || '';

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // ── 5-Second Staged Waterfall Transition System ──────────────────────────
    // Step 1 (0.0s – 1.0s): Task Operations Hub (Top Header)
    // Step 2 (1.0s – 2.0s): 4 KPI Stat Cards + Count-Up Numbers
    // Step 3 (2.0s – 3.0s): Progress Hierarchy Meter (3-Arc Gauge)
    // Step 4 (3.0s – 4.0s): Organisation Progress Card & Department Matrix
    // Step 5 (4.0s – 5.0s): Department Staff & Tasks List
    const [animationStep, setAnimationStep] = useState(introPlayed ? 5 : 0);

    useEffect(() => {
        if (introPlayed) {
            setAnimationStep(5);
            return;
        }
        if (loading) {
            setAnimationStep(0);
            return;
        }

        // First load only
        setAnimationStep(0);

        const t1 = setTimeout(() => setAnimationStep(1), 80);    // 0.08s: Header (Top -> Down)
        const t2 = setTimeout(() => setAnimationStep(2), 1000);  // 1.0s:  4 KPIs (4 Directions)
        const t3 = setTimeout(() => setAnimationStep(3), 2000);  // 2.0s:  Hierarchy Gauge (Left -> Right, 1.8s)
        const t4 = setTimeout(() => setAnimationStep(4), 3200);  // 3.2s:  Organisation Progress (Right -> Left, 1.8s)
        const t5 = setTimeout(() => setAnimationStep(5), 4400);  // 4.4s:  Staff (Left) & Tasks (Right)
        const t6 = setTimeout(() => { introPlayed = true; }, 6200);  // intro done: later visits skip it

        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
            clearTimeout(t3);
            clearTimeout(t4);
            clearTimeout(t5);
            clearTimeout(t6);
        };
    }, [loading]);

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
    const hasInitialLoadedRef = useRef(false);

    // Fetch dashboard data
    const fetchData = async (isManualRefresh = false) => {
        if (!actorId) return;
        if (isManualRefresh || hasInitialLoadedRef.current) setRefreshing(true);
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

            // Fire both requests in parallel — previously sequential (tasks first, then progress)
            const [res, progRes] = await Promise.all([
                fetch(`/api/task-manager/tasks?${params.toString()}`),
                fetch(`/api/task-manager/progress?actorId=${actorId}&date=${selectedDate}`).catch(() => null)
            ]);

            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to load task dashboard data');
            }

            setActor(data.actor);
            setDepartments(data.departments || []);
            setEmployees(data.employees || []);
            setTasks(data.tasks || []);
            setTemplates(data.templates || []);
            hasInitialLoadedRef.current = true;

            // Process progress response (already resolved in parallel above)
            if (progRes) {
                try {
                    const progJson = await progRes.json();
                    if (progJson.success) {
                        setProgressData(progJson.data);
                    }
                } catch (progErr) {
                    console.warn('[TaskAssignmentDashboard] Progress load error:', progErr);
                }
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

    // Realtime Postgres change subscription for live updates (e.g. WhatsApp completions)
    useEffect(() => {
        if (!actorId) return;
        const supabase = createClient();
        const channel = supabase
            .channel('realtime_task_assignments')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignments' }, () => {
                fetchData(true);
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
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
        const isNowCompleted = nextStatus === 'completed';

        // 1. Instant optimistic update to tasks array
        setTasks(prev => prev.map(t => t.id === taskId ? { 
            ...t, 
            status: nextStatus, 
            completed_at: isNowCompleted ? new Date().toISOString() : null 
        } : t));

        // 2. Instant optimistic update to progressData (gauge & matrix)
        setProgressData((prev: any) => {
            if (!prev) return prev;
            const delta = isNowCompleted ? 1 : -1;
            const newCompleted = Math.max(0, (prev.completed ?? 0) + delta);
            const newPending = Math.max(0, (prev.pending ?? 0) - delta);
            const total = prev.total || 1;
            const newPercentage = Math.round((newCompleted / total) * 100);

            const targetTask = tasks.find(t => t.id === taskId);
            const empDeptId = employees.find(e => e.id === targetTask?.employee_id)?.department_id;

            const updatedDepts = prev.departmentProgress?.map((dp: any) => {
                if (dp.departmentId === empDeptId) {
                    const deptCompleted = Math.max(0, dp.completed + delta);
                    const deptTotal = dp.total || 1;
                    return {
                        ...dp,
                        completed: deptCompleted,
                        pending: Math.max(0, dp.pending - delta),
                        percentage: Math.round((deptCompleted / deptTotal) * 100)
                    };
                }
                return dp;
            });

            return {
                ...prev,
                completed: newCompleted,
                pending: newPending,
                percentage: newPercentage,
                departmentProgress: updatedDepts || prev.departmentProgress
            };
        });

        // 3. Persist to API and silently verify with backend
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

            // Silent sync with backend progress endpoint
            fetch(`/api/task-manager/progress?actorId=${actorId}&date=${selectedDate}`)
                .then(r => r.json())
                .then(json => { if (json.success) setProgressData(json.data); })
                .catch(() => {});
        } catch (err: any) {
            alert(`Action failed: ${err.message}`);
            fetchData(true);
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

    // Tasks filtered by current department scope
    const departmentTasks = useMemo(() => {
        if (!selectedDeptId || selectedDeptId === 'all') return tasks;
        const deptEmpIds = new Set(employees.filter(e => e.department_id === selectedDeptId).map(e => e.id));
        return tasks.filter(t => deptEmpIds.has(t.employee_id) || t.template?.department_id === selectedDeptId);
    }, [tasks, selectedDeptId, employees]);

    // Filtered tasks display (department, employee, status, and search query)
    const filteredTasks = useMemo(() => {
        return departmentTasks.filter(t => {
            // Employee filter
            if (selectedEmployeeId && selectedEmployeeId !== 'all') {
                if (t.employee_id !== selectedEmployeeId) return false;
            }
            // Status filter
            if (statusFilter === 'pending' && t.status === 'completed') {
                return false;
            }
            if (statusFilter === 'completed' && t.status !== 'completed') {
                return false;
            }
            // Search query filter
            if (searchQuery) {
                const match = t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                              (t.employee?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()));
                if (!match) return false;
            }
            return true;
        });
    }, [departmentTasks, selectedEmployeeId, statusFilter, searchQuery]);

    const isReportingManager = actor?.role === 'reporting_manager';
    const isSuperuser = actor?.role === 'superuser' || (isSuperuserView && !isReportingManager);
    const deptDisplayName = actor?.department_name
        ? (actor.department_name.toLowerCase().endsWith('department') ? actor.department_name : `${actor.department_name} Department`)
        : 'Department';

    // Derived 3-tier / 2-tier gauge metrics
    const gaugeMetrics = useMemo(() => {
        // 1. Level 3: Organisation Progress (Outer Arc for Superuser)
        const orgCompleted = progressData?.completed ?? tasks.filter(t => t.status === 'completed').length;
        const orgTotal = progressData?.total ?? tasks.length;
        const orgPct = (progressData?.percentage !== undefined)
            ? progressData.percentage
            : (orgTotal > 0 ? Math.round((orgCompleted / orgTotal) * 100) : 100);

        // 2. Level 2: Department Progress (Outer Arc for Reporting Manager, Middle for Superuser)
        let deptTotal = 0;
        let deptCompleted = 0;
        let deptPct = 100;
        let deptLabel = 'Department Scope';
        let deptSublabel = `${departments.length} Departments`;

        if (isReportingManager) {
            const deptName = actor?.department_name || 'Tech';
            deptLabel = `${deptName} Progress`;
            deptSublabel = `Filtered: ${deptName}`;
            deptTotal = departmentTasks.length;
            deptCompleted = departmentTasks.filter(t => t.status === 'completed').length;
            deptPct = deptTotal > 0 ? Math.round((deptCompleted / deptTotal) * 100) : 100;
        } else if (selectedDeptId !== 'all') {
            const dData = progressData?.departmentProgress?.find((dp: any) => dp.departmentId === selectedDeptId);
            const deptObj = departments.find(d => d.id === selectedDeptId);
            deptLabel = dData?.departmentName || deptObj?.name || 'Selected Dept';
            const deptEmpIds = new Set(employees.filter(e => e.department_id === selectedDeptId).map(e => e.id));
            const deptTasks = tasks.filter(t => deptEmpIds.has(t.employee_id) || t.template?.department_id === selectedDeptId);
            deptTotal = deptTasks.length || (dData?.total ?? 0);
            deptCompleted = deptTasks.filter(t => t.status === 'completed').length;
            deptPct = deptTotal > 0 ? Math.round((deptCompleted / deptTotal) * 100) : (dData?.percentage ?? 100);
            deptSublabel = `Filtered: ${deptLabel}`;
        } else if (progressData?.departmentProgress && progressData.departmentProgress.length > 0) {
            const deptsWithTasks = progressData.departmentProgress.filter((dp: any) => dp.total > 0);
            if (deptsWithTasks.length > 0) {
                deptTotal = deptsWithTasks.reduce((sum: number, dp: any) => sum + dp.total, 0);
                deptCompleted = deptsWithTasks.reduce((sum: number, dp: any) => sum + dp.completed, 0);
                deptPct = Math.round((deptCompleted / deptTotal) * 100);
            } else {
                deptPct = 100;
            }
            deptLabel = 'All Departments';
            deptSublabel = `Avg across ${progressData.departmentProgress.length} depts`;
        }

        // 3. Level 1: Employee Progress (Inner Arc)
        let empTotal = 0;
        let empCompleted = 0;
        let empPct = 100;
        let empLabel = 'Employee Scope';
        let empSublabel = `${employees.length} Staff Members`;

        if (selectedEmployeeId !== 'all') {
            const empObj = employees.find(e => e.id === selectedEmployeeId);
            empLabel = empObj?.name || 'Selected Employee';
            const empTasks = departmentTasks.filter(t => t.employee_id === selectedEmployeeId);
            empTotal = empTasks.length;
            empCompleted = empTasks.filter(t => t.status === 'completed').length;
            empPct = empTotal > 0 ? Math.round((empCompleted / empTotal) * 100) : 100;
            empSublabel = `Staff: ${empLabel}`;
        } else if (isReportingManager) {
            const deptStaff = employees.filter(e => e.department_id === actor?.department_id);
            empTotal = departmentTasks.length;
            empCompleted = departmentTasks.filter(t => t.status === 'completed').length;
            empPct = empTotal > 0 ? Math.round((empCompleted / empTotal) * 100) : 100;
            empSublabel = `${deptStaff.length || 1} Staff Members`;
        } else {
            const allEmpProgs = progressData?.departmentProgress?.flatMap((dp: any) => dp.employeeProgress || []) || [];
            const activeEmpProgs = allEmpProgs.filter((ep: any) => ep.total > 0);
            if (activeEmpProgs.length > 0) {
                empTotal = activeEmpProgs.reduce((sum: number, ep: any) => sum + ep.total, 0);
                empCompleted = activeEmpProgs.reduce((sum: number, ep: any) => sum + ep.completed, 0);
                empPct = Math.round((empCompleted / empTotal) * 100);
                empSublabel = `Avg across ${activeEmpProgs.length} active staff`;
            } else if (departmentTasks.length > 0) {
                empTotal = departmentTasks.length;
                empCompleted = departmentTasks.filter(t => t.status === 'completed').length;
                empPct = Math.round((empCompleted / empTotal) * 100);
            }
        }

        return {
            org: {
                percentage: orgPct,
                completed: orgCompleted,
                total: orgTotal,
                label: 'Organisation Progress',
                sublabel: 'Company-wide Rollup'
            },
            dept: {
                percentage: deptPct,
                completed: deptCompleted,
                total: deptTotal,
                label: deptLabel,
                sublabel: deptSublabel
            },
            employee: {
                percentage: empPct,
                completed: empCompleted,
                total: empTotal,
                label: empLabel,
                sublabel: empSublabel
            }
        };
    }, [progressData, tasks, departmentTasks, selectedDeptId, selectedEmployeeId, departments, employees, isReportingManager, actor]);

    // Derived quick-stat numbers (scoped to active department)
    const totalTasks = departmentTasks.length;
    const completedCount = departmentTasks.filter(t => t.status === 'completed').length;
    const pendingCount = departmentTasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
    const completionRate = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

    // Count-up animated values for stat cards (rolls smoothly in Step 2: animationStep >= 2)
    const countTotal     = useCountUp(totalTasks,     animationStep >= 2);
    const countCompleted = useCountUp(completedCount, animationStep >= 2);
    const countPending   = useCountUp(pendingCount,   animationStep >= 2);
    const countRate      = useCountUp(completionRate, animationStep >= 2);

    // Derived progress card stats (tier 4)
    const progressCardStats = useMemo(() => {
        const total = isReportingManager ? departmentTasks.length : (progressData?.total ?? tasks.length);
        const done = isReportingManager ? departmentTasks.filter(t => t.status === 'completed').length : (progressData?.completed ?? 0);
        const pending = isReportingManager ? departmentTasks.filter(t => t.status !== 'completed').length : (progressData?.pending ?? 0);
        const pct = total > 0 ? Math.round((done / total) * 100) : 100;
        return { total, done, pending, pct };
    }, [isReportingManager, departmentTasks, progressData, tasks]);

    // Loading State: Display a sleek loading indicator until all data is loaded
    if (loading) {
        return (
            <div className="w-full min-h-[480px] flex flex-col items-center justify-center p-8 text-center space-y-4">
                <div className="relative flex items-center justify-center">
                    <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/60 dark:border-indigo-800/40 flex items-center justify-center shadow-xl shadow-indigo-500/10">
                        <ClipboardList className="w-8 h-8 text-indigo-600 dark:text-indigo-400 animate-pulse" />
                    </div>
                    <div className="absolute -inset-2.5 border-2 border-indigo-500/20 border-t-indigo-600 rounded-3xl animate-spin" />
                </div>
                <div className="space-y-1">
                    <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-200">
                        Loading Task Operations Hub...
                    </h3>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">
                        Syncing real-time deliverables & operational progress
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div 
            className="w-full space-y-2 sm:space-y-2.5 p-1 sm:p-2.5 tm-root overflow-x-hidden max-w-[1600px] mx-auto"
            style={{ zoom: '0.85' }}
        >

            {/* ── Tier 1 (0.0s – 1.0s): Top Header Bar (Top -> Down Slide) ────────── */}
            <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-2.5 ${animationStep >= 1 ? 'tm-slide-down-visible' : 'tm-slide-down-hidden'}`}>
                {/* Left: Title + Role badge */}
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 text-white flex items-center justify-center shadow-xs flex-shrink-0">
                        <ClipboardList className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <h1 className="text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100 leading-tight truncate">
                                {isReportingManager
                                    ? 'Manager Task Console'
                                    : isSuperuser
                                    ? 'Task Operations Hub'
                                    : 'Daily Task Console'}
                            </h1>
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-bold tracking-wide flex-shrink-0 ${
                                isSuperuser
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40'
                                    : isReportingManager
                                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/40'
                                    : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-200/60 dark:border-zinc-700/40'
                            }`}>
                                <Shield className="w-2.5 h-2.5" />
                                {actor?.role ? actor.role.replace('_', ' ').toUpperCase() : 'USER'}
                            </span>
                        </div>
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                            {isReportingManager
                                ? `Managing: ${actor?.department_name || 'My Department'}`
                                : isSuperuser
                                ? 'Organisation-wide task assignment & oversight'
                                : 'Your personal task deliverables'}
                        </p>
                    </div>
                </div>

                {/* Right: Controls */}
                <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap flex-shrink-0">
                    {/* Date Picker */}
                    <div className="flex items-center gap-1 bg-white dark:bg-zinc-900 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700 transition-all duration-200">
                        <Calendar className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="bg-transparent border-none text-zinc-700 dark:text-zinc-200 text-xs font-medium focus:outline-none cursor-pointer"
                        />
                    </div>

                    {/* Refresh */}
                    <button
                        onClick={() => {
                            setAnimationStep(0);
                            fetchData(true).then(() => {
                                setTimeout(() => setAnimationStep(1), 80);
                                setTimeout(() => setAnimationStep(2), 1000);
                                setTimeout(() => setAnimationStep(3), 2000);
                                setTimeout(() => setAnimationStep(4), 3200);
                                setTimeout(() => setAnimationStep(5), 4400);
                                setTimeout(() => setAnimationStep(6), 5500);
                            });
                        }}
                        disabled={refreshing}
                        className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all duration-200 shadow-xs disabled:opacity-50 hover:scale-105 active:scale-95"
                        title="Refresh data & replay sequence"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>

                    {/* Action Buttons */}
                    {(isReportingManager || isSuperuser) && (
                        <>
                            <button
                                onClick={() => setShowTemplateModal(true)}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-600 transition-all duration-200 shadow-xs active:scale-[0.97]"
                            >
                                <Layers className="w-3 h-3 text-zinc-400" />
                                Template
                            </button>
                            <button
                                onClick={() => {
                                    setAssignTargetEmpId(assignableEmployees[0]?.id || '');
                                    setShowAssignModal(true);
                                }}
                                className="flex items-center gap-1 px-3 py-1 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs transition-all duration-200 active:scale-[0.96]"
                            >
                                <Plus className="w-3 h-3" />
                                Assign Task
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* ── Error Banner ────────────────────────────────────────────────── */}
            {error && (
                <div className="flex items-center gap-3 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/60 rounded-xl text-red-700 dark:text-red-300 text-xs">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="flex-1">{error}</span>
                    <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* ── Quick Stats Row (4-Direction Convergence) ──────────────────── */}
            {!loading && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                        {
                            label: 'Total Tasks',
                            displayValue: countTotal,
                            icon: <ClipboardList className="w-3 h-3" />,
                            color: 'text-zinc-600 dark:text-zinc-300',
                            bg: 'bg-zinc-50 dark:bg-zinc-800/60',
                            iconBg: 'bg-zinc-200/70 dark:bg-zinc-700',
                            animClass: 'tm-slide-left', // Card 0: from Left
                        },
                        {
                            label: 'Completed',
                            displayValue: countCompleted,
                            icon: <CheckCircle2 className="w-3 h-3" />,
                            color: 'text-emerald-700 dark:text-emerald-400',
                            bg: 'bg-emerald-50 dark:bg-emerald-950/30',
                            iconBg: 'bg-emerald-200/70 dark:bg-emerald-900/60',
                            animClass: 'tm-slide-down', // Card 1: from Top
                        },
                        {
                            label: 'Pending',
                            displayValue: countPending,
                            icon: <Clock className="w-3 h-3" />,
                            color: 'text-amber-700 dark:text-amber-400',
                            bg: 'bg-amber-50 dark:bg-amber-950/30',
                            iconBg: 'bg-amber-200/70 dark:bg-amber-900/60',
                            animClass: 'tm-slide-up', // Card 2: from Bottom
                        },
                        {
                            label: 'Completion Rate',
                            displayValue: `${countRate}%`,
                            icon: <TrendingUp className="w-3 h-3" />,
                            color: completionRate >= 80 ? 'text-indigo-700 dark:text-indigo-400' : 'text-orange-700 dark:text-orange-400',
                            bg: completionRate >= 80 ? 'bg-indigo-50 dark:bg-indigo-950/30' : 'bg-orange-50 dark:bg-orange-950/30',
                            iconBg: completionRate >= 80 ? 'bg-indigo-200/70 dark:bg-indigo-900/60' : 'bg-orange-200/70 dark:bg-orange-900/60',
                            animClass: 'tm-slide-right', // Card 3: from Right
                        },
                    ].map((stat, i) => (
                        <div
                            key={i}
                            className={`${stat.bg} rounded-lg p-2 sm:p-2.5 border border-transparent flex items-center gap-2 ${
                                animationStep >= 2 ? `${stat.animClass}-visible` : `${stat.animClass}-hidden`
                            }`}
                            style={{ transitionDelay: `${i * 120}ms` }}
                        >
                            <div className={`${stat.iconBg} ${stat.color} w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0`}>
                                {stat.icon}
                            </div>
                            <div className="min-w-0">
                                <div className={`text-sm sm:text-base font-bold tabular-nums ${stat.color} leading-tight`}>{stat.displayValue}</div>
                                <div className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">{stat.label}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Tier 3 (2.0s – 3.0s): Progress Hierarchy Meter (Superuser or Reporting Manager) ── */}
            {(isSuperuser || isReportingManager) && (
                <div className={`w-full overflow-hidden ${animationStep >= 3 ? 'tm-slide-left-visible' : 'tm-slide-left-hidden'}`}>
                    <TaskProgressGauge
                        orgProgress={gaugeMetrics.org}
                        deptProgress={gaugeMetrics.dept}
                        employeeProgress={gaugeMetrics.employee}
                        active={animationStep >= 3}
                        isReportingManager={isReportingManager}
                        departmentName={deptDisplayName}
                        className={animationStep >= 3 ? 'tm-slide-left-visible' : 'tm-slide-left-hidden'}
                    />
                </div>
            )}

            {/* ── Tier 4 (3.2s – 4.4s): Progress Card (Right -> Left) ── */}
            {progressData && (
                <div className={`bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-xs ${animationStep >= 4 ? 'tm-slide-right-visible' : 'tm-slide-right-hidden'}`}>
                    {/* Card Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800/80">
                        <div className="flex items-center gap-2">
                            <div className="p-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                                <TrendingUp className="w-3 h-3" />
                            </div>
                            <div>
                                <h2 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                                    {isSuperuser
                                        ? 'Organisation Progress'
                                        : isReportingManager
                                        ? `${deptDisplayName} Progress`
                                        : 'Your Task Progress'}
                                </h2>
                                <p className="text-[10px] text-zinc-400">
                                    {isSuperuser
                                        ? `Consolidated across ${progressData.totalDepartments ?? departments.length} departments`
                                        : isReportingManager
                                        ? `Real-time daily task completion for ${deptDisplayName}`
                                        : 'Real-time daily task completion status'}
                                </p>
                            </div>
                        </div>

                        {/* Metric badges */}
                        <div className="flex items-center gap-1 text-[10px] font-semibold flex-wrap">
                            <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                                <Layers className="w-2.5 h-2.5 text-zinc-400" />
                                <span>{progressCardStats.total} Total</span>
                            </div>
                            <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                                <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
                                <span>{progressCardStats.done} Done</span>
                            </div>
                            <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
                                <Clock className="w-2.5 h-2.5 text-amber-500" />
                                <span>{progressCardStats.pending} Pending</span>
                            </div>
                            <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold">
                                <BarChart3 className="w-2.5 h-2.5 text-indigo-500" />
                                <span>{progressCardStats.pct}%</span>
                            </div>
                        </div>
                    </div>

                    {/* Progress Bar — fills smoothly from 0% */}
                    <div className="px-3 pt-1.5 pb-0.5">
                        <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                            <div
                                className="bg-gradient-to-r from-indigo-500 via-emerald-500 to-teal-400 h-full rounded-full"
                                style={{
                                    width: animationStep >= 4 ? `${Math.min(100, Math.max(0, progressCardStats.pct))}%` : '0%',
                                    transition: 'width 1000ms cubic-bezier(0.16, 1, 0.3, 1) 250ms',
                                }}
                            />
                        </div>
                    </div>

                    {/* Department Progress Matrix (Superuser View) */}
                    {isSuperuser && progressData.departmentProgress && progressData.departmentProgress.length > 0 && (
                        <div className="px-3 pb-2 pt-1.5">
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                                    Department Breakdown · {progressData.departmentProgress.length} depts
                                </span>
                                <span className="text-[9px] text-zinc-400">Click to filter</span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 gap-1.5">
                                {progressData.departmentProgress.map((dp: any, dIdx: number) => {
                                    const isDeptActive = selectedDeptId === dp.departmentId;
                                    const isComplete = dp.percentage === 100;
                                    return (
                                        <button
                                            key={dp.departmentId}
                                            onClick={() => {
                                                setSelectedDeptId(isDeptActive ? 'all' : dp.departmentId);
                                                setSelectedEmployeeId('all');
                                            }}
                                            className={`group p-1.5 rounded-md border text-left text-[10px] flex flex-col justify-between gap-1 hover:scale-[1.01] active:scale-[0.98] ${animationStep >= 4 ? 'tm-slide-right-visible' : 'tm-slide-right-hidden'} ${
                                                isDeptActive
                                                    ? 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-300 dark:border-indigo-700 ring-1 ring-indigo-400/30 shadow-xs'
                                                    : 'bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-700/60 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-white dark:hover:bg-zinc-800/80'
                                            }`}
                                            style={{ transitionDelay: `${150 + Math.min(dIdx * 50, 450)}ms` }}
                                        >
                                            <div className={`font-semibold leading-tight truncate ${isDeptActive ? 'text-indigo-800 dark:text-indigo-200' : 'text-zinc-700 dark:text-zinc-300'}`}>
                                                {dp.departmentName}
                                            </div>
                                            <div className="space-y-0.5">
                                                <div className="flex items-center justify-between text-[9px]">
                                                    <span className="text-zinc-400 dark:text-zinc-500">{dp.completed}/{dp.total}</span>
                                                    <span className={`font-bold ${isComplete ? 'text-emerald-600 dark:text-emerald-400' : isDeptActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                                                        {dp.percentage}%
                                                    </span>
                                                </div>
                                                <div className="w-full bg-zinc-200 dark:bg-zinc-700 h-0.5 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full ${isComplete ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                                                        style={{
                                                            width: animationStep >= 4 ? `${dp.percentage}%` : '0%',
                                                            transition: `width 800ms cubic-bezier(0.16, 1, 0.3, 1) ${300 + Math.min(dIdx * 50, 450)}ms`,
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Main Content Grid ────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 sm:gap-3">

                {/* ── Tier 5 (4.4s – 5.5s): Left Column (Staff from Left) ─────────── */}
                <div className={`lg:col-span-4 xl:col-span-3 space-y-2.5 ${animationStep >= 5 ? 'tm-slide-left-visible' : 'tm-slide-left-hidden'}`}>

                    {/* Department Scope Card */}
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-xs">
                        <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800/80">
                            <div className="flex items-center gap-1.5">
                                <Building2 className="w-3 h-3 text-zinc-400" />
                                <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">Department</span>
                            </div>
                            <span className="text-[9px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.2 rounded-full">
                                Step 1
                            </span>
                        </div>

                        <div className="p-2">
                            {isReportingManager ? (
                                <div className="flex items-center gap-2 p-1.5 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/60 rounded-lg">
                                    <div className="w-6 h-6 rounded-md bg-indigo-600 text-white flex items-center justify-center flex-shrink-0">
                                        <Building2 className="w-3 h-3" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 leading-tight truncate">
                                            {actor?.department_name || 'My Department'}
                                        </div>
                                        <div className="text-[9px] text-indigo-500 dark:text-indigo-400">Scope locked to department</div>
                                    </div>
                                </div>
                            ) : isSuperuser ? (
                                <div className="space-y-1">
                                    <label className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">Filter by department</label>
                                    <select
                                        value={selectedDeptId}
                                        onChange={(e) => {
                                            setSelectedDeptId(e.target.value);
                                            setSelectedEmployeeId('all');
                                        }}
                                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-800 dark:text-zinc-200 font-medium focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 focus:outline-none transition-all cursor-pointer"
                                    >
                                        <option value="all">All Departments ({departments.length})</option>
                                        {departments.map(d => (
                                            <option key={d.id} value={d.id}>{d.name}</option>
                                        ))}
                                    </select>
                                </div>
                            ) : null}
                        </div>
                    </div>

                    {/* Employee Selector Card */}
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-xs">
                        <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800/80">
                            <div className="flex items-center gap-1.5">
                                <UserCheck className="w-3 h-3 text-zinc-400" />
                                <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">Staff</span>
                            </div>
                            <span className="text-[9px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.2 rounded-full">
                                {assignableEmployees.length}
                            </span>
                        </div>

                        <div className="max-h-[260px] overflow-y-auto">
                            <div className="p-1 space-y-0.5">
                                {/* All Staff button */}
                                <button
                                    onClick={() => setSelectedEmployeeId('all')}
                                    className={`w-full text-left px-2 py-1 rounded-lg transition-all duration-150 flex items-center justify-between hover:translate-x-0.5 active:scale-[0.98] ${
                                        selectedEmployeeId === 'all'
                                            ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400'
                                    }`}
                                >
                                    <span className="flex items-center gap-1.5 text-xs">
                                        <span className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 ${
                                            selectedEmployeeId === 'all' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                                        }`}>
                                            <Layers className="w-2.5 h-2.5" />
                                        </span>
                                        <span className="font-semibold">All Staff</span>
                                    </span>
                                    <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-bold ${
                                        selectedEmployeeId === 'all'
                                            ? 'bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300'
                                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                                    }`}>
                                        {departmentTasks.length}
                                    </span>
                                </button>

                                {/* Divider */}
                                {assignableEmployees.length > 0 && (
                                    <div className="my-0.5 border-t border-zinc-100 dark:border-zinc-800/80 mx-1.5" />
                                )}

                                {/* Employee list */}
                                {assignableEmployees.map(emp => {
                                    const empTasks = departmentTasks.filter(t => t.employee_id === emp.id);
                                    const empCompleted = empTasks.filter(t => t.status === 'completed').length;
                                    const empPct = empTasks.length > 0 ? Math.round((empCompleted / empTasks.length) * 100) : null;
                                    const isSelected = selectedEmployeeId === emp.id;
                                    const initials = emp.name.trim().split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase();

                                    return (
                                        <button
                                            key={emp.id}
                                            onClick={() => setSelectedEmployeeId(emp.id)}
                                            className={`w-full text-left px-2 py-1 rounded-lg transition-all duration-150 flex items-center justify-between hover:translate-x-0.5 active:scale-[0.98] ${
                                                isSelected
                                                    ? 'bg-indigo-50 dark:bg-indigo-950/40'
                                                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60'
                                            }`}
                                        >
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 text-[9px] font-black ${
                                                    isSelected
                                                        ? 'bg-indigo-600 text-white'
                                                        : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                                                }`}>
                                                    {initials}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className={`text-xs font-semibold leading-tight truncate ${isSelected ? 'text-indigo-800 dark:text-indigo-200' : 'text-zinc-800 dark:text-zinc-200'}`}>
                                                        {emp.name}
                                                    </div>
                                                    <div className="text-[9px] text-zinc-400 leading-tight truncate">
                                                        {emp.department_name || 'Staff'}
                                                    </div>
                                                </div>
                                            </div>
                                            {empPct !== null ? (
                                                <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-bold flex-shrink-0 ${
                                                    empPct === 100
                                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                                        : isSelected
                                                        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300'
                                                        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                                                }`}>
                                                    {empPct}%
                                                </span>
                                            ) : (
                                                <span className="text-[9px] text-zinc-300 dark:text-zinc-600 font-medium flex-shrink-0">—</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Tier 5 (4.4s – 5.5s): Right Column (Tasks from Right) ───────── */}
                <div
                    className={`lg:col-span-8 xl:col-span-9 space-y-3 ${animationStep >= 5 ? 'tm-slide-right-visible' : 'tm-slide-right-hidden'}`}
                    style={{ transitionDelay: '150ms' }}
                >

                    {/* Filter / Search Bar */}
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-2.5 py-1.5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                            <Filter className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                            {/* Status tab switcher */}
                            <div className="flex bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg gap-0.5">
                                {([
                                    { key: 'all' as const, label: 'All', count: departmentTasks.length },
                                    { key: 'pending' as const, label: 'Pending', count: pendingCount },
                                    { key: 'completed' as const, label: 'Done', count: completedCount },
                                ]).map(tab => (
                                    <button
                                        key={tab.key}
                                        onClick={() => setStatusFilter(tab.key)}
                                        className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold transition-all duration-150 active:scale-95 ${
                                            statusFilter === tab.key
                                                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-xs'
                                                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                                        }`}
                                    >
                                        {tab.label}
                                        {tab.count > 0 && (
                                            <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                                                statusFilter === tab.key
                                                    ? tab.key === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                                    : tab.key === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                                    : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                                                    : 'bg-zinc-200/80 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
                                            }`}>
                                                {tab.count}
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Search input */}
                        <div className="relative w-full sm:w-52">
                            <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Search tasks or staff..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-7 pr-2.5 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Task Cards Area */}
                    {loading ? (
                        /* Loading skeleton */
                        <div className="space-y-2">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 shadow-xs animate-pulse">
                                    <div className="flex items-start gap-2">
                                        <div className="w-4 h-4 rounded bg-zinc-200 dark:bg-zinc-700 flex-shrink-0 mt-0.5" />
                                        <div className="flex-1 space-y-1">
                                            <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded w-2/3" />
                                            <div className="h-2 bg-zinc-100 dark:bg-zinc-800 rounded w-1/3" />
                                        </div>
                                        <div className="h-4 w-12 bg-zinc-100 dark:bg-zinc-800 rounded-full" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : filteredTasks.length === 0 ? (
                        /* Empty state */
                        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-xs text-center flex flex-col items-center gap-2">
                            <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                                <ClipboardList className="w-5 h-5 text-zinc-300 dark:text-zinc-600" />
                            </div>
                            <div>
                                <div className="text-xs sm:text-xs font-bold text-zinc-700 dark:text-zinc-300">
                                    {searchQuery ? 'No matching tasks' : 'No tasks for this date'}
                                </div>
                                <p className="text-[10px] text-zinc-400 mt-0.5">
                                    {searchQuery
                                        ? 'Try a different search term or clear the filter.'
                                        : 'Use "Assign Task" to delegate a deliverable to a staff member.'}
                                </p>
                            </div>
                            {(isReportingManager || isSuperuser) && !searchQuery && (
                                <button
                                    onClick={() => {
                                        setAssignTargetEmpId(assignableEmployees[0]?.id || '');
                                        setShowAssignModal(true);
                                    }}
                                    className="mt-1 flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs transition-all"
                                >
                                    <Plus className="w-3 h-3" />
                                    Assign First Task
                                </button>
                            )}
                        </div>
                    ) : (
                        /* Task list */
                        <div className="space-y-1.5">
                            {filteredTasks.map((task, tIdx) => {
                                const isDone = task.status === 'completed';
                                const isDeleting = deletingTaskId === task.id;
                                return (
                                    <div
                                        key={task.id}
                                        className={`group bg-white dark:bg-zinc-900 border rounded-lg px-3 py-2 shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700 ${
                                            animationStep >= 5 ? 'tm-slide-right-visible' : 'tm-slide-right-hidden'
                                        } ${
                                            isDone
                                                ? 'border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10'
                                                : 'border-zinc-200 dark:border-zinc-800'
                                        }`}
                                        style={{ transitionDelay: `${250 + Math.min(tIdx * 50, 450)}ms` }}
                                    >
                                        <div className="flex items-start gap-2">
                                            {/* Checkbox */}
                                            <button
                                                onClick={() => handleToggleTaskStatus(task.id, task.status)}
                                                className={`mt-0.5 w-4 h-4 rounded-md border-2 flex items-center justify-center transition-all duration-200 flex-shrink-0 hover:scale-110 active:scale-90 ${
                                                    isDone
                                                        ? 'bg-emerald-500 border-emerald-500 text-white shadow-xs'
                                                        : 'border-zinc-300 dark:border-zinc-600 hover:border-indigo-400 dark:hover:border-indigo-500 text-transparent hover:bg-indigo-50 dark:hover:bg-indigo-950/30'
                                                }`}
                                                title={isDone ? 'Mark as pending' : 'Mark as completed'}
                                            >
                                                <Check className="w-2.5 h-2.5" />
                                            </button>

                                            {/* Task content */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <span className={`text-xs font-semibold leading-snug transition-all duration-300 ${
                                                                isDone
                                                                    ? 'line-through text-zinc-400 dark:text-zinc-500'
                                                                    : 'text-zinc-900 dark:text-zinc-100'
                                                            }`}>
                                                                {task.title}
                                                            </span>
                                                            {task.template && (
                                                                <span className="inline-flex items-center gap-0.5 text-[8px] font-bold px-1.5 py-0.2 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-300 border border-blue-200/60 dark:border-blue-900/60 flex-shrink-0">
                                                                    {task.template.task_type === 'fixed'
                                                                        ? <Zap className="w-2 h-2" />
                                                                        : <Layers className="w-2 h-2" />}
                                                                    {task.template.task_type.toUpperCase()}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {task.description && (
                                                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-1">
                                                                {task.description}
                                                            </p>
                                                        )}

                                                        {/* Meta row */}
                                                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                            <div className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                                                                <div className="w-3 h-3 rounded bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[7px] font-black text-zinc-600 dark:text-zinc-300 flex-shrink-0">
                                                                    {(task.employee?.full_name || 'S').charAt(0).toUpperCase()}
                                                                </div>
                                                                <span className="font-medium text-zinc-600 dark:text-zinc-300">
                                                                    {task.employee?.full_name || 'Staff Member'}
                                                                </span>
                                                            </div>
                                                            <span className="text-zinc-300 dark:text-zinc-700">·</span>
                                                            <span className="text-[10px] text-zinc-400">{task.assigned_date}</span>
                                                            {task.completed_at && (
                                                                <>
                                                                    <span className="text-zinc-300 dark:text-zinc-700">·</span>
                                                                    <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                                                        <CheckCircle2 className="w-2.5 h-2.5" />
                                                                        {new Date(task.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Status + delete */}
                                                    <div className="flex items-center gap-1 flex-shrink-0">
                                                        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-full text-[9px] font-bold transition-all duration-300 ${
                                                            isDone
                                                                ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                                                                : 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
                                                        }`}>
                                                            {isDone ? <CheckCircle2 className="w-2 h-2" /> : <Clock className="w-2 h-2" />}
                                                            {isDone ? 'Done' : 'Pending'}
                                                        </span>

                                                        {(actor?.role === 'reporting_manager' || actor?.role === 'superuser' || task.assigned_by === actorId) && (
                                                            <button
                                                                type="button"
                                                                disabled={isDeleting}
                                                                onClick={() => handleDeleteTask(task.id, task.title)}
                                                                className="opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 p-0.5 text-zinc-300 dark:text-zinc-600 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition-all duration-200 disabled:opacity-30 active:scale-90"
                                                                title="Delete task"
                                                            >
                                                                {isDeleting ? (
                                                                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                                                                ) : (
                                                                    <Trash2 className="w-2.5 h-2.5" />
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Syncing indicator */}
                    {refreshing && !loading && (
                        <div className="flex items-center justify-center gap-2 py-3 text-xs text-zinc-400">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            Syncing latest data...
                        </div>
                    )}
                </div>
            </div>

            {/* ── Modal: Assign Task ───────────────────────────────────────────── */}
            {showAssignModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}
                >
                    <div
                        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden"
                        style={{ animation: 'tmModalIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                    >
                        {/* Modal Header */}
                        <div className="flex items-center justify-between px-6 pt-6 pb-5 border-b border-zinc-100 dark:border-zinc-800">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-500/30">
                                    <Plus className="w-4 h-4" />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Assign New Task</h3>
                                    <p className="text-xs text-zinc-400 mt-0.5">Delegate a deliverable for {selectedDate}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowAssignModal(false)}
                                className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <form onSubmit={handleAssignTask} className="px-6 py-5 space-y-4">
                            {/* Assignee */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                                    Assignee <span className="text-rose-500">*</span>
                                </label>
                                <select
                                    value={assignTargetEmpId}
                                    onChange={(e) => setAssignTargetEmpId(e.target.value)}
                                    required
                                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 font-medium focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 focus:outline-none transition-all"
                                >
                                    {assignableEmployees.map(emp => (
                                        <option key={emp.id} value={emp.id}>
                                            {emp.name} — {emp.department_name || 'Staff'}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Template quick-select */}
                            {templates.length > 0 && (
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                                        Template <span className="text-zinc-400 font-normal normal-case">(optional)</span>
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
                                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 focus:outline-none transition-all"
                                    >
                                        <option value="">Custom task (no template)</option>
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
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                                    Task Title <span className="text-rose-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. Clean Room 101, Prepare Q3 Audit"
                                    value={assignTitle}
                                    onChange={(e) => setAssignTitle(e.target.value)}
                                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 focus:outline-none transition-all"
                                />
                            </div>

                            {/* Description */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                                    Notes <span className="text-zinc-400 font-normal normal-case">(optional)</span>
                                </label>
                                <textarea
                                    rows={2}
                                    placeholder="Additional instructions or context..."
                                    value={assignDesc}
                                    onChange={(e) => setAssignDesc(e.target.value)}
                                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 focus:outline-none transition-all resize-none"
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                                <button
                                    type="button"
                                    onClick={() => setShowAssignModal(false)}
                                    className="px-4 py-2 text-sm font-semibold rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all duration-150 active:scale-95"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmittingAssign}
                                    className="flex items-center gap-1.5 px-5 py-2 text-sm font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-px active:scale-[0.96] active:shadow-none"
                                >
                                    {isSubmittingAssign ? (
                                        <>
                                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                            Assigning...
                                        </>
                                    ) : (
                                        <>
                                            <Check className="w-3.5 h-3.5" />
                                            Assign Task
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Modal: Create Template ────────────────────────────────────────── */}
            {showTemplateModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}
                >
                    <div
                        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden"
                        style={{ animation: 'tmModalIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                    >
                        {/* Modal Header */}
                        <div className="flex items-center justify-between px-6 pt-6 pb-5 border-b border-zinc-100 dark:border-zinc-800">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-violet-500/30">
                                    <Layers className="w-4 h-4" />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Create Task Template</h3>
                                    <p className="text-xs text-zinc-400 mt-0.5">Reusable template for recurring deliverables</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowTemplateModal(false)}
                                className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <form onSubmit={handleCreateTemplate} className="px-6 py-5 space-y-4">
                            {/* Template Title */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                                    Template Title <span className="text-rose-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. Clean Meeting Room A, Submit Daily Report"
                                    value={newTemplateTitle}
                                    onChange={(e) => setNewTemplateTitle(e.target.value)}
                                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 focus:outline-none transition-all"
                                />
                            </div>

                            {/* Task Type */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">Task Type</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setNewTemplateType('fixed')}
                                        className={`p-3 rounded-xl border text-sm font-semibold transition-all flex flex-col items-center gap-1.5 ${
                                            newTemplateType === 'fixed'
                                                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-400/20'
                                                : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                                        }`}
                                    >
                                        <Zap className={`w-4 h-4 ${newTemplateType === 'fixed' ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400'}`} />
                                        Fixed Daily
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setNewTemplateType('assigned')}
                                        className={`p-3 rounded-xl border text-sm font-semibold transition-all flex flex-col items-center gap-1.5 ${
                                            newTemplateType === 'assigned'
                                                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-400/20'
                                                : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                                        }`}
                                    >
                                        <UserCheck className={`w-4 h-4 ${newTemplateType === 'assigned' ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400'}`} />
                                        Ad-Hoc
                                    </button>
                                </div>
                            </div>

                            {/* Description */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                                    SOP Note <span className="text-zinc-400 font-normal normal-case">(optional)</span>
                                </label>
                                <textarea
                                    rows={2}
                                    placeholder="Standard operating procedure or instructions..."
                                    value={newTemplateDesc}
                                    onChange={(e) => setNewTemplateDesc(e.target.value)}
                                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 focus:outline-none transition-all resize-none"
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                                <button
                                    type="button"
                                    onClick={() => setShowTemplateModal(false)}
                                    className="px-4 py-2 text-sm font-semibold rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all duration-150 active:scale-95"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmittingTemplate}
                                    className="flex items-center gap-1.5 px-5 py-2 text-sm font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-px active:scale-[0.96] active:shadow-none"
                                >
                                    {isSubmittingTemplate ? (
                                        <>
                                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                            Saving...
                                        </>
                                    ) : (
                                        <>
                                            <Check className="w-3.5 h-3.5" />
                                            Save Template
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Animation system */}
            <style>{`
                .tm-root {
                    zoom: 0.85;
                }
                @media (max-width: 640px) {
                    .tm-root {
                        zoom: 0.92;
                    }
                }

                /* ── Slide Transitions (Shared Base) ─────────────────────────── */
                .tm-slide-left-hidden, .tm-slide-right-hidden,
                .tm-slide-down-hidden, .tm-slide-up-hidden {
                    opacity: 0 !important;
                    pointer-events: none !important;
                    will-change: opacity, transform;
                }

                .tm-slide-left-visible, .tm-slide-right-visible,
                .tm-slide-down-visible, .tm-slide-up-visible {
                    opacity: 1 !important;
                    transform: translate(0, 0) !important;
                    pointer-events: auto !important;
                    will-change: opacity, transform;
                }

                /* Horizontal slides */
                .tm-slide-left-hidden, .tm-slide-left-visible,
                .tm-slide-right-hidden, .tm-slide-right-visible {
                    transition: opacity 1400ms cubic-bezier(0.16, 1, 0.3, 1), transform 1800ms cubic-bezier(0.16, 1, 0.3, 1) !important;
                }
                .tm-slide-left-hidden  { transform: translateX(-100px) !important; }
                .tm-slide-right-hidden { transform: translateX(100px) !important; }

                /* Vertical slides */
                .tm-slide-down-hidden, .tm-slide-down-visible,
                .tm-slide-up-hidden, .tm-slide-up-visible {
                    transition: opacity 1300ms cubic-bezier(0.16, 1, 0.3, 1), transform 1600ms cubic-bezier(0.16, 1, 0.3, 1) !important;
                }
                .tm-slide-down-hidden { transform: translateY(-50px) !important; }
                .tm-slide-up-hidden   { transform: translateY(50px) !important; }

                /* ── Modal Spring-in ──────────────────────────────────────────── */
                @keyframes tmModalIn {
                    from { opacity: 0; transform: scale(0.93) translateY(10px); }
                    to   { opacity: 1; transform: scale(1) translateY(0); }
                }
            `}</style>
        </div>
    );
}
