import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: settings, error } = await supabaseAdmin
            .from('checklist_property_settings')
            .select(`
                *,
                approver:users!approver_user_id(id, full_name, email)
            `)
            .eq('property_id', propertyId)
            .maybeSingle();

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        if (!settings) {
            // Check property checklist_mode
            const { data: prop } = await supabaseAdmin
                .from('properties')
                .select('id, organization_id, checklist_mode')
                .eq('id', propertyId)
                .single();

            const defaultSettings = {
                property_id: propertyId,
                organization_id: prop?.organization_id,
                checklist_mode: prop?.checklist_mode || 'basic',
                reminder_enabled: true,
                reminder_lead_time_mins: 15,
                reminder_channels: ['push'],
                approver_required: false,
                approver_user_id: null,
                ai_scoring_enabled: false,
                ai_scoring_threshold: 70,
                cad_enabled: false,
                timezone: 'Asia/Kolkata',
            };

            return NextResponse.json({ success: true, settings: defaultSettings });
        }

        return NextResponse.json({ success: true, settings });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const {
            checklist_mode,
            reminder_enabled,
            reminder_lead_time_mins,
            reminder_channels,
            approver_required,
            approver_user_id,
            ai_scoring_enabled,
            ai_scoring_threshold,
            cad_enabled,
            timezone,
        } = body;

        // Fetch property organization_id
        const { data: prop, error: propError } = await supabaseAdmin
            .from('properties')
            .select('id, organization_id')
            .eq('id', propertyId)
            .single();

        if (propError || !prop) {
            return NextResponse.json({ error: 'Property not found' }, { status: 404 });
        }

        const upsertPayload: any = {
            property_id: propertyId,
            organization_id: prop.organization_id,
            updated_at: new Date().toISOString(),
        };

        if (checklist_mode !== undefined) upsertPayload.checklist_mode = checklist_mode;
        if (reminder_enabled !== undefined) upsertPayload.reminder_enabled = reminder_enabled;
        if (reminder_lead_time_mins !== undefined) upsertPayload.reminder_lead_time_mins = reminder_lead_time_mins;
        if (reminder_channels !== undefined) upsertPayload.reminder_channels = reminder_channels;
        if (approver_required !== undefined) upsertPayload.approver_required = approver_required;
        if (approver_user_id !== undefined) upsertPayload.approver_user_id = approver_user_id;
        if (ai_scoring_enabled !== undefined) upsertPayload.ai_scoring_enabled = ai_scoring_enabled;
        if (ai_scoring_threshold !== undefined) upsertPayload.ai_scoring_threshold = ai_scoring_threshold;
        if (cad_enabled !== undefined) upsertPayload.cad_enabled = cad_enabled;
        if (timezone !== undefined) upsertPayload.timezone = timezone;

        const { data: updated, error: upsertError } = await supabaseAdmin
            .from('checklist_property_settings')
            .upsert(upsertPayload, { onConflict: 'property_id' })
            .select()
            .single();

        if (upsertError) {
            return NextResponse.json({ error: upsertError.message }, { status: 500 });
        }

        // If checklist_mode changed, sync properties.checklist_mode
        if (checklist_mode) {
            await supabaseAdmin
                .from('properties')
                .update({ checklist_mode })
                .eq('id', propertyId);
        }

        return NextResponse.json({ success: true, settings: updated });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
