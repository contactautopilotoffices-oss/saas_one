'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Nfc, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import DieselLoggerCard from './DieselLoggerCard';
import { Toast } from '../ui/Toast';

interface Generator {
    id: string;
    name: string;
    make?: string;
    capacity_kva?: number;
    tank_capacity_litres?: number;
    status: string;
    property_id: string;
    initial_kwh_reading?: number;
    initial_run_hours?: number;
    initial_diesel_level?: number;
}

interface Property {
    id: string;
    name: string;
    code: string;
}

interface DieselReading {
    opening_hours: number;
    closing_hours: number;
    opening_kwh: number;
    closing_kwh: number;
    opening_diesel_level: number;
    closing_diesel_level: number;
    diesel_added_litres: number;
    computed_consumed_litres?: number;
    tariff_id?: string;
    tariff_rate?: number;
    notes?: string;
    reading_date?: string;
}

interface ScanQuickLogProps {
    generator: Generator;
    property: Property | null;
}

const ScanQuickLog: React.FC<ScanQuickLogProps> = ({ generator, property }) => {
    const propertyId = generator.property_id;
    const [previousClosing, setPreviousClosing] = useState<{ hours: number; kwh: number; diesel: number } | undefined>();
    const [activeTariff, setActiveTariff] = useState<any>(null);
    const [reading, setReading] = useState<DieselReading | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [justLogged, setJustLogged] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; visible: boolean }>({
        message: '', type: 'success', visible: false
    });

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setIsLoading(true);
            try {
                const readingsRes = await fetch(`/api/properties/${propertyId}/diesel-readings?generatorId=${generator.id}`);
                const readingsData = readingsRes.ok ? await readingsRes.json() : [];
                const latest = readingsData[0]; // already ordered by reading_date desc

                if (!cancelled) {
                    setPreviousClosing(latest
                        ? { hours: latest.closing_hours, kwh: latest.closing_kwh, diesel: latest.closing_diesel_level }
                        : { hours: generator.initial_run_hours || 0, kwh: generator.initial_kwh_reading || 0, diesel: generator.initial_diesel_level || 0 }
                    );
                }

                const today = new Date().toISOString().split('T')[0];
                try {
                    const tariffRes = await fetch(`/api/properties/${propertyId}/dg-tariffs?generatorId=${generator.id}&date=${today}`);
                    if (tariffRes.ok && !cancelled) {
                        const t = await tariffRes.json();
                        if (t?.id) setActiveTariff(t);
                    }
                } catch {
                    // No active tariff is a valid state
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [propertyId, generator.id, generator.initial_run_hours, generator.initial_kwh_reading, generator.initial_diesel_level]);

    const handleSave = useCallback(async () => {
        if (!reading) return;
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/properties/${propertyId}/diesel-readings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    readings: [{
                        generator_id: generator.id,
                        reading_date: reading.reading_date || new Date().toISOString().split('T')[0],
                        ...reading,
                    }],
                }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to save reading');
            }
            setJustLogged(true);
        } catch (err: any) {
            setToast({ message: err.message, type: 'error', visible: true });
        } finally {
            setIsSubmitting(false);
        }
    }, [reading, propertyId, generator.id]);

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
        );
    }

    if (justLogged) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
                <div className="max-w-sm w-full text-center">
                    <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                    <p className="text-2xl font-black text-slate-900 mb-1">Reading logged</p>
                    <p className="text-sm text-slate-500 font-medium mb-6">
                        {generator.name} · {property?.name}
                    </p>
                    <Link
                        href={`/property/${propertyId}/dashboard?tab=diesel_analytics`}
                        className="inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-primary text-white font-bold text-sm shadow-md shadow-primary/30 hover:shadow-lg transition-all"
                    >
                        View live dashboard <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 px-4 py-6">
            <Toast
                message={toast.message}
                type={toast.type}
                visible={toast.visible}
                onClose={() => setToast(prev => ({ ...prev, visible: false }))}
            />
            <div className="max-w-md mx-auto">
                <div className="flex items-center gap-2 mb-4 text-primary">
                    <Nfc className="w-5 h-5" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Tag scanned · {property?.name}</span>
                </div>
                <DieselLoggerCard
                    generator={generator}
                    previousClosing={previousClosing}
                    activeTariff={activeTariff}
                    onReadingChange={(_id, r) => setReading(r)}
                    onSave={handleSave}
                    isSubmitting={isSubmitting}
                />
            </div>
        </div>
    );
};

export default ScanQuickLog;
