import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string; templateId: string }> }
) {
    const { propertyId, templateId } = await params;
    const supabase = await createClient();

    try {
        const { data: template, error } = await supabaseAdmin
            .from('sop_templates')
            .select(`
                *,
                items:sop_checklist_items(*)
            `)
            .eq('id', templateId)
            .eq('property_id', propertyId)
            .single();

        if (error) {
            return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }

        if (template && Array.isArray(template.items)) {
            template.items.sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
        }

        return NextResponse.json({ success: true, template });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

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

        const body = await request.json();
        const { title, description, category, frequency, assigned_to, is_active, items, start_time, end_time } = body;



        const { data: template, error: updateError } = await supabaseAdmin
            .from('sop_templates')
            .update({
                ...(title && { title }),
                ...(description !== undefined && { description }),
                ...(category && { category }),
                ...(frequency && { frequency }),
                ...(assigned_to !== undefined && { assigned_to }),
                ...(is_active !== undefined && { is_active }),
                start_time: start_time || '09:00',
                end_time: end_time || '17:00',
                updated_at: new Date().toISOString(),
            })
            .eq('id', templateId)
            .eq('property_id', propertyId)
            .select()
            .single();

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        // Update items if provided
        if (items && Array.isArray(items)) {
            // Helper to safely parse and sanitize step parameters
            const sanitizeParams = (raw: any): any[] => {
                if (!raw) return [];
                let arr = raw;
                if (typeof raw === 'string') {
                    try { arr = JSON.parse(raw); } catch { arr = []; }
                }
                if (!Array.isArray(arr)) return [];
                return arr.map((p: any, idx: number) => ({
                    id: p.id || `param_${idx}_${Date.now()}`,
                    name: typeof p === 'string' ? p : (p.name || p.title || `Param ${idx + 1}`),
                    type: p.type || 'yes_no',
                    is_required: p.is_required !== false,
                }));
            };

            // 1. Fetch current items for this template to know which IDs exist
            const { data: existingItems } = await supabaseAdmin
                .from('sop_checklist_items')
                .select('id')
                .eq('template_id', templateId);

            const existingIds = new Set((existingItems || []).map(i => i.id));
            const submittedIds = new Set(items.map(i => i.id).filter(Boolean));

            const toUpdate: any[] = [];
            const toInsert: any[] = [];

            items.forEach((item: any, index: number) => {
                const itemData = {
                    template_id: templateId,
                    title: item.title,
                    description: item.description || '',
                    order_index: index,
                    type: item.type || 'checkbox',
                    is_optional: item.is_optional || false,
                    requires_photo: item.requires_photo || false,
                    requires_comment: item.requires_comment || false,
                    is_mandatory: item.is_mandatory !== false,
                    start_time: item.start_time || null,
                    end_time: item.end_time || null,
                    parameters: sanitizeParams(item.parameters),
                    reference_photo_url: item.reference_photo_url || null,
                    reference_photo_source: item.reference_photo_source || null,
                    cad_area_id: item.cad_area_id || null,
                };

                if (item.id && existingIds.has(item.id)) {
                    toUpdate.push({ id: item.id, ...itemData });
                } else {
                    toInsert.push(itemData);
                }
            });

            // 2. Update existing items in place so references and IDs are preserved
            for (const item of toUpdate) {
                const { id, ...data } = item;
                const { error: updateError } = await supabaseAdmin
                    .from('sop_checklist_items')
                    .update(data)
                    .eq('id', id);
                if (updateError) {
                    console.error(`[PUT Template] Failed to update item ${id}:`, updateError);
                }
            }

            // 3. Insert newly added items
            if (toInsert.length > 0) {
                const { error: insertError } = await supabaseAdmin
                    .from('sop_checklist_items')
                    .insert(toInsert);

                if (insertError) {
                    console.error('[PUT Template] Failed to insert new items:', insertError);
                    return NextResponse.json({ error: 'Failed to insert items: ' + insertError.message }, { status: 500 });
                }
            }

            // 4. Delete items that were intentionally removed from the checklist
            const toDeleteIds = Array.from(existingIds).filter(id => !submittedIds.has(id));
            if (toDeleteIds.length > 0) {
                const { error: delErr } = await supabaseAdmin
                    .from('sop_checklist_items')
                    .delete()
                    .in('id', toDeleteIds);
                if (delErr) {
                    console.warn('[PUT Template] Could not delete removed item (retained for audit history):', delErr.message);
                }
            }
        }

        // Fetch final template with items ordered by order_index
        const { data: finalTemplate } = await supabaseAdmin
            .from('sop_templates')
            .select(`
                *,
                items:sop_checklist_items(*)
            `)
            .eq('id', templateId)
            .single();

        if (finalTemplate && Array.isArray(finalTemplate.items)) {
            finalTemplate.items.sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
        }

        return NextResponse.json({ success: true, template: finalTemplate });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

export async function PATCH(
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

        const body = await request.json();
        const { is_running } = body;

        if (typeof is_running !== 'boolean') {
            return NextResponse.json({ error: 'is_running must be a boolean' }, { status: 400 });
        }

        const patchFields: any = { is_running, updated_at: new Date().toISOString() };
        if (is_running) patchFields.started_at = new Date().toISOString(); // track when schedule went live

        const { data: template, error: updateError } = await supabaseAdmin
            .from('sop_templates')
            .update(patchFields)
            .eq('id', templateId)
            .eq('property_id', propertyId)
            .select()
            .single();

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, template });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

export async function DELETE(
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

        // Soft delete (set is_active = false)
        const { error: deleteError } = await supabaseAdmin
            .from('sop_templates')
            .update({ is_active: false })
            .eq('id', templateId)
            .eq('property_id', propertyId);

        if (deleteError) {
            return NextResponse.json({ error: deleteError.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, message: 'Template deactivated' });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
