import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const orgId = (await params).orgId;
        const body = await request.json();
        
        // Ensure user is master admin or super admin
        const { data: userProfile } = await supabaseAdmin
            .from('users')
            .select('is_master_admin')
            .eq('id', user.id)
            .single();

        if (!userProfile?.is_master_admin) {
            // Alternatively, allow if they are org_super_admin for this org
            const { data: orgMembership } = await supabaseAdmin
                .from('organization_memberships')
                .select('role')
                .eq('user_id', user.id)
                .eq('organization_id', orgId)
                .eq('role', 'org_super_admin')
                .maybeSingle();
            
            if (!orgMembership) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        // Only updating email_preferences and email_templates for now
        const updateData: any = {};
        if (body.email_preferences !== undefined) {
            updateData.email_preferences = body.email_preferences;
        }
        if (body.email_templates !== undefined) {
            updateData.email_templates = body.email_templates;
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        const { data: orgSettings, error: updateError } = await supabaseAdmin
            .from('organization_settings')
            .upsert({ 
                organization_id: orgId, 
                email_preferences: updateData.email_preferences 
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
