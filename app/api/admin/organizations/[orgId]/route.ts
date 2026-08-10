import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export async function GET(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const orgId = (await params).orgId;

        const { data: orgSettings } = await supabaseAdmin
            .from('organization_settings')
            .select('*')
            .eq('organization_id', orgId)
            .maybeSingle();

        return NextResponse.json(orgSettings || { organization_id: orgId });
    } catch (error) {
        console.error('Organization GET error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const orgId = (await params).orgId;
        const body = await request.json();
        
        // Ensure user is master admin, super admin, or authorized admin for this org
        const { data: userProfile } = await supabaseAdmin
            .from('users')
            .select('is_master_admin, is_super_admin, email')
            .eq('id', user.id)
            .single();

        let isAuthorized = userProfile?.is_master_admin || userProfile?.is_super_admin;

        if (!isAuthorized) {
            const { data: orgMemberships } = await supabaseAdmin
                .from('organization_memberships')
                .select('role')
                .eq('user_id', user.id)
                .eq('organization_id', orgId);

            if (orgMemberships && orgMemberships.length > 0) {
                const allowedRoles = new Set(['org_super_admin', 'master_admin', 'owner', 'org_admin', 'procurement', 'admin', 'bd_super_admin']);
                isAuthorized = orgMemberships.some(m => m.role && allowedRoles.has(m.role.toLowerCase().trim()));
            }
        }

        if (!isAuthorized) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const updateData: any = {};
        if (body.email_preferences !== undefined) {
            updateData.email_preferences = body.email_preferences;
        }
        if (body.email_templates !== undefined) {
            updateData.email_templates = body.email_templates;
        }
        if (body.email_service_config !== undefined) {
            updateData.email_service_config = body.email_service_config;
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        const { data: orgSettings, error: updateError } = await supabaseAdmin
            .from('organization_settings')
            .upsert({ 
                organization_id: orgId, 
                ...updateData,
                updated_at: new Date().toISOString()
            }, { onConflict: 'organization_id' })
            .select()
            .single();

        if (updateError) {
            console.error('Error updating organization settings:', updateError);
            return NextResponse.json({ error: 'Failed to update organization settings' }, { status: 500 });
        }

        return NextResponse.json(orgSettings);
    } catch (error) {
        console.error('Organization PATCH error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
