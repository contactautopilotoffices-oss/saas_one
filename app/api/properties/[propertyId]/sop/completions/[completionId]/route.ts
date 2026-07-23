import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string; completionId: string }> }
) {
    const { propertyId, completionId } = await params;
    const supabase = await createClient();

    try {
        // Auth check — GET was previously unauthenticated
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // IDOR guard: fetch completion scoped to this property only
        const { data: completion, error } = await supabaseAdmin
            .from('sop_completions')
            .select(`
                *,
                template:sop_templates(*, items:sop_checklist_items(*)),
                user:users(full_name),
                items:sop_completion_items(
                    *,
                    checklist_item:sop_checklist_items(*),
                    checked_by_user:users!checked_by(full_name)
                )
            `)
            .eq('id', completionId)
            .eq('property_id', propertyId)
            .single();

        if (error || !completion) {
            return NextResponse.json({ error: 'Completion not found' }, { status: 404 });
        }

        // ── Self-heal: insert any missing sop_completion_items rows ──────────
        const templateItems: any[] = completion.template?.items || [];
        const existingIds = new Set((completion.items || []).map((i: any) => i.checklist_item_id));
        const missing = templateItems.filter((ti: any) => !existingIds.has(ti.id));

        if (missing.length > 0) {
            const completionItems = missing.map((ti: any) => ({
                completion_id: completionId,
                checklist_item_id: ti.id,
                is_checked: false
            }));

            await supabaseAdmin
                .from('sop_completion_items')
                .insert(completionItems);

            const { data: healed } = await supabaseAdmin
                .from('sop_completions')
                .select(`
                    *,
                    template:sop_templates(*, items:sop_checklist_items(*)),
                    user:users(full_name),
                    items:sop_completion_items(
                        *,
                        checklist_item:sop_checklist_items(*),
                        checked_by_user:users!checked_by(full_name)
                    )
                `)
                .eq('id', completionId)
                .eq('property_id', propertyId)
                .single();

            return NextResponse.json({ success: true, completion: healed });
        }

        return NextResponse.json({ success: true, completion });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

export async function PUT(
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

        // IDOR guard: confirm this completion belongs to this property before any mutation
        const { data: existing } = await supabaseAdmin
            .from('sop_completions')
            .select('id, property_id, completed_by')
            .eq('id', completionId)
            .eq('property_id', propertyId)
            .maybeSingle();

        if (!existing) {
            return NextResponse.json({ error: 'Completion not found' }, { status: 404 });
        }

        const body = await request.json();
        const { status, notes, item, is_late } = body;

        if (status || notes !== undefined) {
            const updates: any = {};
            if (status) updates.status = status;
            if (notes !== undefined) updates.notes = notes;
            if (is_late !== undefined) updates.is_late = is_late;
            if (status === 'completed') {
                updates.completed_at = new Date().toISOString();
                if (!existing.completed_by) {
                    updates.completed_by = user.id;
                }
                
                // Final hard-check for lateness if template window exists
                const { data: fullComp } = await supabaseAdmin
                    .from('sop_completions')
                    .select('*, template:sop_templates(start_time, end_time)')
                    .eq('id', completionId)
                    .single();

                if (fullComp?.template?.end_time) {
                    const now = new Date();
                    const indiaFormatter = new Intl.DateTimeFormat('en-US', {
                        timeZone: 'Asia/Kolkata',
                        hour: 'numeric',
                        minute: 'numeric',
                        hour12: false
                    });
                    const partsInRange = indiaFormatter.formatToParts(now);
                    const h = parseInt(partsInRange.find(p => p.type === 'hour')?.value || '0');
                    const m = parseInt(partsInRange.find(p => p.type === 'minute')?.value || '0');
                    const currentMins = h * 60 + m;

                    const [sH, sM] = fullComp.template.start_time.slice(0, 5).split(':').map(Number);
                    const [eH, eM] = fullComp.template.end_time.slice(0, 5).split(':').map(Number);
                    const startM = sH * 60 + sM;
                    const endM = eH * 60 + eM;

                    const isOvernight = endM < startM;
                    
                    // Use completion_date to distinguish between logical shifts
                    const logicalDate = fullComp.completion_date;
                    const indiaDateFormatter = new Intl.DateTimeFormat('en-CA', {
                        timeZone: 'Asia/Kolkata',
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit'
                    });
                    const todayStr = indiaDateFormatter.format(now);
                    const yesterdayStr = indiaDateFormatter.format(new Date(now.getTime() - 86400000));
                    
                    const isCurrentlyEarlyMorning = isOvernight && currentMins < endM;
                    const isHistorical = isCurrentlyEarlyMorning 
                        ? logicalDate < yesterdayStr 
                        : logicalDate < todayStr;

                    const isFuture = logicalDate > todayStr;

                    if (isHistorical) {
                        // Past day checklist is definitely late
                        updates.is_late = true;
                    } else if (!isFuture) {
                        // It is for TODAY (or currently active logical shift). 
                        // Only mark late if past end time and before next start.
                        // If it's early morning, it's never "after window" because we are in it.
                        const isAfterWindow = isOvernight
                            ? (currentMins >= endM && currentMins < startM)
                            : (currentMins >= endM);

                        if (isAfterWindow) {
                            updates.is_late = true;
                        }
                    }
                }
            }

            const { error: updateError } = await supabaseAdmin
                .from('sop_completions')
                .update(updates)
                .eq('id', completionId)
                .eq('property_id', propertyId);

            if (updateError) {
                return NextResponse.json({ error: updateError.message }, { status: 500 });
            }
        }

        if (item) {
            const { completionItemId, is_checked, comment, photo_url, video_url, value } = item;

            if (!completionItemId) {
                return NextResponse.json({ error: 'completionItemId is required in item payload' }, { status: 400 });
            }

            const itemUpdates: any = {};
            if (is_checked !== undefined) itemUpdates.is_checked = is_checked;
            if (comment !== undefined) itemUpdates.comment = comment;
            if (photo_url !== undefined) itemUpdates.photo_url = photo_url;
            if (video_url !== undefined) itemUpdates.video_url = video_url;
            if (value !== undefined) itemUpdates.value = value;
            if (is_checked) {
                itemUpdates.checked_at = new Date().toISOString();
                itemUpdates.checked_by = user.id;
            }

            // Scope the item update to this completion to prevent cross-completion tampering
            const { error: itemError } = await supabaseAdmin
                .from('sop_completion_items')
                .update(itemUpdates)
                .eq('id', completionItemId)
                .eq('completion_id', completionId);

            if (itemError) {
                return NextResponse.json({ error: itemError.message }, { status: 500 });
            }
        }

        const { data: completion } = await supabaseAdmin
            .from('sop_completions')
            .select(`
                *,
                template:sop_templates(title, frequency),
                items:sop_completion_items(
                    *,
                    checked_by_user:users!checked_by(full_name)
                )
            `)
            .eq('id', completionId)
            .single();

        return NextResponse.json({ success: true, completion });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
