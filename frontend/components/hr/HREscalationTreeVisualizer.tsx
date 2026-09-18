'use client';

import React, { useState } from 'react';
import { ShieldCheck, HelpCircle, Lock, EyeOff, Clock, ArrowDown, User, Shield, AlertTriangle, Building2, CheckCircle2, ChevronRight, Info, Layers, Sparkles, X, Check, Plus, Trash2, Edit3 } from 'lucide-react';
import { SearchableEmployeeSelector, formatSlaDisplay } from '@/frontend/components/hr/HRAdminConfigPanel';

export function parseSlaTextToValAndUnit(slaText: string): { val: number; unit: 'mins' | 'hours' | 'days' } {
    if (!slaText || !slaText.trim()) return { val: 3, unit: 'days' };
    const str = slaText.toLowerCase();
    const match = str.match(/(\d+(?:\.\d+)?)/);
    const num = match ? parseFloat(match[1]) : 3;

    if (str.includes('min') || str.includes('minute')) {
        return { val: num, unit: 'mins' };
    }
    if (str.includes('hr') || str.includes('hour')) {
        return { val: num, unit: 'hours' };
    }
    return { val: num, unit: 'days' };
}

export function formatTatText(val: number, unit: 'mins' | 'hours' | 'days'): string {
    if (unit === 'mins') {
        return `${val} Minute${val !== 1 ? 's' : ''}`;
    }
    if (unit === 'hours') {
        return `${val} Hour${val !== 1 ? 's' : ''}`;
    }
    return `${val} Working Day${val !== 1 ? 's' : ''}`;
}

export interface EscalationLevel {
    level: number;
    title: string;
    ownerRole: string;
    ownerType: string;
    slaText: string;
    slaHours: string;
    description: string;
    escalationTrigger: string;
    badgeColor?: string;
    borderColor?: string;
    bgColor?: string;
    icon?: React.ReactNode;
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
                slaHours: 'Final TAT',
                description: 'Escalated to Director for final internal resolution, compliance audit, or policy exception approval.',
                escalationTrigger: 'Resolution TAT Breach Flagged on Organization MIS Dashboard',
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
                escalationTrigger: 'If query unaddressed after TAT expiry',
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
                slaHours: 'Final TAT',
                description: 'Final review by Management for company-wide policy exceptions or executive decisions.',
                escalationTrigger: 'Resolution TAT Breach Flagged',
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
                slaHours: 'Final TAT',
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
                slaHours: 'Final TAT',
                description: 'Escalated to Managing Director to ensure company culture feedback is reviewed and actioned.',
                escalationTrigger: 'Resolution TAT Breach Flagged',
                badgeColor: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300',
                borderColor: 'border-indigo-300 dark:border-indigo-800',
                bgColor: 'bg-indigo-50/40 dark:bg-indigo-950/20',
                icon: <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            }
        ]
    }
];

