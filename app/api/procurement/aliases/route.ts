import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { normalizeText, CANONICAL_PROPERTY_ALIASES } from '@/backend/lib/procurement/pricingAndAliasService';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const organizationId = searchParams.get('organization_id');

        if (!organizationId) {
            return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        // 1. Fetch DB aliases
        const { data: dbAliases } = await adminSupabase
            .from('property_aliases')
            .select(`
                id,
                alias_name,
                normalized_alias,
                floor_tag,
                source,
                is_active,
                property_id,
                property:properties(id, name)
            `)
            .eq('organization_id', organizationId)
            .order('alias_name');

        // 2. Fetch canonical properties for mapping helpers
        const { data: properties } = await adminSupabase
            .from('properties')
            .select('id, name')
            .eq('organization_id', organizationId);

        return NextResponse.json({
            aliases: dbAliases || [],
            canonical_defaults: CANONICAL_PROPERTY_ALIASES,
            properties: properties || []
        });
    } catch (err: any) {
        console.error('[Aliases GET Error]:', err);
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { organization_id, property_id, alias_name, floor_tag, source } = body;

        if (!organization_id || !property_id || !alias_name) {
            return NextResponse.json({ error: 'Missing required fields: organization_id, property_id, alias_name' }, { status: 400 });
        }

        const normalizedAlias = normalizeText(alias_name);
        const adminSupabase = createAdminClient();

        const { data, error } = await adminSupabase
            .from('property_aliases')
            .upsert(
                {
                    organization_id,
                    property_id,
                    alias_name: alias_name.trim(),
                    normalized_alias: normalizedAlias,
                    floor_tag: floor_tag || 'All Floors',
                    source: source || 'MANUAL',
                    is_active: true
                },
                { onConflict: 'organization_id,normalized_alias' }
            )
            .select(`
                *,
                property:properties(id, name)
            `)
            .single();

        if (error) {
            return NextResponse.json({ error: 'Failed to save alias', details: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, alias: data });
    } catch (err: any) {
        console.error('[Aliases POST Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}
