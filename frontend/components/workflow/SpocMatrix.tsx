'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Network, Plus, RefreshCw, Save, Trash2, X, Clock, Loader2,
    AlertTriangle, Check, User as UserIcon, Shield,
} from 'lucide-react';

/**
 * SPOC matrix — rows are workflow stages, columns are escalation levels, each cell
 * names the single point of contact (a person or a role) plus that rung's SLA.
 *
 * Deliberately the same mental model as the ticket escalation builder
 * (frontend/components/escalation/EscalationHierarchyBuilder.tsx): 1-based ordered
 * levels, one actor per rung, a per-rung timer. The grid adds the domain/stage axis
 * and the option of naming a role, so a cell keeps working when people change.
 */

type Domain = 'ticket' | 'procurement' | 'petty_cash' | 'payment';

interface DomainSpec {
    key: Domain;
    label: string;
    /** seed rows for a brand-new matrix; the real lifecycle stage keys of each module */
    stages: string[];
}

const DOMAINS: DomainSpec[] = [
    { key: 'ticket', label: 'Tickets', stages: ['open', 'assigned', 'in_progress', 'overdue'] },
    { key: 'procurement', label: 'Procurement', stages: ['requisition', 'comparative', 'po_approval', 'delivery'] },
    { key: 'petty_cash', label: 'Petty Cash', stages: ['submitted', 'approved', 'paid', 'settlement_submitted'] },
    { key: 'payment', label: 'Payments', stages: ['to_align', 'aligned', 'completed'] },
];

// Roles worth offering even when nobody currently holds them in this org.
// 'manager_executive' was removed: no migration ever adds it to the app_role enum or
// uses it anywhere, so it could only ever resolve to zero users.
const BASE_ROLES = [
    'org_super_admin', 'org_admin', 'property_admin',
    'procurement', 'purchase_manager', 'purchase_executive', 'accounts',
    'soft_service_manager', 'mst',
];

const MAX_LEVELS = 6;

interface SpocRule {
    id: string;
    property_id: string | null;
    domain: Domain;
    stage: string;
    level: number;
    spoc_user_id: string | null;
    spoc_role: string | null;
    sla_hours: number | null;
    is_active: boolean;
    spoc?: { id: string; full_name: string | null; email: string | null } | null;
}

interface Employee {
    id: string;
    full_name: string;
    email: string;
    membership_role?: string | null;
    department?: string | null;
}

interface Cell {
    spoc_user_id: string | null;
    spoc_role: string | null;
    sla_hours: number | null;
}

interface Props {
    organizationId: string;
    /** set to edit a property's overrides; omit to edit the org-wide matrix */
    propertyId?: string;
    /** rendered next to the header, e.g. the property dropdown of the host screen */
    propertySelector?: React.ReactNode;
}

const cellKey = (stage: string, level: number) => `${stage}::${level}`;
// Key order is not stable across edits, so the dirty check compares a canonical form
// instead of JSON.stringify — otherwise clearing and re-picking a cell reads as dirty.
const serializeCells = (cells: Record<string, Cell>) =>
    Object.keys(cells).sort()
        .map(k => `${k}|${cells[k].spoc_user_id || ''}|${cells[k].spoc_role || ''}|${cells[k].sla_hours ?? ''}`)
        .join(';');
