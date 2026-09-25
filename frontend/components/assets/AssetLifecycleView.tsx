'use client';

import { useState, type ComponentType } from 'react';
import {
    CheckCircle2, XCircle, Wrench, ShieldCheck, Calendar, MapPin, Building2, Tag,
    IndianRupee, Plus, Loader2, Ticket, FileText, AlertTriangle, Clock,
} from 'lucide-react';
import { GRADE_META, type AssetHealth } from '@/backend/lib/assets/performance';
import { inr, ASSET_STATUS_META, EVENT_TYPE_META } from '@/frontend/lib/assets/roles';

export interface LifecycleAsset {
    id: string;
    asset_code: string;
    name: string;
    asset_type: string | null;
    make: string | null;
    model: string | null;
    serial_number: string | null;
    floor: string | null;
    location: string | null;
    installation_date: string | null;
    purchase_cost: number | null;
    vendor_name: string | null;
    status: string;
    notes: string | null;
    category?: { name: string; color: string | null } | null;
    property?: { name: string; code: string | null } | null;
    health: AssetHealth;
    amc?: { system_name: string; vendor_name: string; contract_end_date: string; status: string } | null;
    total_cost: number;
}

export interface LifecycleEvent {
    id: string;
    event_type: string;
    title: string;
    description: string | null;
    amount: number | null;
    cost_head: string | null;
    occurred_at: string;
    ticket?: { id: string; ticket_number: string; title: string; status: string } | null;
    created_by_user?: { full_name: string } | null;
}

export interface PpmSchedule {
    id: string;
    planned_date: string;
    completion_date: string | null;
    status: string;
    frequency: string | null;
    scope: string | null;
    vendor: { id: string; company_name: string; contact_person: string | null; phone: string | null } | null;
}

export interface LinkedTicket {
    id: string;
    ticket_number: string;
    title: string;
    status: string;
    priority: string;
    created_at: string;
    resolved_at: string | null;
}

interface Props {
    asset: LifecycleAsset;
    events: LifecycleEvent[];
    canLogCost: boolean;
    onLogCost?: (payload: { amount: number; description: string }) => Promise<void>;
    ppmSchedules?: PpmSchedule[];
    tickets?: LinkedTicket[];
}

