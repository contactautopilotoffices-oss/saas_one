import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';

// GET /api/feedback — List feedback tickets
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');
        const type = searchParams.get('type');
        const orgId = searchParams.get('org_id');
        const limit = parseInt(searchParams.get('limit') || '50');

        // Use admin client to bypass RLS for fetching (we'll filter manually)
        const admin = createAdminClient();

        let query = admin
            .from('feedback_tickets')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (status) query = query.eq('status', status);
        if (type) query = query.eq('type', type);
        if (orgId) query = query.eq('organization_id', orgId);

        const { data, error } = await query;

        if (error) {
            console.error('[Feedback GET] Error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ data });
    } catch (err: any) {
        console.error('[Feedback GET] Unexpected error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// POST /api/feedback — Submit new feedback
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();

        const {
            type,               // 'bug' | 'feature'
            error_text,         // Bug: error message text
            error_page_url,     // Bug: URL where error occurred
            error_category,     // Bug: category
            severity,           // Bug: severity level
            feature_description,// Feature: what to build
            target_module,      // Feature: which module
            acceptance_criteria,// Feature: done criteria
            priority,           // Feature: priority
            attachments,        // Array of storage URLs
            property_id,        // Optional property context
            organization_id,    // Required org context
        } = body;

        if (!type || !['bug', 'feature'].includes(type)) {
            return NextResponse.json({ error: 'Type must be "bug" or "feature"' }, { status: 400 });
        }

        if (type === 'bug' && !error_text) {
            return NextResponse.json({ error: 'Bug reports require error_text' }, { status: 400 });
        }

        if (type === 'feature' && !feature_description) {
            return NextResponse.json({ error: 'Feature requests require feature_description' }, { status: 400 });
        }

        // Use admin client to insert (bypasses RLS for reliable insert)
        const admin = createAdminClient();

        const insertData = {
            type,
            status: 'pending',
            submitted_by: user.id,
            submitted_by_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Unknown',
            submitted_by_role: user.user_metadata?.role || 'user',
            property_id: property_id || null,
            organization_id: organization_id || null,
            error_text: type === 'bug' ? error_text : null,
            error_page_url: type === 'bug' ? (error_page_url || null) : null,
            error_category: type === 'bug' ? (error_category || 'other') : null,
            severity: type === 'bug' ? (severity || 'medium') : null,
            feature_description: type === 'feature' ? feature_description : null,
            target_module: type === 'feature' ? (target_module || null) : null,
            acceptance_criteria: type === 'feature' ? (acceptance_criteria || null) : null,
            priority: type === 'feature' ? (priority || 'medium') : null,
            attachments: attachments || [],
        };

        const { data, error } = await admin
            .from('feedback_tickets')
            .insert(insertData)
            .select()
            .single();

        if (error) {
            console.error('[Feedback POST] Error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ data }, { status: 201 });
    } catch (err: any) {
        console.error('[Feedback POST] Unexpected error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
