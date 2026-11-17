'use client';

import React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type { ServerState } from './voiceApi';

/**
 * LiveVoice ID: one line that says whether the voice server can be used right now. "Waking up" is normal for the free
 * server after a quiet spell; it is ready about a minute later. "Check again" also wakes it.
 */
const LOOK: Record<ServerState, { dot: string; text: string; label: string; help: string }> = {
    online: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', label: 'Voice server online', help: 'Ready to recognise voices.' },
    waking: { dot: 'bg-amber-500 animate-pulse', text: 'text-amber-700 dark:text-amber-400', label: 'Voice server waking up', help: 'It was asleep. It is usually ready in 1 to 2 minutes.' },
    offline: { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400', label: 'Voice server offline', help: 'It could not be reached. Ask the admin to check it.' },
    not_configured: { dot: 'bg-zinc-400', text: 'text-zinc-600 dark:text-zinc-400', label: 'Voice server not set up', help: 'The admin still needs to connect it.' },
};

export default function VoiceServerStatus({ state, loading, onRefresh, compact = false }: {
    state: ServerState | null;
    loading?: boolean;
    onRefresh?: () => void;
    compact?: boolean;
}) {
    const look = state ? LOOK[state] : null;
    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1" role="status" aria-live="polite">
            {look ? (
                <>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${look.dot}`} aria-hidden />
                    <span className={`text-xs font-bold ${look.text}`}>{look.label}</span>
                    {!compact && <span className="text-xs text-zinc-500">{look.help}</span>}
                </>
            ) : (
                <span className="text-xs font-semibold text-zinc-500">Checking the voice server…</span>
            )}
            {onRefresh && (
                <button type="button" onClick={onRefresh} disabled={loading}
                    className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800">
                    {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Check again
                </button>
            )}
        </div>
    );
}
