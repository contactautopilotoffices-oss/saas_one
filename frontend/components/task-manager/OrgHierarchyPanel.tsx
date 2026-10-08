"use client";

import React, { useMemo, useState } from 'react';
import { Network, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Search, Building2 } from 'lucide-react';

/**
 * Step 2 — READ-ONLY preview of the reporting chain built from employee_profiles.reporting_manager_id.
 * Nothing here changes data or permissions. Loads only when the panel is opened.
 */

interface ReportPerson {
    userId: string;
    name: string;
    departmentId: string | null;
    departmentName: string | null;
    taskRole: string;
    managerUserId: string | null;
    managerName: string | null;
    directReports: number;
    totalReports: number;
    isManagerByHierarchy: boolean;
    labelMismatch: 'manager_by_hierarchy_but_label_employee' | 'label_manager_but_no_reports' | null;
}

interface ReportDepartment {
    departmentId: string;
    departmentName: string;
    memberCount: number;
    hasInternalManager: boolean;
    internalManagers: string[];
    topMembers: string[];
    externalManagers: string[];
}

interface ReportIssue {
    type: 'no_manager' | 'manager_missing' | 'self_manager' | 'cycle';
    userId: string;
    name: string;
    detail?: string;
}

interface HierarchyReport {
    summary: {
        activeProfiles: number;
        linkedPeople: number;
        withoutUserAccount: number;
        topOfChain: number;
        managersByHierarchy: number;
        labelMismatches: number;
    };
    issues: ReportIssue[];
    departments: ReportDepartment[];
    people: ReportPerson[];
}

const MISMATCH_TEXT: Record<string, string> = {
    manager_by_hierarchy_but_label_employee: 'Has people reporting to them, but label says "employee"',
    label_manager_but_no_reports: 'Label says "manager", but nobody reports to them',
};

function TreeNode({
    person,
    childrenMap,
    depth,
    expanded,
    toggle,
}: {
    person: ReportPerson;
    childrenMap: Map<string, ReportPerson[]>;
    depth: number;
    expanded: Set<string>;
    toggle: (id: string) => void;
}) {
    const kids = childrenMap.get(person.userId) || [];
    const isOpen = expanded.has(person.userId);
    return (
        <div>
            <div
                className="flex items-center gap-2 py-1.5 pr-2 rounded-lg hover:bg-slate-50"
                style={{ paddingLeft: depth * 20 + 4 }}
            >
                {kids.length > 0 ? (
                    <button
                        type="button"
                        onClick={() => toggle(person.userId)}
                        className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-slate-900 cursor-pointer"
                        aria-label={isOpen ? 'Collapse' : 'Expand'}
                    >
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                ) : (
                    <span className="w-5 h-5 flex items-center justify-center text-slate-300">•</span>
                )}
                <span className="text-sm font-bold text-slate-900">{person.name}</span>
                {person.departmentName && (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                        {person.departmentName}
                    </span>
                )}
                {kids.length > 0 && (
                    <span className="text-[11px] text-slate-500">
                        {person.directReports} direct · {person.totalReports} total
                    </span>
                )}
                {person.labelMismatch && (
                    <span
                        title={MISMATCH_TEXT[person.labelMismatch]}
                        className="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300"
                    >
                        label: {person.taskRole}
                    </span>
                )}
            </div>
            {isOpen && kids.map(k => (
                <TreeNode key={k.userId} person={k} childrenMap={childrenMap} depth={depth + 1} expanded={expanded} toggle={toggle} />
            ))}
        </div>
    );
}

