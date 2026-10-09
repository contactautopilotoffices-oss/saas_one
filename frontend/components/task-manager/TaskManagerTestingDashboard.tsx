"use client";

import React, { useState, useEffect, useRef } from 'react';
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
    HelpCircle,
    Clock,
    Zap,
    Play,
    Check,
    Settings2,
    RotateCcw,
    Plus,
    Trash2,
    ChevronDown,
    ChevronUp,
    Sliders,
    Calendar,
    FileText,
    Eye,
    Filter,
    Sun,
    Moon,
    AlertTriangle,
    Copy,
    History,
    X,
    Power,
    Ban,
    Pause,
    ShieldAlert,
    ArrowLeftRight
} from 'lucide-react';
import OrgHierarchyPanel from '@/frontend/components/task-manager/OrgHierarchyPanel';
import TaskAccessPanel from '@/frontend/components/task-manager/TaskAccessPanel';
import type {
    NotificationRule,
    NotificationRuleType,
    NotificationTaskFilters,
    NotificationConditions,
    NotificationCustomTemplate,
    WhatsAppKillSwitches
} from '@/task-manager/types';

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

interface DepartmentItem {
    id: string;
    name: string;
    code?: string | null;
    is_active?: boolean;
}

interface DepartmentSummaryItem {
    id: string;
    name: string;
    code?: string | null;
    manager: EmployeeItem | null;
    members: EmployeeItem[];
    memberCount: number;
    whatsappStatus: 'active' | 'paused';
    rulesCount: number;
}

/**
 * 12-Hour Time Picker with AM/PM toggle and compact grid selectors
 * - No scrolling lists
 * - Tapping Hour shows 1-12 grid
 * - Tapping Minute shows 00-55 grid (with exact minute field)
 * - Emits strict 24-hour "HH:mm" to parent
 */
