'use client';

import React, { useState } from 'react';
import { ShieldCheck, HelpCircle, Lock, EyeOff, Clock, ArrowDown, User, Shield, AlertTriangle, Building2, CheckCircle2, ChevronRight, Info, Layers, Sparkles, X, Check } from 'lucide-react';
import { SearchableEmployeeSelector, formatSlaDisplay } from '@/frontend/components/hr/HRAdminConfigPanel';

interface EscalationLevel {
    level: number;
    title: string;
    ownerRole: string;
    ownerType: string;
    slaText: string;
    slaHours: string;
    description: string;
    escalationTrigger: string;
    badgeColor: string;
    borderColor: string;
    bgColor: string;
    icon: React.ReactNode;
}

interface ClassificationFlow {
    id: string;
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    color: string;
    levels: EscalationLevel[];
}

const escalationFlows: ClassificationFlow[] = [
    {
        id: 'grievance',
        title: 'Employee Grievance',
        subtitle: 'Routed to Reporting Manager / HOD (L1) -> HR Department (L2) -> HR Head (L3) -> Director (L4)',
        icon: <ShieldCheck className="w-5 h-5 text-amber-500" />,
        color: 'amber',
        levels: [
            {
                level: 1,
                title: 'Level 1: Initial Ownership',
                ownerRole: 'Reporting Manager / HOD',
                ownerType: 'reporting_manager',
                slaText: '3 Working Days',
                slaHours: '72 Hours',
                description: 'Direct reporting manager conducts initial investigation, talks to employee, and attempts internal resolution.',
                escalationTrigger: 'If unresolved or no response after 3 Working Days',
                badgeColor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300',
                borderColor: 'border-emerald-300 dark:border-emerald-800',
                bgColor: 'bg-emerald-50/40 dark:bg-emerald-950/20',
                icon: <User className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            },
            {
                level: 2,
                title: 'Level 2: HR Department Escalation',
                ownerRole: 'HR Department',
                ownerType: 'hr',
                slaText: '7 Working Days',
                slaHours: '96 Hours',
                description: 'HR Department steps in to mediate between employee and department, reviews policy guidelines and formal grievances.',
                escalationTrigger: 'If unresolved or pending after 7 Working Days total',
                badgeColor: 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300',
                borderColor: 'border-blue-300 dark:border-blue-800',
                bgColor: 'bg-blue-50/40 dark:bg-blue-950/20',
                icon: <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            },
            {
                level: 3,
                title: 'Level 3: HR Head Review',
                ownerRole: 'HR Head',
                ownerType: 'hr_head',
                slaText: '10 Working Days',
                slaHours: '72 Hours',
                description: 'HR Head takes over high-level mediation, formal committee review, and binding policy decisions.',
                escalationTrigger: 'If unresolved after 10 Working Days total',
                badgeColor: 'bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300',
                borderColor: 'border-purple-300 dark:border-purple-800',
                bgColor: 'bg-purple-50/40 dark:bg-purple-950/20',
                icon: <Shield className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            },
            {
                level: 4,
                title: 'Level 4: Final Internal Escalation',
                ownerRole: 'Director',
                ownerType: 'director',
                slaText: '12 Working Days',
                slaHours: 'Final SLA',
                description: 'Escalated to Director for final internal resolution, compliance audit, or policy exception approval.',
                escalationTrigger: 'SLA Breach Flagged on Organization MIS Dashboard',
                badgeColor: 'bg-red-100 text-red-800 dark:bg-red-950/80 dark:text-red-300',
                borderColor: 'border-red-300 dark:border-red-800',
                bgColor: 'bg-red-50/40 dark:bg-red-950/20',
                icon: <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            }
        ]
    },
    {
        id: 'hr_query',
        title: 'HR-Related Queries',
        subtitle: 'Direct routing to HR Department Helpdesk for quick operational response',
        icon: <HelpCircle className="w-5 h-5 text-blue-500" />,
        color: 'blue',
        levels: [
            {
                level: 1,
                title: 'Level 1: HR Executive / HR Owner',
                ownerRole: 'HR Executive / Concerned HR Owner',
                ownerType: 'hr',
                slaText: '0 - 2 Days',
                slaHours: '48 Hours',
                description: 'Assigned HR representative reviews query (Payroll, Leave, PF/ESIC, Reimbursements) and responds directly to employee.',
                escalationTrigger: 'If query unaddressed after SLA expiry',
                badgeColor: 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300',
                borderColor: 'border-blue-300 dark:border-blue-800',
                bgColor: 'bg-blue-50/40 dark:bg-blue-950/20',
                icon: <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            },
            {
                level: 2,
                title: 'Level 2: HR Manager Escalation',
                ownerRole: 'HR Manager',
                ownerType: 'hr_head',
                slaText: 'Day 2 - Day 5',
                slaHours: '72 Hours',
                description: 'Escalated to HR Manager for salary calculation verification, tax adjustment, or policy clarification.',
                escalationTrigger: 'If query remains unresolved',
                badgeColor: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300',
                borderColor: 'border-indigo-300 dark:border-indigo-800',
                bgColor: 'bg-indigo-50/40 dark:bg-indigo-950/20',
                icon: <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            },
            {
                level: 3,
                title: 'Level 3: HR Head Review',
                ownerRole: 'HR Head',
                ownerType: 'hr_head',
                slaText: 'Day 5 - Day 7',
                slaHours: '48 Hours',
                description: 'Escalated to HR Head to resolve complex payroll disputes or policy exceptions.',
                escalationTrigger: 'If unresolved by HR Manager',
                badgeColor: 'bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300',
                borderColor: 'border-purple-300 dark:border-purple-800',
                bgColor: 'bg-purple-50/40 dark:bg-purple-950/20',
                icon: <Shield className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            },
            {
                level: 4,
                title: 'Level 4: Management Review',
                ownerRole: 'Management, wherever required',
                ownerType: 'director',
                slaText: 'Day 7+',
                slaHours: 'Final SLA',
                description: 'Final review by Management for company-wide policy exceptions or executive decisions.',
                escalationTrigger: 'SLA Breach Flagged',
                badgeColor: 'bg-red-100 text-red-800 dark:bg-red-950/80 dark:text-red-300',
                borderColor: 'border-red-300 dark:border-red-800',
                bgColor: 'bg-red-50/40 dark:bg-red-950/20',
                icon: <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            }
        ]
    },
    {
        id: 'confidential_feedback',
        title: 'Confidential / Anonymous Feedback',
        subtitle: 'Bypasses line manager completely — Direct high-level escalation to Director',
        icon: <Lock className="w-5 h-5 text-purple-500" />,
        color: 'purple',
        levels: [
            {
                level: 1,
                title: 'Level 1: Director Review',
                ownerRole: 'Director',
                ownerType: 'director',
                slaText: '0 - 2 Days',
                slaHours: '48 Hours',
                description: 'Bypasses reporting manager completely for employee privacy. Directly visible to authorized Director(s).',
                escalationTrigger: 'If unaddressed after 48 Hours',
                badgeColor: 'bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300',
                borderColor: 'border-purple-300 dark:border-purple-800',
                bgColor: 'bg-purple-50/40 dark:bg-purple-950/20',
                icon: <Lock className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            },
            {
                level: 2,
                title: 'Level 2: Board / Managing Director',
                ownerRole: 'Managing Director / Executive Board',
                ownerType: 'super_admin',
                slaText: 'Day 2+',
                slaHours: 'Final SLA',
                description: 'Direct escalation to company executive officers for confidential ethics or whistleblowing review.',
                escalationTrigger: 'Critical Priority Alert',
                badgeColor: 'bg-red-100 text-red-800 dark:bg-red-950/80 dark:text-red-300',
                borderColor: 'border-red-300 dark:border-red-800',
                bgColor: 'bg-red-50/40 dark:bg-red-950/20',
                icon: <Shield className="w-5 h-5 text-red-600 dark:text-red-400" />
            }
        ]
    },
    {
        id: 'anonymous_feedback',
        title: 'Anonymous Feedback',
        subtitle: 'Identity-masked submission — Routed directly to Director',
        icon: <EyeOff className="w-5 h-5 text-slate-500" />,
        color: 'slate',
        levels: [
            {
                level: 1,
                title: 'Level 1: Anonymous Ethics Channel',
                ownerRole: 'Director',
                ownerType: 'director',
                slaText: '0 - 3 Days',
                slaHours: '72 Hours',
                description: 'Employee identity is cryptographically masked. Routed directly to Director without sender identity.',
                escalationTrigger: 'If unaddressed after 72 Hours',
                badgeColor: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
                borderColor: 'border-slate-300 dark:border-slate-700',
                bgColor: 'bg-slate-100/50 dark:bg-slate-800/40',
                icon: <EyeOff className="w-5 h-5 text-slate-600 dark:text-slate-400" />
            },
            {
                level: 2,
                title: 'Level 2: Executive Board Audit',
                ownerRole: 'Managing Director / Executive Board',
                ownerType: 'director',
                slaText: 'Day 3+',
                slaHours: 'Final SLA',
                description: 'Escalated to Managing Director to ensure company culture feedback is reviewed and actioned.',
                escalationTrigger: 'SLA Breach Flagged',
                badgeColor: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300',
                borderColor: 'border-indigo-300 dark:border-indigo-800',
                bgColor: 'bg-indigo-50/40 dark:bg-indigo-950/20',
                icon: <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            }
        ]
    }
];

