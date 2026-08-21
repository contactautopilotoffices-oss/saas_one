import { createAdminClient } from '@/frontend/utils/supabase/admin';

export function normalizeText(text: string): string {
    if (!text) return '';
    return text
        .toLowerCase()
        .replace(/[\-_,\.\(\)\[\]\/]/g, ' ') // replace punctuation with space
        .replace(/\s+/g, ' ')               // collapse multiple spaces
        .trim();
}

export interface ResolvedPropertyAlias {
    property_id: string;
    property_name: string;
    floor_tag: string;
    confidence: 'exact' | 'alias' | 'unmapped';
}

export const CANONICAL_PROPERTY_ALIASES = [
    { alias: 'sigma 2nd floor', canonicalName: 'Rabale', floorTag: '2nd Floor' },
    { alias: 'sigma 7th floor', canonicalName: 'Rabale', floorTag: '7th Floor' },
    { alias: 'sigma rabale', canonicalName: 'Rabale', floorTag: 'All Floors' },
    { alias: 'rabale', canonicalName: 'Rabale', floorTag: 'All Floors' },

    { alias: '3i crescent solitaire', canonicalName: '3i Cresent', floorTag: 'All Floors' },
    { alias: '3i crescent', canonicalName: '3i Cresent', floorTag: 'All Floors' },
    { alias: '3i cresent', canonicalName: '3i Cresent', floorTag: 'All Floors' },

    { alias: 'ss plaza', canonicalName: 'SS Plaza', floorTag: 'All Floors' },

    { alias: 'mygate', canonicalName: 'MyGate', floorTag: 'All Floors' },
    { alias: 'mygate vkg', canonicalName: 'MyGate', floorTag: 'All Floors' },

    { alias: 'nrk star indore', canonicalName: 'Indore', floorTag: 'All Floors' },
    { alias: 'nrk star', canonicalName: 'Indore', floorTag: 'All Floors' },
    { alias: 'indore', canonicalName: 'Indore', floorTag: 'All Floors' },

    { alias: 'sky mark noida', canonicalName: 'Noida', floorTag: 'All Floors' },
    { alias: 'arcil sky mark noida', canonicalName: 'Noida', floorTag: 'All Floors' },
    { alias: 'arcil sky mark', canonicalName: 'Noida', floorTag: 'All Floors' },
    { alias: 'noida', canonicalName: 'Noida', floorTag: 'All Floors' },

    { alias: 'mafatlal chember a', canonicalName: 'Mafatlal Chambers , A wing', floorTag: 'A Wing' },
    { alias: 'mafatlal chambers a', canonicalName: 'Mafatlal Chambers , A wing', floorTag: 'A Wing' },
    { alias: 'a wing mafatlal', canonicalName: 'Mafatlal Chambers , A wing', floorTag: 'A Wing' },
    { alias: 'a wing', canonicalName: 'Mafatlal Chambers , A wing', floorTag: 'A Wing' },

    { alias: 'mafatlal chember b', canonicalName: 'Mafatlal Chambers , B wing', floorTag: 'B Wing' },
    { alias: 'mafatlal chambers b', canonicalName: 'Mafatlal Chambers , B wing', floorTag: 'B Wing' },
    { alias: 'b wing mafatlal', canonicalName: 'Mafatlal Chambers , B wing', floorTag: 'B Wing' },
    { alias: 'b wing', canonicalName: 'Mafatlal Chambers , B wing', floorTag: 'B Wing' },

    { alias: 'mafatlal chember c', canonicalName: 'Mafatlal Chambers , C wing', floorTag: 'C Wing' },
    { alias: 'mafatlal chambers c', canonicalName: 'Mafatlal Chambers , C wing', floorTag: 'C Wing' },
    { alias: 'c wing mafatlal', canonicalName: 'Mafatlal Chambers , C wing', floorTag: 'C Wing' },
    { alias: 'c wing', canonicalName: 'Mafatlal Chambers , C wing', floorTag: 'C Wing' },

    { alias: 'mafatlal chember d', canonicalName: 'Mafatlal Chambers , D wing', floorTag: 'D Wing' },
    { alias: 'mafatlal chambers d', canonicalName: 'Mafatlal Chambers , D wing', floorTag: 'D Wing' },
    { alias: 'd wing mafatlal', canonicalName: 'Mafatlal Chambers , D wing', floorTag: 'D Wing' },
    { alias: 'd wing', canonicalName: 'Mafatlal Chambers , D wing', floorTag: 'D Wing' },

    { alias: 'mahindra finance delhi', canonicalName: 'Mahindra Finance - Delhi', floorTag: 'All Floors' },
    { alias: 'mumbai', canonicalName: 'Mumbai', floorTag: 'All Floors' },
    { alias: 'quess house', canonicalName: 'Quess House', floorTag: 'All Floors' },
    { alias: 'byculla r kion', canonicalName: 'Byculla - R Kion', floorTag: 'All Floors' },
    { alias: 'ho byculla', canonicalName: 'HO - Byculla', floorTag: 'All Floors' },
    { alias: 'bajaj kolkata', canonicalName: 'Bajaj Kolkata', floorTag: 'All Floors' },
    { alias: 'amr altruist', canonicalName: 'AMR Altruist', floorTag: 'All Floors' },
];

