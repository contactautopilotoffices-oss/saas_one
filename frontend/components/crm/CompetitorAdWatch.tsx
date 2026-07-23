'use client';

import React, { useState, useCallback } from 'react';
import { Search, Loader2, ExternalLink, Building2, Calendar, Target, AlertTriangle } from 'lucide-react';

interface AdRecord {
    id: string | null;
    advertiser: string | null;
    headline: string | null;
    body: string | null;
    landingUrl: string | null;
    thumbnailUrl: string | null;
    adType: string | null;
    firstSeen: string | null;
    lastSeen: string | null;
    targeting: any;
    impressionsRange: any;
    permalink: string | null;
}

/**
 * Competitor Ad Watch — search LinkedIn's public Ad Library for ads run by
 * competitors (by keyword or advertiser name). Read-only competitive research.
 */
export default function CompetitorAdWatch({ orgId }: { orgId: string }) {
    const [keyword, setKeyword] = useState('');
    const [advertiser, setAdvertiser] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [ads, setAds] = useState<AdRecord[] | null>(null);

    const q = useCallback((p: string) => `${p}${p.includes('?') ? '&' : '?'}org_id=${orgId}`, [orgId]);

    const search = useCallback(async () => {
        if (!keyword.trim() && !advertiser.trim()) {
            setError('Enter a keyword or advertiser name.');
            return;
        }
        setLoading(true); setError(null);
        try {
            const params = new URLSearchParams();
            if (keyword.trim()) params.set('keyword', keyword.trim());
            if (advertiser.trim()) params.set('advertiser', advertiser.trim());
            params.set('country', 'IN');
            const res = await fetch(q(`/api/crm/linkedin/ad-library?${params.toString()}`));
            const data = await res.json().catch(() => null);
            if (!res.ok) { setError(data?.error || `Search failed (${res.status})`); setAds(null); return; }
            setAds(data.ads || []);
        } catch (e: any) {
            setError(e?.message || 'Network error');
            setAds(null);
        } finally {
            setLoading(false);
        }
    }, [keyword, advertiser, q]);

    const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

    const SUGGESTED = ['WeWork', 'Awfis', 'Smartworks', 'Table Space', 'managed office', 'coworking'];

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg bg-[#0A66C2]/10 flex items-center justify-center">
                    <Search className="w-4 h-4 text-[#0A66C2]" />
                </div>
                <div>
                    <h3 className="font-bold text-text-primary">Competitor Ad Watch</h3>
                    <p className="text-xs text-text-tertiary">Search LinkedIn's public Ad Library for competitor campaigns</p>
                </div>
            </div>

            {/* Search controls */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 mt-4">
                <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && search()}
                    placeholder="Keyword (e.g. managed office)"
                    className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
                <input
                    value={advertiser}
                    onChange={(e) => setAdvertiser(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && search()}
                    placeholder="Advertiser (e.g. WeWork)"
                    className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
                <button
                    onClick={search}
                    disabled={loading}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#0A66C2] text-white rounded-xl text-sm font-bold hover:bg-[#084d92] disabled:opacity-50"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Search
                </button>
            </div>

            {/* Quick suggestions */}
            <div className="flex flex-wrap gap-1.5 mt-2">
                {SUGGESTED.map((s) => (
                    <button
                        key={s}
                        onClick={() => { setAdvertiser(/[A-Z]/.test(s[0]) && s.split(' ').length <= 2 ? s : ''); setKeyword(/[A-Z]/.test(s[0]) && s.split(' ').length <= 2 ? '' : s); }}
                        className="text-[11px] px-2 py-1 rounded-full bg-slate-100 text-text-secondary hover:bg-slate-200"
                    >{s}</button>
                ))}
            </div>

            {error && (
                <div className="flex items-start gap-2 mt-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{error}</span>
                </div>
            )}

            {/* Results */}
            {ads && !error && (
                <div className="mt-4">
                    {ads.length === 0 ? (
                        <p className="text-sm text-text-tertiary text-center py-8">No ads found for that search.</p>
                    ) : (
                        <>
                            <p className="text-xs text-text-tertiary mb-3">{ads.length} ad{ads.length !== 1 ? 's' : ''} found</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {ads.map((ad, i) => (
                                    <div key={ad.id || i} className="border border-slate-200 rounded-xl p-3 hover:border-[#0A66C2]/40 transition-colors">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Building2 className="w-3.5 h-3.5 text-text-tertiary" />
                                            <span className="text-sm font-bold text-text-primary truncate">{ad.advertiser || 'Unknown advertiser'}</span>
                                            {ad.adType && <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-text-secondary">{ad.adType}</span>}
                                        </div>
                                        {ad.thumbnailUrl && (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={ad.thumbnailUrl} alt="" className="w-full h-32 object-cover rounded-lg mb-2 bg-slate-50" />
                                        )}
                                        {ad.headline && <p className="text-sm font-semibold text-text-primary mb-1">{ad.headline}</p>}
                                        {ad.body && <p className="text-xs text-text-secondary line-clamp-3 mb-2">{ad.body}</p>}
                                        <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
                                            <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" />{fmtDate(ad.firstSeen)}{ad.lastSeen ? ` – ${fmtDate(ad.lastSeen)}` : ''}</span>
                                            {ad.targeting && <span className="inline-flex items-center gap-1"><Target className="w-3 h-3" />Targeting</span>}
                                        </div>
                                        {ad.permalink && (
                                            <a href={ad.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0A66C2] hover:underline mt-2">
                                                View on LinkedIn <ExternalLink className="w-3 h-3" />
                                            </a>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
