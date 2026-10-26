'use client';

import { useId, useState } from 'react';

export interface RequisitionApprover {
    id: string;
    full_name: string;
    email: string;
    role: string;
}

interface Props {
    approvers: RequisitionApprover[];
    value: string;
    onChange: (id: string) => void;
    loading?: boolean;
    error?: string;
    onRetry?: () => void;
}

export default function RequisitionApproverSelect({ approvers, value, onChange, loading, error, onRetry }: Props) {
    const id = useId();
    const [search, setSearch] = useState('');
    const query = search.trim().toLowerCase();
    const matches = approvers.filter(user => `${user.full_name} ${user.email}`.toLowerCase().includes(query));
    const selected = approvers.find(user => user.id === value);
    // Keep the current selection visible when searching for a different approver.
    const options = selected && !matches.some(user => user.id === value) ? [selected, ...matches] : matches;
    return (
        <div className="space-y-2">
            <label htmlFor={`${id}-search`} className="block text-xs text-slate-500 dark:text-slate-400">Search approvers by name or email</label>
            <input id={`${id}-search`} type="search" value={search}
                onChange={event => setSearch(event.target.value)} placeholder="Search name or email"
                disabled={loading || !!error}
                className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 disabled:opacity-50" />
            <label htmlFor={`${id}-select`} className="block text-xs font-bold text-slate-700 dark:text-slate-300">Select approver *</label>
            <select id={`${id}-select`} required value={value} onChange={event => onChange(event.target.value)}
                disabled={loading || !!error || !approvers.length}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 disabled:opacity-50">
                <option value="">{loading ? 'Loading approvers…' : 'Choose an approver'}</option>
                {options.map(user => <option key={user.id} value={user.id}>
                    {user.full_name || user.email} ({user.email}) — {user.role === 'ops_super_admin' ? 'Ops Super Admin' : 'Org Super Admin'}
                </option>)}
            </select>
            {error ? <p role="alert" className="text-xs text-red-600">{error} {onRetry && <button type="button" onClick={onRetry} className="underline">Retry</button>}</p>
                : !loading && !approvers.length ? <p className="text-xs text-slate-500">No active Org Super Admin or Ops Super Admin users are available in this organization.</p>
                    : !loading && !matches.length ? <p className="text-xs text-slate-500">No matching approvers. Try another name or email.</p> : null}
        </div>
    );
}