export const PricingAndAliasService = {
    /**
     * Resolves a raw PO property string to a canonical application property
     */
    async resolveProperty(rawName: string, organizationId: string): Promise<ResolvedPropertyAlias> {
        const normalized = normalizeText(rawName);
        const adminSupabase = createAdminClient();

        // 1. Check custom DB aliases
        const { data: dbAliases } = await adminSupabase
            .from('property_aliases')
            .select(`property_id, floor_tag, property:properties(id, name)`)
            .eq('organization_id', organizationId)
            .eq('normalized_alias', normalized)
            .eq('is_active', true)
            .maybeSingle();

        if (dbAliases?.property) {
            return {
                property_id: dbAliases.property_id,
                property_name: (dbAliases.property as any).name,
                floor_tag: dbAliases.floor_tag || 'All Floors',
                confidence: 'alias'
            };
        }

        // 2. Check canonical hardcoded aliases
        const matchedPredefined = CANONICAL_PROPERTY_ALIASES.find(
            p => normalizeText(p.alias) === normalized || normalized.includes(normalizeText(p.alias))
        );

        // Fetch all org properties to match by name
        const { data: properties } = await adminSupabase
            .from('properties')
            .select('id, name')
            .eq('organization_id', organizationId);

        if (matchedPredefined && properties) {
            const canonicalProp = properties.find(
                p => normalizeText(p.name) === normalizeText(matchedPredefined.canonicalName)
            );
            if (canonicalProp) {
                return {
                    property_id: canonicalProp.id,
                    property_name: canonicalProp.name,
                    floor_tag: matchedPredefined.floorTag,
                    confidence: 'alias'
                };
            }
        }

        // 3. Check exact property name match
        if (properties) {
            const exact = properties.find(p => normalizeText(p.name) === normalized);
            if (exact) {
                return {
                    property_id: exact.id,
                    property_name: exact.name,
                    floor_tag: 'All Floors',
                    confidence: 'exact'
                };
            }
        }

        return {
            property_id: '',
            property_name: rawName,
            floor_tag: 'All Floors',
            confidence: 'unmapped'
        };
    },

    /**
     * Optimized single query fetching all active master catalog items with site-specific price for propertyId
     */
    async getCatalogWithSitePrices(organizationId: string, propertyId?: string | null) {
        const adminSupabase = createAdminClient();

        // 1. Fetch active master items
        const { data: items, error: itemsErr } = await adminSupabase
            .from('procurement_catalog')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('is_active', true)
            .order('name');

        if (itemsErr) {
            console.error('[PricingService] Error fetching catalog items:', itemsErr);
            return [];
        }

        // 2. If propertyId is provided, fetch all active site-specific prices for this property
        let sitePricesMap: Record<string, number> = {};
        if (propertyId) {
            const { data: sitePrices } = await adminSupabase
                .from('item_site_prices')
                .select('item_id, unit_price')
                .eq('organization_id', organizationId)
                .eq('property_id', propertyId)
                .eq('is_active', true);

            if (sitePrices) {
                sitePrices.forEach((sp: any) => {
                    sitePricesMap[sp.item_id] = Number(sp.unit_price) || 0;
                });
            }
        }

        // 3. Merge: Site price overrides base item price
        return (items || []).map((item: any) => {
            const hasSitePrice = propertyId && sitePricesMap[item.id] !== undefined;
            const effectivePrice = hasSitePrice
                ? sitePricesMap[item.id]
                : (Number(item.unit_price) || Number(item.estimated_price) || 0);

            return {
                id: item.id,
                name: item.name,
                normalized_name: normalizeText(item.name),
                category: item.category || 'HK',
                brand: item.brand || 'NA',
                details: item.color_size_details || '',
                unit: item.unit || 'pcs',
                base_price: Number(item.unit_price) || Number(item.estimated_price) || 0,
                unit_price: effectivePrice,
                is_site_specific: hasSitePrice,
                photo_url: item.photo_url || ''
            };
        });
    }
};
