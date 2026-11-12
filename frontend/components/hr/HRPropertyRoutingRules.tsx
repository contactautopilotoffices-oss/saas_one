'use client';

import React from 'react';
import { Building2, Plus, Trash2, User, X, Info } from 'lucide-react';
import { SearchableEmployeeSelector } from '@/frontend/components/hr/HRAdminConfigPanel';

export interface OrgProperty {
    id: string;
    name: string;
    code?: string | null;
}

// Employee objects as returned by the escalation-config API
export interface RuleAssignee {
    id?: string;
    user_id?: string | null;
    full_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    name?: string | null;
    employee_code?: string | null;
}

export interface PropertyRuleDraft {
    property_ids: string[];
    assignees: RuleAssignee[];
}

interface HRPropertyRoutingRulesProps {
    levelNum: number;
    rules: PropertyRuleDraft[];
    properties: OrgProperty[];
    employeesList: RuleAssignee[];
    onChange: (rules: PropertyRuleDraft[]) => void;
}

const assigneeKey = (a: RuleAssignee): string => a?.user_id || a?.id || '';

const assigneeLabel = (a: RuleAssignee): string =>
    a?.full_name || `${a?.first_name || ''} ${a?.last_name || ''}`.trim() || a?.name || 'User';

// Per-level property rules: a group of properties routed to its own people.
// Properties not in any rule keep using the level's default people.
export default function HRPropertyRoutingRules({
    levelNum,
    rules,
    properties,
    employeesList,
    onChange
}: HRPropertyRoutingRulesProps) {
    const propertyName = (pid: string) => properties.find(p => p.id === pid)?.name;

    const updateRule = (index: number, next: PropertyRuleDraft) => {
        onChange(rules.map((r, i) => (i === index ? next : r)));
    };

    const toggleProperty = (index: number, pid: string) => {
        const rule = rules[index];
        const has = rule.property_ids.includes(pid);
        updateRule(index, {
            ...rule,
            property_ids: has ? rule.property_ids.filter(id => id !== pid) : [...rule.property_ids, pid]
        });
    };

    const addAssignee = (index: number, empId: string) => {
        const emp = employeesList.find(e => e.id === empId || e.user_id === empId);
        if (!emp) return;
        const rule = rules[index];
        if (rule.assignees.some(a => a.id === empId || a.user_id === empId)) return;
        updateRule(index, { ...rule, assignees: [...rule.assignees, emp] });
    };

    const removeAssignee = (index: number, key: string) => {
        const rule = rules[index];
        updateRule(index, { ...rule, assignees: rule.assignees.filter(a => assigneeKey(a) !== key && a.id !== key) });
    };

    return (
        <div className="space-y-2 pt-2 mt-1 border-t border-dashed border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black uppercase text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-indigo-500" />
                    Property-wise routing ({rules.length})
                </span>
                <button
                    type="button"
                    onClick={() => onChange([...rules, { property_ids: [], assignees: [] }])}
                    disabled={properties.length === 0}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50 disabled:no-underline"
                >
                    <Plus className="w-3.5 h-3.5" />
                    Add property rule
                </button>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span>
                    Send Level {levelNum} tickets from selected properties to different people. Properties not in a rule use the Level {levelNum} users above.
                </span>
            </p>

            {properties.length === 0 && (
                <div className="text-xs text-slate-400 italic">No active properties found for this organisation.</div>
            )}

            {rules.map((rule, index) => {
                const usedElsewhere = new Set(
                    rules.flatMap((r, i) => (i === index ? [] : r.property_ids))
                );
                const removedIds = rule.property_ids.filter(pid => !propertyName(pid));
                const isIncomplete = rule.property_ids.length === 0 || rule.assignees.length === 0;

                return (
                    <div
                        key={index}
                        className={`p-3 rounded-2xl border bg-white/80 dark:bg-slate-900/60 space-y-2.5 ${
                            isIncomplete ? 'border-amber-300 dark:border-amber-700' : 'border-slate-200 dark:border-slate-700'
                        }`}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-black text-slate-700 dark:text-slate-200">Rule {index + 1}</span>
                            <button
                                type="button"
                                onClick={() => onChange(rules.filter((_, i) => i !== index))}
                                className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                                title="Remove this property rule"
                                aria-label={`Remove property rule ${index + 1}`}
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        {/* Properties */}
                        <div className="space-y-1">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Properties</div>
                            <div className="flex flex-wrap gap-1.5">
                                {properties.map(p => {
                                    const selected = rule.property_ids.includes(p.id);
                                    const taken = !selected && usedElsewhere.has(p.id);
                                    return (
                                        <button
                                            key={p.id}
                                            type="button"
                                            disabled={taken}
                                            aria-pressed={selected}
                                            onClick={() => toggleProperty(index, p.id)}
                                            title={taken ? 'Already used in another rule at this level' : undefined}
                                            className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-colors ${
                                                selected
                                                    ? 'bg-indigo-600 border-indigo-600 text-white'
                                                    : taken
                                                        ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 cursor-not-allowed line-through'
                                                        : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:border-indigo-400'
                                            }`}
                                        >
                                            {p.name}
                                        </button>
                                    );
                                })}
                                {removedIds.map(pid => (
                                    <span
                                        key={pid}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold border border-rose-300 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300"
                                    >
                                        Removed property
                                        <button
                                            type="button"
                                            onClick={() => toggleProperty(index, pid)}
                                            className="p-0.5 rounded-full hover:bg-rose-100 dark:hover:bg-rose-900"
                                            aria-label="Remove deleted property from rule"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        </div>

                        {/* People */}
                        <div className="space-y-1">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Assigned users</div>
                            <div className="flex flex-wrap gap-1.5">
                                {rule.assignees.length > 0 ? (
                                    rule.assignees.map(a => (
                                        <div
                                            key={assigneeKey(a)}
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-slate-900 border border-indigo-300 dark:border-indigo-700 text-indigo-900 dark:text-indigo-200 rounded-xl text-xs font-bold"
                                        >
                                            <User className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                                            <span>
                                                {assigneeLabel(a)}
                                                {a.employee_code ? ` (${a.employee_code})` : ''}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => removeAssignee(index, assigneeKey(a))}
                                                className="p-0.5 hover:bg-indigo-100 dark:hover:bg-indigo-900 rounded-full text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 transition-colors ml-1"
                                                title="Remove from this rule"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-xs text-slate-400 italic">No users selected.</div>
                                )}
                            </div>
                            {employeesList.length > 0 && (
                                <div className="max-w-md pt-1">
                                    <SearchableEmployeeSelector
                                        placeholder="Add a user for these properties..."
                                        employees={employeesList}
                                        selectedIds={rule.assignees.map(a => a.id || a.user_id || '').filter(Boolean)}
                                        onSelect={(id) => addAssignee(index, id)}
                                        accentColor="indigo"
                                    />
                                </div>
                            )}
                        </div>

                        {isIncomplete && (
                            <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                                Pick at least one property and one user, or remove this rule.
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