const reindexLevels = (levels: EscalationLevel[]): EscalationLevel[] => {
    return levels.map((lvl, index) => {
        const lvlNum = index + 1;
        let newTitle = lvl.title || '';
        if (newTitle.match(/^Level \d+:/i)) {
            newTitle = newTitle.replace(/^Level \d+:/i, `Level ${lvlNum}:`);
        } else if (!newTitle) {
            newTitle = `Level ${lvlNum}: Authority Review`;
        }

        const ownerType = lvl.ownerType || 'custom';
        const badgeColor =
            ownerType === 'reporting_manager' || lvlNum === 1
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                : ownerType === 'hr' || lvlNum === 2
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300'
                : ownerType === 'hr_head' || lvlNum === 3
                ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300'
                : ownerType === 'director' || lvlNum === 4
                ? 'bg-red-100 text-red-800 dark:bg-red-950/80 dark:text-red-300'
                : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300';

        const borderColor =
            ownerType === 'reporting_manager' || lvlNum === 1
                ? 'border-emerald-300 dark:border-emerald-800'
                : ownerType === 'hr' || lvlNum === 2
                ? 'border-blue-300 dark:border-blue-800'
                : ownerType === 'hr_head' || lvlNum === 3
                ? 'border-purple-300 dark:border-purple-800'
                : ownerType === 'director' || lvlNum === 4
                ? 'border-red-300 dark:border-red-800'
                : 'border-indigo-300 dark:border-indigo-800';

        const bgColor =
            ownerType === 'reporting_manager' || lvlNum === 1
                ? 'bg-emerald-50/40 dark:bg-emerald-950/20'
                : ownerType === 'hr' || lvlNum === 2
                ? 'bg-blue-50/40 dark:bg-blue-950/20'
                : ownerType === 'hr_head' || lvlNum === 3
                ? 'bg-purple-50/40 dark:bg-purple-950/20'
                : ownerType === 'director' || lvlNum === 4
                ? 'bg-red-50/40 dark:bg-red-950/20'
                : 'bg-indigo-50/40 dark:bg-indigo-950/20';

        const icon =
            ownerType === 'reporting_manager' ? <User className="w-5 h-5 text-emerald-600 dark:text-emerald-400" /> :
            ownerType === 'hr' ? <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" /> :
            ownerType === 'hr_head' ? <Shield className="w-5 h-5 text-purple-600 dark:text-purple-400" /> :
            ownerType === 'director' ? <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" /> :
            ownerType === 'super_admin' ? <Lock className="w-5 h-5 text-purple-600 dark:text-purple-400" /> :
            <User className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />;

        return {
            ...lvl,
            level: lvlNum,
            title: newTitle,
            badgeColor,
            borderColor,
            bgColor,
            icon
        };
    });
};

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
    onSaveAuthorities?: (payload?: any) => Promise<void>;
    savingAuthorities?: boolean;
    authoritySaveMsg?: string;
    authorityErrorMsg?: string;
    flowAssignees?: Record<string, Record<string, any[]>>;
    flowLevels?: Record<string, EscalationLevel[]>;
    onFlowLevelsChange?: (updatedLevels: Record<string, EscalationLevel[]>) => void;
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
    authorityErrorMsg,
    flowAssignees: initialFlowAssignees,
    flowLevels: initialFlowLevels,
    onFlowLevelsChange
}: HREscalationTreeVisualizerProps = {}) {
    const [selectedFlowId, setSelectedFlowId] = useState<string>('grievance');
    const [hrManagers, setHrManagers] = React.useState<any[]>(initialHrManagers || []);
    const [hrHeads, setHrHeads] = React.useState<any[]>(
        initialHrHeads || (initialHrHead ? [initialHrHead] : [])
    );
    const [directors, setDirectors] = React.useState<any[]>(
        initialDirectors || (initialDirector ? [initialDirector] : [])
    );
    const [flowAssignees, setFlowAssignees] = React.useState<Record<string, Record<string, any[]>>>(
        initialFlowAssignees || {
            grievance: { '1': [], '2': [], '3': [], '4': [] },
            hr_query: { '1': [], '2': [], '3': [], '4': [] },
            confidential_feedback: { '1': [], '2': [] },
            anonymous_feedback: { '1': [], '2': [] }
        }
    );
    const [flowLevels, setFlowLevels] = React.useState<Record<string, EscalationLevel[]>>(() => {
        if (initialFlowLevels && Object.keys(initialFlowLevels).length > 0) {
            return initialFlowLevels;
        }
        return {
            grievance: escalationFlows[0].levels,
            hr_query: escalationFlows[1].levels,
            confidential_feedback: escalationFlows[2].levels,
            anonymous_feedback: escalationFlows[3].levels
        };
    });
    const [editingNodeKey, setEditingNodeKey] = React.useState<string | null>(null);

    const [localSaveMsg, setLocalSaveMsg] = React.useState<string>('');
    const [isSavingLocal, setIsSavingLocal] = React.useState<boolean>(false);

    React.useEffect(() => {
        if (initialFlowAssignees) {
            setFlowAssignees(initialFlowAssignees);
        }
    }, [initialFlowAssignees]);

    React.useEffect(() => {
        if (initialFlowLevels && Object.keys(initialFlowLevels).length > 0) {
            setFlowLevels(prev => ({ ...prev, ...initialFlowLevels }));
        }
    }, [initialFlowLevels]);

    React.useEffect(() => {
        if (initialHrManagers !== undefined) setHrManagers(initialHrManagers);

        if (initialHrHeads !== undefined) setHrHeads(initialHrHeads);
        else if (initialHrHead !== undefined) setHrHeads(initialHrHead ? [initialHrHead] : []);

        if (initialDirectors !== undefined) setDirectors(initialDirectors);
        else if (initialDirector !== undefined) setDirectors(initialDirector ? [initialDirector] : []);
    }, [initialHrManagers, initialHrHeads, initialDirectors, initialHrHead, initialDirector]);

    React.useEffect(() => {
        fetch('/api/hr/admin/escalation-config')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.data) {
                    setHrManagers(data.data.designated_hr_managers || []);
                    setHrHeads(data.data.designated_hr_heads || (data.data.designated_hr_head ? [data.data.designated_hr_head] : []));
                    setDirectors(data.data.designated_directors || (data.data.designated_director ? [data.data.designated_director] : []));
                    if (data.data.flow_assignees) {
                        setFlowAssignees(data.data.flow_assignees);
                    }
                    if (data.data.flow_levels && typeof data.data.flow_levels === 'object') {
                        const loadedLevels: Record<string, EscalationLevel[]> = {};
                        Object.keys(data.data.flow_levels).forEach(fId => {
                            if (Array.isArray(data.data.flow_levels[fId]) && data.data.flow_levels[fId].length > 0) {
                                loadedLevels[fId] = reindexLevels(data.data.flow_levels[fId]);
                            }
                        });
                        setFlowLevels(prev => {
                            const updated = { ...prev, ...loadedLevels };
                            if (onFlowLevelsChange) {
                                queueMicrotask(() => {
                                    onFlowLevelsChange(updated);
                                });
                            }
                            return updated;
                        });
                    }
                }
            })
            .catch(err => console.error(err));
    }, []);

    const currentFlow = escalationFlows.find(f => f.id === selectedFlowId) || escalationFlows[0];
    const currentLevels = flowLevels[selectedFlowId] || currentFlow.levels;

    const handleAddStepAssignee = (flowId: string, levelNum: number, empId: string) => {
        if (!empId) return;
        const empObj = employeesList.find(e => e.id === empId || e.user_id === empId);
        if (!empObj) return;

        setFlowAssignees(prev => {
            const flowObj = { ...(prev[flowId] || {}) };
            const levelKey = String(levelNum);
            
            let baseArr: any[] = [];
            if (Array.isArray(flowObj[levelKey])) {
                baseArr = flowObj[levelKey];
            } else {
                const targetLvl = (flowLevels[flowId] || []).find(l => l.level === levelNum);
                const ownerType = targetLvl?.ownerType;
                baseArr = (
                    ownerType === 'hr' ? hrManagers :
                    ownerType === 'hr_head' ? hrHeads :
                    (ownerType === 'director' || ownerType === 'super_admin') ? directors : []
                );
            }

            const levelArr = [...baseArr];
            if (!levelArr.some(e => e.id === empId || e.user_id === empId)) {
                levelArr.push(empObj);
            }
            flowObj[levelKey] = levelArr;
            return { ...prev, [flowId]: flowObj };
        });
    };

    const handleRemoveStepAssignee = (flowId: string, levelNum: number, empId: string) => {
        setFlowAssignees(prev => {
            const flowObj = { ...(prev[flowId] || {}) };
            const levelKey = String(levelNum);
            
            let baseArr: any[] = [];
            if (Array.isArray(flowObj[levelKey])) {
                baseArr = flowObj[levelKey];
            } else {
                const targetLvl = (flowLevels[flowId] || []).find(l => l.level === levelNum);
                const ownerType = targetLvl?.ownerType;
                baseArr = (
                    ownerType === 'hr' ? hrManagers :
                    ownerType === 'hr_head' ? hrHeads :
                    (ownerType === 'director' || ownerType === 'super_admin') ? directors : []
                );
            }

            const levelArr = baseArr.filter(e => e.id !== empId && e.user_id !== empId);
            flowObj[levelKey] = levelArr;
            return { ...prev, [flowId]: flowObj };
        });
    };

    const handleResetStepAssignees = (flowId: string, levelNum: number) => {
        setFlowAssignees(prev => {
            const flowObj = { ...(prev[flowId] || {}) };
            delete flowObj[String(levelNum)];
            return { ...prev, [flowId]: flowObj };
        });
    };

    const updateFlowLevelsAndNotify = (updater: (prev: Record<string, EscalationLevel[]>) => Record<string, EscalationLevel[]>) => {
        setFlowLevels(prev => {
            const next = updater(prev);
            if (onFlowLevelsChange) {
                queueMicrotask(() => {
                    onFlowLevelsChange(next);
                });
            }
            return next;
        });
    };

    const handleAddLevelAtEnd = (flowId: string) => {
        updateFlowLevelsAndNotify(prev => {
            const current = [...(prev[flowId] || [])];
            const nextNum = current.length + 1;
            const newLevel: EscalationLevel = {
                level: nextNum,
                title: `Level ${nextNum}: Executive Escalation`,
                ownerRole: 'Executive / Board Member',
                ownerType: 'director',
                slaText: `${nextNum * 3} Working Days`,
                slaHours: `${nextNum * 72} Hours`,
                description: `Tier ${nextNum} escalation for executive review and policy resolution.`,
                escalationTrigger: `If unresolved after Level ${nextNum - 1} TAT expiry`
            };
            return { ...prev, [flowId]: reindexLevels([...current, newLevel]) };
        });
    };

    const handleInsertLevelInBetween = (flowId: string, afterIndex: number) => {
        updateFlowLevelsAndNotify(prev => {
            const current = [...(prev[flowId] || [])];
            const newLevel: EscalationLevel = {
                level: afterIndex + 2,
                title: `Level ${afterIndex + 2}: Additional Review Authority`,
                ownerRole: 'Designated Escalation Officer',
                ownerType: 'custom',
                slaText: '5 Working Days',
                slaHours: '120 Hours',
                description: 'Custom intermediate escalation level inserted for thorough review.',
                escalationTrigger: 'If unresolved by preceding level TAT'
            };
            current.splice(afterIndex + 1, 0, newLevel);
            return { ...prev, [flowId]: reindexLevels(current) };
        });

        setFlowAssignees(prev => {
            const currentAssignees = { ...(prev[flowId] || {}) };
            const updatedAssignees: Record<string, any[]> = {};
            Object.keys(currentAssignees).forEach(k => {
                const num = parseInt(k, 10);
                if (num <= afterIndex + 1) {
                    updatedAssignees[String(num)] = currentAssignees[k];
                } else {
                    updatedAssignees[String(num + 1)] = currentAssignees[k];
                }
            });
            updatedAssignees[String(afterIndex + 2)] = [];
            return { ...prev, [flowId]: updatedAssignees };
        });
    };

    const handleDeleteLevel = (flowId: string, deleteIndex: number) => {
        updateFlowLevelsAndNotify(prev => {
            const current = [...(prev[flowId] || [])];
            if (current.length <= 1) return prev;
            current.splice(deleteIndex, 1);
            return { ...prev, [flowId]: reindexLevels(current) };
        });

        setFlowAssignees(prev => {
            const currentAssignees = { ...(prev[flowId] || {}) };
            const deletedNum = deleteIndex + 1;
            const updatedAssignees: Record<string, any[]> = {};
            Object.keys(currentAssignees).forEach(k => {
                const num = parseInt(k, 10);
                if (num < deletedNum) {
                    updatedAssignees[String(num)] = currentAssignees[k];
                } else if (num > deletedNum) {
                    updatedAssignees[String(num - 1)] = currentAssignees[k];
                }
            });
            return { ...prev, [flowId]: updatedAssignees };
        });
    };

    const handleUpdateLevelField = (flowId: string, index: number, field: keyof EscalationLevel, value: any) => {
        updateFlowLevelsAndNotify(prev => {
            const current = [...(prev[flowId] || [])];
            const target = { ...current[index], [field]: value };
            current[index] = target;
            return { ...prev, [flowId]: reindexLevels(current) };
        });
    };

    const handleSaveFlowAssignees = async () => {
        setIsSavingLocal(true);
        setLocalSaveMsg('');
        try {
            const payloadAssignees: Record<string, Record<string, string[]>> = {};
            Object.keys(flowAssignees).forEach(fId => {
                payloadAssignees[fId] = {};
                Object.keys(flowAssignees[fId] || {}).forEach(lNum => {
                    payloadAssignees[fId][lNum] = (flowAssignees[fId][lNum] || []).map(e => e.id || e.user_id).filter(Boolean);
                });
            });

            const cleanFlowLevels: Record<string, any[]> = {};
            Object.keys(flowLevels).forEach(fId => {
                cleanFlowLevels[fId] = (flowLevels[fId] || []).map(lvl => ({
                    level: lvl.level,
                    title: lvl.title,
                    ownerRole: lvl.ownerRole,
                    ownerType: lvl.ownerType,
                    slaText: lvl.slaText,
                    slaHours: lvl.slaHours,
                    description: lvl.description,
                    escalationTrigger: lvl.escalationTrigger
                }));
            });

            if (onSaveAuthorities) {
                await onSaveAuthorities({ flow_assignees: payloadAssignees, flow_levels: cleanFlowLevels });
                setLocalSaveMsg('All escalation levels & step assignees saved successfully!');
            } else {
                const res = await fetch('/api/hr/admin/escalation-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        flow_assignees: payloadAssignees,
                        flow_levels: cleanFlowLevels
                    })
                });
                const data = await res.json();
                if (data.success) {
                    setLocalSaveMsg('All escalation levels & step assignees saved successfully!');
                }
            }
        } catch (e: any) {
            console.error('Error saving step assignees and levels:', e);
        } finally {
            setIsSavingLocal(false);
            setTimeout(() => setLocalSaveMsg(''), 4000);
        }
    };

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
                                HR Resolution TAT & Automatic Escalation Tree Hierarchy
                            </h2>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
                            Visual graphical flow showing how tickets auto-escalate across organizational tiers. Add escalation levels in between or at the end, and assign custom designated owners for each level.
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
                        const levelCount = (flowLevels[flow.id] || flow.levels).length;
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
                                        {levelCount} Escalation Levels
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
                <div className="border-b border-slate-100 dark:border-slate-800 pb-4 flex items-center justify-between flex-wrap gap-2">
                    <div>
                        <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                            {currentFlow.icon}
                            {currentFlow.title} Hierarchy Tree
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">{currentFlow.subtitle}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => handleAddLevelAtEnd(selectedFlowId)}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors border border-slate-200 dark:border-slate-700"
                        >
                            <Plus className="w-3.5 h-3.5 text-indigo-500" />
                            Add Level at End
                        </button>
                        <button
                            type="button"
                            onClick={handleSaveFlowAssignees}
                            disabled={isSavingLocal || savingAuthorities}
                            className="px-3.5 py-1.5 bg-[#587e85] hover:bg-[#48686e] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
                        >
                            <Check className="w-3.5 h-3.5" />
                            {isSavingLocal || savingAuthorities ? 'Saving...' : `Save ${currentFlow.title} Settings`}
                        </button>
                        <span className="px-3 py-1 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-full font-mono text-xs font-bold border border-indigo-200 dark:border-indigo-800/40">
                            {currentLevels.length} Sequential Levels
                        </span>
                    </div>
                </div>

                {localSaveMsg && (
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-xs text-emerald-700 dark:text-emerald-300 font-bold flex items-center gap-2 animate-in fade-in">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>{localSaveMsg}</span>
                    </div>
                )}

                {/* Vertical Graphical Flow Chart Tree */}
                <div className="max-w-3xl mx-auto space-y-0 relative">
                    {currentLevels.map((lvl, index) => {
                        const isLast = index === currentLevels.length - 1;
                        const levelKey = String(lvl.level);
                        const nodeEditKey = `${selectedFlowId}_${index}`;
                        const isEditingThisNode = editingNodeKey === nodeEditKey;

                        const isStepCustomized = flowAssignees[selectedFlowId]?.[levelKey] !== undefined;
                        const customAssignees: any[] = flowAssignees[selectedFlowId]?.[levelKey] || [];
                        const defaultAssignees: any[] = (
                            lvl.ownerType === 'hr' ? hrManagers :
                            lvl.ownerType === 'hr_head' ? hrHeads :
                            (lvl.ownerType === 'director' || lvl.ownerType === 'super_admin') ? directors : []
                        );
                        const displayAssignees = isStepCustomized ? customAssignees : defaultAssignees;
                        const hasCustom = isStepCustomized;

                        return (
                            <React.Fragment key={lvl.level}>
                                {/* Node Card */}
                                <div className={`relative p-5 rounded-2xl border-2 ${lvl.borderColor || 'border-slate-200'} ${lvl.bgColor || 'bg-slate-50'} shadow-sm transition-all hover:shadow-md space-y-3 group`}>
                                    {/* Level Header Badge & Controls */}
                                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/60 dark:border-slate-800/60 pb-2.5">
                                        <div className="flex items-center gap-2">
                                            <span className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider ${lvl.badgeColor || 'bg-indigo-100 text-indigo-800'}`}>
                                                {lvl.title}
                                            </span>
                                            {hasCustom && (
                                                <span className="px-2 py-0.5 rounded-full text-[9.5px] font-black uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300">
                                                    Custom Assigned
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-1.5 px-3 py-1 bg-white/80 dark:bg-slate-900/80 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 shadow-xs">
                                                <Clock className="w-3.5 h-3.5 text-indigo-500" />
                                                <span>Resolution TAT: <span className="font-mono text-indigo-600 dark:text-indigo-400">{lvl.slaText}</span></span>
                                            </div>

                                            {/* Edit Node Toggle */}
                                            <button
                                                type="button"
                                                onClick={() => setEditingNodeKey(isEditingThisNode ? null : nodeEditKey)}
                                                className={`p-1.5 rounded-lg border text-xs font-bold flex items-center gap-1 transition-colors ${
                                                    isEditingThisNode
                                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                                                }`}
                                                title="Edit Level Title, Resolution TAT & Role Settings"
                                            >
                                                <Edit3 className="w-3.5 h-3.5" />
                                                <span className="hidden sm:inline">{isEditingThisNode ? 'Close' : 'Edit Level'}</span>
                                            </button>

                                            {/* Delete Node (if > 1 level) */}
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteLevel(selectedFlowId, index)}
                                                disabled={currentLevels.length <= 1}
                                                className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-30 transition-colors"
                                                title={currentLevels.length <= 1 ? 'Minimum 1 escalation level required' : 'Delete this escalation level'}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Inline Edit Level Details Panel */}
                                    {isEditingThisNode && (
                                        <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-indigo-200 dark:border-indigo-800 space-y-3 animate-in fade-in">
                                            <div className="text-xs font-black text-indigo-900 dark:text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                                                <Edit3 className="w-3.5 h-3.5 text-indigo-500" />
                                                Edit Level {lvl.level} Properties
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                                                        Level Title
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={lvl.title}
                                                        onChange={e => handleUpdateLevelField(selectedFlowId, index, 'title', e.target.value)}
                                                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold"
                                                        placeholder="Level Title..."
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                                                        Owner Role Display Name
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={lvl.ownerRole}
                                                        onChange={e => handleUpdateLevelField(selectedFlowId, index, 'ownerRole', e.target.value)}
                                                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold"
                                                        placeholder="Role Display Name..."
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                                                        Owner Routing Type
                                                    </label>
                                                    <select
                                                        value={lvl.ownerType || 'custom'}
                                                        onChange={e => handleUpdateLevelField(selectedFlowId, index, 'ownerType', e.target.value)}
                                                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold"
                                                    >
                                                        <option value="reporting_manager">Direct Reporting Manager of Submitter</option>
                                                        <option value="hr">HR Department / HR Manager</option>
                                                        <option value="hr_head">HR Head</option>
                                                        <option value="director">Director</option>
                                                        <option value="super_admin">Managing Director / Board</option>
                                                        <option value="custom">Custom Designated Employee(s)</option>
                                                    </select>
                                                </div>

                                                <div>
                                                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                                                        Resolution TAT (Value & Unit)
                                                    </label>
                                                    <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                                                        <input
                                                            type="number"
                                                            step="any"
                                                            min={0}
                                                            value={parseSlaTextToValAndUnit(lvl.slaText).val}
                                                            onChange={(e) => {
                                                                const num = parseFloat(e.target.value) || 0;
                                                                const unit = parseSlaTextToValAndUnit(lvl.slaText).unit;
                                                                handleUpdateLevelField(selectedFlowId, index, 'slaText', formatTatText(num, unit));
                                                            }}
                                                            className="w-20 px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono font-bold outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                                                        />
                                                        <select
                                                            value={parseSlaTextToValAndUnit(lvl.slaText).unit}
                                                            onChange={(e) => {
                                                                const unit = e.target.value as 'mins' | 'hours' | 'days';
                                                                const val = parseSlaTextToValAndUnit(lvl.slaText).val;
                                                                handleUpdateLevelField(selectedFlowId, index, 'slaText', formatTatText(val, unit));
                                                            }}
                                                            className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold outline-none cursor-pointer text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500"
                                                        >
                                                            <option value="days">Working Days</option>
                                                            <option value="hours">Hours</option>
                                                            <option value="mins">Minutes</option>
                                                        </select>
                                                        <input
                                                            type="text"
                                                            value={lvl.slaText}
                                                            onChange={e => handleUpdateLevelField(selectedFlowId, index, 'slaText', e.target.value)}
                                                            className="flex-1 min-w-[120px] px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-indigo-700 dark:text-indigo-300"
                                                            placeholder="Formatted TAT string"
                                                            title="Custom TAT display string"
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                                                    Level Resolution TAT Description & Governance
                                                </label>
                                                <textarea
                                                    rows={2}
                                                    value={lvl.description}
                                                    onChange={e => handleUpdateLevelField(selectedFlowId, index, 'description', e.target.value)}
                                                    className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium"
                                                    placeholder="Describe responsibilities for this level..."
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Role Owner Card Body */}
                                    <div className="flex items-start gap-3 pt-1">
                                        <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm shrink-0">
                                            {lvl.icon || <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
                                        </div>
                                        <div className="space-y-2 flex-1">
                                            <div>
                                                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Designated Owner / Role</div>
                                                <div className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                                                    {lvl.ownerRole}
                                                </div>
                                            </div>                                             {/* Interactive Step Assignees Section */}
                                            {lvl.ownerType === 'reporting_manager' ? (
                                                <div className="p-3 bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-2xl text-xs text-emerald-800 dark:text-emerald-300 font-medium flex items-center gap-2">
                                                    <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                                    <span>
                                                        <strong>Automatic Hierarchy Routing:</strong> Tickets are dynamically assigned to the direct <strong>Reporting Manager / HOD</strong> of whoever submits the grievance. No manual assignment needed.
                                                    </span>
                                                </div>
                                            ) : (
                                                <div className="space-y-2 pt-1">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs font-black uppercase text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                                                            <User className="w-3.5 h-3.5 text-indigo-500" />
                                                            Level {lvl.level} Assigned Users ({displayAssignees.length})
                                                        </span>
                                                        {isStepCustomized && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleResetStepAssignees(selectedFlowId, lvl.level)}
                                                                className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline font-bold transition-colors"
                                                                title="Reset assignees for this step back to default role members"
                                                            >
                                                                Reset to default role
                                                            </button>
                                                        )}
                                                    </div>

                                                    {/* Selected Assignee Badges */}
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {displayAssignees.length > 0 ? (
                                                            displayAssignees.map((assignee) => (
                                                                <div
                                                                    key={assignee.id || assignee.user_id || assignee.employee_code}
                                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-slate-900 border border-indigo-300 dark:border-indigo-700 text-indigo-900 dark:text-indigo-200 rounded-xl text-xs font-bold shadow-2xs"
                                                                >
                                                                    <User className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                                                                    <span>
                                                                        {assignee.full_name || `${assignee.first_name || ''} ${assignee.last_name || ''}`.trim() || assignee.name || 'User'}
                                                                        {assignee.employee_code ? ` (${assignee.employee_code})` : ''}
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleRemoveStepAssignee(selectedFlowId, lvl.level, assignee.id || assignee.user_id)}
                                                                        className="p-0.5 hover:bg-indigo-100 dark:hover:bg-indigo-900 rounded-full text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 transition-colors ml-1"
                                                                        title="Remove assignee from this step"
                                                                    >
                                                                        <X className="w-3.5 h-3.5" />
                                                                    </button>
                                                                </div>
                                                            ))
                                                        ) : (
                                                            <div className="text-xs text-slate-400 italic bg-slate-100/60 dark:bg-slate-800/40 p-2 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 w-full">
                                                                No custom assignees selected.
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Add Assignee Selector */}
                                                     {employeesList && employeesList.length > 0 && (
                                                         <div className="pt-1.5 max-w-md space-y-2">
                                                             <SearchableEmployeeSelector
                                                                 placeholder={`+ Assign specific employee to Level ${lvl.level}...`}
                                                                 employees={employeesList}
                                                                 selectedIds={displayAssignees.map(a => a.id || a.user_id)}
                                                                 onSelect={(id) => handleAddStepAssignee(selectedFlowId, lvl.level, id)}
                                                                 accentColor="indigo"
                                                             />
                                                         </div>
                                                     )}
                                                 </div>
                                             )}

                                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed pt-1 border-t border-slate-200/40 dark:border-slate-700/40">
                                                {lvl.description}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Graphical Connector Arrow & Insert Level In Between Button */}
                                {!isLast && (
                                    <div className="py-3 flex flex-col items-center justify-center my-1 relative group/conn">
                                        {/* Connector Line Top */}
                                        <div className="w-0.5 h-6 bg-indigo-300 dark:bg-indigo-700" />
                                        
                                        {/* Insert Level Button & Condition Badge */}
                                        <div className="my-1 flex items-center gap-2">
                                            <div className="px-3 py-1 bg-amber-50 dark:bg-amber-950/80 border border-amber-300 dark:border-amber-700/60 rounded-full text-[11px] font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5 shadow-sm">
                                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                                <span>Auto-Escalates: {lvl.escalationTrigger}</span>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => handleInsertLevelInBetween(selectedFlowId, index)}
                                                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full text-[11px] font-bold flex items-center gap-1 shadow-xs transition-all hover:scale-105"
                                                title={`Insert new escalation level between Level ${lvl.level} and Level ${lvl.level + 1}`}
                                            >
                                                <Plus className="w-3 h-3" />
                                                <span>Insert Level In Between</span>
                                            </button>
                                        </div>
                                        
                                        {/* Connector Line Bottom */}
                                        <div className="w-0.5 h-6 bg-indigo-300 dark:bg-indigo-700" />
                                        <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center -mt-2 shadow-sm z-10">
                                            <ArrowDown className="w-3.5 h-3.5 animate-bounce" />
                                        </div>
                                    </div>
                                )}
                            </React.Fragment>
                        );
                    })}

                    {/* Bottom Add Escalation Level Card */}
                    <div className="pt-4 flex justify-center">
                        <button
                            type="button"
                            onClick={() => handleAddLevelAtEnd(selectedFlowId)}
                            className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-2xl text-xs font-black flex items-center gap-2 shadow-md shadow-indigo-500/20 transition-all hover:scale-105"
                        >
                            <Plus className="w-4 h-4" />
                            <span>➕ Add New Escalation Level at End (Level {currentLevels.length + 1})</span>
                        </button>
                    </div>
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
                            <span><strong>Multi-Channel Alerts:</strong> Automatic WhatsApp & Email notifications triggered to level owner when Resolution TAT clock starts.</span>
                        </div>
                        <div className="flex items-start gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                            <span><strong>Overdue Escalation:</strong> System background cron evaluates ticket Resolution TATs hourly and promotes ticket ownership automatically.</span>
                        </div>
                        <div className="flex items-start gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                            <span><strong>Dynamic Escalations:</strong> Unlimited escalation levels can be inserted or added per category with specific designated assignees.</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
