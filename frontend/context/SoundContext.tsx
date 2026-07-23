'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useCrmSound, type SoundName } from '@/frontend/hooks/useCrmSound';

// Per-device preference for CRM sound effects. Off by default (browsers block
// autoplay anyway, and silence is the safe default in shared offices). Mirrors
// ThemeContext: localStorage-backed, SSR-safe, simple toggle.
export const SOUND_STORAGE_KEY = 'crm:sound:enabled';

interface SoundContextType {
    soundEnabled: boolean;
    toggleSound: () => void;
    setSoundEnabled: (on: boolean) => void;
    // Plays a cue ONLY when sound is enabled — components can call freely.
    play: (name: SoundName) => void;
}

const SoundContext = createContext<SoundContextType | undefined>(undefined);

export function SoundProvider({ children }: { children: React.ReactNode }) {
    const [soundEnabled, setEnabled] = useState(false);
    const playRaw = useCrmSound();

    // Hydrate the saved preference.
    useEffect(() => {
        try {
            const saved = localStorage.getItem(SOUND_STORAGE_KEY);
            if (saved === 'true') setEnabled(true);
        } catch {}
    }, []);

    const persist = (on: boolean) => {
        setEnabled(on);
        try {
            localStorage.setItem(SOUND_STORAGE_KEY, on ? 'true' : 'false');
        } catch {}
    };

    const setSoundEnabled = useCallback((on: boolean) => {
        persist(on);
        // A confirming chime when the user turns sound ON (inside their click,
        // so the AudioContext unlocks immediately).
        if (on) playRaw('success');
    }, [playRaw]);

    const toggleSound = useCallback(() => setSoundEnabled(!soundEnabled), [soundEnabled, setSoundEnabled]);

    const play = useCallback(
        (name: SoundName) => {
            if (soundEnabled) playRaw(name);
        },
        [soundEnabled, playRaw]
    );

    return (
        <SoundContext.Provider value={{ soundEnabled, toggleSound, setSoundEnabled, play }}>
            {children}
        </SoundContext.Provider>
    );
}

// Safe accessor: returns a no-op-ish default when used outside a provider, so
// shared components (e.g. Toast) don't crash on non-CRM routes.
export function useSound(): SoundContextType {
    const ctx = useContext(SoundContext);
    if (ctx === undefined) {
        return { soundEnabled: false, toggleSound: () => {}, setSoundEnabled: () => {}, play: () => {} };
    }
    return ctx;
}
