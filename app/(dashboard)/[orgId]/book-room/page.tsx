'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/frontend/context/AuthContext';
import TenantRoomBooking from '@/frontend/components/meeting-rooms/TenantRoomBooking';
import { Building2, ChevronLeft, ChevronRight, DoorOpen, Loader2 } from 'lucide-react';

interface BookableProperty {
    id: string;
    name: string;
    room_count: number;
}

const LAST_PROPERTY_KEY = 'book_room_last_property';

/**
 * Meeting room booking for HR and CRM users.
 * Step 1: choose a property. Step 2: choose a room and slot (no credits needed).
 */
export default function BookMeetingRoomPage() {
    const params = useParams();
    const orgId = params.orgId as string;
    const { user } = useAuth();
    const [properties, setProperties] = useState<BookableProperty[]>([]);
    const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!orgId) return;
        const fetchProperties = async () => {
            setIsLoading(true);
            setError('');
            try {
                const res = await fetch(`/api/meeting-rooms/bookable-properties?orgId=${orgId}`);
                const data = await res.json();
                if (!res.ok) {
                    setError(res.status === 403
                        ? 'Meeting room booking is available for HR and CRM teams only.'
                        : (data.error || 'Failed to load properties'));
                    return;
                }
                const list: BookableProperty[] = data.properties || [];
                setProperties(list);

                // Reopen the property used last time, if it still has rooms.
                let last = '';
                try { last = localStorage.getItem(LAST_PROPERTY_KEY) || ''; } catch { /* storage blocked */ }
                if (last && list.some(p => p.id === last)) setSelectedPropertyId(last);
                else if (list.length === 1) setSelectedPropertyId(list[0].id);
            } catch {
                setError('Failed to load properties');
            } finally {
                setIsLoading(false);
            }
        };
        fetchProperties();
    }, [orgId]);

    const selectProperty = (id: string) => {
        setSelectedPropertyId(id);
        try {
            if (id) localStorage.setItem(LAST_PROPERTY_KEY, id);
            else localStorage.removeItem(LAST_PROPERTY_KEY);
        } catch { /* storage blocked */ }
    };

    const selectedProperty = properties.find(p => p.id === selectedPropertyId);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
            <div className="flex flex-col gap-1">
                <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Book Meeting Room</h1>
                <p className="text-sm text-slate-500 font-medium">
                    {selectedProperty ? 'Pick a room and a time slot. No credits needed.' : 'Choose a property to see its meeting rooms.'}
                </p>
            </div>

            {error ? (
                <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl p-12 text-center">
                    <p className="text-slate-500 font-bold">{error}</p>
                </div>
            ) : properties.length === 0 ? (
                <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl p-12 text-center">
                    <p className="text-slate-500 font-bold">No properties with meeting rooms yet.</p>
                </div>
            ) : selectedProperty ? (
                <>
                    {/* Step 2: chosen property, with a way back to step 1 */}
                    <div className="flex items-center justify-between gap-3 bg-white px-4 py-3 rounded-2xl border border-slate-100 shadow-sm">
                        <div className="flex items-center gap-3 min-w-0">
                            <Building2 className="w-4 h-4 text-primary shrink-0" />
                            <span className="text-sm font-black text-slate-700 truncate">{selectedProperty.name}</span>
                        </div>
                        {properties.length > 1 && (
                            <button
                                type="button"
                                onClick={() => selectProperty('')}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 shrink-0"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" />
                                Change property
                            </button>
                        )}
                    </div>

                    <TenantRoomBooking
                        key={selectedProperty.id}
                        propertyId={selectedProperty.id}
                        user={user}
                        hideHeader={true}
                        creditFree={true}
                    />
                </>
            ) : (
                /* Step 1: choose a property */
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {properties.map(p => (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => selectProperty(p.id)}
                            className="flex items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm hover:border-primary/40 hover:shadow-md transition-all text-left"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                                    <Building2 className="w-5 h-5 text-primary" />
                                </div>
                                <div className="min-w-0">
                                    <p className="font-bold text-slate-800 truncate">{p.name}</p>
                                    <p className="flex items-center gap-1 text-xs text-slate-500 font-medium">
                                        <DoorOpen className="w-3 h-3" />
                                        {p.room_count} meeting room{p.room_count === 1 ? '' : 's'}
                                    </p>
                                </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
