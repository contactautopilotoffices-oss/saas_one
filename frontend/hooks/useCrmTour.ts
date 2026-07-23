'use client';

import { useState, useEffect, useCallback } from 'react';

export type TourId = 'crm-dashboard' | 'crm-leads' | 'crm-lead-detail' | 'crm-calendar';

export const TOUR_ORDER: TourId[] = ['crm-dashboard', 'crm-leads', 'crm-lead-detail', 'crm-calendar'];

export const TOUR_LABELS: Record<TourId, string> = {
    'crm-dashboard': 'Dashboard',
    'crm-leads': 'Leads Table',
    'crm-lead-detail': 'Lead Details & Stages',
    'crm-calendar': 'Calendar',
};

interface TourState {
    completedTours: Set<string>;
    isLoaded: boolean;
}

let globalState: TourState = { completedTours: new Set(), isLoaded: false };
const listeners = new Set<() => void>();

function notify() { listeners.forEach(fn => fn()); }

async function loadCompletions() {
    if (globalState.isLoaded) return;
    try {
        const res = await fetch('/api/crm/tours');
        if (res.ok) {
            const { completions } = await res.json();
            globalState = {
                completedTours: new Set((completions || []).map((c: any) => c.tour_id)),
                isLoaded: true,
            };
        } else {
            globalState = { ...globalState, isLoaded: true };
        }
    } catch {
        globalState = { ...globalState, isLoaded: true };
    }
    notify();
}

export function useCrmTour(tourId: TourId) {
    const [, setTick] = useState(0);

    useEffect(() => {
        const update = () => setTick(t => t + 1);
        listeners.add(update);
        loadCompletions();
        return () => { listeners.delete(update); };
    }, []);

    const isCompleted = globalState.completedTours.has(tourId);
    const shouldAutoStart = globalState.isLoaded && !isCompleted;

    const markComplete = useCallback(async () => {
        globalState.completedTours.add(tourId);
        notify();
        try {
            await fetch('/api/crm/tours', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tour_id: tourId }),
            });
        } catch { /* best effort */ }
    }, [tourId]);

    const resetTour = useCallback(async () => {
        globalState.completedTours.delete(tourId);
        notify();
        try {
            await fetch('/api/crm/tours', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tour_id: tourId }),
            });
        } catch { /* best effort */ }
    }, [tourId]);

    const resetAll = useCallback(async () => {
        globalState.completedTours.clear();
        notify();
        try {
            await fetch('/api/crm/tours', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
        } catch { /* best effort */ }
    }, []);

    return { shouldAutoStart, isCompleted, isLoaded: globalState.isLoaded, markComplete, resetTour, resetAll };
}

export function useCrmOnboarding() {
    const [, setTick] = useState(0);

    useEffect(() => {
        const update = () => setTick(t => t + 1);
        listeners.add(update);
        loadCompletions();
        return () => { listeners.delete(update); };
    }, []);

    const isLoaded = globalState.isLoaded;
    const completedTours = globalState.completedTours;
    const allCompleted = TOUR_ORDER.every(id => completedTours.has(id));
    const completedCount = TOUR_ORDER.filter(id => completedTours.has(id)).length;
    const nextTourId = TOUR_ORDER.find(id => !completedTours.has(id)) || null;

    return { isLoaded, allCompleted, completedCount, totalCount: TOUR_ORDER.length, nextTourId, completedTours };
}