export default function OrgHierarchyPanel({ orgId }: { orgId?: string }) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<HierarchyReport | null>(null);
    const [tab, setTab] = useState<'departments' | 'tree' | 'people'>('departments');
    const [search, setSearch] = useState('');
    const [onlyMismatches, setOnlyMismatches] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/task-manager/hierarchy?orgId=${encodeURIComponent(orgId || '')}`);
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load hierarchy');
            setReport(data.report);
        } catch (err: any) {
            setError(err.message || 'Failed to load hierarchy');
        } finally {
            setLoading(false);
        }
    };

    const toggleOpen = () => {
        const next = !open;
        setOpen(next);
        if (next && !report && !loading) load();
    };

    const childrenMap = useMemo(() => {
        const map = new Map<string, ReportPerson[]>();
        (report?.people || []).forEach(p => {
            if (!p.managerUserId) return;
            const list = map.get(p.managerUserId) || [];
            list.push(p);
            map.set(p.managerUserId, list);
        });
        map.forEach(list => list.sort((a, b) => a.name.localeCompare(b.name)));
        return map;
    }, [report]);

    const roots = useMemo(
        () => (report?.people || []).filter(p => !p.managerUserId && (childrenMap.get(p.userId)?.length || 0) > 0)
            .sort((a, b) => b.totalReports - a.totalReports),
        [report, childrenMap]
    );
    const loneRoots = useMemo(
        () => (report?.people || []).filter(p => !p.managerUserId && !(childrenMap.get(p.userId)?.length)),
        [report, childrenMap]
    );

    const toggleNode = (id: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const expandAll = () => setExpanded(new Set((report?.people || []).filter(p => p.directReports > 0).map(p => p.userId)));
    const collapseAll = () => setExpanded(new Set());

    const filteredPeople = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (report?.people || []).filter(p => {
            if (onlyMismatches && !p.labelMismatch) return false;
            if (!q) return true;
            return p.name.toLowerCase().includes(q)
                || (p.departmentName || '').toLowerCase().includes(q)
                || (p.managerName || '').toLowerCase().includes(q);
        });
    }, [report, search, onlyMismatches]);

    const brokenIssues = (report?.issues || []).filter(i => i.type !== 'no_manager');

    return (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <Network className="w-5 h-5 text-indigo-500" />
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">
                                Reporting Chain (from reporting_manager_id)
                            </h3>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-800 border border-indigo-200">
                                Step 2: Read-only preview
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Who reports to whom, as stored on each employee profile. Compare it with reality. Nothing here changes any permission yet.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {open && (
                        <button
                            type="button"
                            disabled={loading}
                            onClick={load}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs cursor-pointer disabled:opacity-50"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                            Refresh
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={toggleOpen}
                        className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs cursor-pointer"
                    >
                        {open ? 'Hide' : 'Show reporting chain'}
                    </button>
                </div>
            </div>

            {open && (
                <div className="space-y-4">
                    {error && (
                        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
                            ⚠️ {error}
                        </div>
                    )}
                    {loading && !report && <p className="text-xs text-slate-500">Loading reporting chain…</p>}

                    {report && (
                        <>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                {[
                                    { label: 'People in the chart', value: report.summary.linkedPeople, hint: 'active, with a user account' },
                                    { label: 'No user account', value: report.summary.withoutUserAccount, hint: 'cannot use Task Manager' },
                                    { label: 'Top of a chain', value: report.summary.topOfChain, hint: 'report to nobody' },
                                    { label: 'Managers (by hierarchy)', value: report.summary.managersByHierarchy, hint: 'have direct reports' },
                                    { label: 'Label mismatches', value: report.summary.labelMismatches, hint: 'old label disagrees' },
                                ].map(t => (
                                    <div key={t.label} className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{t.label}</p>
                                        <p className="text-xl font-black text-slate-900">{t.value}</p>
                                        <p className="text-[10px] text-slate-500">{t.hint}</p>
                                    </div>
                                ))}
                            </div>

                            {brokenIssues.length === 0 ? (
                                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold flex items-center gap-2">
                                    <CheckCircle2 className="w-4 h-4" />
                                    No broken links: no loops, no missing managers.
                                </div>
                            ) : (
                                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-1">
                                    <p className="font-black flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {brokenIssues.length} data problem(s) found</p>
                                    {brokenIssues.slice(0, 15).map(i => (
                                        <p key={`${i.type}-${i.userId}`}>• {i.name}: {i.detail || i.type}</p>
                                    ))}
                                </div>
                            )}

                            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit">
                                {([
                                    ['departments', 'By department'],
                                    ['tree', 'Chain tree'],
                                    ['people', 'All people'],
                                ] as const).map(([id, label]) => (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => setTab(id)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${tab === id ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            {tab === 'departments' && (
                                <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                                    <table className="w-full text-xs">
                                        <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px]">
                                            <tr>
                                                <th className="text-left p-3">Department</th>
                                                <th className="text-left p-3">Members</th>
                                                <th className="text-left p-3">Who manages the team</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {report.departments.map(d => (
                                                <tr key={d.departmentId} className="border-t border-slate-100 align-top">
                                                    <td className="p-3 font-bold text-slate-900 flex items-center gap-1.5">
                                                        <Building2 className="w-3.5 h-3.5 text-slate-400" /> {d.departmentName}
                                                    </td>
                                                    <td className="p-3 text-slate-700">{d.memberCount}</td>
                                                    <td className="p-3 text-slate-700">
                                                        {d.hasInternalManager ? (
                                                            <span>
                                                                Inside the team: <strong>{d.internalManagers.join(', ')}</strong>
                                                                {d.externalManagers.length > 0 && <> · above them: <strong>{d.externalManagers.join(', ')}</strong></>}
                                                            </span>
                                                        ) : d.externalManagers.length > 0 ? (
                                                            <span>
                                                                <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200 font-bold mr-1">No manager inside the team</span>
                                                                everyone reports to <strong>{d.externalManagers.join(', ')}</strong>
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-500">Top of the chain: {d.topMembers.join(', ') || '—'}</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {tab === 'tree' && (
                                <div className="border border-slate-200 rounded-2xl p-3 space-y-1">
                                    <div className="flex items-center gap-2 pb-2">
                                        <button type="button" onClick={expandAll} className="text-xs font-bold text-indigo-700 hover:underline cursor-pointer">Expand all</button>
                                        <span className="text-slate-300">|</span>
                                        <button type="button" onClick={collapseAll} className="text-xs font-bold text-indigo-700 hover:underline cursor-pointer">Collapse all</button>
                                    </div>
                                    {roots.map(r => (
                                        <TreeNode key={r.userId} person={r} childrenMap={childrenMap} depth={0} expanded={expanded} toggle={toggleNode} />
                                    ))}
                                    {loneRoots.length > 0 && (
                                        <div className="pt-3 mt-2 border-t border-slate-100">
                                            <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1">
                                                No manager and nobody reports to them ({loneRoots.length})
                                            </p>
                                            <p className="text-xs text-slate-600">{loneRoots.map(p => p.name).join(', ')}</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {tab === 'people' && (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-xl px-3 py-1.5">
                                            <Search className="w-3.5 h-3.5 text-slate-400" />
                                            <input
                                                value={search}
                                                onChange={e => setSearch(e.target.value)}
                                                placeholder="Search name, department, manager"
                                                className="text-xs outline-none w-56"
                                            />
                                        </div>
                                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                                            <input type="checkbox" checked={onlyMismatches} onChange={e => setOnlyMismatches(e.target.checked)} />
                                            Only show label mismatches
                                        </label>
                                        <span className="text-[11px] text-slate-500">{filteredPeople.length} shown</span>
                                    </div>
                                    <div className="overflow-x-auto border border-slate-200 rounded-2xl max-h-[480px] overflow-y-auto">
                                        <table className="w-full text-xs">
                                            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] sticky top-0">
                                                <tr>
                                                    <th className="text-left p-3">Person</th>
                                                    <th className="text-left p-3">Department</th>
                                                    <th className="text-left p-3">Reports to</th>
                                                    <th className="text-left p-3">Direct / total</th>
                                                    <th className="text-left p-3">Old label</th>
                                                    <th className="text-left p-3">Check</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredPeople.map(p => (
                                                    <tr key={p.userId} className="border-t border-slate-100">
                                                        <td className="p-3 font-bold text-slate-900">{p.name}</td>
                                                        <td className="p-3 text-slate-700">{p.departmentName || '—'}</td>
                                                        <td className="p-3 text-slate-700">{p.managerName || <span className="text-slate-400">nobody (top)</span>}</td>
                                                        <td className="p-3 text-slate-700">{p.directReports} / {p.totalReports}</td>
                                                        <td className="p-3 text-slate-700">{p.taskRole}</td>
                                                        <td className="p-3">
                                                            {p.labelMismatch ? (
                                                                <span className="text-amber-800 font-bold">⚠️ {MISMATCH_TEXT[p.labelMismatch]}</span>
                                                            ) : (
                                                                <span className="text-emerald-700">OK</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
