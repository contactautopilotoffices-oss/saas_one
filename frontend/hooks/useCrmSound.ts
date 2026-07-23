'use client';

import { useCallback, useRef } from 'react';

// ── Synthesized CRM sound effects (no audio files) ────────────────────────────
// A tiny Web Audio synthesizer: short, low-volume cues generated on the fly so we
// ship zero asset bytes and never block on a network fetch. The AudioContext is
// created lazily on the first play() call (which is always inside a user gesture),
// satisfying browser autoplay policies.

export type SoundName = 'success' | 'toggle' | 'tick';

// Each cue is a small list of {freq, start, dur, type, gain} notes. Kept short
// (≤ 220ms total) and quiet so it reads as a UI accent, not an alert.
interface Note {
    freq: number;
    start: number; // seconds offset from play()
    dur: number; // seconds
    type?: OscillatorType;
    gain?: number; // peak gain (0..1), pre master
}

const CUES: Record<SoundName, Note[]> = {
    // Two-note rise — confident "done".
    success: [
        { freq: 587.33, start: 0, dur: 0.1, type: 'sine', gain: 0.5 }, // D5
        { freq: 880.0, start: 0.08, dur: 0.16, type: 'sine', gain: 0.5 }, // A5
    ],
    // Soft single blip — selection / filter change.
    toggle: [{ freq: 440.0, start: 0, dur: 0.07, type: 'triangle', gain: 0.4 }],
    // Crisp short tick — checkbox / small confirm.
    tick: [{ freq: 660.0, start: 0, dur: 0.05, type: 'square', gain: 0.25 }],
};

const MASTER_GAIN = 0.18; // global ceiling — keeps everything gentle

/**
 * Returns a stable `play(name)` callback that synthesizes a short cue.
 * Safe to call when audio is unavailable (it no-ops). The caller is responsible
 * for gating on a user "sound enabled" preference.
 */
export function useCrmSound() {
    const ctxRef = useRef<AudioContext | null>(null);

    const getCtx = useCallback((): AudioContext | null => {
        if (typeof window === 'undefined') return null;
        if (!ctxRef.current) {
            const AC = window.AudioContext || (window as any).webkitAudioContext;
            if (!AC) return null;
            try {
                ctxRef.current = new AC();
            } catch {
                return null;
            }
        }
        return ctxRef.current;
    }, []);

    const play = useCallback(
        (name: SoundName) => {
            const ctx = getCtx();
            if (!ctx) return;
            // Resume if the context was suspended (autoplay policy / tab switch).
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});

            const now = ctx.currentTime;
            const master = ctx.createGain();
            master.gain.value = MASTER_GAIN;
            master.connect(ctx.destination);

            for (const note of CUES[name]) {
                const osc = ctx.createOscillator();
                const g = ctx.createGain();
                osc.type = note.type || 'sine';
                osc.frequency.value = note.freq;
                const t0 = now + note.start;
                const peak = note.gain ?? 0.4;
                // Quick attack, exponential release — avoids clicks.
                g.gain.setValueAtTime(0.0001, t0);
                g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
                g.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur);
                osc.connect(g);
                g.connect(master);
                osc.start(t0);
                osc.stop(t0 + note.dur + 0.02);
            }
        },
        [getCtx]
    );

    return play;
}
