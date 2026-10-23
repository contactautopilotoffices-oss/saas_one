'use client';

import React, { useEffect, useState } from 'react';
import { api, Field, inputCls, btnPrimary, ErrorLine } from './invoiceUi';
import AutoNotifySettings from './AutoNotifySettings';

interface Settings {
    link_expiry_hours: number; max_file_mb: number; amount_tolerance: number; rate_tolerance_pct: number; qty_tolerance_pct: number; min_confidence: number;
    approver_roles: string[]; approval_limit: number; escalation_roles: string[]; evidence_required: boolean; doc_deadline_days: number; policy_version: number;
}

const ROLE_NAMES: Record<string, string> = { org_super_admin: 'Org super admin', master_admin: 'Master admin', org_admin: 'Org admin', accounts: 'Accounts', purchase_manager: 'Purchase manager' };

function RoleBox({ k, title, hint, roles, choices, canEdit, onToggle }: {
    k: 'approver_roles' | 'escalation_roles'; title: string; hint: string; roles: string[]; choices: string[]; canEdit: boolean; onToggle: (k: 'approver_roles' | 'escalation_roles', r: string) => void;
}) {
    return (
        <div>
            <div className="text-xs font-bold text-text-secondary">{title}</div>
            <div className="text-[11px] text-text-tertiary mb-1.5">{hint}</div>
            <div className="flex flex-wrap gap-2">
                {choices.map((r) => (
                    <label key={r} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold ${roles.includes(r) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-secondary'} ${canEdit ? 'cursor-pointer' : 'opacity-70'}`}>
                        <input type="checkbox" className="sr-only" disabled={!canEdit} checked={roles.includes(r)} onChange={() => onToggle(k, r)} /> {ROLE_NAMES[r] ?? r}
                    </label>
                ))}
            </div>
        </div>
    );
}

export default function InvoicePolicy({ orgId, canEdit, onSaved }: { orgId: string; canEdit: boolean; onSaved: () => void }) {
    const [s, setS] = useState<Settings | null>(null);
    const [choices, setChoices] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        api<{ settings: Settings; role_choices: string[] }>(`/api/invoices/settings?org_id=${orgId}`).then((d) => { setS(d.settings); setChoices(d.role_choices); }).catch((e) => setError(e.message));
    }, [orgId]);

    if (!s) return error ? <ErrorLine message={error} /> : <p className="text-sm text-text-tertiary py-6">Loading…</p>;
    const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { setS({ ...s, [k]: v }); setSaved(false); };
    const toggleRole = (k: 'approver_roles' | 'escalation_roles', r: string) => set(k, s[k].includes(r) ? s[k].filter((x) => x !== r) : [...s[k], r]);
    const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);

    const save = async () => {
        setBusy(true); setError(null);
        try {
            const d = await api<{ settings: Settings }>('/api/invoices/settings', { method: 'PUT', body: JSON.stringify({ org_id: orgId, ...s }) });
            setS(d.settings); setSaved(true); onSaved();
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    };

    return (
        <div className="space-y-6 max-w-3xl">
            <p className="text-sm text-text-secondary">These rules apply to every new check and decision. Each save creates a new policy version, and every decision records the version it was made under. Version now: <b>{s.policy_version}</b>.</p>

            <section className="space-y-3">
                <h3 className="text-sm font-bold text-text-primary">Fast-track approval</h3>
                <RoleBox k="approver_roles" title="Who can decide a request" hint="Nobody can ever decide a request they raised themselves." roles={s.approver_roles} choices={choices} canEdit={canEdit} onToggle={toggleRole} />
                <Field label="Approval limit (₹)" hint="Above this, only the escalation roles below can approve."><input className={inputCls} type="number" disabled={!canEdit} value={s.approval_limit} onChange={num('approval_limit')} /></Field>
                <RoleBox k="escalation_roles" title="Who can approve above the limit, and waive an invoice by policy" hint="Keep this to your most senior roles." roles={s.escalation_roles} choices={choices} canEdit={canEdit} onToggle={toggleRole} />
                <label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" disabled={!canEdit} checked={s.evidence_required} onChange={(e) => set('evidence_required', e.target.checked)} /> Require evidence with every request</label>
                <Field label="Days to receive the invoice after a fast-track payment"><input className={inputCls} type="number" disabled={!canEdit} value={s.doc_deadline_days} onChange={num('doc_deadline_days')} /></Field>
            </section>

            <section className="space-y-3">
                <h3 className="text-sm font-bold text-text-primary">Matching tolerances</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Field label="Rounding allowance (₹)"><input className={inputCls} type="number" step="0.01" disabled={!canEdit} value={s.amount_tolerance} onChange={num('amount_tolerance')} /></Field>
                    <Field label="Rate tolerance (%)"><input className={inputCls} type="number" step="0.1" disabled={!canEdit} value={s.rate_tolerance_pct} onChange={num('rate_tolerance_pct')} /></Field>
                    <Field label="Quantity tolerance (%)"><input className={inputCls} type="number" step="0.1" disabled={!canEdit} value={s.qty_tolerance_pct} onChange={num('qty_tolerance_pct')} /></Field>
                    <Field label="Minimum read confidence (%)"><input className={inputCls} type="number" disabled={!canEdit} value={s.min_confidence} onChange={num('min_confidence')} /></Field>
                </div>
            </section>

            <section className="space-y-3">
                <h3 className="text-sm font-bold text-text-primary">Vendor upload links</h3>
                <div className="grid grid-cols-2 gap-3 max-w-md">
                    <Field label="Default expiry (hours)"><input className={inputCls} type="number" disabled={!canEdit} value={s.link_expiry_hours} onChange={num('link_expiry_hours')} /></Field>
                    <Field label="Largest file (MB)"><input className={inputCls} type="number" disabled={!canEdit} value={s.max_file_mb} onChange={num('max_file_mb')} /></Field>
                </div>
            </section>

            <AutoNotifySettings orgId={orgId} canEdit={canEdit} />

            <ErrorLine message={error} />
            {canEdit ? <button className={btnPrimary} onClick={save} disabled={busy}>{busy ? 'Saving…' : saved ? 'Saved' : 'Save policy'}</button> : <p className="text-xs text-text-tertiary">Only super admins can change this policy.</p>}
        </div>
    );
}
