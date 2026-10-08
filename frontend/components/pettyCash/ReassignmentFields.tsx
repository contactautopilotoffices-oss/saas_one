'use client';
import { useEffect, useState } from 'react';
import { pcFetch } from './workflowTypes';
interface Assignment { property_id: string; user_id: string; kind: string; is_primary: boolean; user?: { full_name?: string; email?: string } }
export default function ReassignmentFields({ org, propertyId, requesterId }: { org: string; propertyId: string; requesterId: string }) {
    const [rows, setRows] = useState<Assignment[]>([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
    useEffect(() => {
        let active = true;
        pcFetch<{ assignments: Assignment[] }>(`/api/petty-cash/assignments?org_id=${org}`).then(data => { if (active) setRows(data.assignments.filter(row => row.property_id === propertyId && row.is_primary && row.user_id !== requesterId)); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [org, propertyId, requesterId]);
    if (loading) return <p>Loading configured actors…<input type="text" required value="" readOnly className="sr-only" aria-label="Routing still loading" /></p>;
    return <fieldset className="space-y-3"><legend>Assign the configured allocator and approver</legend><p>This restarts allocation and preserves earlier decisions in the timeline.</p>{error && <p role="alert">{error}</p>}{['allocator', 'approver'].map(kind => <label className="block" key={kind}>{kind === 'allocator' ? 'Assigned allocator' : 'Assigned approver'}<select aria-label={kind === 'allocator' ? 'Assigned allocator' : 'Assigned approver'} className="pc-input" name={`reassign_${kind}_id`} required defaultValue={rows.find(row => row.kind === kind && row.is_primary)?.user_id || ''}><option value="">Select configured {kind}</option>{rows.filter(row => row.kind === kind).map(row => <option key={row.user_id} value={row.user_id}>{row.user?.full_name || row.user?.email || row.user_id}</option>)}</select></label>)}</fieldset>;
}
