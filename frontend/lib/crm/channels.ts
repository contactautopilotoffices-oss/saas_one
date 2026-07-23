/**
 * Single source of truth for the multi-channel (Meta / LinkedIn / Google) model.
 * Used by the ChannelSwitch (filter existing dashboards) and SourceBadge
 * (show a lead's origin) — so no per-channel UIs are ever duplicated.
 */

export type Channel = 'meta_ads' | 'linkedin_ads' | 'google_ads';

export interface ChannelMeta {
    key: Channel;
    label: string;       // short label for the switch
    badge: string;       // text on the source badge
    color: string;       // brand color (hex)
    bg: string;          // tailwind bg tint class
    text: string;        // tailwind text class
}

export const CHANNELS: Record<Channel, ChannelMeta> = {
    meta_ads:     { key: 'meta_ads',     label: 'Meta',     badge: 'Meta',     color: '#1877F2', bg: 'bg-blue-50',   text: 'text-blue-600' },
    linkedin_ads: { key: 'linkedin_ads', label: 'LinkedIn', badge: 'LinkedIn', color: '#0A66C2', bg: 'bg-sky-50',    text: 'text-[#0A66C2]' },
    google_ads:   { key: 'google_ads',   label: 'Google',   badge: 'Google',   color: '#EA4335', bg: 'bg-red-50',    text: 'text-red-600' },
};

/** The ordered options for a channel switch, with an "All" entry first. */
export const CHANNEL_OPTIONS: { key: Channel | 'all'; label: string }[] = [
    { key: 'all', label: 'All' },
    ...Object.values(CHANNELS).map((c) => ({ key: c.key, label: c.label })),
];

/** Map a lead-source name (e.g. "Meta Lead Ads", "LinkedIn") to a channel. */
export function channelFromSource(sourceName?: string | null): Channel | null {
    if (!sourceName) return null;
    const n = sourceName.toLowerCase();
    if (n.includes('meta') || n.includes('facebook') || n.includes('instagram')) return 'meta_ads';
    if (n.includes('linkedin')) return 'linkedin_ads';
    if (n.includes('google')) return 'google_ads';
    return null;
}

export function channelMeta(channel?: Channel | null): ChannelMeta | null {
    return channel ? CHANNELS[channel] ?? null : null;
}
