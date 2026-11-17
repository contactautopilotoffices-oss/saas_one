'use client';

import { useCallback, useEffect, useState } from 'react';

/** LiveVoice ID (owner 2026-11-02): "My voice" + the voice server's state. The server decides everything. */

export const VOICE_URL = '/api/task-manager/voice';

export type ServerState = 'online' | 'waking' | 'offline' | 'not_configured';
export type ClipProblem = 'too_short' | 'too_long' | 'too_quiet' | 'too_loud' | 'too_much_silence' | null;

export interface VoiceInfo {
    setupMissing: boolean;
    me: { enrolled: boolean; updatedAt?: string; clipAgreement?: number };
    server: { state: ServerState; detail: string | null };
    /** Meetings I start name who spoke (my department has the switch ON) */
    meetingVoiceOn: boolean;
    consentVersion: string;
}

/** Loads my voice + the server state. `refresh()` checks again (also wakes a sleeping server). */
export function useVoiceInfo() {
    const [info, setInfo] = useState<VoiceInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(VOICE_URL, { cache: 'no-store' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.error || 'Could not load voice settings');
            setInfo(data as VoiceInfo);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load voice settings');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);
    return { info, setInfo, loading, error, refresh };
}

export const CLIP_PROBLEM_TEXT: Record<Exclude<ClipProblem, null>, string> = {
    too_short: 'Too short. Read the whole sentence.',
    too_long: 'Too long.',
    too_quiet: 'Too quiet. Hold the phone closer.',
    too_loud: 'Too loud. Hold the phone a little further away.',
    too_much_silence: 'Mostly silence. Start speaking right after you press record.',
};

/** Readable reason for a meeting whose voices were not named (stt.speakerId.reason). */
export const SKIP_REASON_TEXT: Record<string, string> = {
    no_speaker_labels: 'the speech service did not separate the voices',
    server_not_configured: 'the voice server is not set up',
    not_set_up: 'voice recognition is not set up in the database yet',
    switched_off: 'voice recognition is OFF for your department',
    nobody_picked: 'nobody was picked as present',
    nobody_enrolled: 'none of the people present have set up their voice',
    server_waking: 'the voice server did not wake up in time',
    server_offline: 'the voice server could not be reached',
    server_unavailable: 'the voice server could not be reached',
    timed_out: 'the voice server took too long',
    audio_gone: 'the recording was no longer available',
    recordings_mismatch: 'the recording pieces did not match the transcript',
    links_failed: 'the recording could not be shared with the voice server',
};
