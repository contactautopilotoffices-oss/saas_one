'use client';

import React, { useState, useEffect } from 'react';
import { Clock, Loader2, X, ArrowUpRight, ArrowDownRight, RefreshCcw, User, Calendar } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface CreditLog {
    id: string;
    action: 'assigned' | 'spent' | 'reset' | 'refilled';
    hours_changed: number;
    hours_after: number;
    created_at: string;
    notes: string | null;
    performed_by_user: { full_name: string } | null;
}

interface Props {
    propertyId: string;
    companyId?: string;
    userId?: string;
    title: string;
    onClose: () => void;
}

export default function CompanyCreditHistory({ propertyId, companyId, userId, title, onClose }: Props) {
    const [logs, setLogs] = useState<CreditLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchHistory = async () => {
            setIsLoading(true);
            try {
                let url = `/api/meeting-room-credits/history?propertyId=${propertyId}`;
                if (companyId) url += `&companyId=${companyId}`;
                else if (userId) url += `&userId=${userId}`;

                const res = await fetch(url);
                const data = await res.json();
                if (res.ok) setLogs(data.logs || []);
            } catch (err) {
                console.error('Failed to fetch credit history:', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchHistory();
    }, [propertyId, companyId, userId]);

    const getActionIcon = (action: string, changed: number) => {
        if (action === 'reset') return <RefreshCcw className="w-4 h-4 text-blue-500" />;
        if (changed > 0) return <ArrowUpRight className="w-4 h-4 text-emerald-500" />;
        return <ArrowDownRight className="w-4 h-4 text-rose-500" />;
    };

    const getActionLabel = (action: string) => {
        switch (action) {
            case 'reset': return 'Monthly Reset';
            case 'assigned': return 'Admin Adjustment';
            case 'spent': return 'Room Booking';
            case 'refilled': return 'Credit Refill';
            default: return action;
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                onClick={onClose}
            />
            <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
                {/* Header */}
                <div className="p-8 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center border border-slate-100">
                            <Clock className="w-6 h-6 text-slate-400" />
                        </div>
                        <div>
                            <h4 className="text-xl font-black text-slate-900 tracking-tight">Credit History</h4>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{title}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-3 bg-slate-50 rounded-2xl hover:bg-slate-100 transition-all">
                        <X className="w-5 h-5 text-slate-400" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 space-y-4">
                            <Loader2 className="w-8 h-8 text-primary animate-spin" />
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading history...</p>
                        </div>
                    ) : logs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center opacity-40">
                            <Calendar className="w-12 h-12 text-slate-300 mb-4" />
                            <p className="text-sm font-bold text-slate-500">No history found</p>
                            <p className="text-[10px] uppercase tracking-widest mt-1">Actions will appear here</p>
                        </div>
                    ) : (
                        logs.map((log) => (
                            <div key={log.id} className="bg-slate-50/50 p-5 rounded-3xl border border-slate-100/50 hover:bg-white hover:shadow-lg transition-all group">
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-sm ${log.action === 'reset' ? 'bg-blue-50' : log.hours_changed > 0 ? 'bg-emerald-50' : 'bg-rose-50'}`}>
                                            {getActionIcon(log.action, log.hours_changed)}
                                        </div>
                                        <div>
                                            <p className="text-sm font-black text-slate-800 uppercase tracking-tight">{getActionLabel(log.action)}</p>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                                {new Date(log.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className={`text-sm font-black ${log.hours_changed > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {log.hours_changed > 0 ? '+' : ''}{log.hours_changed}h
                                        </p>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Balance: {log.hours_after}h</p>
                                    </div>
                                </div>
                                
                                {log.notes && (
                                    <p className="text-xs font-medium text-slate-600 bg-white/50 p-3 rounded-2xl border border-slate-100 italic">
                                        "{log.notes}"
                                    </p>
                                )}

                                <div className="mt-3 flex items-center gap-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                                    <User className="w-3 h-3" />
                                    <span>Performed by: {log.performed_by_user?.full_name || 'System Auto'}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </motion.div>
        </div>
    );
}