const titleCase = (s: string) => s.split(/[_\s]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
const slugify = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

export default function SpocMatrix({ organizationId, propertyId, propertySelector }: Props) {
    const [domain, setDomain] = useState<Domain>('ticket');
    const [rules, setRules] = useState<SpocRule[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [canEdit, setCanEdit] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const [draft, setDraft] = useState<Record<string, Cell>>({});
    const [original, setOriginal] = useState<Record<string, Cell>>({});
    const [extraStages, setExtraStages] = useState<string[]>([]);
    const [levelCount, setLevelCount] = useState(3);
    const [editing, setEditing] = useState<{ stage: string; level: number } | null>(null);
    const [newStage, setNewStage] = useState('');

    const scopeLabel = propertyId ? 'this property' : 'the organization';

    // ── Load ────────────────────────────────────────────────────────────────────

    // Switching domain tabs fires overlapping requests; without a staleness guard a slow
    // response for the PREVIOUS domain lands last and repopulates the grid while `domain`
    // has already moved on — the next Save would then write one domain's cells under
    // another domain's key, invisibly from either tab.
    const reqId = useRef(0);

    const fetchAll = useCallback(async () => {
        const id = ++reqId.current;
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ organization_id: organizationId, domain });
            if (propertyId) params.set('property_id', propertyId);
            const empParams = new URLSearchParams({ organizationId });
            if (propertyId) empParams.set('propertyId', propertyId);

            const [ruleRes, empRes] = await Promise.all([
                fetch(`/api/workflows/spoc?${params}`),
                fetch(`/api/escalation/employees?${empParams}`),
            ]);

            const ruleData = await ruleRes.json();
            if (id !== reqId.current) return;
            if (!ruleRes.ok) throw new Error(ruleData.error || 'Failed to load the SPOC matrix');

            const loaded: SpocRule[] = ruleData.rules || [];
            setRules(loaded);
            setCanEdit(ruleData.can_edit !== false);
            // Employees are a nice-to-have; a failed pool must not blank the grid.
            setEmployees(empRes.ok ? (await empRes.json()) || [] : []);

            const mine = loaded.filter(r => (propertyId ? r.property_id === propertyId : r.property_id === null));
            const base: Record<string, Cell> = {};
            for (const r of mine) {
                base[cellKey(r.stage, r.level)] = {
                    spoc_user_id: r.spoc_user_id,
                    spoc_role: r.spoc_role,
                    sla_hours: r.sla_hours,
                };
            }
            setOriginal(base);
            setDraft(base);
            setExtraStages([]);
            const maxLevel = loaded.reduce((m, r) => Math.max(m, r.level), 0);
            setLevelCount(Math.min(MAX_LEVELS, Math.max(3, maxLevel)));
        } catch (err: any) {
            if (id !== reqId.current) return;
            setError(err.message || 'Failed to load the SPOC matrix');
            setRules([]);
        } finally {
            if (id === reqId.current) setLoading(false);
        }
    }, [organizationId, propertyId, domain]);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    // ── Derived ─────────────────────────────────────────────────────────────────

    const spec = DOMAINS.find(d => d.key === domain)!;

    const stages = useMemo(() => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const s of [...spec.stages, ...rules.map(r => r.stage), ...extraStages, ...Object.keys(draft).map(k => k.split('::')[0])]) {
            if (!s || seen.has(s)) continue;
            seen.add(s);
            out.push(s);
        }
        return out;
    }, [spec, rules, extraStages, draft]);

    const levels = useMemo(() => Array.from({ length: levelCount }, (_, i) => i + 1), [levelCount]);

    /** org-wide rules a property inherits when it has no override of its own */
    const inherited = useMemo(() => {
        const map: Record<string, SpocRule> = {};
        if (!propertyId) return map;
        for (const r of rules) if (r.property_id === null) map[cellKey(r.stage, r.level)] = r;
        return map;
    }, [rules, propertyId]);

    const employeeById = useMemo(() => {
        const m: Record<string, Employee> = {};
        for (const e of employees) m[e.id] = e;
        return m;
    }, [employees]);

    const roleOptions = useMemo(() => {
        const held = employees.map(e => e.membership_role).filter(Boolean) as string[];
        return [...new Set([...held, ...BASE_ROLES])].sort();
    }, [employees]);

    const roleHeadcount = useCallback(
        (role: string) => employees.filter(e => e.membership_role === role).length,
        [employees],
    );

    const dirty = useMemo(() => serializeCells(draft) !== serializeCells(original), [draft, original]);

    // Switching domain refetches and rebuilds the draft, so unsaved cells would vanish.
    function switchDomain(next: Domain) {
        if (next === domain) return;
        if (dirty && !window.confirm('Discard the unsaved changes to this matrix?')) return;
        setDomain(next);
    }

    // ── Cell editing ────────────────────────────────────────────────────────────

    function setCell(stage: string, level: number, cell: Cell | null) {
        setDraft(prev => {
            const next = { ...prev };
            if (cell === null || (!cell.spoc_user_id && !cell.spoc_role)) delete next[cellKey(stage, level)];
            else next[cellKey(stage, level)] = cell;
            return next;
        });
    }

    function addStage() {
        const key = slugify(newStage);
        if (!key) return;
        if (!stages.includes(key)) setExtraStages(prev => [...prev, key]);
        setNewStage('');
    }

    async function save() {
        setSaving(true);
        setError('');
        try {
            // Send every touched cell; a cell dropped from the draft is sent empty,
            // which the API reads as "delete this cell".
            const keys = new Set([...Object.keys(draft), ...Object.keys(original)]);
            const payloadRules = [...keys].map(key => {
                const [stage, levelStr] = key.split('::');
                const cell = draft[key];
                return {
                    stage,
                    level: Number(levelStr),
                    spoc_user_id: cell?.spoc_user_id ?? null,
                    spoc_role: cell?.spoc_role ?? null,
                    sla_hours: cell?.sla_hours ?? null,
                };
            });

            const res = await fetch('/api/workflows/spoc', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organization_id: organizationId,
                    property_id: propertyId || null,
                    domain,
                    rules: payloadRules,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Save failed');

            setSuccess('SPOC matrix saved');
            setTimeout(() => setSuccess(''), 3000);
            await fetchAll();
        } catch (err: any) {
            setError(err.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    }

    // ── Render ──────────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="w-7 h-7 text-primary animate-spin" />
            </div>
        );
    }

    const configuredCount = Object.keys(draft).length;

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
                        <Network className="w-5 h-5 text-primary" /> SPOC &amp; Escalation Matrix
                    </h2>
                    <p className="text-sm text-text-secondary mt-0.5">
                        One owner per stage, per level — for {scopeLabel}. Levels run left to right, exactly like the ticket escalation chain.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {propertySelector}
                    <button onClick={fetchAll} title="Refresh"
                        className="p-2.5 rounded-xl border border-border text-text-tertiary hover:text-text-primary hover:bg-muted transition-colors">
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    {canEdit && (
                        <button onClick={save} disabled={!dirty || saving}
                            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50">
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {saving ? 'Saving…' : 'Save Matrix'}
                        </button>
                    )}
                </div>
            </div>

            {/* Domain tabs */}
            <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
                {DOMAINS.map(d => (
                    <button key={d.key} onClick={() => switchDomain(d.key)}
                        className={`px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 transition-colors ${
                            domain === d.key ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                        {d.label}
                    </button>
                ))}
            </div>

            {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-500 text-sm font-semibold">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
                </div>
            )}
            {success && (
                <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-xl text-green-600 text-sm font-semibold">
                    <Check className="w-4 h-4 flex-shrink-0" /> {success}
                </div>
            )}

            {!canEdit && (
                <div className="p-3 bg-muted border border-border rounded-xl text-sm text-text-secondary">
                    You can view this matrix but not change it. Only org admins may edit it.
                </div>
            )}

            {configuredCount === 0 && (
                <div className="flex items-start gap-3 p-4 bg-surface-elevated border border-border rounded-2xl">
                    <Shield className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-bold text-text-primary">No SPOCs configured yet for {spec.label}</p>
                        <p className="text-xs text-text-secondary mt-0.5">
                            The rows below are the usual stages for this module — nothing is saved until you fill a cell.
                            Anything left empty simply has no SPOC, and callers fall back to their existing behaviour.
                        </p>
                    </div>
                </div>
            )}

            {/* Grid */}
            <div className="border border-border rounded-2xl bg-surface overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse">
                    <thead>
                        <tr className="bg-muted">
                            <th className="text-left text-[11px] font-bold uppercase tracking-wider text-text-tertiary px-4 py-3 w-48">Stage</th>
                            {levels.map(l => (
                                <th key={l} className="text-left text-[11px] font-bold uppercase tracking-wider text-text-tertiary px-3 py-3">
                                    Level {l}
                                </th>
                            ))}
                            <th className="px-3 py-3 w-12">
                                {canEdit && levelCount < MAX_LEVELS && (
                                    <button onClick={() => setLevelCount(n => n + 1)} title="Add level"
                                        className="p-1.5 rounded-lg border border-border text-text-tertiary hover:text-primary hover:border-primary transition-colors">
                                        <Plus className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {stages.map(stage => (
                            <tr key={stage} className="border-t border-border">
                                <td className="px-4 py-3 align-top">
                                    <p className="text-sm font-bold text-text-primary">{titleCase(stage)}</p>
                                    <p className="text-[11px] text-text-tertiary font-mono">{stage}</p>
                                </td>
                                {levels.map(level => {
                                    const cell = draft[cellKey(stage, level)];
                                    const inh = inherited[cellKey(stage, level)];
                                    return (
                                        <td key={level} className="px-3 py-3 align-top">
                                            <button
                                                onClick={() => canEdit && setEditing({ stage, level })}
                                                disabled={!canEdit}
                                                className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors min-h-[62px] ${
                                                    cell
                                                        ? 'border-primary/40 bg-primary/5 hover:border-primary'
                                                        : 'border-dashed border-border hover:border-primary/50 bg-surface-elevated'
                                                } ${canEdit ? '' : 'cursor-default'}`}
                                            >
                                                {cell ? (
                                                    <>
                                                        <span className="flex items-center gap-1.5 text-sm font-bold text-text-primary">
                                                            {cell.spoc_user_id ? <UserIcon className="w-3.5 h-3.5 text-primary" /> : <Shield className="w-3.5 h-3.5 text-primary" />}
                                                            <span className="truncate">
                                                                {cell.spoc_user_id
                                                                    ? employeeById[cell.spoc_user_id]?.full_name || 'Assigned user'
                                                                    : titleCase(cell.spoc_role || '')}
                                                            </span>
                                                        </span>
                                                        <span className="flex items-center gap-1 text-[11px] text-text-secondary mt-1">
                                                            {cell.spoc_user_id ? 'Person' : `Role · ${roleHeadcount(cell.spoc_role || '')} people`}
                                                            {cell.sla_hours ? <><Clock className="w-3 h-3 ml-1" />{cell.sla_hours}h</> : null}
                                                        </span>
                                                    </>
                                                ) : inh ? (
                                                    <span className="text-xs text-text-tertiary">
                                                        Inherited ·{' '}
                                                        {inh.spoc?.full_name || titleCase(inh.spoc_role || '')}
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-text-tertiary">— set SPOC</span>
                                                )}
                                            </button>
                                        </td>
                                    );
                                })}
                                <td />
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Add a stage the defaults don't cover */}
            {canEdit && (
                <div className="flex items-center gap-2">
                    <input
                        value={newStage}
                        onChange={e => setNewStage(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addStage(); }}
                        placeholder="Add a stage (e.g. vendor_followup)"
                        className="px-3 py-2 border border-border rounded-xl text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                    <button onClick={addStage} disabled={!slugify(newStage)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-sm font-bold text-text-secondary hover:text-text-primary hover:bg-muted transition-colors disabled:opacity-40">
                        <Plus className="w-4 h-4" /> Add Stage
                    </button>
                    {dirty && <span className="text-xs text-text-tertiary ml-auto">Unsaved changes</span>}
                </div>
            )}

            {editing && (
                <CellEditor
                    stage={editing.stage}
                    level={editing.level}
                    value={draft[cellKey(editing.stage, editing.level)] || null}
                    employees={employees}
                    roleOptions={roleOptions}
                    roleHeadcount={roleHeadcount}
                    onClose={() => setEditing(null)}
                    onSave={cell => { setCell(editing.stage, editing.level, cell); setEditing(null); }}
                />
            )}
        </div>
    );
}

