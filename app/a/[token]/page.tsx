'use client';

import { use, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Loader from '@/frontend/components/ui/Loader';
import AssetLifecycleView, { type LifecycleAsset, type LifecycleEvent, type PpmSchedule, type LinkedTicket } from '@/frontend/components/assets/AssetLifecycleView';

/**
 * Public asset profile page: /a/<qr_token>.
 * Printed QR labels resolve here without requiring a login. The qr_token itself
 * is the capability secret — anyone who scans the physical label sees the
 * asset details, health, AMC, PPM schedules, linked tickets, and lifecycle.
 */
export default function AssetScanPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = use(params);

    const [asset, setAsset] = useState<LifecycleAsset | null>(null);
    const [events, setEvents] = useState<LifecycleEvent[]>([]);
    const [ppmSchedules, setPpmSchedules] = useState<PpmSchedule[]>([]);
    const [tickets, setTickets] = useState<LinkedTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/assets/scan/${encodeURIComponent(token)}`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Could not load this asset');
                setAsset(data.asset);
                setEvents(data.events || []);
                setPpmSchedules(data.ppm_schedules || []);
                setTickets(data.tickets || []);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not load this asset');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [token]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <Loader size="lg" text="Loading asset..." />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 pb-16">
            <div className="max-w-2xl mx-auto px-4 pt-6">
                <div className="flex items-center gap-2 mb-5">
                    <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                        <span className="text-primary font-black text-sm">A</span>
                    </div>
                    <span className="text-sm font-black text-slate-600 tracking-wide">AUTOPILOT ASSET TAG</span>
                </div>

                {error && (
                    <div className="bg-white rounded-3xl p-8 text-center border border-rose-100">
                        <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto mb-3" />
                        <p className="text-sm font-bold text-slate-700">{error}</p>
                    </div>
                )}

                {!error && asset && (
                    <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
                        <AssetLifecycleView
                            asset={asset}
                            events={events}
                            ppmSchedules={ppmSchedules}
                            tickets={tickets}
                            canLogCost={false}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
