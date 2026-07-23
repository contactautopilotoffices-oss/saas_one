'use client';

import React from 'react';
import { channelFromSource, channelMeta } from '@/frontend/lib/crm/channels';

/**
 * Small badge showing a lead's acquisition channel, derived from its lead-source
 * name. Renders nothing for non-ad sources (referral / walk-in / organic) unless
 * `showOther` is set. Use in the leads table + detail drawer.
 */
export default function SourceBadge({
    source,
    showOther = false,
    className = '',
}: {
    source?: string | null;
    showOther?: boolean;
    className?: string;
}) {
    const ch = channelFromSource(source);
    const meta = channelMeta(ch);

    if (!meta) {
        if (!showOther || !source) return null;
        return (
            <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 ${className}`}>
                {source}
            </span>
        );
    }

    return (
        <span
            className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.bg} ${meta.text} ${className}`}
        >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
            {meta.badge}
        </span>
    );
}
