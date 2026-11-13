import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { canReviewChecklist, normalizeParamKey, PARAM_STATUSES } from '@/lib/sop/checklistAiReview';

/**
 * Checker corrections on AI parameter verdicts. The scorer reads these back as standing rules
 * (same step, and same parameter name across the organization), so the AI learns over time.
 *
 * GET  -> { can_review, feedback[] } for this completion
 * POST -> { completionItemId, parameterName, verdict: 'correct' | 'incorrect', correctedStatus?, guidance? }
 *         Only property / org admins or the checker assigned in checklist settings.
 */

async function loadCompletion(completionId: string, propertyId: string) {
    let q = supabaseAdmin
        .from('sop_completions')
        .select('id, property_id, template_id')
        .eq('id', completionId);
    if (propertyId && propertyId !== 'all' && propertyId !== 'undefined' && propertyId !== 'null') {
        q = q.eq('property_id', propertyId);
    }
    const { data } = await q.maybeSingle();
    return data;
}

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ propertyId: string; completionId: string }> }
) {
    const { propertyId, completionId } = await params;
    const supabase = await createClient();

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const completion = await loadCompletion(completionId, propertyId);
        if (!completion) {
            return NextResponse.json({ error: 'Completion not found' }, { status: 404 });
        }

        const { allowed } = await canReviewChecklist(user.id, completion.property_id);

        const { data: feedback, error } = await supabaseAdmin
            .from('sop_ai_feedback')
            .select('id, completion_item_id, parameter_name, ai_status, verdict, corrected_status, guidance, created_by, created_at')
            .eq('completion_id', completionId)
            .eq('is_active', true)
            .order('created_at', { ascending: false });

        return NextResponse.json({
            can_review: allowed,
            feedback: error ? [] : (feedback || []),
            feedback_available: !error,
        });
    } catch (err) {
        console.error('[AI Feedback GET] Error:', err);
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
    }
}

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

        const completion = await loadCompletion(completionId, propertyId);
        if (!completion) {
            return NextResponse.json({ error: 'Completion not found' }, { status: 404 });
        }

        const { allowed, organizationId } = await canReviewChecklist(user.id, completion.property_id);
        if (!allowed) {
            return NextResponse.json({ error: 'Only the assigned checker or a property admin can correct the AI' }, { status: 403 });
        }
        if (!organizationId) {
            return NextResponse.json({ error: 'Property has no organization' }, { status: 400 });
        }

        const body = await request.json().catch(() => ({}));
        const completionItemId = String(body.completionItemId || '');
        const parameterName = String(body.parameterName || '').trim();
        const verdict = body.verdict;
        const correctedStatus = body.correctedStatus ?? null;
        const guidance = typeof body.guidance === 'string' ? body.guidance.trim().slice(0, 500) : '';

        if (!completionItemId || !parameterName) {
            return NextResponse.json({ error: 'completionItemId and parameterName are required' }, { status: 400 });
        }
        if (verdict !== 'correct' && verdict !== 'incorrect') {
            return NextResponse.json({ error: "verdict must be 'correct' or 'incorrect'" }, { status: 400 });
        }
        if (verdict === 'incorrect' && !(PARAM_STATUSES as readonly string[]).includes(correctedStatus)) {
            return NextResponse.json({ error: `correctedStatus must be one of: ${PARAM_STATUSES.join(', ')}` }, { status: 400 });
        }

        const { data: item } = await supabaseAdmin
            .from('sop_completion_items')
            .select('*')
            .eq('id', completionItemId)
            .eq('completion_id', completionId)
            .maybeSingle();
        if (!item) {
            return NextResponse.json({ error: 'Completion item not found' }, { status: 404 });
        }

        // Scope check: only parameters the AI actually scored on this step can be corrected
        const paramScores: any[] = Array.isArray(item.ai_parameter_scores) ? item.ai_parameter_scores : [];
        const key = normalizeParamKey(parameterName);
        const paramIdx = paramScores.findIndex((p: any) => !p?.system && normalizeParamKey(p?.name || '') === key);
        if (paramIdx === -1) {
            return NextResponse.json({ error: 'This parameter was not scored by the AI on this step' }, { status: 400 });
        }
        const aiParam = paramScores[paramIdx];

        // Replace any earlier active correction from this item+parameter so a re-review doesn't double count
        await supabaseAdmin
            .from('sop_ai_feedback')
            .update({ is_active: false })
            .eq('completion_item_id', completionItemId)
            .eq('parameter_key', key)
            .eq('is_active', true);

        const { data: saved, error: insertError } = await supabaseAdmin
            .from('sop_ai_feedback')
            .insert({
                organization_id: organizationId,
                property_id: completion.property_id,
                template_id: completion.template_id,
                checklist_item_id: item.checklist_item_id,
                completion_id: completionId,
                completion_item_id: completionItemId,
                parameter_name: aiParam.name || parameterName,
                parameter_key: key,
                ai_status: aiParam.status || null,
                verdict,
                corrected_status: verdict === 'incorrect' ? correctedStatus : null,
                guidance: guidance || null,
                created_by: user.id,
            })
            .select('id, completion_item_id, parameter_name, ai_status, verdict, corrected_status, guidance, created_by, created_at')
            .single();

        if (insertError) {
            console.error('[AI Feedback POST] Insert error:', insertError.message);
            return NextResponse.json({ error: 'Could not save the correction. The feedback table may not be set up yet.' }, { status: 500 });
        }

        // Record the reviewer's verdict on the step so reports show it next to the AI result
        const reviewedStatus = verdict === 'incorrect' ? correctedStatus : aiParam.status;
        const updatedParams = paramScores.map((p: any, i: number) => i === paramIdx ? {
            ...p,
            reviewer_status: reviewedStatus,
            reviewer_verdict: verdict,
            reviewer_note: guidance || null,
            reviewed_by: user.id,
            reviewed_at: new Date().toISOString(),
        } : p);

        // The step stays "needs review" while any flagged parameter has no human verdict yet
        const stillUnreviewed = updatedParams.some((p: any) =>
            !p?.system && (p.status === 'not_visible' || p.status === 'not_in_frame') && !p.reviewer_status
        );
        const matches: any[] = Array.isArray(item.ai_photo_matches) ? item.ai_photo_matches : [];
        const hasAngleIssue = matches.some((m: any) => m?.status === 'missing' || m?.status === 'angle_mismatch');

        const itemUpdate: any = { ai_parameter_scores: updatedParams };
        if (item.ai_needs_review !== undefined && item.step_approval_status !== 'approved') {
            itemUpdate.ai_needs_review = stillUnreviewed || hasAngleIssue;
        }
        await supabaseAdmin.from('sop_completion_items').update(itemUpdate).eq('id', completionItemId);

        return NextResponse.json({
            success: true,
            feedback: saved,
            parameters: updatedParams,
            needs_review: itemUpdate.ai_needs_review ?? item.ai_needs_review ?? false,
        });
    } catch (err) {
        console.error('[AI Feedback POST] Error:', err);
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
    }
}