// ── Cell editor ─────────────────────────────────────────────────────────────────

function CellEditor({
    stage, level, value, employees, roleOptions, roleHeadcount, onClose, onSave,
}: {
    stage: string;
    level: number;
    value: Cell | null;
    employees: Employee[];
    roleOptions: string[];
    roleHeadcount: (role: string) => number;
    onClose: () => void;
    onSave: (cell: Cell | null) => void;
}) {
    const [mode, setMode] = useState<'user' | 'role'>(value?.spoc_role && !value?.spoc_user_id ? 'role' : 'user');
    const [userId, setUserId] = useState(value?.spoc_user_id || '');
    const [role, setRole] = useState(value?.spoc_role || '');
    const [sla, setSla] = useState(value?.sla_hours != null ? String(value.sla_hours) : '');

    const [hint, setHint] = useState('');

    // Apply with the active tab empty used to mean onSave(null), i.e. DELETE the cell —
    // so merely peeking at the Person tab on a role-configured cell and hitting Apply
    // wiped it, with no warning. Clearing is what the "Clear cell" button is for.
    const commit = () => {
        const hours = sla.trim() ? Math.max(1, parseInt(sla, 10) || 0) : 0;
        if (mode === 'user' && !userId) {
            setHint('Pick a person, or switch to Role. Use “Clear cell” to empty this rung.');
            return;
        }
        if (mode === 'role' && !role) {
            setHint('Pick a role, or switch to Person. Use “Clear cell” to empty this rung.');
            return;
        }
        onSave({
            spoc_user_id: mode === 'user' ? userId : null,
            spoc_role: mode === 'role' ? role : null,
            sla_hours: hours > 0 ? hours : null,
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div className="w-full max-w-md bg-surface-elevated border border-border rounded-2xl shadow-xl p-5 space-y-4"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between">
                    <div>
                        <h3 className="text-base font-bold text-text-primary">{titleCase(stage)} · Level {level}</h3>
                        <p className="text-xs text-text-secondary mt-0.5">Who owns this stage at this rung?</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-muted">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex gap-2">
                    {(['user', 'role'] as const).map(m => (
                        <button key={m} onClick={() => setMode(m)}
                            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-bold border transition-colors ${
                                mode === m ? 'bg-primary text-white border-primary' : 'bg-surface text-text-secondary border-border hover:text-text-primary'}`}>
                            {m === 'user' ? <UserIcon className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                            {m === 'user' ? 'Person' : 'Role'}
                        </button>
                    ))}
                </div>

                {mode === 'user' ? (
                    <div>
                        <label className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary block mb-1.5">SPOC</label>
                        <select value={userId} onChange={e => setUserId(e.target.value)}
                            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                            <option value="">Select a person…</option>
                            {employees.map(e => (
                                <option key={e.id} value={e.id}>
                                    {e.full_name}{e.membership_role ? ` — ${titleCase(e.membership_role)}` : ''}
                                </option>
                            ))}
                        </select>
                        {employees.length === 0 && (
                            <p className="text-xs text-text-tertiary mt-1.5">No employees available for this scope — pick a role instead.</p>
                        )}
                    </div>
                ) : (
                    <div>
                        <label className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary block mb-1.5">Role</label>
                        <select value={role} onChange={e => setRole(e.target.value)}
                            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                            <option value="">Select a role…</option>
                            {roleOptions.map(r => (
                                <option key={r} value={r}>{titleCase(r)} ({roleHeadcount(r)})</option>
                            ))}
                        </select>
                        {role && roleHeadcount(role) === 0 && (
                            <p className="text-xs text-amber-500 mt-1.5">Nobody currently holds this role here — the rung will resolve to nobody until someone does.</p>
                        )}
                    </div>
                )}

                <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary block mb-1.5">
                        SLA before escalating (hours, optional)
                    </label>
                    <input type="number" min={1} value={sla} onChange={e => setSla(e.target.value)} placeholder="e.g. 24"
                        className="w-32 px-3 py-2.5 border border-border rounded-xl text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                </div>

                {hint && <p className="text-xs text-orange-500">{hint}</p>}

                <div className="flex items-center justify-between pt-1">
                    <button onClick={() => onSave(null)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold text-red-500 hover:bg-red-500/10 transition-colors">
                        <Trash2 className="w-4 h-4" /> Clear cell
                    </button>
                    <div className="flex items-center gap-2">
                        <button onClick={onClose}
                            className="px-4 py-2 rounded-xl border border-border text-sm font-bold text-text-secondary hover:bg-muted transition-colors">
                            Cancel
                        </button>
                        <button onClick={commit}
                            className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 transition-colors">
                            Apply
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
