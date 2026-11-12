'use client';

/** "What should the AI have done?": an answer from the catalog plus its details. Shared by Learning and the training chat. */
export interface Entry { id: string; kind: string; label: string }
export interface Answer { entryId: string; fields: Record<string, unknown> }

export const PERIODS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This week'], ['last_7_days', 'Last 7 days'], ['this_month', 'This month'], ['last_month', 'Last month']] as const;
/** Which details each answer takes, so the teach form only shows what matters. */
export const FIELDS: Record<string, Array<'period' | 'status' | 'day' | 'property_name' | 'urgent'>> = {
    'tickets.count': ['period', 'status', 'property_name'],
    'tickets.list': ['period', 'status', 'property_name'],
    'electricity.readings_status': ['day', 'property_name'],
    'electricity.consumption': ['period', 'property_name'],
    'ticket.create': ['urgent'],
};
/** The "what should it have done" picker: an answer + its details. */
export default function AnswerPicker({ entries, value, onChange }: { entries: Entry[]; value: Answer; onChange: (v: Answer) => void }) {
    const want = FIELDS[value.entryId] || [];
    const setField = (k: string, v: unknown) => onChange({ ...value, fields: { ...value.fields, [k]: v === '' ? undefined : v } });
    const sel = 'rounded-lg border border-slate-200 px-2 py-1 text-xs';
    return (
        <div className="flex flex-wrap items-center gap-2">
            <select className={sel} value={value.entryId} onChange={e => onChange({ entryId: e.target.value, fields: {} })}>
                <option value="">Choose the right answer…</option>
                {entries.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
            {want.includes('period') && <select className={sel} value={String(value.fields.period ?? 'today')} onChange={e => setField('period', e.target.value)}>{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
            {want.includes('day') && <select className={sel} value={String(value.fields.day ?? 'today')} onChange={e => setField('day', e.target.value)}><option value="today">Today</option><option value="yesterday">Yesterday</option></select>}
            {want.includes('status') && <select className={sel} value={String(value.fields.status ?? 'all')} onChange={e => setField('status', e.target.value)}><option value="all">All</option><option value="open">Open</option><option value="closed">Closed</option></select>}
            {want.includes('property_name') && <input className={sel} placeholder="Property (optional)" value={String(value.fields.property_name ?? '')} onChange={e => setField('property_name', e.target.value)} />}
            {want.includes('urgent') && <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={value.fields.urgent === true} onChange={e => setField('urgent', e.target.checked)} /> urgent</label>}
        </div>
    );
}