interface HREscalationTreeVisualizerProps {
    designatedHrManagers?: any[];
    designatedHrHeads?: any[];
    designatedDirectors?: any[];
    designatedHrHead?: any;
    designatedDirector?: any;
    employeesList?: any[];
    selectedDirectorIds?: string[];
    onAddDirector?: (id: string) => void;
    onRemoveDirector?: (id: string) => void;
    selectedHrHeadIds?: string[];
    onAddHrHead?: (id: string) => void;
    onRemoveHrHead?: (id: string) => void;
    selectedHrManagerIds?: string[];
    onAddHrManager?: (id: string) => void;
    onRemoveHrManager?: (id: string) => void;
    onSaveAuthorities?: () => Promise<void>;
    savingAuthorities?: boolean;
    authoritySaveMsg?: string;
    authorityErrorMsg?: string;
}

export default function HREscalationTreeVisualizer({
    designatedHrManagers: initialHrManagers,
    designatedHrHeads: initialHrHeads,
    designatedDirectors: initialDirectors,
    designatedHrHead: initialHrHead,
    designatedDirector: initialDirector,
    employeesList = [],
    selectedDirectorIds = [],
    onAddDirector,
    onRemoveDirector,
    selectedHrHeadIds = [],
    onAddHrHead,
    onRemoveHrHead,
    selectedHrManagerIds = [],
    onAddHrManager,
    onRemoveHrManager,
    onSaveAuthorities,
    savingAuthorities = false,
    authoritySaveMsg,
    authorityErrorMsg
}: HREscalationTreeVisualizerProps = {}) {
    const [selectedFlowId, setSelectedFlowId] = useState<string>('grievance');
    const [hrManagers, setHrManagers] = React.useState<any[]>(initialHrManagers || []);
    const [hrHeads, setHrHeads] = React.useState<any[]>(
        initialHrHeads || (initialHrHead ? [initialHrHead] : [])
    );
    const [directors, setDirectors] = React.useState<any[]>(
        initialDirectors || (initialDirector ? [initialDirector] : [])
    );

    React.useEffect(() => {
        if (initialHrManagers !== undefined) setHrManagers(initialHrManagers);

        if (initialHrHeads !== undefined) setHrHeads(initialHrHeads);
        else if (initialHrHead !== undefined) setHrHeads(initialHrHead ? [initialHrHead] : []);

        if (initialDirectors !== undefined) setDirectors(initialDirectors);
        else if (initialDirector !== undefined) setDirectors(initialDirector ? [initialDirector] : []);
    }, [initialHrManagers, initialHrHeads, initialDirectors, initialHrHead, initialDirector]);

    React.useEffect(() => {
        if (!initialHrManagers && !initialHrHeads && !initialDirectors && !initialHrHead && !initialDirector) {
            fetch('/api/hr/admin/escalation-config')
                .then(res => res.json())
                .then(data => {
                    if (data.success && data.data) {
                        setHrManagers(data.data.designated_hr_managers || []);
                        setHrHeads(data.data.designated_hr_heads || (data.data.designated_hr_head ? [data.data.designated_hr_head] : []));
                        setDirectors(data.data.designated_directors || (data.data.designated_director ? [data.data.designated_director] : []));
                    }
                })
                .catch(err => console.error(err));
        }
    }, []);

    const currentFlow = escalationFlows.find(f => f.id === selectedFlowId) || escalationFlows[0];

    return (
        <div className="space-y-6">
            {/* Header Banner */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-2xl">
                                <Layers className="w-5 h-5" />
                            </div>
                            <h2 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                                HR SLA & Automatic Escalation Tree Hierarchy
                            </h2>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
                            Visual graphical flow showing how tickets auto-escalate across organizational tiers when SLA timers expire.
                        </p>
                    </div>

                    <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-xs font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
                        <Sparkles className="w-4 h-4 text-emerald-500 animate-pulse" />
                        <span>Live System Auto-Escalation Active</span>
                    </div>
                </div>

                {/* Classification Navigation Tabs */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                    {escalationFlows.map((flow) => {
                        const isSelected = flow.id === selectedFlowId;
                        return (
                            <button
                                key={flow.id}
                                type="button"
                                onClick={() => setSelectedFlowId(flow.id)}
                                className={`p-3 rounded-2xl border text-xs font-bold flex items-center gap-2.5 transition-all text-left ${
                                    isSelected
                                        ? 'bg-[#587e85] text-white border-[#587e85] shadow-md shadow-[#587e85]/20 scale-[1.02]'
                                        : 'bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                            >
                                <div className={`p-1.5 rounded-xl ${isSelected ? 'bg-white/20 text-white' : 'bg-white dark:bg-slate-900 shadow-xs'}`}>
                                    {flow.icon}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-xs font-black">{flow.title}</div>
                                    <div className={`text-[10px] truncate ${isSelected ? 'text-indigo-100' : 'text-slate-400'}`}>
                                        {flow.levels.length} Escalation Levels
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Graphical Tree Flow Visualization Card */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-8">
                {/* Active Flow Sub-Header */}
                <div className="border-b border-slate-100 dark:border-slate-800 pb-4 flex items-center justify-between">
                    <div>
                        <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                            {currentFlow.icon}
                            {currentFlow.title} Hierarchy Tree
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">{currentFlow.subtitle}</p>
                    </div>
                    <span className="px-3 py-1 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-full font-mono text-xs font-bold border border-indigo-200 dark:border-indigo-800/40">
                        {currentFlow.levels.length} Sequential Nodes
                    </span>
                </div>

                {/* Vertical Graphical Flow Chart Tree */}
                <div className="max-w-3xl mx-auto space-y-0 relative">
                    {currentFlow.levels.map((lvl, index) => {
                        const isLast = index === currentFlow.levels.length - 1;
                        return (
                            <React.Fragment key={lvl.level}>
                                {/* Node Card */}
                                <div className={`relative p-5 rounded-2xl border-2 ${lvl.borderColor} ${lvl.bgColor} shadow-sm transition-all hover:shadow-md space-y-3 group`}>
                                    {/* Level Header Badge & Timer */}
                                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/60 dark:border-slate-800/60 pb-2.5">
                                        <div className="flex items-center gap-2">
                                            <span className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider ${lvl.badgeColor}`}>
                                                {lvl.title}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 px-3 py-1 bg-white/80 dark:bg-slate-900/80 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 shadow-xs">
                                            <Clock className="w-3.5 h-3.5 text-indigo-500" />
                                            <span>SLA Window: <span className="font-mono text-indigo-600 dark:text-indigo-400">{lvl.slaText}</span> ({lvl.slaHours})</span>
                                        </div>
                                    </div>

                                    {/* Role Owner Card Body */}
                                    <div className="flex items-start gap-3 pt-1">
                                        <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm shrink-0">
                                            {lvl.icon}
                                        </div>
                                        <div className="space-y-1 flex-1">
                                            <div className="text-xs font-black text-slate-400 uppercase tracking-widest">Designated Owner</div>
                                            <div className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                                                {lvl.ownerRole}
                                            </div>
                                            {lvl.ownerType === 'hr' && (
                                                <div className="space-y-2 my-1">
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {hrManagers.length > 0 ? (
                                                            hrManagers.map((mgr) => (
                                                                <div key={mgr.id || mgr.employee_code} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-100 dark:bg-blue-950/80 border border-blue-300 dark:border-blue-800 rounded-lg text-xs font-bold text-blue-900 dark:text-blue-200">
                                                                    <User className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                                                                    <span>
                                                                        Assigned: {mgr.full_name || `${mgr.first_name} ${mgr.last_name}`} ({mgr.employee_code || ''})
                                                                    </span>
                                                                    {onRemoveHrManager && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => onRemoveHrManager(mgr.id)}
                                                                            className="p-0.5 hover:bg-blue-200 dark:hover:bg-blue-900 rounded-full text-blue-500 hover:text-blue-800 dark:hover:text-blue-200 transition-colors ml-1"
                                                                            title="Remove Assigned HR Manager"
                                                                        >
                                                                            <X className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ))
                                                        ) : (
                                                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-100 dark:bg-blue-950/80 border border-blue-300 dark:border-blue-800 rounded-lg text-xs font-bold text-blue-900 dark:text-blue-200">
                                                                <User className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                                                                <span>Assigned: HR Department / Operations Lead</span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {onAddHrManager && employeesList && employeesList.length > 0 && (
                                                        <div className="pt-1 max-w-md space-y-2">
                                                            <SearchableEmployeeSelector
                                                                placeholder="+ Assign HR Manager / HR Dept Member"
                                                                employees={employeesList}
                                                                selectedIds={selectedHrManagerIds.length > 0 ? selectedHrManagerIds : hrManagers.map(m => m.id)}
                                                                onSelect={onAddHrManager}
                                                                accentColor="blue"
                                                            />
                                                            {onSaveAuthorities && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => onSaveAuthorities()}
                                                                    disabled={savingAuthorities}
                                                                    className="px-3 py-1.5 bg-[#587e85] hover:bg-[#48686e] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
                                                                >
                                                                    <Check className="w-3.5 h-3.5" />
                                                                    {savingAuthorities ? 'Saving...' : 'Save HR Department Authority'}
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {lvl.ownerType === 'hr_head' && (
                                                <div className="space-y-2 my-1">
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {hrHeads.length > 0 ? (
                                                            hrHeads.map((head) => (
                                                                <div key={head.id || head.employee_code} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-purple-100 dark:bg-purple-950/80 border border-purple-300 dark:border-purple-800 rounded-lg text-xs font-bold text-purple-900 dark:text-purple-200">
                                                                    <User className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                                                                    <span>
                                                                        Assigned: {head.full_name || `${head.first_name} ${head.last_name}`} ({head.employee_code || ''})
                                                                    </span>
                                                                    {onRemoveHrHead && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => onRemoveHrHead(head.id)}
                                                                            className="p-0.5 hover:bg-purple-200 dark:hover:bg-purple-900 rounded-full text-purple-500 hover:text-purple-800 dark:hover:text-purple-200 transition-colors ml-1"
                                                                            title="Remove HR Head"
                                                                        >
                                                                            <X className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ))
                                                        ) : (
                                                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-purple-100 dark:bg-purple-950/80 border border-purple-300 dark:border-purple-800 rounded-lg text-xs font-bold text-purple-900 dark:text-purple-200">
                                                                <User className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                                                                <span>Assigned: HR Head / Leadership (Not selected)</span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {onAddHrHead && employeesList && employeesList.length > 0 && (
                                                        <div className="pt-1 max-w-md space-y-2">
                                                            <SearchableEmployeeSelector
                                                                placeholder="+ Assign HR Head"
                                                                employees={employeesList}
                                                                selectedIds={selectedHrHeadIds.length > 0 ? selectedHrHeadIds : hrHeads.map(h => h.id)}
                                                                onSelect={onAddHrHead}
                                                                accentColor="purple"
                                                            />
                                                            {onSaveAuthorities && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => onSaveAuthorities()}
                                                                    disabled={savingAuthorities}
                                                                    className="px-3 py-1.5 bg-[#587e85] hover:bg-[#48686e] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
                                                                >
                                                                    <Check className="w-3.5 h-3.5" />
                                                                    {savingAuthorities ? 'Saving...' : 'Save HR Head Authority'}
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {(lvl.ownerType === 'director' || lvl.ownerType === 'super_admin') && (
                                                <div className="space-y-2 my-1">
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {directors.length > 0 ? (
                                                            directors.map((dir) => (
                                                                <div key={dir.id || dir.employee_code} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-100 dark:bg-red-950/80 border border-red-300 dark:border-red-800 rounded-lg text-xs font-bold text-red-900 dark:text-red-200">
                                                                    <User className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
                                                                    <span>
                                                                        Assigned: {dir.full_name || `${dir.first_name} ${dir.last_name}`} ({dir.employee_code || ''})
                                                                    </span>
                                                                    {onRemoveDirector && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => onRemoveDirector(dir.id)}
                                                                            className="p-0.5 hover:bg-red-200 dark:hover:bg-red-900 rounded-full text-red-500 hover:text-red-800 dark:hover:text-red-200 transition-colors ml-1"
                                                                            title="Remove Assigned Director"
                                                                        >
                                                                            <X className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ))
                                                        ) : (
                                                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-100 dark:bg-red-950/80 border border-red-300 dark:border-red-800 rounded-lg text-xs font-bold text-red-900 dark:text-red-200">
                                                                <User className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
                                                                <span>Assigned: Executive Management / Board (Not selected)</span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Interactive Combobox for assigning Directors / Board / Confidential Feedback Users */}
                                                    {onAddDirector && employeesList && employeesList.length > 0 && (
                                                        <div className="pt-1 max-w-md space-y-2">
                                                            <SearchableEmployeeSelector
                                                                placeholder={
                                                                    selectedFlowId === 'confidential_feedback'
                                                                        ? (lvl.level === 2 ? "+ Assign Board Member / Managing Director" : "+ Assign Director / Recipient for Confidential Feedback")
                                                                        : "+ Assign Director / Board Member"
                                                                }
                                                                employees={employeesList}
                                                                selectedIds={selectedDirectorIds.length > 0 ? selectedDirectorIds : directors.map(d => d.id)}
                                                                onSelect={onAddDirector}
                                                                accentColor={selectedFlowId === 'confidential_feedback' ? 'purple' : 'red'}
                                                            />

                                                            {onSaveAuthorities && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => onSaveAuthorities()}
                                                                    disabled={savingAuthorities}
                                                                    className="px-3 py-1.5 bg-[#587e85] hover:bg-[#48686e] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
                                                                >
                                                                    <Check className="w-3.5 h-3.5" />
                                                                    {savingAuthorities ? 'Saving...' : selectedFlowId === 'confidential_feedback' ? 'Save Confidential Recipient' : 'Save Designated Authority'}
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed pt-0.5">
                                                {lvl.description}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Graphical Connector Arrow Down */}
                                {!isLast && (
                                    <div className="py-3 flex flex-col items-center justify-center my-1 relative">
                                        {/* Connector Line */}
                                        <div className="w-0.5 h-8 bg-indigo-300 dark:bg-indigo-700" />
                                        
                                        {/* Escalation Condition Badge */}
                                        <div className="my-1 px-3 py-1 bg-amber-50 dark:bg-amber-950/80 border border-amber-300 dark:border-amber-700/60 rounded-full text-[11px] font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5 shadow-sm">
                                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                            <span>Auto-Escalates: {lvl.escalationTrigger}</span>
                                        </div>
                                        
                                        {/* Arrow Head */}
                                        <div className="w-0.5 h-6 bg-indigo-300 dark:bg-indigo-700" />
                                        <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center -mt-2 shadow-sm z-10">
                                            <ArrowDown className="w-3.5 h-3.5 animate-bounce" />
                                        </div>
                                    </div>
                                )}
                            </React.Fragment>
                        );
                    })}
                </div>

                {/* System Automation Legend */}
                <div className="mt-8 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs space-y-2">
                    <div className="font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                        <Info className="w-4 h-4 text-indigo-500" />
                        Automated System Governance & Notification Rules
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-slate-600 dark:text-slate-300 pt-1">
                        <div className="flex items-start gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                            <span><strong>Multi-Channel Alerts:</strong> Automatic WhatsApp & Email notifications triggered to level owner when SLA clock starts.</span>
                        </div>
                        <div className="flex items-start gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                            <span><strong>Overdue Escalation:</strong> System background cron evaluates ticket SLAs hourly and promotes ticket ownership automatically.</span>
                        </div>
                        <div className="flex items-start gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                            <span><strong>Privacy Guarantee:</strong> Confidential feedback & anonymous tickets route exclusively to designated Executive roles.</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
