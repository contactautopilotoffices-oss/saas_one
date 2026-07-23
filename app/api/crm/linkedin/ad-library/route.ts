import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';
import { LinkedInConfig, linkedinGet, LinkedInAuthError } from '@/backend/services/linkedinClient';

/**
 * GET /api/crm/linkedin/ad-library?keyword=...&advertiser=...&country=...
 *
 * Competitor Ad Watch — queries LinkedIn's public Ad Library (`/rest/adLibrary`,
 * finder `criteria`). Returns normalized public ad records for competitive
 * research (advertiser, creative text, run dates, and — for EEA ads — the DSA
 * targeting disclosure).
 *
 * Uses the org's stored OAuth token. Read-only, public data; admin-gated.
 */

const CONFIG_SELECT =
    'id, organization_id, client_id, client_secret, access_token, refresh_token, token_expires_at, refresh_token_expires_at, ad_account_urn, organization_urn, default_assignee, default_lead_source, default_property, is_active, last_lead_sync_at';

export async function GET(request: NextRequest) {
    const access = await resolveCrmAccess(request, readOrgId(request));
    if (isCrmAccessError(access)) return access;
    if (!access.isAdmin && !access.isMasterAdmin) {
        return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const sp = new URL(request.url).searchParams;
    const keyword = sp.get('keyword')?.trim() || '';
    const advertiser = sp.get('advertiser')?.trim() || '';
    const countries = (sp.get('country') || '').trim(); // e.g. 'IN' or 'urn:li:country:in'
    const start = Math.max(0, parseInt(sp.get('start') || '0') || 0);
    const count = Math.min(50, parseInt(sp.get('count') || '25') || 25);

    if (!keyword && !advertiser) {
        return NextResponse.json({ error: 'Provide a keyword or advertiser to search.' }, { status: 400 });
    }

    const { data: cfg } = await supabaseAdmin
        .from('crm_linkedin_config')
        .select(CONFIG_SELECT)
        .eq('organization_id', access.organizationId)
        .maybeSingle();

    if (!cfg || !cfg.is_active || !cfg.access_token) {
        return NextResponse.json({ error: 'Connect LinkedIn first (Settings → Integrations).' }, { status: 400 });
    }

    // Build the criteria finder query.
    const params: string[] = ['q=criteria', `start=${start}`, `count=${count}`];
    if (keyword) params.push(`keyword=${encodeURIComponent(keyword)}`);
    if (advertiser) params.push(`advertiser=${encodeURIComponent(advertiser)}`);
    if (countries) {
        const urn = countries.startsWith('urn:') ? countries : `urn:li:country:${countries.toLowerCase()}`;
        params.push(`countries=List(${encodeURIComponent(urn)})`);
    }
    const path = `/adLibrary?${params.join('&')}`;

    try {
        const json = await linkedinGet(cfg as LinkedInConfig, path);
        const ads = (json.elements || []).map(normalizeAd);
        return NextResponse.json({
            ads,
            paging: json.paging ?? null,
            count: ads.length,
        });
    } catch (err: any) {
        if (err instanceof LinkedInAuthError) {
            return NextResponse.json({ error: err.message, code: 'auth' }, { status: 401 });
        }
        // The Ad Library product may not be granted yet — surface a clear hint.
        const msg = err?.message || 'Ad Library query failed';
        const notProvisioned = /permission|not.*authorized|access|403|404/i.test(msg);
        return NextResponse.json(
            {
                error: notProvisioned
                    ? 'Ad Library not available on this app yet — request the "LinkedIn Ad Library" product (Default Tier) in your LinkedIn app.'
                    : msg,
            },
            { status: 502 }
        );
    }
}

/**
 * Normalize LinkedIn's ad-library element into a flat, UI-friendly shape.
 * LinkedIn's exact field names vary; we read several likely paths defensively.
 */
function normalizeAd(el: any) {
    const details = el.adDetails || el.details || el;
    const dateRange = el.firstImpressionAt || el.dateRange || details.runSchedule || null;
    const start = typeof el.firstImpressionAt === 'number' ? el.firstImpressionAt : dateRange?.start ?? null;
    const end = typeof el.latestImpressionAt === 'number' ? el.latestImpressionAt : dateRange?.end ?? null;

    return {
        id: el.adId || el.id || el.adUrn || null,
        advertiser:
            el.advertiserName ||
            el.advertiser?.name ||
            details.advertiserName ||
            el.payingEntityName ||
            null,
        headline: details.headline || el.headline || null,
        body: details.commentary || details.text || el.adText || el.commentary || null,
        landingUrl: details.landingPageUrl || el.landingPageUrl || null,
        thumbnailUrl: details.thumbnailUrl || el.imageUrl || null,
        adType: el.adType || details.format || null,
        firstSeen: start ? new Date(start).toISOString() : null,
        lastSeen: end ? new Date(end).toISOString() : null,
        // EEA DSA transparency: targeting parameters when present.
        targeting: el.adTargeting || el.targeting || details.targeting || null,
        impressionsRange: el.totalImpressions || el.impressions || null,
        permalink: el.adLibraryUrl || el.permalink || (el.adUrn ? `https://www.linkedin.com/ad-library/detail/${encodeURIComponent(el.adUrn)}` : null),
        raw: undefined as any, // keep payload lean
    };
}
