import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * GET /api/properties/[propertyId]
 * 
 * Fetch detail for a specific property
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;

    try {
        const { data: property, error } = await supabaseAdmin
            .from('properties')
            .select('*')
            .eq('id', propertyId)
            .single();

        if (error) {
            console.error('[PropertyAPI] Error fetching property:', error.message);
            return NextResponse.json({ error: error.message }, { status: 404 });
        }

        return NextResponse.json(property);
    } catch (error: any) {
        console.error('[PropertyAPI] Internal error:', error.message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * PATCH /api/properties/[propertyId]
 * Update property details using service role
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;

    try {
        const body = await request.json();
        const { data: property, error } = await supabaseAdmin
            .from('properties')
            .update(body)
            .eq('id', propertyId)
            .select()
            .single();

        if (error) {
            console.error('[PropertyAPI] Error updating property:', error.message);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, property });
    } catch (error: any) {
        console.error('[PropertyAPI] Internal update error:', error.message);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
