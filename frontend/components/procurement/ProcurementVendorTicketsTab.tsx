'use client';

import React, { useState, useEffect } from 'react';
import { ShoppingBag, CheckCircle2, Clock, MapPin, User, Building, ExternalLink, Loader2, AlertCircle } from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';

interface VendorTicket {
    id: string;
    ticket_number: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    floor_number?: string;
    location?: string;
    created_at: string;
    needs_vendor_procurement: boolean;
    vendor_procurement_status: string;
    vendor_procurement_note: string;
    vendor_arranged_details?: string;
    vendor_tagged_at?: string;
    vendor_arranged_at?: string;
    property?: { id: string; name: string };
    creator?: { full_name: string; email: string };
    tagged_by_user?: { full_name: string; email: string };
}

export default function ProcurementVendorTicketsTab() {
    const supabase = createClient();
    const [tickets, setTickets] = useState<VendorTicket[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'pending' | 'arranged'>('pending');
    const [selectedTicket, setSelectedTicket] = useState<VendorTicket | null>(null);
    const [arrangedDetailsInput, setArrangedDetailsInput] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const fetchVendorTickets = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('tickets')
                .select(`
                    id, ticket_number, title, description, status, priority, floor_number, location, created_at,
                    needs_vendor_procurement, vendor_procurement_status, vendor_procurement_note, vendor_arranged_details,
                    vendor_tagged_at, vendor_arranged_at,
                    property:properties(id, name),
                    creator:users!raised_by(full_name, email),
                    tagged_by_user:users!tickets_vendor_tagged_by_fkey(full_name, email)
                `)
                .eq('needs_vendor_procurement', true)
                .order('vendor_tagged_at', { ascending: false });

            if (error) throw error;
            const formatted: VendorTicket[] = (data || []).map((t: any) => ({
                ...t,
                property: Array.isArray(t.property) ? t.property[0] : t.property,
                creator: Array.isArray(t.creator) ? t.creator[0] : t.creator,
                tagged_by_user: Array.isArray(t.tagged_by_user) ? t.tagged_by_user[0] : t.tagged_by_user,
            }));
            setTickets(formatted);
        } catch (err) {
            console.error('Error fetching vendor tickets:', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchVendorTickets();
    }, []);

    const handleMarkVendorArranged = async () => {
        if (!selectedTicket) return;
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/tickets/${selectedTicket.id}/vendor-arranged`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ details: arrangedDetailsInput.trim() })
            });

            if (res.ok) {
                setSelectedTicket(null);
                setArrangedDetailsInput('');
                fetchVendorTickets();
            } else {
                const data = await res.json();
                alert(data.error || 'Failed to update vendor status');
            }
        } catch (err) {
            console.error('Error marking vendor arranged:', err);
            alert('A network error occurred.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const filteredTickets = tickets.filter(t => {
        if (filter === 'pending') return t.vendor_procurement_status !== 'vendor_arranged';
        if (filter === 'arranged') return t.vendor_procurement_status === 'vendor_arranged';
        return true;
    });

    const pendingCount = tickets.filter(t => t.vendor_procurement_status !== 'vendor_arranged').length;

    return (
        <div className="space-y-6">
            {/* Header / Stats */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div>
                    <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                        <ShoppingBag className="w-6 h-6 text-amber-500" />
                        Vendor Requirement Tickets
                    </h2>
                    <p className="text-sm text-slate-500 font-medium mt-1">
                        Tickets tagged by property admins requiring an external service vendor
                    </p>
                </div>

                {/* Filter Toggles */}
                <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200">
                    <button
                        onClick={() => setFilter('pending')}
                        className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 ${
                            filter === 'pending'
                                ? 'bg-amber-500 text-white shadow-sm'
                                : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                        Pending Arrangement
                        {pendingCount > 0 && (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                                filter === 'pending' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'
                            }`}>
                                {pendingCount}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setFilter('arranged')}
                        className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                            filter === 'arranged'
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                        Vendor Arranged
                    </button>
                    <button
                        onClick={() => setFilter('all')}
                        className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                            filter === 'all'
                                ? 'bg-slate-900 text-white shadow-sm'
                                : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                        All ({tickets.length})
                    </button>
                </div>
            </div>

            {/* Content List */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-16 bg-white rounded-2xl border border-slate-200">
                    <Loader2 className="w-8 h-8 text-amber-500 animate-spin mb-3" />
                    <p className="text-sm font-bold text-slate-500">Loading vendor tickets...</p>
                </div>
            ) : filteredTickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 bg-white rounded-2xl border border-slate-200 text-center px-4">
                    <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center mb-4">
                        <ShoppingBag className="w-7 h-7 text-amber-500" />
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mb-1">No Vendor Requests Found</h3>
                    <p className="text-sm text-slate-500 max-w-sm">
                        {filter === 'pending'
                            ? 'Great job! There are currently no pending vendor requests.'
                            : 'No tickets match the selected filter.'}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4">
                    {filteredTickets.map((t) => {
                        const isArranged = t.vendor_procurement_status === 'vendor_arranged';
                        return (
                            <div
                                key={t.id}
                                className={`bg-white border rounded-2xl p-6 transition-all hover:shadow-md ${
                                    isArranged ? 'border-emerald-200 bg-emerald-50/10' : 'border-amber-200 bg-amber-50/10'
                                }`}
                            >
                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                                    <div>
                                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                                            <span className="px-3 py-1 bg-slate-100 text-slate-700 font-mono text-xs font-bold rounded-lg">
                                                #{t.ticket_number}
                                            </span>
                                            <span className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${
                                                isArranged
                                                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                                    : 'bg-amber-100 text-amber-700 border border-amber-200'
                                            }`}>
                                                {isArranged ? '✓ Vendor Arranged' : '⏳ Pending Vendor'}
                                            </span>
                                            {t.property?.name && (
                                                <span className="flex items-center gap-1 text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1 rounded-lg">
                                                    <Building className="w-3.5 h-3.5" />
                                                    {t.property.name}
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="text-lg font-black text-slate-900">{t.title}</h3>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <a
                                            href={`/tickets/${t.id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5"
                                        >
                                            View Ticket <ExternalLink className="w-3.5 h-3.5" />
                                        </a>

                                        <button
                                            onClick={() => {
                                                setSelectedTicket(t);
                                                setArrangedDetailsInput(t.vendor_arranged_details || '');
                                            }}
                                            className={`px-5 py-2.5 font-bold text-xs rounded-xl transition-all shadow-sm flex items-center gap-1.5 ${
                                                isArranged
                                                    ? 'bg-slate-800 hover:bg-slate-900 text-white'
                                                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                            }`}
                                        >
                                            <CheckCircle2 className="w-4 h-4" />
                                            {isArranged ? 'Edit Vendor Details' : 'Mark Vendor Arranged'}
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 text-sm">
                                    <div className="bg-white p-4 rounded-xl border border-slate-100">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                                            Vendor Requirements (From Property Staff)
                                        </p>
                                        <p className="text-slate-800 font-medium whitespace-pre-wrap">
                                            {t.vendor_procurement_note || 'No notes provided.'}
                                        </p>
                                        {t.tagged_by_user?.full_name && (
                                            <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-50">
                                                Requested by <span className="font-semibold text-slate-600">{t.tagged_by_user.full_name}</span>
                                                {t.vendor_tagged_at && ` on ${new Date(t.vendor_tagged_at).toLocaleDateString()}`}
                                            </p>
                                        )}
                                    </div>

                                    <div className="bg-white p-4 rounded-xl border border-slate-100">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                                            Arranged Vendor Details
                                        </p>
                                        {isArranged ? (
                                            <>
                                                <p className="text-emerald-900 font-semibold whitespace-pre-wrap">
                                                    {t.vendor_arranged_details || 'Vendor has been assigned.'}
                                                </p>
                                                {t.vendor_arranged_at && (
                                                    <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-50">
                                                        Arranged on {new Date(t.vendor_arranged_at).toLocaleDateString()}
                                                    </p>
                                                )}
                                            </>
                                        ) : (
                                            <p className="text-slate-400 italic font-medium">
                                                Vendor arrangement is in progress. Click "Mark Vendor Arranged" above to enter vendor contact details and notify the requester.
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Vendor Arranged Modal */}
            {selectedTicket && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl p-6 border border-slate-100">
                        <div className="flex justify-between items-center pb-4 border-b border-slate-100 mb-4">
                            <div>
                                <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                                    Mark Vendor Arranged
                                </h3>
                                <p className="text-xs text-slate-500 font-medium mt-1">
                                    Ticket #{selectedTicket.ticket_number} - {selectedTicket.title}
                                </p>
                            </div>
                        </div>

                        <div className="space-y-4 mb-6">
                            <div>
                                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">
                                    Vendor Details / Arrival Schedule
                                </label>
                                <textarea
                                    value={arrangedDetailsInput}
                                    onChange={(e) => setArrangedDetailsInput(e.target.value)}
                                    placeholder="Enter vendor company name, technician contact number, estimated arrival time..."
                                    rows={4}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 font-medium"
                                />
                            </div>

                            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-xs text-emerald-800 font-medium">
                                📬 Submitting this will update the ticket status and send an automated email update to the requester and property staff with the vendor details.
                            </div>
                        </div>

                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setSelectedTicket(null)}
                                className="px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleMarkVendorArranged}
                                disabled={isSubmitting}
                                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-black flex items-center gap-2 transition-all shadow-md"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Updating & Sending Email...
                                    </>
                                ) : (
                                    <>Confirm Vendor Arranged</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
