'use client';
import { useEffect, useState } from 'react';
import { Building2, CheckCircle2, Loader2, Save, ShieldCheck, UserRound } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import SearchableSelect from './SearchableSelect';
import { pcFetch, pcJson, type Context } from './workflowTypes';
interface Candidate { id: string; full_name: string; email: string; roles?: string[]; property_association?: string }
interface Assignment { property_id: string; kind: string; user_id: string; is_primary: boolean }
export default function PropertyRoutingSettings({ context, onSaved }: { context: Context; onSaved: () => void }) {
    const [property, setProperty] = useState(context.configuration_properties[0]?.id || '');
    const [users, setUsers] = useState<Candidate[]>([]);
    const [allocator, setAllocator] = useState(''); const [approver, setApprover] = useState('');
    const [error, setError] = useState(''); const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [retry, setRetry] = useState(0);
    useEffect(() => {
        let active = true; setLoading(true); setUsers([]); setAllocator(''); setApprover(''); setMessage(''); setError('');
        if (!property) { setLoading(false); return; }
        Promise.all([
            pcFetch<{ users: Candidate[] }>(`/api/petty-cash/candidates?org_id=${context.organization_id}&property_id=${property}`),
            pcFetch<{ assignments: Assignment[] }>(`/api/petty-cash/assignments?org_id=${context.organization_id}`),
        ]).then(([candidates, config]) => {
            if (!active) return;
            setUsers(candidates.users);
            const rows = config.assignments.filter(row => row.property_id === property && row.is_primary);
            setAllocator(rows.find(row => row.kind === 'allocator')?.user_id || '');
            setApprover(rows.find(row => row.kind === 'approver')?.user_id || '');
        }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load routing'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [property, context.organization_id, retry]);
    const options = users.map(user => ({ value: user.id, label: user.full_name || user.email, description: user.email || undefined, searchText: `${user.roles?.join(' ') || ''} ${user.property_association || ''}` }));
    const unavailable = (!loading && allocator && !users.some(user => user.id === allocator)) || (!loading && approver && !users.some(user => user.id === approver));
    const ready = !loading && !error && !busy && property && allocator && approver && allocator !== approver && !unavailable;
    return <form className="pc-panel" onSubmit={async event => {
        event.preventDefault(); if (!ready) return; setBusy(true); setMessage(''); setError('');
        try {
            await pcFetch('/api/petty-cash/assignments', pcJson({ organization_id: context.organization_id, property_id: property, allocator_id: allocator, approver_id: approver, allocator_backups: [], approver_backups: [] }, 'PUT'));
            setMessage('Routing saved. New requests will use these users; reassign pending requests explicitly.'); onSaved();
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Save failed'); } finally { setBusy(false); }
    }}>
        <div className="pc-panel-heading"><div className="pc-icon-tile"><Building2 size={20} /></div><div><h2 className="text-base font-semibold">Property Routing</h2><p className="text-sm text-text-secondary mt-1">Choose who allocates and approves cash for each property.</p></div></div>
        {!context.configuration_properties.length ? <div className="pc-empty"><Building2 size={24} /><h3>No properties available</h3><p>Add a property to configure its petty cash routing.</p></div> : <>
            <div className="pc-routing-body space-y-5">
                <div className="max-w-xl"><SearchableSelect label="Property" value={property} options={context.configuration_properties.map(item => ({ value: item.id, label: item.name }))} onChange={setProperty} disabled={busy} /></div>
                <div className="grid md:grid-cols-2 gap-4">
                    <div className="pc-routing-stage"><div className="flex items-center gap-2 text-primary mb-3"><UserRound size={18} /><span className="text-xs font-semibold uppercase tracking-wider">1 · Allocation</span></div><SearchableSelect label="Allocator" value={allocator} options={options} onChange={value => { setAllocator(value); if (value === approver) setApprover(''); }} disabled={busy || loading || !!error} emptyMessage="No eligible users match your search." /><p className="pc-help">Reviews the request and decides the cash amount.</p></div>
                    <div className="pc-routing-stage"><div className="flex items-center gap-2 text-primary mb-3"><ShieldCheck size={18} /><span className="text-xs font-semibold uppercase tracking-wider">2 · Approval</span></div><SearchableSelect label="Approver" value={approver} options={options.filter(option => option.value !== allocator)} onChange={setApprover} disabled={busy || loading || !!error} emptyMessage="No eligible users match your search." /><p className="pc-help">Approves the allocation before Accounts makes payment.</p></div>
                </div>
                {loading && <p role="status" className="flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={16} className="animate-spin" />Loading property routing…</p>}
                {!loading && !error && !users.length && <p className="pc-notice">No eligible internal users are available for this property. Check their active property or organization memberships.</p>}
                {unavailable && <p role="alert" className="pc-notice">A configured user is no longer eligible. Select an active allocator and approver before saving.</p>}
                {error && <div role="alert" className="pc-alert flex flex-wrap items-center justify-between gap-3"><span>{error}</span><Button type="button" variant="solid" size="sm" onClick={() => setRetry(value => value + 1)}>Retry</Button></div>}
                {message && <p role="status" className="pc-success"><CheckCircle2 size={18} className="shrink-0" />{message}</p>}
            </div>
            <div className="pc-panel-footer"><p className="text-xs text-text-secondary max-w-lg">The allocator and approver must be different people. Changes apply to new requests; existing requests keep their assigned users.</p><Button disabled={!ready} className="gap-2 shrink-0" type="submit">{busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{busy ? 'Saving…' : 'Save routing'}</Button></div>
        </>}
    </form>;
}
