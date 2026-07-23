import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { createClient } from '@/frontend/utils/supabase/server';

/**
 * GET /api/audit/submissions?property_id=...&period=...
 * Fetch audit submissions for a property, joined with master items.
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get('property_id');
    const period = searchParams.get('period') || '2025-26';

    if (!propertyId) return NextResponse.json({ error: 'Property ID required' }, { status: 400 });

    // Join with master items to show the full checklist even if no submission exists
    const { data: masterItems, error: mError } = await supabaseAdmin
        .from('audit_master_items')
        .select('*')
        .order('si_no', { ascending: true });

    if (mError) return NextResponse.json({ error: mError.message }, { status: 500 });

    const { data: submissions, error: sError } = await supabaseAdmin
        .from('property_audit_submissions')
        .select('*')
        .eq('property_id', propertyId)
        .eq('audit_period_year', period);

    if (sError) return NextResponse.json({ error: sError.message }, { status: 500 });

    // Merge submissions into master list
    const checklist = masterItems.map(item => {
        const sub = submissions.find(s => s.master_item_id === item.id);
        return {
            ...item,
            submission: sub || { status: 'missing', remark: '', proof_url: null }
        };
    });

    return NextResponse.json({ checklist });
}

/**
 * PATCH /api/audit/submissions
 * Update or create a submission (used by SPOCs to upload proof).
 */
export async function PATCH(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await request.json();
        const { master_item_id, property_id, organization_id, status, remark, proof_url, audit_period_year } = body;

        const { data, error } = await supabaseAdmin
            .from('property_audit_submissions')
            .upsert({
                master_item_id,
                property_id,
                organization_id,
                status: status || 'pending_review',
                remark,
                proof_url,
                submitted_by: user.id,
                submitted_at: new Date().toISOString(),
                audit_period_year: audit_period_year || '2025-26',
                updated_at: new Date().toISOString(),
            }, { 
                onConflict: 'master_item_id,property_id,audit_period_year' 
            })
            .select()
            .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ submission: data });
    } catch (err) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
