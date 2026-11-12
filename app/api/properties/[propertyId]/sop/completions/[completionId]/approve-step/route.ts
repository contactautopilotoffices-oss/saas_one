import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * POST /api/properties/[propertyId]/sop/completions/[completionId]/approve-step
 * Step-by-step checklist approval for checker/approver/admin.
 * Body: { completionItemId, step_approval_status, step_approval_notes }
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string; completionId: string }> }
) {
    const { propertyId, completionId } = await params;
    const supabase = await createClient();

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { completionItemId, step_approval_status, step_approval_notes } = body;

        if (!completionItemId) {
            return NextResponse.json({ error: 'completionItemId is required' }, { status: 400 });
        }

        if (!['approved', 'rejected', 'pending'].includes(step_approval_status)) {
            return NextResponse.json({ error: 'Invalid step_approval_status' }, { status: 400 });
        }

        // Verify completion belongs to this property
        let compQuery = supabaseAdmin
            .from('sop_completions')
            .select('id, property_id, approval_status')
            .eq('id', completionId);

        if (propertyId && propertyId !== 'all' && propertyId !== 'undefined' && propertyId !== 'null') {
            compQuery = compQuery.eq('property_id', propertyId);
        }

        const { data: completion, error: compError } = await compQuery.maybeSingle();
        if (compError || !completion) {
            return NextResponse.json({ error: 'Completion not found' }, { status: 404 });
        }

        // Update the step item
        const updatePayload: any = {
            step_approval_status,
            step_approved_by: user.id,
            step_approved_at: new Date().toISOString(),
        };

        if (step_approval_notes !== undefined) {
            updatePayload.step_approval_notes = step_approval_notes;
        }

        const { data: updatedItem, error: itemError } = await supabaseAdmin
            .from('sop_completion_items')
            .update(updatePayload)
            .eq('id', completionItemId)
            .eq('completion_id', completionId)
            .select()
            .single();

        if (itemError) {
            return NextResponse.json({ error: itemError.message }, { status: 500 });
        }

        // Fetch all items to evaluate overall completion approval status
        const { data: allItems } = await supabaseAdmin
            .from('sop_completion_items')
            .select('id, step_approval_status')
            .eq('completion_id', completionId);

        let overallApprovalStatus = 'pending';
        if (allItems && allItems.length > 0) {
            const hasRejection = allItems.some(it => it.step_approval_status === 'rejected');
            const allApproved = allItems.every(it => it.step_approval_status === 'approved');

            if (hasRejection) {
                overallApprovalStatus = 'rejected';
            } else if (allApproved) {
                overallApprovalStatus = 'approved';
            } else {
                overallApprovalStatus = 'pending';
            }

            await supabaseAdmin
                .from('sop_completions')
                .update({
                    approval_status: overallApprovalStatus,
                    approver_id: user.id,
                    approved_at: overallApprovalStatus === 'approved' ? new Date().toISOString() : null,
                })
                .eq('id', completionId);
        }

        return NextResponse.json({
            success: true,
            item: updatedItem,
            overallApprovalStatus,
        });
    } catch (err) {
        console.error('[Step Approval Error]:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