function TwelveHourTimePicker({
    value,
    onChange
}: {
    value: string;
    onChange: (val24: string) => void;
}) {
    const [showHourPicker, setShowHourPicker] = useState(false);
    const [showMinutePicker, setShowMinutePicker] = useState(false);
    const pickerRef = useRef<HTMLDivElement>(null);

    // Parse 24-hr value ("HH:mm") into 12-hr parts
    const parse24 = (v: string) => {
        const [hRaw, mRaw] = (v || '09:00').split(':');
        let h = parseInt(hRaw, 10);
        if (isNaN(h) || h < 0 || h > 23) h = 9;
        const m = parseInt(mRaw, 10);
        const safeM = isNaN(m) || m < 0 || m > 59 ? '00' : String(m).padStart(2, '0');
        const period: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
        let h12 = h % 12;
        if (h12 === 0) h12 = 12;
        return { hour12: h12, minuteStr: safeM, period };
    };

    const { hour12, minuteStr, period } = parse24(value);

    // Reconstruct 24-hr string
    const emitChange = (h12: number, mStr: string, p: 'AM' | 'PM') => {
        let h24 = h12 % 12;
        if (p === 'PM') h24 += 12;
        const safeM = String(mStr).padStart(2, '0');
        onChange(`${String(h24).padStart(2, '0')}:${safeM}`);
    };

    // Close on outside click or Escape
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
                setShowHourPicker(false);
                setShowMinutePicker(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setShowHourPicker(false);
                setShowMinutePicker(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const handleHourSelect = (selectedH: number) => {
        emitChange(selectedH, minuteStr, period);
        setShowHourPicker(false);
        setShowMinutePicker(true); // Smooth auto-advance to minute selection
    };

    const handleMinuteSelect = (selectedM: string) => {
        emitChange(hour12, selectedM, period);
        setShowMinutePicker(false);
    };

    const handlePeriodChange = (newP: 'AM' | 'PM') => {
        if (newP === period) return;
        emitChange(hour12, minuteStr, newP);
    };

    return (
        <div className="relative w-full" ref={pickerRef}>
            <div className="flex items-center gap-2">
                {/* Main display input container */}
                <div className="flex-1 flex items-center bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold shadow-xs hover:border-slate-400 transition-colors focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary">
                    <Clock className="w-4 h-4 text-slate-400 mr-2 flex-shrink-0" />

                    {/* Hour trigger */}
                    <button
                        type="button"
                        onClick={() => {
                            setShowHourPicker(prev => !prev);
                            setShowMinutePicker(false);
                        }}
                        className={`px-2 py-1 rounded-lg text-slate-800 hover:bg-slate-100 font-mono transition-colors text-sm md:text-base font-extrabold ${
                            showHourPicker ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-400' : ''
                        }`}
                        title="Click to select Hour"
                    >
                        {String(hour12).padStart(2, '0')}
                    </button>

                    <span className="text-slate-400 font-bold px-0.5 select-none">:</span>

                    {/* Minute trigger */}
                    <button
                        type="button"
                        onClick={() => {
                            setShowMinutePicker(prev => !prev);
                            setShowHourPicker(false);
                        }}
                        className={`px-2 py-1 rounded-lg text-slate-800 hover:bg-slate-100 font-mono transition-colors text-sm md:text-base font-extrabold ${
                            showMinutePicker ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-400' : ''
                        }`}
                        title="Click to select Minute"
                    >
                        {minuteStr}
                    </button>

                    <div className="ml-auto pl-2">
                        <span className="text-xs font-mono font-bold text-slate-400">
                            IST
                        </span>
                    </div>
                </div>

                {/* AM / PM Toggle buttons side-by-side */}
                <div className="flex items-center p-1 bg-slate-200/80 rounded-xl border border-slate-300/80 shadow-xs flex-shrink-0">
                    <button
                        type="button"
                        onClick={() => handlePeriodChange('AM')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black tracking-wider transition-all ${
                            period === 'AM'
                                ? 'bg-slate-900 text-white shadow-xs'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                        }`}
                    >
                        AM
                    </button>
                    <button
                        type="button"
                        onClick={() => handlePeriodChange('PM')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black tracking-wider transition-all ${
                            period === 'PM'
                                ? 'bg-slate-900 text-white shadow-xs'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                        }`}
                    >
                        PM
                    </button>
                </div>
            </div>

            {/* Popover Grid: Hours (1 to 12) */}
            {showHourPicker && (
                <div className="absolute top-full left-0 mt-2 z-50 w-64 bg-white border border-slate-200 rounded-2xl p-3 shadow-xl animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                        <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                            Select Hour
                        </span>
                        <span className="text-xs font-bold text-slate-700 font-mono">
                            {period}
                        </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(h => (
                            <button
                                key={h}
                                type="button"
                                onClick={() => handleHourSelect(h)}
                                className={`h-10 rounded-xl text-sm font-bold font-mono transition-all flex items-center justify-center ${
                                    hour12 === h
                                        ? 'bg-primary text-white shadow-sm shadow-primary/30 font-black scale-105'
                                        : 'bg-slate-50 hover:bg-slate-100 text-slate-700 active:scale-95'
                                }`}
                            >
                                {h}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Popover Grid: Minutes (00 to 55 + exact minute field) */}
            {showMinutePicker && (
                <div className="absolute top-full left-0 mt-2 z-50 w-72 bg-white border border-slate-200 rounded-2xl p-3 shadow-xl animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                        <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                            Select Minute
                        </span>
                        <span className="text-xs font-bold text-slate-700 font-mono">
                            {hour12}:{minuteStr} {period}
                        </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                        {['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].map(m => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => handleMinuteSelect(m)}
                                className={`h-10 rounded-xl text-sm font-bold font-mono transition-all flex items-center justify-center ${
                                    minuteStr === m
                                        ? 'bg-primary text-white shadow-sm shadow-primary/30 font-black scale-105'
                                        : 'bg-slate-50 hover:bg-slate-100 text-slate-700 active:scale-95'
                                }`}
                            >
                                :{m}
                            </button>
                        ))}
                    </div>
                    {/* Exact Minute Input */}
                    <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-slate-500">Exact Minute:</span>
                        <div className="flex items-center gap-1.5">
                            <input
                                type="number"
                                min="0"
                                max="59"
                                defaultValue={minuteStr}
                                placeholder="00-59"
                                className="w-16 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-center focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                                onChange={(e) => {
                                    const val = parseInt(e.target.value, 10);
                                    if (!isNaN(val) && val >= 0 && val <= 59) {
                                        emitChange(hour12, String(val).padStart(2, '0'), period);
                                    }
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowMinutePicker(false)}
                                className="px-2.5 py-1 bg-slate-900 text-white rounded-lg text-[10px] font-bold hover:bg-slate-800 transition-colors"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// The staged intro plays once per page load; coming back to this screen shows it fully drawn.
let controlCenterIntroPlayed = false;

export default function TaskManagerTestingDashboard({ orgId }: { orgId?: string }) {
    const [employees, setEmployees] = useState<EmployeeItem[]>([]);
    const [departments, setDepartments] = useState<DepartmentItem[]>([]);
    const [departmentSummaries, setDepartmentSummaries] = useState<Record<string, DepartmentSummaryItem>>({});
    const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>('');
    const [deptFilterScope, setDeptFilterScope] = useState<'department' | 'all'>('department');
    const [techSummary, setTechSummary] = useState<TechSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
    const [sendKickoff, setSendKickoff] = useState(true);

    // Cron Schedule & Multi-Rule Engine State
    const [cronTiming, setCronTiming] = useState('09:00');
    const [cronEnabled, setCronEnabled] = useState(true);
    const [whitelistEnabled, setWhitelistEnabled] = useState(false);
    const [cronLastRunDate, setCronLastRunDate] = useState<string | null>(null);
    const [cronLastRunSummary, setCronLastRunSummary] = useState<string | null>(null);
    const [savingSchedule, setSavingSchedule] = useState(false);
    const [triggerLoading, setTriggerLoading] = useState(false);
    const [dryRunMode, setDryRunMode] = useState(true);
    const [currentISTDisplay, setCurrentISTDisplay] = useState('');

    // Phase 4: Multi-Rule Notification Management State
    const [rules, setRules] = useState<NotificationRule[]>([]);
    const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
    const [actionRuleId, setActionRuleId] = useState<string | null>(null);
    const [showAddRuleModal, setShowAddRuleModal] = useState<boolean>(false);
    const [ruleEditState, setRuleEditState] = useState<Record<string, NotificationRule>>({});
    const [newRuleForm, setNewRuleForm] = useState<{
        name: string;
        ruleType: NotificationRuleType;
        targetTimeIST: string;
        daysOfWeek: number[];
        taskFilters: NotificationTaskFilters;
        conditions: NotificationConditions;
        customTemplate: NotificationCustomTemplate;
    }>({
        name: 'Midday Progress Check-in',
        ruleType: 'pending_reminder',
        targetTimeIST: '14:00',
        daysOfWeek: [1, 2, 3, 4, 5, 6],
        taskFilters: {
            includeTodayFixed: true,
            includeTodayAssigned: true,
            includeYesterdayPending: true,
            lookbackDays: 1,
            onlyPending: true
        },
        conditions: {
            skipIfZeroTasks: true,
            requirePendingOnly: true
        },
        customTemplate: {
            headerGreeting: 'Hello {{firstName}}! 📋 Here is your afternoon task check-in:',
            customMessage: '',
            footerInstruction: 'Keep up the momentum! 🔥',
            includeQuickReplies: true
        }
    });

    // Phase 5: Notification History & Audit Trail State
    const [auditLogs, setAuditLogs] = useState<any[]>([]);
    const [loadingLogs, setLoadingLogs] = useState<boolean>(false);
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
    const [copiedLogId, setCopiedLogId] = useState<string | null>(null);

    // Phase 2: Multi-Level WhatsApp Kill Switches State
    const [killSwitches, setKillSwitches] = useState<WhatsAppKillSwitches>({
        globalHalt: false,
        haltReason: null,
        haltedAt: null,
        haltedBy: null,
        departmentHalt: {},
        messageTypeHalt: {
            morning_digest: false,
            pending_reminder: false,
            eod_summary: false,
            overdue_alert: false,
            manager_kickoff: false,
            employee_kickoff: false,
        },
    });
    const [killSwitchLoading, setKillSwitchLoading] = useState<boolean>(false);

    // Step 1: Pretend Mode (safe default ON: no Task Manager WhatsApp message is delivered)
    const [whatsappPretendMode, setWhatsappPretendMode] = useState<boolean>(true);

    // Phase 4: Department Roster & Transfer State
    const [rosterSearchQuery, setRosterSearchQuery] = useState('');
    const [transferModal, setTransferModal] = useState<{
        isOpen: boolean;
        employee: EmployeeItem | null;
        targetDeptId: string;
        keepRole: boolean;
    }>({
        isOpen: false,
        employee: null,
        targetDeptId: '',
        keepRole: false
    });
    const [showAddMemberModal, setShowAddMemberModal] = useState(false);
    const [addMemberEmployeeId, setAddMemberEmployeeId] = useState('');

    // Phase 6: Safety Confirmation Dialog State
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        confirmLabel: string;
        confirmColor: 'rose' | 'amber' | 'primary';
        onConfirm: () => void;
    }>({
        isOpen: false,
        title: '',
        message: '',
        confirmLabel: 'Confirm',
        confirmColor: 'primary',
        onConfirm: () => {}
    });

    // Phase 6: Activity Audit Log Category Filters
    const [auditFilterCategory, setAuditFilterCategory] = useState<'all' | 'whatsapp' | 'safety' | 'roster'>('all');

    useEffect(() => {
        const updateIST = () => {
            const now = new Date();
            const timeStr = now.toLocaleTimeString('en-US', {
                timeZone: 'Asia/Kolkata',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
            setCurrentISTDisplay(timeStr);
        };
        updateIST();
        const interval = setInterval(updateIST, 1000);
        return () => clearInterval(interval);
    }, []);

    const setTimeOffset = (minutesAhead: number) => {
        const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        d.setMinutes(d.getMinutes() + minutesAhead);
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        setCronTiming(`${h}:${m}`);
    };

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
                if (data.departments) {
                    setDepartments(data.departments);
                }
                if (data.departmentSummaries) {
                    setDepartmentSummaries(data.departmentSummaries);
                }
                if (data.killSwitches) {
                    setKillSwitches(data.killSwitches);
                }

                // Auto-select Tech or first department if none selected
                if (!selectedDepartmentId) {
                    const tech = (data.departments || []).find((d: any) => d.name.toLowerCase() === 'tech');
                    if (tech) setSelectedDepartmentId(tech.id);
                    else if (data.departments?.[0]) setSelectedDepartmentId(data.departments[0].id);
                }

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

            // Load Testing & Notification Rules Configuration
            try {
                const configRes = await fetch('/api/task-manager/testing-config');
                const configData = await configRes.json();
                if (configData.success && configData.config) {
                    setCronTiming(configData.config.cronTiming || '09:00');
                    setCronEnabled(configData.config.cronEnabled !== false);
                    setWhitelistEnabled(Boolean(configData.config.enabled));
                    setCronLastRunDate(configData.config.cronLastRunDate || null);
                    setCronLastRunSummary(configData.config.cronLastRunSummary || null);
                    
                    if (configData.config.killSwitches) {
                        setKillSwitches(configData.config.killSwitches);
                    }
                    setWhatsappPretendMode(configData.config.whatsappPretendMode !== false);

                    const fetchedRules = configData.config.rules || [];
                    setRules(fetchedRules);
                    const editMap: Record<string, NotificationRule> = {};
                    fetchedRules.forEach((r: NotificationRule) => {
                        editMap[r.id] = JSON.parse(JSON.stringify(r));
                    });
                    setRuleEditState(editMap);

                    if (configData.logs && Array.isArray(configData.logs)) {
                        setAuditLogs(configData.logs);
                    }
                }
            } catch (cfgErr) {
                console.warn('[TaskManagerTestingDashboard] Failed to load testing config:', cfgErr);
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

    // ── Phase 2: Kill Switch Actions Handlers ──────────────────────────────
    const handleToggleGlobalKillSwitch = (halt: boolean) => {
        if (halt) {
            setConfirmModal({
                isOpen: true,
                title: '🛑 EMERGENCY: Stop All WhatsApp Messages?',
                message: 'Are you sure you want to STOP ALL WHATSAPP MESSAGES COMPANY-WIDE? This will immediately halt all automated digests, reminders, kickoffs, and cron jobs across every department.',
                confirmLabel: 'STOP ALL MESSAGES',
                confirmColor: 'rose',
                onConfirm: async () => {
                    setConfirmModal(prev => ({ ...prev, isOpen: false }));
                    await executeGlobalKillSwitch(true);
                }
            });
            return;
        }
        executeGlobalKillSwitch(false);
    };

    const executeGlobalKillSwitch = async (halt: boolean) => {
        setKillSwitchLoading(true);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'toggle_global_kill_switch',
                    halt,
                    reason: halt ? 'Emergency stop engaged by administrator' : null,
                    actor: 'Admin'
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to toggle global kill switch');

            if (data.killSwitches) setKillSwitches(data.killSwitches);
            setStatusMessage({
                type: halt ? 'error' : 'success',
                title: halt ? '🛑 Global WhatsApp Kill Switch ENGAGED' : '🟢 Global WhatsApp Messaging RESUMED',
                details: data.message
            });
            await fetchData();
        } catch (err: any) {
            setStatusMessage({ type: 'error', title: 'Kill Switch Action Failed', details: err.message });
        } finally {
            setKillSwitchLoading(false);
        }
    };

    const handleToggleDepartmentKillSwitch = async (deptId: string, halt: boolean) => {
        setKillSwitchLoading(true);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'toggle_department_kill_switch',
                    departmentId: deptId,
                    halt
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to toggle department kill switch');

            if (data.killSwitches) setKillSwitches(data.killSwitches);
            const deptName = departments.find(d => d.id === deptId)?.name || 'Department';
            setStatusMessage({
                type: halt ? 'error' : 'success',
                title: halt ? `⏸️ ${deptName} WhatsApp Paused` : `▶️ ${deptName} WhatsApp Active`,
                details: data.message
            });
            await fetchData();
        } catch (err: any) {
            setStatusMessage({ type: 'error', title: 'Department Toggle Failed', details: err.message });
        } finally {
            setKillSwitchLoading(false);
        }
    };

    const handleToggleMessageTypeKillSwitch = async (messageType: string, halt: boolean) => {
        setKillSwitchLoading(true);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'toggle_message_type_kill_switch',
                    messageType,
                    halt
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to toggle category');

            if (data.killSwitches) setKillSwitches(data.killSwitches);
            setStatusMessage({
                type: 'success',
                title: `Message Category '${messageType}' ${halt ? 'Paused' : 'Resumed'}`,
                details: data.message
            });
            await fetchData();
        } catch (err: any) {
            setStatusMessage({ type: 'error', title: 'Category Toggle Failed', details: err.message });
        } finally {
            setKillSwitchLoading(false);
        }
    };

    // ── Step 1: Pretend Mode toggle ────────────────────────────────────────
    const executePretendMode = async (enabled: boolean) => {
        setKillSwitchLoading(true);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'toggle_pretend_mode',
                    enabled,
                    confirm: true,
                    actor: 'Admin'
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to change Pretend Mode');

            setWhatsappPretendMode(enabled);
            setStatusMessage({
                type: enabled ? 'success' : 'error',
                title: enabled ? '🛡️ Pretend Mode ON' : '⚠️ Pretend Mode OFF',
                details: data.message
            });
            await fetchData();
        } catch (err: any) {
            setStatusMessage({ type: 'error', title: 'Pretend Mode Change Failed', details: err.message });
        } finally {
            setKillSwitchLoading(false);
        }
    };

    const handleTogglePretendMode = (enabled: boolean) => {
        if (!enabled) {
            setConfirmModal({
                isOpen: true,
                title: '⚠️ Turn OFF Pretend Mode?',
                message: 'With Pretend Mode OFF, Task Manager WhatsApp messages can be delivered to real phones again (the kill switches and the sandbox whitelist still apply). Only continue if you are sure the system is ready to send.',
                confirmLabel: 'Turn OFF Pretend Mode',
                confirmColor: 'rose',
                onConfirm: async () => {
                    setConfirmModal(prev => ({ ...prev, isOpen: false }));
                    await executePretendMode(false);
                }
            });
            return;
        }
        executePretendMode(true);
    };

    // ── Phase 3: Reporting Manager Direct Actions ─────────────────────────
    const handleSendManagerKickoffDirect = (managerId: string) => {
        const mgr = employees.find(e => e.id === managerId);
        if (!mgr) return;
        setConfirmModal({
            isOpen: true,
            title: `Dispatch Manager Kickoff?`,
            message: `Send official Meta-approved kickoff template (tm_manager_kickoff_v1) to ${mgr.first_name} on ${mgr.phone || 'registered phone'}? This will open their 24h interactive session.`,
            confirmLabel: 'Send Manager Kickoff',
            confirmColor: 'primary',
            onConfirm: async () => {
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                setActionLoading(true);
                setStatusMessage(null);
                try {
                    const res = await fetch('/api/task-manager/manager-role', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            employeeId: managerId,
                            action: 'send_manager_kickoff'
                        })
                    });
                    const data = await res.json();
                    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to dispatch kickoff');
                    setStatusMessage({
                        type: 'success',
                        title: data.pretend ? '🛡️ Pretend Mode: Manager Kickoff NOT sent' : 'Manager Kickoff Dispatched 👑',
                        details: data.message
                    });
                    await fetchData();
                } catch (err: any) {
                    setStatusMessage({ type: 'error', title: 'Kickoff Dispatch Failed', details: err.message });
                } finally {
                    setActionLoading(false);
                }
            }
        });
    };

    const handleRemoveManagerRole = (managerId: string, managerName: string) => {
        setConfirmModal({
            isOpen: true,
            title: `Step Down Reporting Manager?`,
            message: `Are you sure you want to revert ${managerName} back to a standard Employee? They will no longer have manager kickoff or report permissions.`,
            confirmLabel: 'Revert to Employee',
            confirmColor: 'amber',
            onConfirm: async () => {
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                setActionLoading(true);
                setStatusMessage(null);
                try {
                    const res = await fetch('/api/task-manager/manager-role', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            employeeId: managerId,
                            action: 'remove_manager'
                        })
                    });
                    const data = await res.json();
                    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to revert role');
                    setStatusMessage({
                        type: 'success',
                        title: 'Role Updated',
                        details: data.message
                    });
                    await fetchData();
                } catch (err: any) {
                    setStatusMessage({ type: 'error', title: 'Role Update Failed', details: err.message });
                } finally {
                    setActionLoading(false);
                }
            }
        });
    };

    const handleAssignManagerDirect = async (employeeId: string) => {
        const emp = employees.find(e => e.id === employeeId);
        if (!emp) return;
        setActionLoading(true);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/manager-role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employeeId,
                    action: 'assign_manager',
                    sendKickoff: true
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to assign manager');
            setStatusMessage({
                type: 'success',
                title: 'Reporting Manager Assigned 👑',
                details: data.message
            });
            await fetchData();
        } catch (err: any) {
            setStatusMessage({ type: 'error', title: 'Assignment Failed', details: err.message });
        } finally {
            setActionLoading(false);
        }
    };

    // ── Phase 4: Employee Department Transfer Actions ────────────────────
    const handleTransferEmployeeSubmit = async () => {
        if (!transferModal.employee || !transferModal.targetDeptId) return;
        const emp = transferModal.employee;
        setActionLoading(true);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/manager-role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employeeId: emp.id,
                    action: 'transfer_department',
                    targetDepartmentId: transferModal.targetDeptId,
                    keepRole: transferModal.keepRole
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to transfer employee');
            setStatusMessage({
                type: 'success',
                title: 'Employee Transferred Successfully ⇄',
                details: data.message
            });
            setTransferModal({ isOpen: false, employee: null, targetDeptId: '', keepRole: false });
            await fetchData();
        } catch (err: any) {
            setStatusMessage({ type: 'error', title: 'Transfer Failed', details: err.message });
        } finally {
            setActionLoading(false);
        }
    };

    const handleAddMemberSubmit = async () => {
        if (!addMemberEmployeeId || !currentDepartment) return;
        setActionLoading(true);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/manager-role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employeeId: addMemberEmployeeId,
                    action: 'transfer_department',
                    targetDepartmentId: currentDepartment.id,
                    keepRole: false
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to add member to department');
            setStatusMessage({
                type: 'success',
                title: 'Member Added to Department 👥',
                details: data.message
            });
            setShowAddMemberModal(false);
            setAddMemberEmployeeId('');
            await fetchData();
        } catch (err: any) {
            setStatusMessage({ type: 'error', title: 'Add Member Failed', details: err.message });
        } finally {
            setActionLoading(false);
        }
    };

    const handleSendEmployeeKickoffDirect = (emp: EmployeeItem) => {
        setConfirmModal({
            isOpen: true,
            title: `Dispatch Employee Kickoff?`,
            message: `Send official Meta-approved Employee Kickoff template (tm_employee_kickoff_v1) to ${emp.first_name} ${emp.last_name || ''} on ${emp.phone || 'registered phone'}?`,
            confirmLabel: 'Send Kickoff Template',
            confirmColor: 'primary',
            onConfirm: async () => {
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                setActionLoading(true);
                setStatusMessage(null);
                try {
                    const res = await fetch('/api/task-manager/manager-role', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            employeeId: emp.id,
                            action: 'send_employee_kickoff'
                        })
                    });
                    const data = await res.json();
                    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to dispatch kickoff');
                    setStatusMessage({
                        type: 'success',
                        title: data.pretend ? '🛡️ Pretend Mode: Employee Kickoff NOT sent' : 'Employee Kickoff Dispatched 📨',
                        details: data.message
                    });
                    await fetchData();
                } catch (err: any) {
                    setStatusMessage({ type: 'error', title: 'Kickoff Failed', details: err.message });
                } finally {
                    setActionLoading(false);
                }
            }
        });
    };

    // ── Phase 5: Department Dry-Run Simulation Trigger ───────────────────
    const handleSimulateDepartmentRun = async () => {
        if (!currentDepartment) return;
        setTriggerLoading(true);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'trigger_dispatch',
                    departmentId: currentDepartment.id,
                    dryRun: true
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to simulate');
            setStatusMessage({
                type: 'success',
                title: `🛡️ ${currentDepartment.name} Simulation Completed`,
                details: data.message
            });
            await fetchAuditLogs();
        } catch (err: any) {
            setStatusMessage({ type: 'error', title: 'Simulation Failed', details: err.message });
        } finally {
            setTriggerLoading(false);
        }
    };

    const handleSaveSchedule = async () => {
        if (!cronTiming || !/^\d{1,2}:\d{2}$/.test(cronTiming.trim())) {
            setStatusMessage({
                type: 'error',
                title: 'Invalid Time Selected',
                details: 'Please enter a valid dispatch time in HH:mm format (e.g., 09:00 or 12:45).'
            });
            return;
        }
        setSavingSchedule(true);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cronTiming,
                    cronEnabled,
                    enabled: whitelistEnabled,
                    employees: whitelistEnabled
                        ? [{ name: 'Sahil Gorde', phone: '8433649199' }]
                        : []
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save schedule');
            setStatusMessage({
                type: 'success',
                title: 'Schedule Updated Successfully',
                details: `Cron timing set to ${cronTiming} IST. Master status: ${cronEnabled ? 'Active' : 'Paused'}. Whitelist: ${whitelistEnabled ? 'ON (Only Sahil Gorde)' : 'OFF (All Tech Staff)'}.`
            });
        } catch (err: any) {
            setStatusMessage({
                type: 'error',
                title: 'Failed to update schedule',
                details: err.message
            });
        } finally {
            setSavingSchedule(false);
        }
    };

    const handleManualTrigger = async (action: 'trigger_generate' | 'trigger_dispatch') => {
        setTriggerLoading(true);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    dryRun: dryRunMode
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to trigger run');

            setStatusMessage({
                type: 'success',
                title: action === 'trigger_generate' ? 'Task Generation Completed' : 'Morning Notification Run Completed',
                details: data.message
            });

            await fetchData();
        } catch (err: any) {
            setStatusMessage({
                type: 'error',
                title: 'Trigger Execution Failed',
                details: err.message
            });
        } finally {
            setTriggerLoading(false);
        }
    };

    const [resettingRun, setResettingRun] = useState(false);

    const handleResetRunDate = async () => {
        setResettingRun(true);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cronLastRunDate: null,
                    cronLastRunSummary: null
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to reset run date');

            setStatusMessage({
                type: 'success',
                title: 'Schedule Armed for Retesting',
                details: 'Today\'s run stamp has been cleared. The automated cron is now ready to trigger again!'
            });

            await fetchData();
        } catch (err: any) {
            setStatusMessage({
                type: 'error',
                title: 'Reset Failed',
                details: err.message
            });
        } finally {
            setResettingRun(false);
        }
    };

    // ── Phase 4: Granular Rule Management Handlers ─────────────────────────
    const handleToggleRule = async (rule: NotificationRule) => {
        const nextEnabled = !rule.enabled;
        setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: nextEnabled } : r));
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_rule',
                    ruleId: rule.id,
                    updates: { enabled: nextEnabled }
                })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
        } catch (err: any) {
            setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: rule.enabled } : r));
            setStatusMessage({ type: 'error', title: 'Failed to toggle rule', details: err.message });
        }
    };

    const handleUpdateRuleTime = async (ruleId: string, newTiming: string) => {
        setRules(prev => prev.map(r => r.id === ruleId ? { ...r, targetTimeIST: newTiming } : r));
        try {
            await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_rule',
                    ruleId,
                    updates: { targetTimeIST: newTiming }
                })
            });
            if (ruleId === 'rule_morning_digest') setCronTiming(newTiming);
        } catch (err: any) {
            console.error('Failed to update timing:', err);
        }
    };

    const handleQuickOffset = async (ruleId: string, minutesAhead: number) => {
        const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        d.setMinutes(d.getMinutes() + minutesAhead);
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        const newTime = `${h}:${m}`;
        await handleUpdateRuleTime(ruleId, newTime);
        setStatusMessage({
            type: 'success',
            title: `Timing Set to ${newTime} IST`,
            details: `Rule scheduled for ${minutesAhead} minute(s) from current IST. Automated cron will trigger it.`
        });
    };

    const handleToggleDay = async (rule: NotificationRule, dayNum: number) => {
        const currentDays = rule.daysOfWeek || [];
        const nextDays = currentDays.includes(dayNum)
            ? currentDays.filter(d => d !== dayNum)
            : [...currentDays, dayNum].sort((a, b) => a - b);
        
        setRules(prev => prev.map(r => r.id === rule.id ? { ...r, daysOfWeek: nextDays } : r));
        try {
            await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_rule',
                    ruleId: rule.id,
                    updates: { daysOfWeek: nextDays }
                })
            });
        } catch (err: any) {
            console.error('Failed to update active days:', err);
        }
    };

    const handleTriggerRule = async (ruleId: string, dryRun: boolean) => {
        setActionRuleId(ruleId);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'trigger_dispatch',
                    ruleId,
                    dryRun
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to dispatch rule');

            setStatusMessage({
                type: 'success',
                title: dryRun ? '🛡️ Dry-Run Simulation Completed' : '⚡ Live Rule Dispatched',
                details: data.message
            });
            await fetchData();
        } catch (err: any) {
            setStatusMessage({
                type: 'error',
                title: 'Rule Trigger Failed',
                details: err.message
            });
        } finally {
            setActionRuleId(null);
        }
    };

    const handleResetRule = async (ruleId: string) => {
        setActionRuleId(ruleId);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'reset_rule',
                    ruleId
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to reset rule');

            setStatusMessage({
                type: 'success',
                title: 'Rule Run Status Reset',
                details: 'Today\'s run stamp has been cleared. The rule is re-armed and ready to fire again!'
            });
            await fetchData();
        } catch (err: any) {
            setStatusMessage({
                type: 'error',
                title: 'Reset Failed',
                details: err.message
            });
        } finally {
            setActionRuleId(null);
        }
    };

    const handleResetAllRules = async () => {
        setActionLoading(true);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'reset_rule',
                    ruleId: 'all'
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to reset all rules');

            setStatusMessage({
                type: 'success',
                title: 'All Rules Reset for Today',
                details: 'All notification schedules are re-armed and ready to fire again today.'
            });
            await fetchData();
        } catch (err: any) {
            setStatusMessage({
                type: 'error',
                title: 'Reset Failed',
                details: err.message
            });
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteRule = async (ruleId: string, ruleName: string) => {
        if (!window.confirm(`Are you sure you want to delete notification rule "${ruleName}"?`)) return;
        setActionLoading(true);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete_rule',
                    ruleId
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to delete rule');

            setStatusMessage({
                type: 'success',
                title: 'Rule Deleted',
                details: `Notification rule "${ruleName}" has been removed.`
            });
            if (expandedRuleId === ruleId) setExpandedRuleId(null);
            await fetchData();
        } catch (err: any) {
            setStatusMessage({
                type: 'error',
                title: 'Delete Failed',
                details: err.message
            });
        } finally {
            setActionLoading(false);
        }
    };

    const handleSaveRuleAdvanced = async (ruleId: string) => {
        const edited = ruleEditState[ruleId];
        if (!edited) return;
        setActionRuleId(ruleId);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_rule',
                    ruleId,
                    updates: {
                        name: edited.name,
                        taskFilters: edited.taskFilters,
                        conditions: edited.conditions,
                        customTemplate: edited.customTemplate
                    }
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save rule settings');

            setStatusMessage({
                type: 'success',
                title: 'Rule Settings Saved',
                details: `Filters, conditions, and custom template updated for "${edited.name}".`
            });
            await fetchData();
        } catch (err: any) {
            setStatusMessage({
                type: 'error',
                title: 'Save Failed',
                details: err.message
            });
        } finally {
            setActionRuleId(null);
        }
    };

    const handleCreateNewRule = async () => {
        if (!newRuleForm.name.trim()) {
            setStatusMessage({ type: 'error', title: 'Rule Name Required', details: 'Please enter a name for the rule.' });
            return;
        }
        setActionLoading(true);
        setStatusMessage(null);
        const ruleId = `rule_${Date.now()}`;
        const newRule: NotificationRule = {
            id: ruleId,
            name: newRuleForm.name.trim(),
            enabled: true,
            targetTimeIST: newRuleForm.targetTimeIST,
            daysOfWeek: newRuleForm.daysOfWeek,
            ruleType: newRuleForm.ruleType,
            taskFilters: newRuleForm.taskFilters,
            conditions: newRuleForm.conditions,
            recipients: { target: 'tech_all', notifyReportingManager: true },
            customTemplate: newRuleForm.customTemplate,
            lastRunDate: null,
            lastRunSummary: null
        };

        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_rule',
                    ruleId,
                    updates: newRule
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create rule');

            setShowAddRuleModal(false);
            setStatusMessage({
                type: 'success',
                title: 'Notification Rule Created',
                details: `Rule "${newRule.name}" configured and active at ${newRule.targetTimeIST} IST.`
            });
            await fetchData();
        } catch (err: any) {
            setStatusMessage({ type: 'error', title: 'Creation Failed', details: err.message });
        } finally {
            setActionLoading(false);
        }
    };

    const handleMasterWhitelistToggle = async (nextVal: boolean) => {
        setWhitelistEnabled(nextVal);
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enabled: nextVal,
                    employees: nextVal
                        ? [{ name: 'Sahil Gorde', phone: '8433649199' }]
                        : []
                })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            setStatusMessage({
                type: 'success',
                title: nextVal ? '🔒 Whitelist Protection Enabled' : '👥 Whitelist Protection Disabled',
                details: nextVal
                    ? 'All automated digests and test runs strictly target Sahil Gorde (8433649199).'
                    : 'Caution: Outbound notifications will go to all Tech team members.'
            });
        } catch (err: any) {
            setWhitelistEnabled(!nextVal);
            setStatusMessage({ type: 'error', title: 'Failed to update whitelist', details: err.message });
        }
    };

    const handleMasterCronToggle = async () => {
        const nextVal = !cronEnabled;
        setCronEnabled(nextVal);
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cronEnabled: nextVal })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            setStatusMessage({
                type: 'success',
                title: nextVal ? '⚡ Automated Heartbeat Resumed' : '⏸️ Automated Heartbeat Paused',
                details: nextVal ? 'Scheduled notification rules will trigger on time.' : 'All automated cron checks are currently halted.'
            });
        } catch (err: any) {
            setCronEnabled(!nextVal);
            setStatusMessage({ type: 'error', title: 'Failed to toggle heartbeat', details: err.message });
        }
    };

    const fetchAuditLogs = async () => {
        setLoadingLogs(true);
        try {
            const res = await fetch('/api/task-manager/testing-config');
            const data = await res.json();
            if (data.success && data.logs) {
                setAuditLogs(data.logs);
            }
        } catch (err) {
            console.warn('[TaskManagerTestingDashboard] Failed to fetch audit logs:', err);
        } finally {
            setLoadingLogs(false);
        }
    };

    const handleClearLogs = () => {
        setConfirmModal({
            isOpen: true,
            title: 'Clear Activity Audit Trail?',
            message: 'Are you sure you want to clear all notification dispatch and safety audit records from the database? This action cannot be undone.',
            confirmLabel: 'Clear All Trail',
            confirmColor: 'rose',
            onConfirm: async () => {
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                setLoadingLogs(true);
                try {
                    const res = await fetch('/api/task-manager/testing-config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'clear_logs' })
                    });
                    const data = await res.json();
                    if (data.success) {
                        setAuditLogs([]);
                        setStatusMessage({
                            type: 'success',
                            title: 'Audit Logs Cleared',
                            details: 'Notification dispatch audit history has been successfully reset.'
                        });
                    }
                } catch (err: any) {
                    setStatusMessage({
                        type: 'error',
                        title: 'Failed to clear logs',
                        details: err?.message
                    });
                } finally {
                    setLoadingLogs(false);
                }
            }
        });
    };

    const handleCopyLogPreview = (logId: string, text: string) => {
        if (navigator?.clipboard) {
            navigator.clipboard.writeText(text);
            setCopiedLogId(logId);
            setTimeout(() => setCopiedLogId(null), 2000);
        }
    };

    const formatISTTime = (isoString?: string) => {
        if (!isoString) return 'Just now';
        try {
            const d = new Date(isoString);
            return d.toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
        } catch {
            return isoString;
        }
    };

    const [animationStep, setAnimationStep] = useState(controlCenterIntroPlayed ? 5 : 0);

    useEffect(() => {
        fetchData();
    }, []);

    useEffect(() => {
        // The intro plays once per page load; later visits show everything at once
        if (controlCenterIntroPlayed) {
            setAnimationStep(5);
            return;
        }
        if (loading) {
            setAnimationStep(0);
            return;
        }

        setAnimationStep(0);
        const t1 = setTimeout(() => setAnimationStep(1), 50);
        const t2 = setTimeout(() => setAnimationStep(2), 150);
        const t3 = setTimeout(() => setAnimationStep(3), 280);
        const t4 = setTimeout(() => setAnimationStep(4), 400);
        const t5 = setTimeout(() => { setAnimationStep(5); controlCenterIntroPlayed = true; }, 520);

        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
            clearTimeout(t3);
            clearTimeout(t4);
            clearTimeout(t5);
        };
    }, [loading]);

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

    // Sleek Loading State matching Task Manager
    if (loading) {
        return (
            <div className="w-full min-h-[480px] flex flex-col items-center justify-center p-8 text-center space-y-4 tm-root max-w-[1600px] mx-auto" style={{ zoom: '0.85' }}>
                <div className="relative flex items-center justify-center">
                    <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200/60 flex items-center justify-center shadow-xl shadow-amber-500/10">
                        <FlaskConical className="w-8 h-8 text-amber-600 animate-pulse" />
                    </div>
                    <div className="absolute -inset-2.5 border-2 border-amber-500/20 border-t-amber-600 rounded-3xl animate-spin" />
                </div>
                <div className="space-y-1">
                    <h3 className="text-base font-bold text-slate-800">
                        Loading Task Testing Hub...
                    </h3>
                    <p className="text-xs text-slate-400">
                        Syncing live employee roles, whitelist config & automated cron schedule
                    </p>
                </div>
            </div>
        );
    }

    // ── Phase 1: Dynamic Department & Org-wide Computations ─────────────────
    const currentDepartment = departments.find(d => d.id === selectedDepartmentId) || 
        departments.find(d => d.name.toLowerCase() === 'tech') || 
        departments[0] || null;

    const currentDepartmentSummary: DepartmentSummaryItem = (currentDepartment && departmentSummaries[currentDepartment.id]) || {
        id: currentDepartment?.id || '94a74961-2dd8-453d-9728-f6f2b9ade99b',
        name: currentDepartment?.name || 'Tech',
        code: currentDepartment?.code || 'TECH',
        manager: techSummary?.manager || null,
        members: techSummary?.members || [],
        memberCount: techSummary?.members?.length || 0,
        whatsappStatus: 'active',
        rulesCount: 3
    };

    const departmentMembers = (employees || []).filter(e => 
        e.department_id === currentDepartment?.id ||
        (e.department && currentDepartment && e.department.toLowerCase() === currentDepartment.name.toLowerCase())
    );

    const displayedEmployees = deptFilterScope === 'department' && departmentMembers.length > 0
        ? departmentMembers
        : employees;

    const totalDepartmentsCount = departments.length || 14;
    const totalEmployeesCount = employees.length || 124;
    const totalManagersCount = employees.filter(e => e.task_role === 'reporting_manager').length;
    const isCurrentDeptHalted = Boolean(currentDepartment && (killSwitches.globalHalt || killSwitches.departmentHalt?.[currentDepartment.id]));

    return (
        <div 
            className="w-full space-y-4 p-2 sm:p-4 tm-root overflow-x-hidden max-w-[1600px] mx-auto"
            style={{ zoom: '0.85' }}
        >
            {/* Phase 2: Persistent Emergency Kill Switch Alert Banner */}
            {killSwitches.globalHalt && (
                <div className="bg-gradient-to-r from-rose-600 via-rose-700 to-rose-800 text-white p-4 sm:p-5 rounded-3xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4 border-2 border-rose-400/50 animate-pulse">
                    <div className="flex items-center gap-3.5">
                        <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center font-black text-2xl flex-shrink-0 shadow-inner">
                            🛑
                        </div>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-black text-base uppercase tracking-wider text-white">
                                    Global WhatsApp Kill Switch Engaged
                                </h3>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-black/40 text-rose-200 border border-white/20">
                                    Company-Wide Halt
                                </span>
                            </div>
                            <p className="text-xs text-rose-100 mt-0.5 leading-relaxed">
                                {killSwitches.haltReason || 'All automated WhatsApp messaging, daily task digests, reminders, and employee kickoffs are paused across ALL departments.'}
                                {killSwitches.haltedAt && ` (Engaged at ${formatISTTime(killSwitches.haltedAt)})`}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        disabled={killSwitchLoading}
                        onClick={() => handleToggleGlobalKillSwitch(false)}
                        className="flex items-center justify-center gap-2 px-5 py-2.5 bg-white text-rose-700 hover:bg-rose-50 font-black text-xs uppercase tracking-wider rounded-2xl shadow-lg transition-all cursor-pointer whitespace-nowrap active:scale-95 flex-shrink-0"
                    >
                        <Power className="w-4 h-4 text-emerald-600" />
                        Resume All WhatsApp Messaging
                    </button>
                </div>
            )}

            {/* Step 1: Pretend Mode Banner */}
            {whatsappPretendMode && (
                <div className="bg-gradient-to-r from-indigo-600 via-indigo-700 to-indigo-800 text-white p-4 sm:p-5 rounded-3xl shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4 border border-indigo-400/50">
                    <div className="flex items-center gap-3.5">
                        <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center font-black text-2xl flex-shrink-0 shadow-inner">
                            🛡️
                        </div>
                        <div>
                            <h3 className="font-black text-base uppercase tracking-wider text-white">
                                Pretend Mode ON: no WhatsApp messages are being sent
                            </h3>
                            <p className="text-xs text-indigo-100 mt-0.5 leading-relaxed">
                                Every Task Manager message (digests, replies, kickoffs) is saved to the history below as "Pretend (Not Sent)" and is NOT delivered to anyone.
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        disabled={killSwitchLoading}
                        onClick={() => handleTogglePretendMode(false)}
                        className="flex items-center justify-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white border border-white/30 font-bold text-xs uppercase tracking-wider rounded-2xl transition-all cursor-pointer whitespace-nowrap active:scale-95 flex-shrink-0"
                    >
                        Turn off Pretend Mode…
                    </button>
                </div>
            )}
            {!whatsappPretendMode && (
                <div className="bg-amber-50 border border-amber-300 text-amber-950 p-3 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p className="text-xs font-bold">
                        ⚠️ Pretend Mode is OFF: Task Manager WhatsApp messages can be delivered to real phones (kill switches and sandbox still apply).
                    </p>
                    <button
                        type="button"
                        disabled={killSwitchLoading}
                        onClick={() => handleTogglePretendMode(true)}
                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer whitespace-nowrap"
                    >
                        Turn Pretend Mode ON
                    </button>
                </div>
            )}

            {/* Header Banner */}
            <div className={`bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/20 rounded-3xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 ${animationStep >= 1 ? 'tm-slide-down-visible' : 'tm-slide-down-hidden'}`}>
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-amber-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/30 flex-shrink-0">
                        <Building2 className="w-6 h-6" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
                                Department & WhatsApp Control Center
                            </h1>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-900 text-white">
                                Control Center
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500 text-white">
                                Phase 2: Safety Live
                            </span>
                        </div>
                        <p className="text-slate-500 text-sm mt-0.5">
                            Central command for department rosters, reporting managers, automated WhatsApp messaging, and scheduled notifications.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 self-start md:self-auto">
                    <button
                        type="button"
                        onClick={fetchData}
                        disabled={loading || actionLoading || killSwitchLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-bold text-xs shadow-sm transition-all cursor-pointer"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        Refresh Control Center
                    </button>
                </div>
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

            {/* High-Level Organization Overview Stat Bar */}
            <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 ${animationStep >= 1 ? 'tm-slide-down-visible' : 'tm-slide-down-hidden'}`}>
                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-primary" /> Total Departments
                    </p>
                    <div className="flex items-baseline gap-2">
                        <span className="text-xl font-black text-slate-900">{totalDepartmentsCount}</span>
                        <span className="text-[11px] font-bold text-slate-500">Configured</span>
                    </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-indigo-500" /> Active Managers
                    </p>
                    <div className="flex items-baseline gap-2">
                        <span className="text-xl font-black text-indigo-600">{totalManagersCount}</span>
                        <span className="text-[11px] font-bold text-slate-500">Assigned</span>
                    </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-emerald-500" /> Total Staff
                    </p>
                    <div className="flex items-baseline gap-2">
                        <span className="text-xl font-black text-slate-900">{totalEmployeesCount}</span>
                        <span className="text-[11px] font-bold text-slate-500">Employees</span>
                    </div>
                </div>

                <div className={`border rounded-2xl p-4 shadow-2xs transition-all ${
                    killSwitches.globalHalt
                        ? 'bg-rose-50 border-rose-300'
                        : isCurrentDeptHalted
                            ? 'bg-amber-50 border-amber-300'
                            : 'bg-white border-slate-200'
                }`}>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                        <MessageSquare className={`w-3.5 h-3.5 ${
                            killSwitches.globalHalt ? 'text-rose-600' : isCurrentDeptHalted ? 'text-amber-600' : 'text-emerald-500'
                        }`} /> WhatsApp Channel
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                        <span className={`w-2.5 h-2.5 rounded-full ${
                            killSwitches.globalHalt
                                ? 'bg-rose-600 animate-ping'
                                : isCurrentDeptHalted
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-500 animate-pulse'
                        }`} />
                        <span className={`text-sm font-black uppercase ${
                            killSwitches.globalHalt
                                ? 'text-rose-700'
                                : isCurrentDeptHalted
                                    ? 'text-amber-700'
                                    : 'text-emerald-700'
                        }`}>
                            {killSwitches.globalHalt ? 'HALTED' : isCurrentDeptHalted ? 'PAUSED' : 'ONLINE'}
                        </span>
                    </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs col-span-2 sm:col-span-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-500" /> Scheduled Rules
                    </p>
                    <div className="flex items-baseline gap-2">
                        <span className="text-xl font-black text-amber-600">{rules.filter(r => r.enabled).length}</span>
                        <span className="text-[11px] font-bold text-slate-500">Active</span>
                    </div>
                </div>
            </div>

            {/* ── Phase 2: WhatsApp Kill Switches & Multi-Level Safety Controls Panel ── */}
            <div className={`bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4 ${animationStep >= 2 ? 'tm-slide-up-visible' : 'tm-slide-up-hidden'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                        <ShieldAlert className="w-5 h-5 text-rose-500" />
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">
                                    WhatsApp Kill Switches & Safety Controls
                                </h3>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-200">
                                    Phase 2 Active
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Multi-level controls to halt or isolate automated WhatsApp messaging instantly.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-slate-400 font-bold">Scope:</span>
                        <span className="font-extrabold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-xl">
                            {killSwitches.globalHalt ? 'Company-wide Halt' : 'Targeted Control'}
                        </span>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Zone 1: Master Global Kill Switch */}
                    <div className={`p-4 rounded-2xl border transition-all flex flex-col justify-between ${
                        killSwitches.globalHalt
                            ? 'bg-rose-50/70 border-rose-300 shadow-sm shadow-rose-500/10'
                            : 'bg-emerald-50/40 border-emerald-200'
                    }`}>
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                                    <Power className="w-3.5 h-3.5 text-primary" /> Master Switch
                                </span>
                                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                    killSwitches.globalHalt
                                        ? 'bg-rose-600 text-white border-rose-700'
                                        : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                }`}>
                                    {killSwitches.globalHalt ? '🛑 All Stopped' : '🟢 Bot Active'}
                                </span>
                            </div>
                            <h4 className="font-bold text-sm text-slate-900">
                                Global Emergency Kill Switch
                            </h4>
                            <p className="text-xs text-slate-500 mt-1 leading-snug">
                                {killSwitches.globalHalt
                                    ? 'All automated WhatsApp messaging is halted company-wide. Click below to resume.'
                                    : 'Immediately stops every notification, morning digest, reminder, and kickoff across ALL departments.'}
                            </p>
                        </div>

                        <div className="pt-4">
                            {killSwitches.globalHalt ? (
                                <button
                                    type="button"
                                    disabled={killSwitchLoading}
                                    onClick={() => handleToggleGlobalKillSwitch(false)}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md transition-all cursor-pointer active:scale-98"
                                >
                                    <Power className="w-4 h-4" />
                                    Resume All Messaging 🟢
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    disabled={killSwitchLoading}
                                    onClick={() => handleToggleGlobalKillSwitch(true)}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md transition-all cursor-pointer active:scale-98"
                                >
                                    <Ban className="w-4 h-4" />
                                    STOP ALL WHATSAPP MESSAGES 🛑
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Zone 2: Department-Level Kill Switch */}
                    <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between">
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                                    <Building2 className="w-3.5 h-3.5 text-primary" /> Department Switch
                                </span>
                                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                    isCurrentDeptHalted
                                        ? 'bg-amber-100 text-amber-800 border-amber-300'
                                        : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                }`}>
                                    {isCurrentDeptHalted ? '⏸️ Paused' : '🟢 Active'}
                                </span>
                            </div>
                            <h4 className="font-bold text-sm text-slate-900">
                                {currentDepartment?.name || 'Selected Department'} WhatsApp
                            </h4>
                            <p className="text-xs text-slate-500 mt-1 leading-snug">
                                Turn WhatsApp messaging ON or OFF for <strong className="text-slate-800">{currentDepartment?.name || 'this department'}</strong> without affecting other company departments.
                            </p>
                        </div>

                        <div className="pt-4">
                            {currentDepartment && (
                                <button
                                    type="button"
                                    disabled={killSwitchLoading || killSwitches.globalHalt}
                                    onClick={() => handleToggleDepartmentKillSwitch(currentDepartment.id, !Boolean(killSwitches.departmentHalt?.[currentDepartment.id]))}
                                    className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 font-black text-xs uppercase tracking-wider rounded-xl shadow-sm transition-all cursor-pointer active:scale-98 ${
                                        killSwitches.departmentHalt?.[currentDepartment.id]
                                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                            : 'bg-white hover:bg-slate-100 text-slate-800 border border-slate-200'
                                    }`}
                                >
                                    {killSwitches.departmentHalt?.[currentDepartment.id] ? (
                                        <>
                                            <Play className="w-3.5 h-3.5" /> Resume {currentDepartment.code || 'Dept'} WhatsApp
                                        </>
                                    ) : (
                                        <>
                                            <Pause className="w-3.5 h-3.5 text-amber-600" /> Pause {currentDepartment.code || 'Dept'} WhatsApp
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Zone 3: Message-Type Kill Switches */}
                    <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between">
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                                    <Sliders className="w-3.5 h-3.5 text-primary" /> Category Controls
                                </span>
                                <span className="text-[10px] font-mono text-slate-400">5 Categories</span>
                            </div>
                            <h4 className="font-bold text-sm text-slate-900">
                                Message-Type Kill Switches
                            </h4>
                            <p className="text-xs text-slate-500 mt-1 leading-snug">
                                Pause specific message categories across the pipeline without halting the bot entirely.
                            </p>
                        </div>

                        <div className="pt-3 space-y-1.5">
                            {[
                                { key: 'morning_digest', label: '☀️ Morning Digests' },
                                { key: 'pending_reminder', label: '⚡ Midday Reminders' },
                                { key: 'eod_summary', label: '🌙 Evening Recaps' },
                                { key: 'manager_kickoff', label: '👑 Manager Kickoffs' },
                                { key: 'employee_kickoff', label: '👥 Employee Kickoffs' },
                            ].map(item => {
                                const isHalted = Boolean((killSwitches.messageTypeHalt as any)?.[item.key]);
                                return (
                                    <div key={item.key} className="flex items-center justify-between py-1 px-2 rounded-lg bg-white border border-slate-100 text-xs">
                                        <span className="font-bold text-slate-700 text-[11px] truncate">{item.label}</span>
                                        <button
                                            type="button"
                                            disabled={killSwitchLoading || killSwitches.globalHalt}
                                            onClick={() => handleToggleMessageTypeKillSwitch(item.key, !isHalted)}
                                            className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                                isHalted
                                                    ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                                                    : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                            }`}
                                        >
                                            {isHalted ? 'PAUSED' : 'ACTIVE'}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Department Selector Carousel / Navigation Grid */}
            <div className={`bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3 ${animationStep >= 2 ? 'tm-slide-up-visible' : 'tm-slide-up-hidden'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-primary" />
                        <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                            Select Department ({departments.length})
                        </h3>
                    </div>
                    <span className="text-[11px] font-bold text-slate-500">
                        Managing: <strong className="text-primary">{currentDepartment?.name || 'Tech'}</strong>
                    </span>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-2 pt-1 no-scrollbar flex-nowrap md:flex-wrap">
                    {departments.map(dept => {
                        const summary = departmentSummaries[dept.id];
                        const isSelected = (currentDepartment?.id === dept.id);
                        const memberCount = summary?.memberCount !== undefined 
                            ? summary.memberCount 
                            : employees.filter(e => e.department_id === dept.id || (e.department && e.department.toLowerCase() === dept.name.toLowerCase())).length;
                        const hasManager = Boolean(summary?.manager);
                        const isDeptPaused = Boolean(killSwitches.departmentHalt?.[dept.id]);

                        return (
                            <button
                                key={dept.id}
                                type="button"
                                onClick={() => setSelectedDepartmentId(dept.id)}
                                className={`flex items-center gap-2 px-3.5 py-2 rounded-2xl border text-xs font-bold transition-all flex-shrink-0 cursor-pointer ${
                                    isSelected
                                        ? 'bg-slate-900 text-white border-slate-900 shadow-sm shadow-slate-900/20 scale-[1.02]'
                                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                                }`}
                            >
                                <span className={`w-2 h-2 rounded-full ${
                                    isDeptPaused
                                        ? 'bg-amber-400'
                                        : hasManager
                                            ? 'bg-emerald-400'
                                            : 'bg-slate-300'
                                }`} />
                                <span className="truncate max-w-[160px]">{dept.name}</span>
                                {isDeptPaused && (
                                    <span className="text-[9px] px-1 py-0.2 rounded font-extrabold uppercase bg-amber-500/20 text-amber-700">
                                        PAUSED
                                    </span>
                                )}
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold ${
                                    isSelected
                                        ? 'bg-white/20 text-white'
                                        : 'bg-slate-200 text-slate-600'
                                }`}>
                                    {memberCount}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Top Grid: Selected Department Live Status */}
            <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 ${animationStep >= 2 ? 'tm-slide-up-visible' : 'tm-slide-up-hidden'}`}>
                {/* 1. Department Reporting Manager Card */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Shield className="w-3.5 h-3.5 text-primary" /> {currentDepartment?.name} Manager
                        </p>
                        <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-100 text-slate-600 rounded border border-slate-200">
                            {currentDepartment?.code || 'DEPT'}
                        </span>
                    </div>

                    {currentDepartmentSummary?.manager ? (
                        <div className="space-y-3">
                            <div>
                                <h3 className="text-base font-bold text-slate-900">
                                    {currentDepartmentSummary.manager.first_name} {currentDepartmentSummary.manager.last_name || ''}
                                </h3>
                                <p className="text-xs text-slate-500 font-mono mt-0.5 flex items-center gap-1">
                                    <Phone className="w-3 h-3 text-slate-400" />
                                    {currentDepartmentSummary.manager.phone || 'No phone set'}
                                </p>
                            </div>
                            <div className="flex items-center gap-2 pt-0.5 flex-wrap">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-[10px] font-bold">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Active Reporting Manager
                                </span>
                                <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded border border-indigo-200">
                                    Kickoff Ready
                                </span>
                            </div>

                            {/* Phase 3: Reporting Manager Direct Controls */}
                            <div className="pt-2 border-t border-slate-100 flex items-center gap-2 flex-wrap">
                                <button
                                    type="button"
                                    disabled={actionLoading || !currentDepartmentSummary.manager.phone}
                                    onClick={() => handleSendManagerKickoffDirect(currentDepartmentSummary.manager!.id)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-[11px] shadow-xs transition-all cursor-pointer disabled:opacity-50"
                                >
                                    <Send className="w-3 h-3" /> Resend Kickoff
                                </button>
                                <button
                                    type="button"
                                    disabled={actionLoading}
                                    onClick={() => handleRemoveManagerRole(currentDepartmentSummary.manager!.id, `${currentDepartmentSummary.manager!.first_name} ${currentDepartmentSummary.manager!.last_name || ''}`)}
                                    className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-200 rounded-xl font-bold text-[11px] transition-all cursor-pointer"
                                >
                                    <UserX className="w-3 h-3 text-rose-500" /> Step Down
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-2.5">
                            <div>
                                <p className="text-xs font-bold text-amber-900">No Manager Assigned</p>
                                <p className="text-[11px] text-amber-700 leading-snug">
                                    Select any team member to assign as Reporting Manager for {currentDepartment?.name}.
                                </p>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <select
                                    id="quick-assign-mgr-select"
                                    defaultValue=""
                                    className="flex-1 px-2 py-1.5 bg-white border border-amber-300 rounded-xl text-xs font-bold text-slate-800"
                                >
                                    <option value="" disabled>Choose member...</option>
                                    {(currentDepartmentSummary?.members || []).map(m => (
                                        <option key={m.id} value={m.id}>{m.first_name} {m.last_name || ''}</option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    disabled={actionLoading}
                                    onClick={() => {
                                        const sel = (document.getElementById('quick-assign-mgr-select') as HTMLSelectElement)?.value;
                                        if (sel) handleAssignManagerDirect(sel);
                                    }}
                                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50"
                                >
                                    Assign
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* 2. Team Members in Selected Department */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 text-primary" /> {currentDepartment?.name} Members ({currentDepartmentSummary?.members?.length || 0})
                        </p>
                        <span className="text-[10px] font-bold text-slate-500">
                            Click to inspect
                        </span>
                    </div>

                    {currentDepartmentSummary?.members && currentDepartmentSummary.members.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto pr-1">
                            {currentDepartmentSummary.members.map(m => (
                                <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => setSelectedEmployeeId(m.id)}
                                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                                        selectedEmployeeId === m.id
                                            ? 'bg-primary text-white border-primary shadow-xs'
                                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                                    }`}
                                >
                                    <span>{m.first_name} {m.last_name || ''}</span>
                                    <span className={`text-[9px] px-1.5 py-0.2 rounded font-extrabold uppercase ${
                                        m.task_role === 'reporting_manager'
                                            ? selectedEmployeeId === m.id ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-800'
                                            : selectedEmployeeId === m.id ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
                                    }`}>
                                        {m.task_role === 'reporting_manager' ? '👑' : '👤'}
                                    </span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                            <p className="text-xs text-slate-500 font-medium">No members currently in {currentDepartment?.name}.</p>
                        </div>
                    )}
                </div>

                {/* 3. Department Services & Automation Overview */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-primary" /> {currentDepartment?.name} Services
                    </p>

                    <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between p-2 bg-slate-50 rounded-xl border border-slate-100">
                            <div className="flex items-center gap-1.5">
                                <MessageSquare className={`w-3.5 h-3.5 ${
                                    killSwitches.globalHalt ? 'text-rose-600' : isCurrentDeptHalted ? 'text-amber-600' : 'text-emerald-600'
                                }`} />
                                <span className="font-bold text-slate-700">WhatsApp Channel</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${
                                    killSwitches.globalHalt
                                        ? 'bg-rose-100 text-rose-800 border-rose-200'
                                        : isCurrentDeptHalted
                                            ? 'bg-amber-100 text-amber-800 border-amber-200'
                                            : 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                }`}>
                                    {killSwitches.globalHalt ? '🛑 Global Halt' : isCurrentDeptHalted ? '⏸️ Paused' : '🟢 Active'}
                                </span>
                                {currentDepartment && !killSwitches.globalHalt && (
                                    <button
                                        type="button"
                                        disabled={killSwitchLoading}
                                        onClick={() => handleToggleDepartmentKillSwitch(currentDepartment.id, !Boolean(killSwitches.departmentHalt?.[currentDepartment.id]))}
                                        className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer border ${
                                            killSwitches.departmentHalt?.[currentDepartment.id]
                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                                : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                                        }`}
                                    >
                                        {killSwitches.departmentHalt?.[currentDepartment.id] ? 'Resume' : 'Pause'}
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center justify-between p-2 bg-slate-50 rounded-xl border border-slate-100">
                            <span className="font-bold text-slate-700 flex items-center gap-1.5">
                                <FileText className="w-3.5 h-3.5 text-indigo-600" /> Task Engine
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-indigo-50 text-indigo-700 border border-indigo-200">
                                🟢 Ready
                            </span>
                        </div>

                        <div className="flex items-center justify-between p-2 bg-slate-50 rounded-xl border border-slate-100">
                            <span className="font-bold text-slate-700 flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5 text-amber-600" /> Scheduled Cron
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-50 text-amber-800 border border-amber-200">
                                {currentDepartmentSummary?.rulesCount || 0} Rules
                            </span>
                        </div>

                        {/* Phase 5: Department Simulation Trigger */}
                        <div className="pt-1">
                            <button
                                type="button"
                                disabled={triggerLoading || killSwitches.globalHalt || isCurrentDeptHalted}
                                onClick={handleSimulateDepartmentRun}
                                className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl font-bold text-xs transition-all cursor-pointer active:scale-98 disabled:opacity-50"
                            >
                                <Shield className="w-3.5 h-3.5 text-indigo-600" />
                                <span>Simulate {currentDepartment?.code || 'Dept'} Run (Dry-Run)</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Phase 4: Department Team Roster & Staff Directory ── */}
            <div className={`bg-white border border-slate-200 rounded-3xl p-6 md:p-8 shadow-sm space-y-5 ${animationStep >= 2 ? 'tm-slide-up-visible' : 'tm-slide-up-hidden'}`}>
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                    <div>
                        <div className="flex items-center gap-2.5 flex-wrap">
                            <Users className="w-5 h-5 text-primary" />
                            <h2 className="text-lg md:text-xl font-black text-slate-900 tracking-tight">
                                {currentDepartment?.name} Team Roster & Staff Directory
                            </h2>
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-slate-100 text-slate-800 border border-slate-200">
                                {currentDepartmentSummary?.members?.length || 0} Members
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                            Manage department team members, promote reporting managers, transfer staff across departments, and dispatch personalized employee kickoffs.
                        </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative">
                            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                                type="text"
                                value={rosterSearchQuery}
                                onChange={(e) => setRosterSearchQuery(e.target.value)}
                                placeholder="Search members in department..."
                                className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-primary w-48 sm:w-60"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowAddMemberModal(true)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs shadow-xs transition-all cursor-pointer"
                        >
                            <Plus className="w-3.5 h-3.5 text-amber-400" />
                            <span>Add Member</span>
                        </button>
                    </div>
                </div>

                {/* Member Cards / Table */}
                {(() => {
                    const deptMembers = (currentDepartmentSummary?.members || []).filter(m => {
                        if (!rosterSearchQuery.trim()) return true;
                        const q = rosterSearchQuery.toLowerCase();
                        return (
                            (m.first_name || '').toLowerCase().includes(q) ||
                            (m.last_name || '').toLowerCase().includes(q) ||
                            (m.phone || '').includes(q) ||
                            (m.email || '').toLowerCase().includes(q)
                        );
                    });

                    if (deptMembers.length === 0) {
                        return (
                            <div className="p-8 text-center bg-slate-50/70 rounded-2xl border border-dashed border-slate-200 space-y-2">
                                <Users className="w-8 h-8 text-slate-400 mx-auto" />
                                <h4 className="text-sm font-bold text-slate-800">No Members Found in {currentDepartment?.name}</h4>
                                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                                    Click &quot;Add Member&quot; above to transfer or assign employees into this department.
                                </p>
                            </div>
                        );
                    }

                    return (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {deptMembers.map(m => {
                                const isMgr = m.task_role === 'reporting_manager' || m.task_role === 'superuser';
                                const hasValidPhone = Boolean(m.phone && m.phone.replace(/\D/g, '').length >= 10);

                                return (
                                    <div
                                        key={m.id}
                                        className={`p-4 rounded-2xl border transition-all space-y-3 ${
                                            isMgr
                                                ? 'bg-amber-50/40 border-amber-200 shadow-2xs'
                                                : 'bg-white border-slate-200 hover:border-slate-300'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <h4 className="font-bold text-sm text-slate-900 truncate">
                                                        {m.first_name} {m.last_name || ''}
                                                    </h4>
                                                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                                        isMgr
                                                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                                            : 'bg-slate-100 text-slate-600 border-slate-200'
                                                    }`}>
                                                        {isMgr ? '👑 Manager' : '👤 Employee'}
                                                    </span>
                                                </div>
                                                <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                                    {m.email}
                                                </p>
                                            </div>

                                            {/* WhatsApp status icon */}
                                            <div className="flex-shrink-0">
                                                {hasValidPhone ? (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[9px] font-bold" title="WhatsApp Enabled">
                                                        <MessageSquare className="w-2.5 h-2.5" /> +91
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded text-[9px] font-bold" title="Phone missing">
                                                        No Phone
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="text-xs text-slate-600 font-mono">
                                            📱 {m.phone || 'No phone set'}
                                        </div>

                                        {/* Action Bar */}
                                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1.5 flex-wrap">
                                            <div className="flex items-center gap-1">
                                                {/* Kickoff Dispatch */}
                                                <button
                                                    type="button"
                                                    disabled={actionLoading || !hasValidPhone}
                                                    onClick={() => isMgr ? handleSendManagerKickoffDirect(m.id) : handleSendEmployeeKickoffDirect(m)}
                                                    className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[10px] font-bold transition-all cursor-pointer disabled:opacity-50"
                                                    title="Send Meta-approved Kickoff Template"
                                                >
                                                    <Send className="w-2.5 h-2.5 inline mr-1" />
                                                    Kickoff
                                                </button>

                                                {/* Transfer Department */}
                                                <button
                                                    type="button"
                                                    disabled={actionLoading}
                                                    onClick={() => setTransferModal({
                                                        isOpen: true,
                                                        employee: m,
                                                        targetDeptId: departments.find(d => d.id !== currentDepartment?.id)?.id || '',
                                                        keepRole: false
                                                    })}
                                                    className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                                                    title="Transfer to another department"
                                                >
                                                    <ArrowLeftRight className="w-2.5 h-2.5 inline mr-1" />
                                                    Transfer
                                                </button>
                                            </div>

                                            {/* Role toggle */}
                                            {isMgr ? (
                                                <button
                                                    type="button"
                                                    disabled={actionLoading}
                                                    onClick={() => handleRemoveManagerRole(m.id, `${m.first_name} ${m.last_name || ''}`)}
                                                    className="px-2 py-1 text-slate-400 hover:text-rose-600 rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                                                >
                                                    Step Down
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    disabled={actionLoading}
                                                    onClick={() => handleAssignManagerDirect(m.id)}
                                                    className="px-2 py-1 text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                                                >
                                                    👑 Make Mgr
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })()}
            </div>

            {/* Multi-Schedule Routine & Notification Rules Manager */}
            <div className={`bg-white border border-slate-200 rounded-3xl p-6 md:p-8 shadow-sm space-y-6 ${animationStep >= 3 ? 'tm-slide-up-visible' : 'tm-slide-up-hidden'}`}>
                {/* Header Row */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <Clock className="w-5 h-5 text-amber-500" />
                            <h2 className="text-lg md:text-xl font-black text-slate-900 tracking-tight">
                                Notification Rules & Multi-Schedule Cron Engine
                            </h2>
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300">
                                Multi-Rule Active
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200">
                                IST Heartbeat
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1 max-w-3xl">
                            Configure multiple daily notification schedules, custom WhatsApp message templates, task selection filters, and automated carry-forward rules for the Tech department. Changes apply immediately without redeploying.
                        </p>
                    </div>

                    {/* Right: Master Heartbeat State & Current IST Clock */}
                    <div className="flex items-center gap-2.5 flex-wrap self-start md:self-auto">
                        {currentISTDisplay && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-bold bg-slate-100 border border-slate-200 text-slate-700 shadow-2xs">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                IST {currentISTDisplay}
                            </span>
                        )}

                        <button
                            type="button"
                            onClick={handleMasterCronToggle}
                            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all border shadow-2xs cursor-pointer ${
                                cronEnabled
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100/70'
                                    : 'bg-rose-50 text-rose-800 border-rose-300 hover:bg-rose-100/70'
                            }`}
                            title={cronEnabled ? 'Click to pause all automated cron checks' : 'Click to resume automated cron checks'}
                        >
                            <span className={`w-2 h-2 rounded-full ${cronEnabled ? 'bg-emerald-500 animate-ping' : 'bg-rose-500'}`} />
                            <span>{cronEnabled ? 'Heartbeat: Active' : 'Heartbeat: Paused'}</span>
                        </button>
                    </div>
                </div>

                {/* Whitelist Sandbox Protection Alert Banner (Loud & Clear) */}
                <div className={`p-4 rounded-2xl border transition-all ${
                    whitelistEnabled
                        ? 'bg-emerald-50/90 border-emerald-300 text-emerald-950'
                        : 'bg-amber-50/90 border-amber-300 text-amber-950'
                }`}>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-3">
                            <Shield className={`w-5 h-5 flex-shrink-0 mt-0.5 ${whitelistEnabled ? 'text-emerald-700' : 'text-amber-700'}`} />
                            <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-black uppercase tracking-wider">
                                        {whitelistEnabled ? '🔒 Whitelist Sandbox Protection: ACTIVE (Sahil Gorde — 8433649199)' : '⚠️ Whitelist Protection: DISABLED (Broadcast Mode)'}
                                    </span>
                                </div>
                                <p className="text-xs mt-0.5 opacity-90 leading-relaxed font-sans">
                                    {whitelistEnabled
                                        ? 'Strict isolation enforced: All automated crons, midday check-ins, and manual dispatches ONLY send WhatsApp messages to your number (8433649199). Lohitaksha and Harsh are 100% excluded.'
                                        : 'Caution: Live dispatches will send WhatsApp messages to all active Tech employees (Sahil Gorde, Lohitaksha Ranganathan, Harsh Patil).'}
                                </p>
                            </div>
                        </div>

                        <label className="flex items-center gap-2 cursor-pointer self-start sm:self-center bg-white/80 px-3 py-1.5 rounded-xl border border-slate-200/80 shadow-2xs hover:bg-white transition-all flex-shrink-0">
                            <span className="text-xs font-bold text-slate-800">
                                {whitelistEnabled ? 'Sandbox ON' : 'Sandbox OFF'}
                            </span>
                            <input
                                type="checkbox"
                                checked={whitelistEnabled}
                                onChange={(e) => handleMasterWhitelistToggle(e.target.checked)}
                                className="w-4 h-4 text-primary rounded border-slate-300 focus:ring-primary"
                            />
                        </label>
                    </div>
                </div>

                {/* Global Controls & Rules Toolbar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 border-t border-slate-100">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-black uppercase tracking-wider text-slate-400">
                            Active Schedules ({rules.length}):
                        </span>
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                            {rules.filter(r => r.enabled).length} Enabled
                        </span>
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            {rules.filter(r => r.lastRunDate === new Date().toISOString().slice(0, 10)).length} Dispatched Today
                        </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Generate Tasks Global Trigger */}
                        <button
                            type="button"
                            disabled={triggerLoading}
                            onClick={() => handleManualTrigger('trigger_generate')}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs shadow-2xs transition-all disabled:opacity-50 cursor-pointer"
                            title="Generate today's fixed routine task assignments in the database"
                        >
                            {triggerLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 text-primary" />}
                            <span>⚡ Generate Tasks</span>
                        </button>

                        {/* Reset All Today */}
                        <button
                            type="button"
                            disabled={actionLoading}
                            onClick={handleResetAllRules}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs shadow-2xs transition-all disabled:opacity-50 cursor-pointer"
                            title="Clear today's run stamp for all rules so they can fire again"
                        >
                            <RotateCcw className="w-3.5 h-3.5 text-amber-600" />
                            <span>🔄 Reset All Today</span>
                        </button>

                        {/* Add Rule Button */}
                        <button
                            type="button"
                            onClick={() => setShowAddRuleModal(true)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs shadow-xs transition-all cursor-pointer"
                        >
                            <Plus className="w-3.5 h-3.5 text-amber-400" />
                            <span>Add Notification Rule</span>
                        </button>
                    </div>
                </div>

                {/* Rules List Cards */}
                <div className="space-y-4">
                    {rules.map((rule) => {
                        const todayIST = new Date().toISOString().slice(0, 10);
                        const isDispatchedToday = rule.lastRunDate === todayIST;
                        const isExpanded = expandedRuleId === rule.id;
                        const isActionLoading = actionRuleId === rule.id;
                        const edited = ruleEditState[rule.id] || rule;

                        // Visual styling based on ruleType
                        const typeInfo = (() => {
                            switch (rule.ruleType) {
                                case 'morning_digest':
                                    return {
                                        icon: Sun,
                                        label: 'Morning Kickoff',
                                        badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
                                        borderClass: 'border-l-amber-500'
                                    };
                                case 'pending_reminder':
                                    return {
                                        icon: Clock,
                                        label: 'Midday Reminder',
                                        badgeClass: 'bg-sky-100 text-sky-900 border-sky-300',
                                        borderClass: 'border-l-sky-500'
                                    };
                                case 'eod_summary':
                                    return {
                                        icon: Moon,
                                        label: 'EOD Wrap-up',
                                        badgeClass: 'bg-indigo-100 text-indigo-900 border-indigo-300',
                                        borderClass: 'border-l-indigo-500'
                                    };
                                case 'overdue_alert':
                                    return {
                                        icon: AlertTriangle,
                                        label: 'Overdue Alert',
                                        badgeClass: 'bg-rose-100 text-rose-900 border-rose-300',
                                        borderClass: 'border-l-rose-500'
                                    };
                                default:
                                    return {
                                        icon: Clock,
                                        label: 'Custom Rule',
                                        badgeClass: 'bg-slate-100 text-slate-800 border-slate-300',
                                        borderClass: 'border-l-slate-400'
                                    };
                            }
                        })();

                        const TypeIcon = typeInfo.icon;

                        return (
                            <div
                                key={rule.id}
                                className={`relative border border-slate-200 rounded-2xl transition-all duration-200 border-l-4 hover:z-20 focus-within:z-30 ${typeInfo.borderClass} ${
                                    rule.enabled ? 'bg-white shadow-xs' : 'bg-slate-50/80 opacity-75'
                                }`}
                            >
                                {/* Rule Card Header Bar */}
                                <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div className="space-y-1.5 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${typeInfo.badgeClass}`}>
                                                <TypeIcon className="w-3 h-3" />
                                                {typeInfo.label}
                                            </span>

                                            <h3 className="text-sm md:text-base font-black text-slate-900">
                                                {rule.name}
                                            </h3>

                                            {/* Status Badge */}
                                            {isDispatchedToday ? (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                                                    <Check className="w-3 h-3" /> Dispatched Today
                                                </span>
                                            ) : !rule.enabled ? (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-200 text-slate-700">
                                                    Paused
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200">
                                                    <Clock className="w-3 h-3 text-amber-600" /> Pending for {rule.targetTimeIST} IST
                                                </span>
                                            )}
                                        </div>

                                        {/* Run summary if available */}
                                        {rule.lastRunSummary && (
                                            <p className="text-[11px] font-mono text-slate-500 truncate max-w-2xl">
                                                {rule.lastRunSummary}
                                            </p>
                                        )}
                                    </div>

                                    {/* Enable / Disable Toggle Switch */}
                                    <div className="flex items-center gap-3 self-start md:self-auto flex-shrink-0">
                                        <span className="text-xs font-bold text-slate-600">
                                            {rule.enabled ? 'Rule Active' : 'Rule Paused'}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => handleToggleRule(rule)}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none cursor-pointer ${
                                                rule.enabled ? 'bg-emerald-600' : 'bg-slate-300'
                                            }`}
                                            title={rule.enabled ? 'Click to Pause this rule' : 'Click to Enable this rule'}
                                        >
                                            <span
                                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                                    rule.enabled ? 'translate-x-6' : 'translate-x-1'
                                                }`}
                                            />
                                        </button>
                                    </div>
                                </div>

                                {/* Rule Card Controls Row: Time Picker, Days Chips & Action Buttons */}
                                <div className={`px-4 sm:px-5 pb-4 pt-1 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-t border-slate-100 bg-slate-50/50 ${!isExpanded ? 'rounded-b-2xl' : ''}`}>
                                    {/* Left: Timing and Weekdays */}
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 flex-wrap">
                                        {/* Target Time Picker */}
                                        <div className="flex items-center gap-2">
                                            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex-shrink-0">
                                                Time (IST):
                                            </span>
                                            <div className="w-[270px] relative z-30">
                                                <TwelveHourTimePicker
                                                    value={rule.targetTimeIST}
                                                    onChange={(val) => handleUpdateRuleTime(rule.id, val)}
                                                />
                                            </div>
                                        </div>

                                        {/* Quick Test Offset Chips */}
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Test:</span>
                                            <button
                                                type="button"
                                                onClick={() => handleQuickOffset(rule.id, 2)}
                                                className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 rounded-md text-[10px] font-bold transition-colors cursor-pointer"
                                                title="Set to 2 minutes from current IST for instant testing"
                                            >
                                                +2m
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleQuickOffset(rule.id, 5)}
                                                className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 rounded-md text-[10px] font-bold transition-colors cursor-pointer"
                                                title="Set to 5 minutes from current IST"
                                            >
                                                +5m
                                            </button>
                                        </div>

                                        {/* Days of Week selector chips */}
                                        <div className="flex items-center gap-1">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Days:</span>
                                            {[
                                                { day: 1, label: 'M' },
                                                { day: 2, label: 'T' },
                                                { day: 3, label: 'W' },
                                                { day: 4, label: 'T' },
                                                { day: 5, label: 'F' },
                                                { day: 6, label: 'S' },
                                                { day: 0, label: 'S' }
                                            ].map(({ day, label }, idx) => {
                                                const isActive = (rule.daysOfWeek || []).includes(day);
                                                return (
                                                    <button
                                                        key={`${rule.id}-day-${day}-${idx}`}
                                                        type="button"
                                                        onClick={() => handleToggleDay(rule, day)}
                                                        className={`w-6 h-6 rounded-md text-[10px] font-bold transition-all flex items-center justify-center cursor-pointer ${
                                                            isActive
                                                                ? 'bg-slate-900 text-white shadow-2xs font-black'
                                                                : 'bg-white border border-slate-200 text-slate-400 hover:border-slate-300'
                                                        }`}
                                                        title={`Click to toggle ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][day]}`}
                                                    >
                                                        {label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Right: Actions Button Group */}
                                    <div className="flex items-center gap-2 flex-wrap self-start lg:self-auto">
                                        {/* Run Now Button */}
                                        <button
                                            type="button"
                                            disabled={isActionLoading}
                                            onClick={() => handleTriggerRule(rule.id, false)}
                                            className="flex items-center gap-1 px-3 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold text-xs shadow-2xs transition-all disabled:opacity-50 cursor-pointer"
                                            title="Dispatch live notification now (strictly targets Sahil Gorde whitelist)"
                                        >
                                            {isActionLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                            <span>⚡ Run Now</span>
                                        </button>

                                        {/* Dry Run Button */}
                                        <button
                                            type="button"
                                            disabled={isActionLoading}
                                            onClick={() => handleTriggerRule(rule.id, true)}
                                            className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 rounded-xl font-bold text-xs shadow-2xs transition-all disabled:opacity-50 cursor-pointer"
                                            title="Simulate dispatch without sending any WhatsApp messages"
                                        >
                                            <Play className="w-3.5 h-3.5 text-amber-500" />
                                            <span>🛡️ Dry-Run</span>
                                        </button>

                                        {/* Reset Today Button */}
                                        {isDispatchedToday && (
                                            <button
                                                type="button"
                                                disabled={isActionLoading}
                                                onClick={() => handleResetRule(rule.id)}
                                                className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 rounded-xl font-bold text-xs shadow-2xs transition-all disabled:opacity-50 cursor-pointer"
                                                title="Clear today's run record so the rule can trigger again today"
                                            >
                                                <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
                                                <span>Reset Run</span>
                                            </button>
                                        )}

                                        {/* Expand Filters & Template Button */}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (isExpanded) {
                                                    setExpandedRuleId(null);
                                                } else {
                                                    setExpandedRuleId(rule.id);
                                                    setRuleEditState(prev => ({
                                                        ...prev,
                                                        [rule.id]: JSON.parse(JSON.stringify(rule))
                                                    }));
                                                }
                                            }}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs transition-all border cursor-pointer ${
                                                isExpanded
                                                    ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                                                    : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                                            }`}
                                        >
                                            <Sliders className="w-3.5 h-3.5" />
                                            <span>{isExpanded ? 'Hide Settings' : 'Filters & Template'}</span>
                                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                        </button>

                                        {/* Delete Custom Rule Button */}
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteRule(rule.id, rule.name)}
                                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                            title="Delete this rule"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                {/* Expandable Drawer: Filters, Conditions, Custom Template & Live Preview */}
                                {isExpanded && (
                                    <div className="p-5 md:p-6 bg-slate-50 border-t border-slate-200 space-y-6 animate-in fade-in duration-200 rounded-b-2xl">
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                            {/* Column 1: Task Selection Filters & Conditions */}
                                            <div className="space-y-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
                                                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                                                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                                                        <Filter className="w-3.5 h-3.5 text-primary" /> Task Filters & Selection
                                                    </h4>
                                                    <span className="text-[10px] text-slate-400 font-bold">Rule ID: {rule.id}</span>
                                                </div>

                                                <div className="space-y-3">
                                                    {/* Filter 1: Fixed Routine Tasks */}
                                                    <label className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200/80 cursor-pointer hover:bg-slate-100 transition-colors">
                                                        <div>
                                                            <span className="text-xs font-bold text-slate-900 block">
                                                                Include Today&apos;s Fixed Routine Tasks
                                                            </span>
                                                            <span className="text-[11px] text-slate-500">
                                                                Routine daily fixed tasks generated automatically for the Tech department.
                                                            </span>
                                                        </div>
                                                        <input
                                                            type="checkbox"
                                                            checked={edited.taskFilters?.includeTodayFixed ?? true}
                                                            onChange={(e) => {
                                                                setRuleEditState(prev => ({
                                                                    ...prev,
                                                                    [rule.id]: {
                                                                        ...edited,
                                                                        taskFilters: { ...edited.taskFilters, includeTodayFixed: e.target.checked }
                                                                    }
                                                                }));
                                                            }}
                                                            className="w-4 h-4 text-primary rounded border-slate-300 focus:ring-primary ml-3"
                                                        />
                                                    </label>

                                                    {/* Filter 2: Ad-Hoc Assigned Tasks */}
                                                    <label className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200/80 cursor-pointer hover:bg-slate-100 transition-colors">
                                                        <div>
                                                            <span className="text-xs font-bold text-slate-900 block">
                                                                Include Today&apos;s Assigned / Ad-Hoc Tasks
                                                            </span>
                                                            <span className="text-[11px] text-slate-500">
                                                                Non-routine tasks assigned specifically for today by managers.
                                                            </span>
                                                        </div>
                                                        <input
                                                            type="checkbox"
                                                            checked={edited.taskFilters?.includeTodayAssigned ?? true}
                                                            onChange={(e) => {
                                                                setRuleEditState(prev => ({
                                                                    ...prev,
                                                                    [rule.id]: {
                                                                        ...edited,
                                                                        taskFilters: { ...edited.taskFilters, includeTodayAssigned: e.target.checked }
                                                                    }
                                                                }));
                                                            }}
                                                            className="w-4 h-4 text-primary rounded border-slate-300 focus:ring-primary ml-3"
                                                        />
                                                    </label>

                                                    {/* Filter 3: Carry-Forward Past Uncompleted Tasks */}
                                                    <label className="flex items-center justify-between p-2.5 bg-amber-50/60 rounded-xl border border-amber-200/80 cursor-pointer hover:bg-amber-100/60 transition-colors">
                                                        <div>
                                                            <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                                                <span>🔄 Carry-Forward Incomplete Past Tasks</span>
                                                                <span className="px-1.5 py-0.2 bg-amber-200 text-amber-900 rounded text-[9px] font-black uppercase">Carry-Forward</span>
                                                            </span>
                                                            <span className="text-[11px] text-slate-600 block mt-0.5">
                                                                Queries unfinished tasks from previous days and tags them with [Carried Forward].
                                                            </span>
                                                        </div>
                                                        <input
                                                            type="checkbox"
                                                            checked={edited.taskFilters?.includeYesterdayPending ?? true}
                                                            onChange={(e) => {
                                                                setRuleEditState(prev => ({
                                                                    ...prev,
                                                                    [rule.id]: {
                                                                        ...edited,
                                                                        taskFilters: { ...edited.taskFilters, includeYesterdayPending: e.target.checked }
                                                                    }
                                                                }));
                                                            }}
                                                            className="w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500 ml-3"
                                                        />
                                                    </label>

                                                    {/* Lookback window days */}
                                                    {edited.taskFilters?.includeYesterdayPending && (
                                                        <div className="pl-4 flex items-center justify-between text-xs py-1">
                                                            <span className="font-bold text-slate-600">
                                                                Lookback Window (Days):
                                                            </span>
                                                            <select
                                                                value={edited.taskFilters?.lookbackDays || 1}
                                                                onChange={(e) => {
                                                                    const val = parseInt(e.target.value, 10);
                                                                    setRuleEditState(prev => ({
                                                                        ...prev,
                                                                        [rule.id]: {
                                                                            ...edited,
                                                                            taskFilters: { ...edited.taskFilters, lookbackDays: val }
                                                                        }
                                                                    }));
                                                                }}
                                                                className="px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800"
                                                            >
                                                                <option value="1">1 Day (Yesterday only)</option>
                                                                <option value="2">2 Days</option>
                                                                <option value="3">3 Days (Recommended)</option>
                                                                <option value="7">7 Days (Full past week)</option>
                                                            </select>
                                                        </div>
                                                    )}

                                                    {/* Filter 4: Only Pending (Incomplete) */}
                                                    <label className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200/80 cursor-pointer hover:bg-slate-100 transition-colors">
                                                        <div>
                                                            <span className="text-xs font-bold text-slate-900 block">
                                                                Incomplete / Pending Tasks Only
                                                            </span>
                                                            <span className="text-[11px] text-slate-500">
                                                                Hide completed tasks from the notification copy (ideal for midday reminders).
                                                            </span>
                                                        </div>
                                                        <input
                                                            type="checkbox"
                                                            checked={edited.taskFilters?.onlyPending ?? false}
                                                            onChange={(e) => {
                                                                setRuleEditState(prev => ({
                                                                    ...prev,
                                                                    [rule.id]: {
                                                                        ...edited,
                                                                        taskFilters: { ...edited.taskFilters, onlyPending: e.target.checked }
                                                                    }
                                                                }));
                                                            }}
                                                            className="w-4 h-4 text-primary rounded border-slate-300 focus:ring-primary ml-3"
                                                        />
                                                    </label>
                                                </div>

                                                {/* Conditions Subsection */}
                                                <div className="pt-3 border-t border-slate-100 space-y-2">
                                                    <h5 className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                                                        Execution Conditions
                                                    </h5>
                                                    <label className="flex items-center justify-between text-xs font-bold text-slate-700 cursor-pointer">
                                                        <span>Skip Notification if 0 matching tasks</span>
                                                        <input
                                                            type="checkbox"
                                                            checked={edited.conditions?.skipIfZeroTasks ?? true}
                                                            onChange={(e) => {
                                                                setRuleEditState(prev => ({
                                                                    ...prev,
                                                                    [rule.id]: {
                                                                        ...edited,
                                                                        conditions: { ...edited.conditions, skipIfZeroTasks: e.target.checked }
                                                                    }
                                                                }));
                                                            }}
                                                            className="w-4 h-4 text-primary rounded border-slate-300 ml-2"
                                                        />
                                                    </label>
                                                    <label className="flex items-center justify-between text-xs font-bold text-slate-700 cursor-pointer">
                                                        <span>Skip Notification if all tasks already completed</span>
                                                        <input
                                                            type="checkbox"
                                                            checked={edited.conditions?.requirePendingOnly ?? false}
                                                            onChange={(e) => {
                                                                setRuleEditState(prev => ({
                                                                    ...prev,
                                                                    [rule.id]: {
                                                                        ...edited,
                                                                        conditions: { ...edited.conditions, requirePendingOnly: e.target.checked }
                                                                    }
                                                                }));
                                                            }}
                                                            className="w-4 h-4 text-primary rounded border-slate-300 ml-2"
                                                        />
                                                    </label>
                                                </div>
                                            </div>

                                            {/* Column 2: Custom WhatsApp Template & Live Preview */}
                                            <div className="space-y-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
                                                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                                                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                                                        <FileText className="w-3.5 h-3.5 text-primary" /> Custom WhatsApp Template
                                                    </h4>
                                                    <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                                                        <Sparkles className="w-3 h-3" /> Dynamic Tags
                                                    </span>
                                                </div>

                                                {/* Header Greeting */}
                                                <div>
                                                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                                                        Custom Header Greeting:
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={edited.customTemplate?.headerGreeting || ''}
                                                        placeholder="e.g. Good morning {{firstName}}! 📋"
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            setRuleEditState(prev => ({
                                                                ...prev,
                                                                [rule.id]: {
                                                                    ...edited,
                                                                    customTemplate: { ...edited.customTemplate, headerGreeting: val }
                                                                }
                                                            }));
                                                        }}
                                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-sans text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                                                    />
                                                </div>

                                                {/* Announcement Note */}
                                                <div>
                                                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                                                        Custom Announcement / Note (Optional):
                                                    </label>
                                                    <textarea
                                                        rows={2}
                                                        value={edited.customTemplate?.customMessage || ''}
                                                        placeholder="e.g. 📢 Reminder: Complete client deployments before 4 PM today."
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            setRuleEditState(prev => ({
                                                                ...prev,
                                                                [rule.id]: {
                                                                    ...edited,
                                                                    customTemplate: { ...edited.customTemplate, customMessage: val }
                                                                }
                                                            }));
                                                        }}
                                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-sans text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                                                    />
                                                </div>

                                                {/* Footer Instruction */}
                                                <div>
                                                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                                                        Custom Footer Instructions:
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={edited.customTemplate?.footerInstruction || ''}
                                                        placeholder="e.g. Reply 'done 1' to mark complete. Have a great day! 🚀"
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            setRuleEditState(prev => ({
                                                                ...prev,
                                                                [rule.id]: {
                                                                    ...edited,
                                                                    customTemplate: { ...edited.customTemplate, footerInstruction: val }
                                                                }
                                                            }));
                                                        }}
                                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-sans text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                                                    />
                                                </div>

                                                {/* Quick Replies Toggle */}
                                                <label className="flex items-center justify-between text-xs font-bold text-slate-700 cursor-pointer pt-1">
                                                    <span>Include Quick Reply Guide (done 1, done all)</span>
                                                    <input
                                                        type="checkbox"
                                                        checked={edited.customTemplate?.includeQuickReplies !== false}
                                                        onChange={(e) => {
                                                            setRuleEditState(prev => ({
                                                                ...prev,
                                                                [rule.id]: {
                                                                    ...edited,
                                                                    customTemplate: { ...edited.customTemplate, includeQuickReplies: e.target.checked }
                                                                }
                                                            }));
                                                        }}
                                                        className="w-4 h-4 text-primary rounded border-slate-300 ml-2"
                                                    />
                                                </label>

                                                {/* Dynamic Variables Pill Tags */}
                                                <div className="pt-2 border-t border-slate-100">
                                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                                                        Supported Dynamic Tags:
                                                    </span>
                                                    <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
                                                        {['{{firstName}}', '{{fullName}}', '{{totalTasks}}', '{{pendingTasks}}', '{{completedTasks}}', '{{date}}'].map(tag => (
                                                            <span
                                                                key={tag}
                                                                className="px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 rounded-md font-bold select-all cursor-pointer hover:bg-slate-200"
                                                                title={`Copy tag ${tag}`}
                                                            >
                                                                {tag}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* Realtime WhatsApp Bubble Preview */}
                                                <div className="mt-3 bg-[#EFEAE2] p-3.5 rounded-2xl border border-[#D1D7DB] shadow-inner font-sans space-y-2">
                                                    <div className="flex items-center justify-between pb-1.5 border-b border-[#D1D7DB]/60">
                                                        <span className="text-[10px] font-black text-slate-600 uppercase tracking-wider flex items-center gap-1">
                                                            <MessageSquare className="w-3 h-3 text-emerald-600" /> WhatsApp Live Preview (Sahil Gorde)
                                                        </span>
                                                        <span className="text-[9px] font-mono text-slate-400">IST</span>
                                                    </div>
                                                    <div className="bg-white rounded-xl p-3 shadow-xs border border-emerald-100 text-slate-800 text-[11px] font-sans leading-relaxed whitespace-pre-line">
                                                        {/* Header */}
                                                        {edited.customTemplate?.headerGreeting
                                                            ? edited.customTemplate.headerGreeting
                                                                .replace(/\{\{firstName\}\}/g, 'Sahil')
                                                                .replace(/\{\{fullName\}\}/g, 'Sahil Gorde')
                                                                .replace(/\{\{date\}\}/g, 'Mon, Oct 5')
                                                                .replace(/\{\{totalTasks\}\}/g, '3')
                                                                .replace(/\{\{pendingTasks\}\}/g, '2')
                                                                .replace(/\{\{completedTasks\}\}/g, '1')
                                                            : (rule.ruleType === 'morning_digest'
                                                                ? '☀️ *Good Morning Sahil!* 👋\nHere are your tasks for today (Mon, Oct 5):'
                                                                : rule.ruleType === 'pending_reminder'
                                                                ? '⏳ *Midday Progress Check-in*\nHello Sahil, here is your remaining task list:'
                                                                : rule.ruleType === 'eod_summary'
                                                                ? '🏁 *End-of-Day Task Summary*\nHello Sahil, here is your daily wrap-up:'
                                                                : '⚠️ *Urgent: Overdue Tasks Alert*\nHello Sahil, the following tasks are past due:')}

                                                        {/* Optional note */}
                                                        {edited.customTemplate?.customMessage && (
                                                            `\n\n📢 *Note:* ${edited.customTemplate.customMessage}`
                                                        )}

                                                        {/* Tasks mockup */}
                                                        {rule.ruleType === 'eod_summary' ? (
                                                            '\n\n✅ Completed: 1\n⏳ Outstanding: 2\n\n1. Review System Architecture [Fixed] - ✅ Completed\n2. 🔄 Update API Gateway Endpoint [Carried Forward] - ⏳ Pending\n3. Deploy Test Beta Tab [Assigned] - ⏳ Pending'
                                                        ) : rule.ruleType === 'overdue_alert' ? (
                                                            '\n\n1. ⚠️ Update API Gateway Endpoint [⚠️ 2d overdue]\n2. ⚠️ Database Migration Check [⚠️ 1d overdue]'
                                                        ) : (
                                                            '\n\n1. Review System Architecture [Fixed]\n2. 🔄 Update API Gateway Endpoint [Carried Forward]\n3. Deploy Test Beta Tab [Assigned]'
                                                        )}

                                                        {/* Footer */}
                                                        {edited.customTemplate?.footerInstruction && (
                                                            `\n\n${edited.customTemplate.footerInstruction}`
                                                        )}

                                                        {/* Quick replies */}
                                                        {edited.customTemplate?.includeQuickReplies !== false && (
                                                            '\n\n💡 *Quick Reply:* Type "done 1" to mark complete, or "tasks" to refresh.'
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Drawer Footer Actions */}
                                        <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-200">
                                            <button
                                                type="button"
                                                onClick={() => setExpandedRuleId(null)}
                                                className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl font-bold text-xs transition-colors cursor-pointer"
                                            >
                                                Close
                                            </button>

                                            <button
                                                type="button"
                                                disabled={isActionLoading}
                                                onClick={() => handleSaveRuleAdvanced(rule.id)}
                                                className="flex items-center gap-1.5 px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs shadow-xs transition-all disabled:opacity-50 cursor-pointer"
                                            >
                                                {isActionLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-emerald-400" />}
                                                <span>Save Rule Settings</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Modal: Add New Notification Rule */}
            {showAddRuleModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
                    <div className="bg-white rounded-3xl max-w-xl w-full p-6 md:p-8 shadow-2xl border border-slate-200 space-y-5 animate-in zoom-in-95 duration-150">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                            <div>
                                <h3 className="text-lg font-black text-slate-900">
                                    ➕ Create New Notification Rule
                                </h3>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    Add an automated cron schedule rule with custom timing and filters.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowAddRuleModal(false)}
                                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Quick Presets */}
                        <div>
                            <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">
                                Quick Preset Templates:
                            </span>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {[
                                    { name: 'Morning Kickoff', type: 'morning_digest' as NotificationRuleType, time: '09:00' },
                                    { name: 'Midday Reminder', type: 'pending_reminder' as NotificationRuleType, time: '14:00' },
                                    { name: 'EOD Wrap-up', type: 'eod_summary' as NotificationRuleType, time: '18:30' },
                                    { name: 'Overdue Alert', type: 'overdue_alert' as NotificationRuleType, time: '11:30' }
                                ].map(preset => (
                                    <button
                                        key={preset.name}
                                        type="button"
                                        onClick={() => {
                                            setNewRuleForm(prev => ({
                                                ...prev,
                                                name: preset.name,
                                                ruleType: preset.type,
                                                targetTimeIST: preset.time,
                                                taskFilters: {
                                                    ...prev.taskFilters,
                                                    onlyPending: preset.type === 'pending_reminder' || preset.type === 'overdue_alert'
                                                }
                                            }));
                                        }}
                                        className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-left text-xs font-bold text-slate-800 transition-colors cursor-pointer"
                                    >
                                        <span className="block truncate">{preset.name}</span>
                                        <span className="text-[10px] text-slate-400 font-mono block">{preset.time} IST</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Form Fields */}
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1">
                                    Rule Name
                                </label>
                                <input
                                    type="text"
                                    value={newRuleForm.name}
                                    placeholder="e.g. Afternoon Team Standup Reminder"
                                    onChange={(e) => setNewRuleForm(prev => ({ ...prev, name: e.target.value }))}
                                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1">
                                        Rule Type
                                    </label>
                                    <select
                                        value={newRuleForm.ruleType}
                                        onChange={(e) => setNewRuleForm(prev => ({ ...prev, ruleType: e.target.value as NotificationRuleType }))}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    >
                                        <option value="morning_digest">Morning Kickoff (09:00)</option>
                                        <option value="pending_reminder">Midday Pending Reminder (14:00)</option>
                                        <option value="eod_summary">End-of-Day Summary (18:30)</option>
                                        <option value="overdue_alert">Overdue Task Alert (Escalation)</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1">
                                        Dispatch Time (IST)
                                    </label>
                                    <TwelveHourTimePicker
                                        value={newRuleForm.targetTimeIST}
                                        onChange={(val) => setNewRuleForm(prev => ({ ...prev, targetTimeIST: val }))}
                                    />
                                </div>
                            </div>

                            {/* Active Days */}
                            <div>
                                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                                    Active Days of Week
                                </label>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    {[
                                        { day: 1, label: 'Mon' },
                                        { day: 2, label: 'Tue' },
                                        { day: 3, label: 'Wed' },
                                        { day: 4, label: 'Thu' },
                                        { day: 5, label: 'Fri' },
                                        { day: 6, label: 'Sat' },
                                        { day: 0, label: 'Sun' }
                                    ].map(({ day, label }) => {
                                        const isActive = newRuleForm.daysOfWeek.includes(day);
                                        return (
                                            <button
                                                key={`new-rule-day-${day}`}
                                                type="button"
                                                onClick={() => {
                                                    const nextDays = isActive
                                                        ? newRuleForm.daysOfWeek.filter(d => d !== day)
                                                        : [...newRuleForm.daysOfWeek, day].sort((a, b) => a - b);
                                                    setNewRuleForm(prev => ({ ...prev, daysOfWeek: nextDays }));
                                                }}
                                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                                                    isActive
                                                        ? 'bg-slate-900 text-white shadow-2xs font-black'
                                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                }`}
                                            >
                                                {label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Modal Action Buttons */}
                        <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setShowAddRuleModal(false)}
                                className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={actionLoading || !newRuleForm.name.trim()}
                                onClick={handleCreateNewRule}
                                className="flex items-center gap-1.5 px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs shadow-xs transition-all disabled:opacity-50 cursor-pointer"
                            >
                                {actionLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5 text-amber-400" />}
                                <span>Create & Arm Rule</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Phase 6: Notification Dispatch History & Activity Audit Trail Card */}
            <div className={`bg-white border border-slate-200 rounded-3xl p-6 md:p-8 shadow-sm space-y-5 transition-all ${animationStep >= 3 ? 'tm-slide-up-visible' : 'tm-slide-up-hidden'}`}>
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                    <div>
                        <div className="flex items-center gap-2.5 flex-wrap">
                            <div className="p-2 bg-indigo-50 border border-indigo-200 rounded-xl text-indigo-600">
                                <History className="w-5 h-5" />
                            </div>
                            <h2 className="text-lg md:text-xl font-black text-slate-900 tracking-tight">
                                Notification Dispatch History & Activity Audit Trail
                            </h2>
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-indigo-50 text-indigo-700 border border-indigo-200">
                                {auditLogs.length} Events
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                            Real-time audit trail of automated cron triggers, dry-run simulations, WhatsApp dispatches, and administrative safety changes.
                        </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            type="button"
                            disabled={loadingLogs}
                            onClick={fetchAuditLogs}
                            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                            title="Refresh audit logs from database"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin text-primary' : 'text-slate-500'}`} />
                            <span>Refresh Trail</span>
                        </button>
                        {auditLogs.length > 0 && (
                            <button
                                type="button"
                                disabled={loadingLogs}
                                onClick={handleClearLogs}
                                className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 rounded-xl font-bold text-xs shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                                title="Clear all notification audit events"
                            >
                                <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                                <span>Clear Trail</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* Category Filter Pills (Phase 6) */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar flex-wrap">
                    <span className="text-xs font-bold text-slate-400 mr-1">Filter Activity:</span>
                    {[
                        { id: 'all', label: 'All Activity', count: auditLogs.length },
                        { id: 'whatsapp', label: 'WhatsApp Dispatches', count: auditLogs.filter(l => l.event_type === 'whatsapp_sent' || !l.event_type).length },
                        { id: 'safety', label: 'Kill Switches & Safety', count: auditLogs.filter(l => l.event_type === 'kill_switch_updated').length },
                        { id: 'roster', label: 'Roster & Managers', count: auditLogs.filter(l => ['employee_transferred', 'manager_role_assigned', 'manager_role_removed', 'employee_kickoff_sent', 'manager_kickoff_sent'].includes(l.event_type)).length },
                    ].map(tab => {
                        const active = auditFilterCategory === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setAuditFilterCategory(tab.id as any)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                                    active
                                        ? 'bg-indigo-600 text-white shadow-xs'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                            >
                                <span>{tab.label}</span>
                                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                                    active ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-600'
                                }`}>
                                    {tab.count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Filtered Logs List or Empty State */}
                {(() => {
                    const filteredLogs = auditLogs.filter(log => {
                        if (auditFilterCategory === 'whatsapp') {
                            return log.event_type === 'whatsapp_sent' || !log.event_type;
                        }
                        if (auditFilterCategory === 'safety') {
                            return log.event_type === 'kill_switch_updated';
                        }
                        if (auditFilterCategory === 'roster') {
                            return ['employee_transferred', 'manager_role_assigned', 'manager_role_removed', 'employee_kickoff_sent', 'manager_kickoff_sent'].includes(log.event_type);
                        }
                        return true;
                    });

                    if (filteredLogs.length === 0) {
                        return (
                            <div className="p-8 text-center bg-slate-50/70 rounded-2xl border border-dashed border-slate-200 space-y-2">
                                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-500 mx-auto flex items-center justify-center border border-indigo-100">
                                    <Clock className="w-6 h-6" />
                                </div>
                                <h4 className="text-sm font-bold text-slate-800">No Events in this Category</h4>
                                <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                                    Activity recorded during simulations, kill switch toggles, staff transfers, or WhatsApp dispatches will appear here.
                                </p>
                            </div>
                        );
                    }

                    return (
                        <div className="space-y-3">
                            {filteredLogs.map(log => {
                                const details = log.details || {};
                                const isExpanded = expandedLogId === log.id;
                                const isCopied = copiedLogId === log.id;

                                // ── 1. Safety / Kill Switch Event ──
                                if (log.event_type === 'kill_switch_updated') {
                                    const isHalted = Boolean(details.globalHalt);
                                    return (
                                        <div
                                            key={log.id}
                                            className={`border rounded-2xl transition-all duration-150 overflow-hidden border-l-4 ${
                                                isHalted ? 'border-l-rose-500 bg-rose-50/20' : 'border-l-emerald-500 bg-white'
                                            } border-slate-200 p-4`}
                                        >
                                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                                                <div className="space-y-1.5 flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-md">
                                                            <Clock className="w-3 h-3 text-slate-400" />
                                                            {formatISTTime(log.created_at)}
                                                        </span>
                                                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                                                            🛡️ Safety Control
                                                        </span>
                                                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                                            isHalted
                                                                ? 'bg-rose-100 text-rose-900 border border-rose-300'
                                                                : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                                                        }`}>
                                                            {isHalted ? '🛑 Company-Wide Halt Engaged' : '🟢 Messaging Resumed / Updated'}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-slate-700 font-medium pt-0.5">
                                                        {details.haltReason || 'WhatsApp Kill Switch configuration updated by administrator.'}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }

                                // ── 1b. Pretend Mode Changed Event ──
                                if (log.event_type === 'pretend_mode_updated') {
                                    const isOn = Boolean(details.pretendMode);
                                    return (
                                        <div
                                            key={log.id}
                                            className={`border rounded-2xl overflow-hidden border-l-4 ${
                                                isOn ? 'border-l-indigo-500 bg-indigo-50/20' : 'border-l-amber-500 bg-amber-50/30'
                                            } border-slate-200 p-4`}
                                        >
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-md">
                                                    <Clock className="w-3 h-3 text-slate-400" />
                                                    {formatISTTime(log.created_at)}
                                                </span>
                                                <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                                                    🛡️ Safety Control
                                                </span>
                                                <span className="text-xs font-bold text-slate-800">
                                                    {isOn ? 'Pretend Mode turned ON' : 'Pretend Mode turned OFF'}
                                                    {details.actor ? ` by ${details.actor}` : ''}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                }

                                // ── 2. Staff Transfer Event ──
                                if (log.event_type === 'employee_transferred') {
                                    return (
                                        <div
                                            key={log.id}
                                            className="border rounded-2xl transition-all duration-150 overflow-hidden border-l-4 border-l-indigo-500 border-slate-200 bg-white p-4"
                                        >
                                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                                                <div className="space-y-1.5 flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-md">
                                                            <Clock className="w-3 h-3 text-slate-400" />
                                                            {formatISTTime(log.created_at)}
                                                        </span>
                                                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200">
                                                            ⇄ Department Transfer
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-3 text-xs text-slate-700 flex-wrap pt-0.5">
                                                        <span className="font-bold text-slate-900">
                                                            👤 {details.employeeName || 'Staff Member'}
                                                        </span>
                                                        <span className="text-slate-300">•</span>
                                                        <span className="font-medium text-slate-600">
                                                            From: <strong className="text-slate-800">{details.fromDepartment || 'Unassigned'}</strong>
                                                        </span>
                                                        <span>→</span>
                                                        <span className="font-medium text-indigo-700">
                                                            To: <strong className="text-indigo-900">{details.toDepartment}</strong>
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }

                                // ── 3. Manager Role Changed Event ──
                                if (log.event_type === 'manager_role_assigned' || log.event_type === 'manager_role_removed') {
                                    const isAssigned = log.event_type === 'manager_role_assigned';
                                    return (
                                        <div
                                            key={log.id}
                                            className={`border rounded-2xl transition-all duration-150 overflow-hidden border-l-4 ${
                                                isAssigned ? 'border-l-amber-500 bg-amber-50/20' : 'border-l-slate-400 bg-white'
                                            } border-slate-200 p-4`}
                                        >
                                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                                                <div className="space-y-1.5 flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-md">
                                                            <Clock className="w-3 h-3 text-slate-400" />
                                                            {formatISTTime(log.created_at)}
                                                        </span>
                                                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${
                                                            isAssigned ? 'bg-amber-100 text-amber-900 border-amber-200' : 'bg-slate-100 text-slate-700 border-slate-200'
                                                        }`}>
                                                            {isAssigned ? '👑 Manager Role Assigned' : '👤 Role Reverted to Employee'}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-slate-700 font-medium pt-0.5">
                                                        Department: <strong className="text-slate-900">{details.department || 'Tech'}</strong>
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }

                                // ── 4. Kickoff Dispatched Event ──
                                if (log.event_type === 'manager_kickoff_sent' || log.event_type === 'employee_kickoff_sent') {
                                    const isMgrKickoff = log.event_type === 'manager_kickoff_sent';
                                    return (
                                        <div
                                            key={log.id}
                                            className="border rounded-2xl transition-all duration-150 overflow-hidden border-l-4 border-l-emerald-500 border-slate-200 bg-white p-4"
                                        >
                                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                                                <div className="space-y-1.5 flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-md">
                                                            <Clock className="w-3 h-3 text-slate-400" />
                                                            {formatISTTime(log.created_at)}
                                                        </span>
                                                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-800 border border-emerald-200">
                                                            {isMgrKickoff ? '👑 Manager Kickoff Dispatched' : '👥 Employee Kickoff Dispatched'}
                                                        </span>
                                                        <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                                                            {details.campaignName}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-3 text-xs text-slate-600 flex-wrap pt-0.5">
                                                        <span className="font-bold text-slate-900">
                                                            👤 {details.managerName || details.empName}
                                                        </span>
                                                        {details.targetPhone && (
                                                            <span className="font-mono text-slate-500">
                                                                📱 {details.targetPhone}
                                                            </span>
                                                        )}
                                                        <span className="text-slate-300">•</span>
                                                        <span className="font-medium text-slate-700">
                                                            Dept: {details.deptName || 'Tech'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }

                                // ── 4b. Any other recorded event (access changes, messages received, task updates, ...) ──
                                // Shown as a plain row so it is never mistaken for a sent WhatsApp message.
                                if (log.event_type && log.event_type !== 'whatsapp_sent' && log.event_type !== 'whatsapp_blocked_by_kill_switch') {
                                    const summary = JSON.stringify(details);
                                    return (
                                        <div key={log.id} className="border rounded-2xl overflow-hidden border-l-4 border-l-slate-300 border-slate-200 bg-white p-3">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-md">
                                                    <Clock className="w-3 h-3 text-slate-400" />
                                                    {formatISTTime(log.created_at)}
                                                </span>
                                                <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                                                    {String(log.event_type).replace(/_/g, ' ')}
                                                </span>
                                                <span className="text-[11px] text-slate-500 truncate max-w-full">
                                                    {summary.length > 160 ? summary.slice(0, 160) + '…' : summary}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                }

                                // ── 5. Standard WhatsApp Notification Dispatch (whatsapp_sent) ──
                                const isBlocked = log.event_type === 'whatsapp_blocked_by_kill_switch';
                                const isPretend = Boolean(details.pretend);
                                const isDryRun = !isBlocked && (details.dryRun || details.status === 'simulated');
                                const isFailed = details.status === 'failed';

                                const ruleType = details.type || details.ruleType || 'morning_digest';
                                let ruleBadgeColor = 'bg-amber-50 text-amber-800 border-amber-200';
                                if (ruleType === 'pending_reminder') ruleBadgeColor = 'bg-sky-50 text-sky-800 border-sky-200';
                                if (ruleType === 'eod_summary') ruleBadgeColor = 'bg-indigo-50 text-indigo-800 border-indigo-200';
                                if (ruleType === 'overdue_alert') ruleBadgeColor = 'bg-rose-50 text-rose-800 border-rose-200';

                                return (
                                    <div
                                        key={log.id}
                                        className={`border rounded-2xl transition-all duration-150 overflow-hidden border-l-4 ${
                                            isFailed || isBlocked
                                                ? 'border-l-rose-500'
                                                : isDryRun
                                                ? 'border-l-amber-500'
                                                : 'border-l-emerald-500'
                                        } ${
                                            isExpanded ? 'border-slate-300 bg-slate-50/50 shadow-xs' : 'border-slate-200 bg-white hover:border-slate-300'
                                        }`}
                                    >
                                        <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                                            <div className="space-y-1.5 flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-md">
                                                        <Clock className="w-3 h-3 text-slate-400" />
                                                        {formatISTTime(log.created_at)}
                                                    </span>
                                                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${ruleBadgeColor}`}>
                                                        {details.ruleName || details.type || 'WhatsApp Notification'}
                                                    </span>
                                                    {isBlocked ? (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-900 border border-rose-300">
                                                            <Ban className="w-3 h-3 text-rose-600" />
                                                            Blocked (Not Sent)
                                                        </span>
                                                    ) : isDryRun ? (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300">
                                                            <Shield className="w-3 h-3 text-amber-600" />
                                                            {isPretend ? 'Pretend (Not Sent)' : 'Simulated (Dry-Run)'}
                                                        </span>
                                                    ) : isFailed ? (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-900 border border-rose-300">
                                                            <AlertCircle className="w-3 h-3 text-rose-600" />
                                                            Failed
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-900 border border-emerald-300">
                                                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                                            Live Sent
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-3 text-xs text-slate-600 flex-wrap pt-0.5">
                                                    <span className="font-bold text-slate-900">
                                                        👤 {details.employeeName || 'Tech Employee'}
                                                    </span>
                                                    {details.phone && (
                                                        <span className="font-mono text-slate-500">
                                                            📱 {details.phone}
                                                        </span>
                                                    )}
                                                    <span className="text-slate-300">•</span>
                                                    <span className="font-medium text-slate-700">
                                                        📋 {details.taskCount !== undefined ? `${details.taskCount} task${details.taskCount === 1 ? '' : 's'}` : isBlocked ? 'Message stopped' : isPretend ? 'Message saved' : 'Digest sent'}
                                                    </span>
                                                    {(details.error || (isBlocked && details.reason)) && (
                                                        <span className="text-rose-600 font-medium">
                                                            ⚠️ {details.error || details.reason}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {details.preview && (
                                                <div className="flex items-center gap-2 self-start md:self-auto flex-shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                                                    >
                                                        <Eye className="w-3.5 h-3.5 text-slate-500" />
                                                        <span>{isExpanded ? 'Hide Message' : 'View Message'}</span>
                                                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {isExpanded && details.preview && (
                                            <div className="px-4 pb-4 pt-1 border-t border-slate-100 bg-slate-50/70">
                                                <div className="max-w-2xl bg-[#EFEAE2] p-4 rounded-2xl border border-[#D1D7DB] shadow-xs space-y-2 mt-2">
                                                    <div className="flex items-center justify-between pb-1.5 border-b border-[#D1D7DB]/60">
                                                        <span className="text-[10px] font-black text-slate-600 uppercase tracking-wider flex items-center gap-1">
                                                            <MessageSquare className="w-3 h-3 text-emerald-600" /> WhatsApp Message Copy
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleCopyLogPreview(log.id, details.preview)}
                                                            className="flex items-center gap-1 text-[10px] font-bold text-slate-600 hover:text-slate-900 bg-white px-2 py-0.5 rounded-md border border-slate-200 shadow-2xs transition-colors cursor-pointer"
                                                        >
                                                            {isCopied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                                            <span>{isCopied ? 'Copied!' : 'Copy Text'}</span>
                                                        </button>
                                                    </div>
                                                    <div className="bg-white rounded-xl p-3 shadow-xs border border-emerald-100 text-slate-800 text-[11px] font-sans leading-relaxed whitespace-pre-line">
                                                        {details.preview}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })()}
            </div>

            {/* Step 3: Who is unlocked for the Task Manager (department switch + kickoff status) */}
            <TaskAccessPanel orgId={orgId} />

            {/* Step 2: Read-only reporting chain preview (from reporting_manager_id) */}
            <OrgHierarchyPanel orgId={orgId} />

            {/* Main Interactive Control Card */}
            <div className={`bg-white border border-slate-200 rounded-3xl p-6 md:p-8 shadow-sm space-y-6 ${animationStep >= 4 ? 'tm-slide-up-visible' : 'tm-slide-up-hidden'}`}>
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
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold transition-colors cursor-pointer"
                    >
                        👤 Myself (Sahil Gorde)
                    </button>
                    {currentDepartmentSummary?.manager && (
                        <button
                            type="button"
                            onClick={() => setSelectedEmployeeId(currentDepartmentSummary.manager!.id)}
                            className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg font-bold transition-colors cursor-pointer"
                        >
                            👑 {currentDepartment?.name} Manager ({currentDepartmentSummary.manager.first_name})
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => quickSelect('9100256500')}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold transition-colors cursor-pointer"
                    >
                        👑 Lohitaksha Ranganathan
                    </button>
                    <button
                        type="button"
                        onClick={() => quickSelect('7028232515')}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold transition-colors cursor-pointer"
                    >
                        ⚡ Harsh Patil
                    </button>
                </div>

                {/* Dropdown Selector */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-black text-slate-700 uppercase tracking-wider">
                                Select Employee
                            </label>
                            {/* Scope Filter: Selected Dept vs All Company Staff */}
                            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                                <button
                                    type="button"
                                    onClick={() => setDeptFilterScope('department')}
                                    className={`px-2 py-0.5 text-[10px] font-extrabold rounded-md transition-all cursor-pointer ${
                                        deptFilterScope === 'department'
                                            ? 'bg-white text-slate-900 shadow-2xs'
                                            : 'text-slate-500 hover:text-slate-900'
                                    }`}
                                >
                                    {currentDepartment?.name || 'Dept'} ({departmentMembers.length})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDeptFilterScope('all')}
                                    className={`px-2 py-0.5 text-[10px] font-extrabold rounded-md transition-all cursor-pointer ${
                                        deptFilterScope === 'all'
                                            ? 'bg-white text-slate-900 shadow-2xs'
                                            : 'text-slate-500 hover:text-slate-900'
                                    }`}
                                >
                                    All Staff ({employees.length})
                                </button>
                            </div>
                        </div>
                        <select
                            value={selectedEmployeeId}
                            onChange={(e) => setSelectedEmployeeId(e.target.value)}
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                        >
                            {displayedEmployees.map(emp => (
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
                                {actionLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
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
                                {actionLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                {actionLoading ? 'Sending Kickoff...' : 'Send Employee Kickoff'}
                            </button>

                            {/* Remove Role Button */}
                            <button
                                type="button"
                                disabled={actionLoading}
                                onClick={() => handleRoleAction('remove_manager')}
                                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-50"
                            >
                                {actionLoading ? <RefreshCw className="w-4 h-4 animate-spin text-rose-500" /> : <UserX className="w-4 h-4 text-rose-500" />}
                                {actionLoading ? 'Removing...' : 'Remove Manager Role (Revert)'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Meta Approved Templates & WhatsApp Quick Reply Cheatsheet */}
            <div className={`bg-slate-900 text-white rounded-3xl p-6 md:p-8 space-y-5 ${animationStep >= 5 ? 'tm-slide-up-visible' : 'tm-slide-up-hidden'}`}>
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

            {/* ── Phase 4 Modal: Transfer Employee Department ── */}
            {transferModal.isOpen && transferModal.employee && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-5">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                            <div className="flex items-center gap-2">
                                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                                    <ArrowLeftRight className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="font-black text-base text-slate-900">Transfer Department</h3>
                                    <p className="text-xs text-slate-500">Move employee to a different department</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setTransferModal({ isOpen: false, employee: null, targetDeptId: '', keepRole: false })}
                                className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 space-y-1">
                            <p className="text-xs font-bold text-slate-800">
                                👤 {transferModal.employee.first_name} {transferModal.employee.last_name || ''}
                            </p>
                            <p className="text-[11px] text-slate-500 font-mono">
                                Current Dept: <strong className="text-slate-700">{transferModal.employee.department || currentDepartment?.name || 'Unassigned'}</strong>
                            </p>
                        </div>

                        <div>
                            <label className="text-xs font-black uppercase text-slate-700 tracking-wider block mb-2">
                                Target Department
                            </label>
                            <select
                                value={transferModal.targetDeptId}
                                onChange={(e) => setTransferModal(prev => ({ ...prev, targetDeptId: e.target.value }))}
                                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                            >
                                <option value="" disabled>Select destination department...</option>
                                {departments.filter(d => d.id !== transferModal.employee?.department_id).map(dept => (
                                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                                ))}
                            </select>
                        </div>

                        <label className="flex items-center gap-2.5 cursor-pointer p-3 rounded-xl bg-slate-50 border border-slate-100">
                            <input
                                type="checkbox"
                                checked={transferModal.keepRole}
                                onChange={(e) => setTransferModal(prev => ({ ...prev, keepRole: e.target.checked }))}
                                className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
                            />
                            <span className="text-xs font-bold text-slate-700">
                                Keep Reporting Manager role in new department (if applicable)
                            </span>
                        </label>

                        <div className="flex items-center justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => setTransferModal({ isOpen: false, employee: null, targetDeptId: '', keepRole: false })}
                                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={actionLoading || !transferModal.targetDeptId}
                                onClick={handleTransferEmployeeSubmit}
                                className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold text-xs shadow-xs transition-all cursor-pointer disabled:opacity-50"
                            >
                                {actionLoading ? 'Transferring...' : 'Confirm Transfer ⇄'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Phase 4 Modal: Add Member to Department ── */}
            {showAddMemberModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-5">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                            <div className="flex items-center gap-2">
                                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                                    <Plus className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="font-black text-base text-slate-900">Add Member to {currentDepartment?.name}</h3>
                                    <p className="text-xs text-slate-500">Assign an existing employee to this department</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => { setShowAddMemberModal(false); setAddMemberEmployeeId(''); }}
                                className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div>
                            <label className="text-xs font-black uppercase text-slate-700 tracking-wider block mb-2">
                                Select Staff Member
                            </label>
                            <select
                                value={addMemberEmployeeId}
                                onChange={(e) => setAddMemberEmployeeId(e.target.value)}
                                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                            >
                                <option value="" disabled>Choose employee to add...</option>
                                {employees
                                    .filter(e => e.department_id !== currentDepartment?.id && e.department?.toLowerCase() !== currentDepartment?.name.toLowerCase())
                                    .map(emp => (
                                        <option key={emp.id} value={emp.id}>
                                            {emp.first_name} {emp.last_name || ''} ({emp.department || 'Unassigned'})
                                        </option>
                                    ))
                                }
                            </select>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => { setShowAddMemberModal(false); setAddMemberEmployeeId(''); }}
                                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={actionLoading || !addMemberEmployeeId}
                                onClick={handleAddMemberSubmit}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-xs transition-all cursor-pointer disabled:opacity-50"
                            >
                                {actionLoading ? 'Adding...' : 'Add to Department 👥'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Phase 6 Modal: Prominent Safety Confirmation Dialog ── */}
            {confirmModal.isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
                        <div className="flex items-start gap-3">
                            <div className={`p-2.5 rounded-2xl flex-shrink-0 ${
                                confirmModal.confirmColor === 'rose'
                                    ? 'bg-rose-50 text-rose-600 border border-rose-200'
                                    : confirmModal.confirmColor === 'amber'
                                        ? 'bg-amber-50 text-amber-600 border border-amber-200'
                                        : 'bg-primary/10 text-primary border border-primary/20'
                            }`}>
                                <AlertTriangle className="w-5 h-5" />
                            </div>
                            <div className="space-y-1">
                                <h3 className="font-black text-base text-slate-900 leading-snug">
                                    {confirmModal.title}
                                </h3>
                                <p className="text-xs text-slate-500 leading-relaxed">
                                    {confirmModal.message}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                            <button
                                type="button"
                                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirmModal.onConfirm}
                                className={`px-4 py-2 text-white rounded-xl font-black text-xs shadow-xs transition-all cursor-pointer active:scale-98 ${
                                    confirmModal.confirmColor === 'rose'
                                        ? 'bg-rose-600 hover:bg-rose-700'
                                        : confirmModal.confirmColor === 'amber'
                                            ? 'bg-amber-600 hover:bg-amber-700'
                                            : 'bg-primary hover:bg-primary/90'
                                }`}
                            >
                                {confirmModal.confirmLabel}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Animation & Responsive Spacing System matching TaskAssignmentDashboard */}
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
                    transition: opacity 800ms cubic-bezier(0.16, 1, 0.3, 1), transform 900ms cubic-bezier(0.16, 1, 0.3, 1) !important;
                }
                .tm-slide-left-hidden  { transform: translateX(-40px) !important; }
                .tm-slide-right-hidden { transform: translateX(40px) !important; }

                /* Vertical slides */
                .tm-slide-down-hidden, .tm-slide-down-visible,
                .tm-slide-up-hidden, .tm-slide-up-visible {
                    transition: opacity 800ms cubic-bezier(0.16, 1, 0.3, 1), transform 900ms cubic-bezier(0.16, 1, 0.3, 1) !important;
                }
                .tm-slide-down-hidden { transform: translateY(-30px) !important; }
                .tm-slide-up-hidden   { transform: translateY(30px) !important; }
            `}</style>
        </div>
    );
}