export default function AssetLifecycleView({ asset, events, canLogCost, onLogCost, ppmSchedules = [], tickets = [] }: Props) {
    const [showCostForm, setShowCostForm] = useState(false);
    const [costAmount, setCostAmount] = useState('');
    const [costNote, setCostNote] = useState('');
    const [savingCost, setSavingCost] = useState(false);

    const grade = GRADE_META[asset.health.grade];
    const statusMeta = ASSET_STATUS_META[asset.status] || { label: asset.status, color: '#64748B' };

    const submitCost = async () => {
        const amount = Number(costAmount);
        if (!amount || amount <= 0 || !onLogCost) return;
        setSavingCost(true);
        try {
            await onLogCost({ amount, description: costNote });
            setCostAmount('');
            setCostNote('');
            setShowCostForm(false);
        } finally {
            setSavingCost(false);
        }
    };

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-xl font-black text-slate-900">{asset.name}</h2>
                        <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide"
                            style={{ backgroundColor: `${statusMeta.color}1a`, color: statusMeta.color }}
                        >
                            {statusMeta.label}
                        </span>
                    </div>
                    <p className="text-sm text-slate-400 font-mono mt-0.5">{asset.asset_code}</p>
                </div>
                <div
                    className="flex items-center gap-2 px-4 py-2.5 rounded-2xl"
                    style={{ backgroundColor: `${grade.color}12` }}
                >
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: grade.color }} />
                    <div>
                        <p className="text-sm font-black" style={{ color: grade.color }}>{grade.label}</p>
                        <p className="text-[10px] text-slate-500">{grade.blurb}</p>
                    </div>
                </div>
            </div>

            {/* Details grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                {asset.category && (
                    <Detail icon={Tag} label="Category" value={asset.category.name} />
                )}
                {asset.property && (
                    <Detail icon={Building2} label="Property" value={asset.property.name} />
                )}
                {(asset.floor || asset.location) && (
                    <Detail icon={MapPin} label="Location" value={[asset.floor, asset.location].filter(Boolean).join(' · ')} />
                )}
                {asset.installation_date && (
                    <Detail icon={Calendar} label="Installed" value={new Date(asset.installation_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} />
                )}
                {(asset.make || asset.model) && (
                    <Detail icon={Wrench} label="Make / Model" value={[asset.make, asset.model].filter(Boolean).join(' ')} />
                )}
                {asset.serial_number && <Detail icon={FileText} label="Serial No." value={asset.serial_number} />}
                {asset.vendor_name && <Detail icon={Building2} label="Vendor" value={asset.vendor_name} />}
                {asset.purchase_cost != null && <Detail icon={IndianRupee} label="Purchase Cost" value={inr(asset.purchase_cost)} />}
                <Detail icon={IndianRupee} label="Total R&M Spend" value={inr(asset.total_cost)} />
            </div>

            {/* Health checkpoints */}
            <div className="rounded-2xl border border-slate-100 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                    <ShieldCheck size={15} className="text-slate-400" />
                    <p className="text-xs font-black text-slate-500 uppercase tracking-wide">Performance Checkpoints</p>
                </div>
                <div className="divide-y divide-slate-50">
                    {asset.health.checkpoints.map((cp) => (
                        <div key={cp.key} className="flex items-start gap-3 px-4 py-3">
                            {cp.ok ? <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0 mt-0.5" /> : <XCircle size={16} className="text-rose-400 flex-shrink-0 mt-0.5" />}
                            <div>
                                <p className="text-sm font-bold text-slate-800">{cp.label}</p>
                                <p className="text-xs text-slate-500 mt-0.5">{cp.detail}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {asset.amc && (
                <div className="flex items-center gap-3 p-3 rounded-2xl bg-violet-50 border border-violet-100 text-sm">
                    <ShieldCheck size={16} className="text-violet-500 flex-shrink-0" />
                    <p className="text-violet-700">
                        <span className="font-bold">{asset.amc.system_name}</span> AMC with {asset.amc.vendor_name}, valid until{' '}
                        {new Date(asset.amc.contract_end_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                </div>
            )}

            {/* PPM schedules */}
            <div className="rounded-2xl border border-slate-100 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                    <Calendar size={15} className="text-slate-400" />
                    <p className="text-xs font-black text-slate-500 uppercase tracking-wide">Preventive Maintenance</p>
                </div>
                <div className="divide-y divide-slate-50 max-h-96 overflow-y-auto">
                    {ppmSchedules.length === 0 && <p className="px-4 py-6 text-sm text-slate-400 text-center">No PPM schedules linked</p>}
                    {ppmSchedules.map((ppm) => (
                        <div key={ppm.id} className="flex items-start justify-between gap-3 px-4 py-3">
                            <div className="min-w-0">
                                <p className="text-sm font-bold text-slate-800">
                                    {ppm.scope || 'Scheduled maintenance'}
                                </p>
                                {ppm.vendor && (
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        {ppm.vendor.company_name}
                                        {ppm.vendor.contact_person ? ` · ${ppm.vendor.contact_person}` : ''}
                                    </p>
                                )}
                                <p className="text-[10px] text-slate-400 mt-1">
                                    Planned {new Date(ppm.planned_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    {ppm.frequency ? ` · ${ppm.frequency}` : ''}
                                </p>
                            </div>
                            <PpmStatusBadge status={ppm.status} />
                        </div>
                    ))}
                </div>
            </div>

            {/* Linked tickets */}
            <div className="rounded-2xl border border-slate-100 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                    <Ticket size={15} className="text-slate-400" />
                    <p className="text-xs font-black text-slate-500 uppercase tracking-wide">Tickets / Work log</p>
                </div>
                <div className="divide-y divide-slate-50 max-h-96 overflow-y-auto">
                    {tickets.length === 0 && <p className="px-4 py-6 text-sm text-slate-400 text-center">No tickets linked to this asset</p>}
                    {tickets.map((t) => (
                        <div key={t.id} className="flex items-start justify-between gap-3 px-4 py-3">
                            <div className="min-w-0">
                                <p className="text-sm font-bold text-slate-800 truncate">{t.title}</p>
                                <p className="text-[10px] text-slate-400 mt-1">
                                    {t.ticket_number} · {new Date(t.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </p>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <span
                                    className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide"
                                    style={{ backgroundColor: `${ticketStatusColor(t.status)}1a`, color: ticketStatusColor(t.status) }}
                                >
                                    {t.status}
                                </span>
                                <span className="text-[10px] text-slate-400 capitalize">{t.priority}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Cost logging */}
            {canLogCost && (
                <div className="rounded-2xl border border-slate-100 p-4">
                    {!showCostForm ? (
                        <button onClick={() => setShowCostForm(true)} className="flex items-center gap-2 text-sm font-bold text-primary">
                            <Plus size={16} /> Log a cost against this asset
                        </button>
                    ) : (
                        <div className="space-y-3">
                            <p className="text-xs font-black text-slate-500 uppercase tracking-wide">Log R&M Cost</p>
                            <div className="flex gap-3">
                                <input
                                    type="number" min={0} placeholder="Amount (₹)"
                                    value={costAmount} onChange={(e) => setCostAmount(e.target.value)}
                                    className="w-36 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                                />
                                <input
                                    placeholder="What was the cost for?"
                                    value={costNote} onChange={(e) => setCostNote(e.target.value)}
                                    className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                                />
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => setShowCostForm(false)} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold">Cancel</button>
                                <button
                                    onClick={submitCost}
                                    disabled={savingCost || !costAmount}
                                    className="px-4 py-2 bg-primary text-white rounded-xl text-xs font-black uppercase tracking-wide disabled:opacity-40 flex items-center gap-2"
                                >
                                    {savingCost && <Loader2 size={13} className="animate-spin" />} Save to R&M Budget
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Timeline */}
            <div className="rounded-2xl border border-slate-100 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                    <Clock size={15} className="text-slate-400" />
                    <p className="text-xs font-black text-slate-500 uppercase tracking-wide">Lifecycle</p>
                </div>
                <div className="divide-y divide-slate-50 max-h-96 overflow-y-auto">
                    {events.length === 0 && <p className="px-4 py-6 text-sm text-slate-400 text-center">No history yet</p>}
                    {events.map((ev) => {
                        const meta = EVENT_TYPE_META[ev.event_type] || { label: ev.event_type, color: '#64748B' };
                        return (
                            <div key={ev.id} className="flex items-start gap-3 px-4 py-3">
                                <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: meta.color }} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-xs font-black uppercase tracking-wide" style={{ color: meta.color }}>{meta.label}</span>
                                        {ev.ticket && (
                                            <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                                                <Ticket size={10} /> {ev.ticket.ticket_number}
                                            </span>
                                        )}
                                        {ev.amount != null && (
                                            <span className="text-xs font-black text-amber-600">{inr(ev.amount)}</span>
                                        )}
                                    </div>
                                    <p className="text-sm font-semibold text-slate-800 mt-0.5">{ev.title}</p>
                                    {ev.description && <p className="text-xs text-slate-500 italic mt-0.5">&quot;{ev.description}&quot;</p>}
                                    <p className="text-[10px] text-slate-400 mt-1">
                                        {ev.created_by_user?.full_name || 'System'} ·{' '}
                                        {new Date(ev.occurred_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {asset.health.nearing_end_of_life && (
                <div className="flex items-center gap-2 p-3 rounded-2xl bg-amber-50 border border-amber-100 text-xs text-amber-700 font-semibold">
                    <AlertTriangle size={14} className="flex-shrink-0" /> Nearing end of its expected lifecycle.
                </div>
            )}
        </div>
    );
}

function PpmStatusBadge({ status }: { status: string }) {
    const color = status === 'completed' ? '#10B981' : status === 'overdue' ? '#EF4444' : '#F59E0B';
    const label = status === 'completed' ? 'Done' : status === 'overdue' ? 'Overdue' : status === 'pending' ? 'Pending' : status;
    return (
        <span
            className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide whitespace-nowrap"
            style={{ backgroundColor: `${color}1a`, color }}
        >
            {label}
        </span>
    );
}

function ticketStatusColor(status: string): string {
    const s = status.toLowerCase();
    if (['open', 'assigned', 'in_progress'].includes(s)) return '#3B82F6';
    if (['resolved', 'closed'].includes(s)) return '#10B981';
    if (['blocked', 'waitlist', 'pending_validation'].includes(s)) return '#F59E0B';
    return '#64748B';
}

function Detail({ icon: Icon, label, value }: { icon: ComponentType<{ size: number; className?: string }>; label: string; value: string }) {
    return (
        <div className="flex items-start gap-2">
            <Icon size={14} className="text-slate-300 mt-0.5 flex-shrink-0" />
            <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">{label}</p>
                <p className="text-slate-700 font-semibold">{value}</p>
            </div>
        </div>
    );
}
