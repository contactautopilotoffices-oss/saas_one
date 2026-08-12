import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * PUT /api/properties/[propertyId]/sop/templates/[templateId]/cad/areas
 * Save CAD areas with step linkages for a template.
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string; templateId: string }> }
) {
    const { propertyId, templateId } = await params;
    const supabase = await createClient();

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Verify template belongs to property
        const { data: template, error: templateError } = await supabaseAdmin
            .from('sop_templates')
            .select('id')
            .eq('id', templateId)
            .eq('property_id', propertyId)
            .maybeSingle();

        if (templateError || !template) {
            return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }

        const body = await request.json();
        const { areas } = body;

        if (!Array.isArray(areas)) {
            return NextResponse.json({ error: 'areas must be an array' }, { status: 400 });
        }

        // Validate each area
        for (const area of areas) {
            if (!area.id || !area.label || !area.coordinates) {
                return NextResponse.json(
                    { error: 'Each area must have id, label, and coordinates' },
                    { status: 400 }
                );
            }
            if (typeof area.coordinates.x !== 'number' || typeof area.coordinates.y !== 'number' ||
                typeof area.coordinates.width !== 'number' || typeof area.coordinates.height !== 'number') {
                return NextResponse.json(
                    { error: 'coordinates must contain numeric x, y, width, height' },
                    { status: 400 }
                );
            }
            if (!Array.isArray(area.linked_step_ids)) {
                return NextResponse.json(
                    { error: 'linked_step_ids must be an array' },
                    { status: 400 }
                );
            }
        }

        // Update template with areas
        const { error: updateError } = await supabaseAdmin
            .from('sop_templates')
            .update({
                cad_areas: areas,
                updated_at: new Date().toISOString(),
            })
            .eq('id', templateId);

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        // Update linked checklist items with cad_area_id
        const areaMap = new Map<string, string[]>();
        for (const area of areas) {
            for (const stepId of area.linked_step_ids) {
                const existing = areaMap.get(stepId) || [];
                existing.push(area.id);
                areaMap.set(stepId, existing);
            }
        }

        // Reset all items' cad_area_id first
        await supabaseAdmin
            .from('sop_checklist_items')
            .update({ cad_area_id: null })
            .eq('template_id', templateId);

        // Set cad_area_id for linked items
        for (const [stepId, areaIds] of areaMap.entries()) {
            const { error: itemError } = await supabaseAdmin
                .from('sop_checklist_items')
                .update({
                    cad_area_id: areaIds[0], // Primary area
                    reference_photo_source: 'cad',
                })
                .eq('id', stepId)
                .eq('template_id', templateId);

            if (itemError) {
                console.error(`Failed to update item ${stepId}:`, itemError);
            }
        }

        return NextResponse.json({ success: true, areas });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string; templateId: string }> }
) {
    const { propertyId, templateId } = await params;
    const supabase = await createClient();

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: template, error } = await supabase
            .from('sop_templates')
            .select('cad_areas, cad_converted_image_url, cad_file_type')
            .eq('id', templateId)
            .eq('property_id', propertyId)
            .single();

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            areas: template.cad_areas || [],
            cadConvertedImageUrl: template.cad_converted_image_url,
            cadFileType: template.cad_file_type,
        });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
