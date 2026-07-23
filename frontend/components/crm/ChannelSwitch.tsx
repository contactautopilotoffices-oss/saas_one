'use client';

import React from 'react';
import { Layers } from 'lucide-react';
import { CHANNEL_OPTIONS, CHANNELS, Channel } from '@/frontend/lib/crm/channels';

/** Small brand glyph for a channel (letter-mark on the brand color). */
function ChannelIcon({ ch }: { ch: Channel | 'all' }) {
    if (ch === 'all') return <Layers className="w-3.5 h-3.5" />;
    const meta = CHANNELS[ch];
    const glyph = ch === 'meta_ads' ? '∞' : ch === 'linkedin_ads' ? 'in' : 'G';
    return (
        <span
            className="inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-black text-white"
            style={{ backgroundColor: meta.color }}
        >{glyph}</span>
    );
}

/**
 * Icon-based segmented control to filter ANY dashboard by ad channel.
 * Pass the selected value as ?channel= to the same data endpoint — no separate
 * Meta/LinkedIn dashboards. `value` of 'all' means no filter.
 */
export default function ChannelSwitch({
    value,
    onChange,
    className = '',
}: {
    value: Channel | 'all';
    onChange: (v: Channel | 'all') => void;
    className?: string;
}) {
    return (
        <div className={`inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl ${className}`}>
            {CHANNEL_OPTIONS.map((opt) => {
                const active = value === opt.key;
                return (
                    <button
                        key={opt.key}
                        type="button"
                        onClick={() => onChange(opt.key)}
                        title={opt.label}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                            active ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
                        }`}
                    >
                        <ChannelIcon ch={opt.key as Channel | 'all'} />
                        <span className="hidden sm:inline">{opt.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
