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

        // Sanitize and validate each area
        const sanitizedAreas = areas.map((area: any, idx: number) => {
            const id = area.id || `area-${Date.now()}-${idx}`;
            const label = (area.label && typeof area.label === 'string' && area.label.trim())
                ? area.label.trim()
                : `Area ${idx + 1}`;

            let coords = area.coordinates;
            if ((!coords || typeof coords.x !== 'number') && Array.isArray(area.points) && area.points.length > 0) {
                const minX = Math.round(Math.min(...area.points.map((p: any) => p.x)));
                const maxX = Math.round(Math.max(...area.points.map((p: any) => p.x)));
                const minY = Math.round(Math.min(...area.points.map((p: any) => p.y)));
                const maxY = Math.round(Math.max(...area.points.map((p: any) => p.y)));
                coords = { x: minX, y: minY, width: Math.max(10, maxX - minX), height: Math.max(10, maxY - minY) };
            }

            const x = typeof coords?.x === 'number' && !isNaN(coords.x) ? coords.x : 0;
            const y = typeof coords?.y === 'number' && !isNaN(coords.y) ? coords.y : 0;
            const width = typeof coords?.width === 'number' && !isNaN(coords.width) && coords.width > 0 ? coords.width : 50;
            const height = typeof coords?.height === 'number' && !isNaN(coords.height) && coords.height > 0 ? coords.height : 50;

            return {
                ...area,
                id,
                label,
                coordinates: { x, y, width, height },
                linked_step_ids: Array.isArray(area.linked_step_ids) ? area.linked_step_ids : [],
            };
        });

        // Update template with areas
        const { error: updateError } = await supabaseAdmin
            .from('sop_templates')
            .update({
                cad_areas: sanitizedAreas,
                updated_at: new Date().toISOString(),
            })
            .eq('id', templateId);

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        // Update linked checklist items with cad_area_id
        const areaMap = new Map<string, string[]>();
        for (const area of sanitizedAreas) {
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

        const { data: template, error } = await supabaseAdmin
            .from('sop_templates')
            .select('cad_areas, cad_converted_image_url, cad_file_type')
            .eq('id', templateId)
            .eq('property_id', propertyId)
            .maybeSingle();

        if (error || !template) {
            return NextResponse.json({ error: error?.message || 'Template not found' }, { status: error ? 500 : 404 });
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
