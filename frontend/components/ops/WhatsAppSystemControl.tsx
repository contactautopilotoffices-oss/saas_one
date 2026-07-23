'use client';

import { useState, useEffect } from 'react';
import { MessageSquare, Shield, Power, Loader2, CheckCircle2, Ticket, Calendar, Wrench, Box, Users } from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';
import { motion } from 'framer-motion';

export default function WhatsAppSystemControl() {
    const [globalEnabled, setGlobalEnabled] = useState<boolean | null>(null);
    const [modules, setModules] = useState<Record<string, boolean>>({
        ticketing: true,
        meeting_room: true,
        ppm: true,
        procurement: true,
        crm: true
    });
    const [isLoading, setIsLoading] = useState(true);
    const [isUpdating, setIsUpdating] = useState<string | null>(null);
    const supabase = createClient();

    useEffect(() => {
        fetchStatus();
    }, []);

    const fetchStatus = async () => {
        setIsLoading(true);
        
        const keys = [
            'whatsapp_notifications_enabled',
            'whatsapp_ticketing_enabled',
            'whatsapp_meeting_room_enabled',
            'whatsapp_ppm_enabled',
            'whatsapp_procurement_enabled',
            'whatsapp_crm_enabled'
        ];

        const { data, error } = await supabase
            .from('system_config')
            .select('key, value')
            .in('key', keys);

        if (data) {
            const configMap = data.reduce((acc: any, row: any) => ({ ...acc, [row.key]: row.value === true }), {});
            setGlobalEnabled(configMap['whatsapp_notifications_enabled'] ?? false);
            setModules({
                ticketing: configMap['whatsapp_ticketing_enabled'] ?? true,
                meeting_room: configMap['whatsapp_meeting_room_enabled'] ?? true,
                ppm: configMap['whatsapp_ppm_enabled'] ?? true,
                procurement: configMap['whatsapp_procurement_enabled'] ?? true,
                crm: configMap['whatsapp_crm_enabled'] ?? true
            });
        }
        setIsLoading(false);
    };

    const toggleConfig = async (key: string, currentValue: boolean, updateState: (val: boolean) => void) => {
        setIsUpdating(key);
        const newValue = !currentValue;
        
        const { error } = await supabase
            .from('system_config')
            .upsert({
                key: key,
                value: newValue as any,
                updated_at: new Date().toISOString()
            }, { onConflict: 'key' });

        if (!error) {
            updateState(newValue);
        } else {
            console.error(`Error updating ${key}:`, error);
        }
        setIsUpdating(null);
    };

    if (isLoading) return null;

    return (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <MessageSquare className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                        <h3 className="font-black text-slate-800 uppercase tracking-wider text-sm">WhatsApp System</h3>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Global & Module Toggles</p>
                    </div>
                </div>
                <div className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${globalEnabled ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                    {globalEnabled ? 'System Live' : 'System Paused'}
                </div>
            </div>

            <div className="p-6 space-y-6">
                <div className="flex items-start gap-4 pb-6 border-b border-slate-100">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 transition-colors ${globalEnabled ? 'bg-emerald-500 shadow-lg shadow-emerald-200' : 'bg-slate-200'}`}>
                        <Power className={`w-6 h-6 ${globalEnabled ? 'text-white' : 'text-slate-400'}`} />
                    </div>
                    <div className="flex-1">
                        <p className="text-sm text-slate-600 font-bold leading-relaxed mb-4">
                            This switch controls all automated WhatsApp notifications across the entire platform. 
                            When off, no messages will be sent via Wasender, overriding any module settings below.
                        </p>
                        
                        <button
                            onClick={() => toggleConfig('whatsapp_notifications_enabled', globalEnabled!, setGlobalEnabled)}
                            disabled={isUpdating !== null}
                            className={`group relative w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-3
                                ${globalEnabled 
                                    ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' 
                                    : 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-xl shadow-emerald-100'
                                }`}
                        >
                            {isUpdating === 'whatsapp_notifications_enabled' ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : globalEnabled ? (
                                <>
                                    <Power className="w-4 h-4" /> Shutdown Global Service
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 className="w-4 h-4" /> Activate Global Service
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Module Toggles */}
                <div className="space-y-3">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Module Specific Toggles</h4>
                    
                    {[
                        { id: 'ticketing', name: 'Ticketing & Snags', icon: Ticket },
                        { id: 'meeting_room', name: 'Meeting Rooms', icon: Calendar },
                        { id: 'ppm', name: 'PPM / Maintenance', icon: Wrench },
                        { id: 'procurement', name: 'Procurement', icon: Box },
                        { id: 'crm', name: 'CRM / BD Leads', icon: Users },
                    ].map((mod) => (
                        <div key={mod.id} className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100">
                            <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${modules[mod.id] ? 'bg-primary/10 text-primary' : 'bg-slate-200 text-slate-400'}`}>
                                    <mod.icon className="w-4 h-4" />
                                </div>
                                <span className="text-sm font-bold text-slate-700">{mod.name}</span>
                            </div>
                            <button
                                onClick={() => toggleConfig(`whatsapp_${mod.id}_enabled`, modules[mod.id], (val) => setModules(prev => ({ ...prev, [mod.id]: val })))}
                                disabled={isUpdating !== null || !globalEnabled}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${!globalEnabled ? 'opacity-50 cursor-not-allowed' : ''} ${modules[mod.id] ? 'bg-emerald-500' : 'bg-slate-200'}`}
                            >
                                <span className={`${modules[mod.id] ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition-transform`} />
                            </button>
                        </div>
                    ))}
                </div>

                <div className="bg-amber-50 rounded-2xl p-4 flex items-start gap-3 border border-amber-100">
                    <Shield className="w-4 h-4 text-amber-500 mt-0.5" />
                    <p className="text-[10px] text-amber-800 font-bold leading-relaxed uppercase tracking-tight">
                        Warning: Turning this on will resume all enqueued ticket alerts and reminders immediately.
                    </p>
                </div>
            </div>
        </div>
    );
}
