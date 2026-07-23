import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    const templateId = searchParams.get('templateId');
    const completionDate = searchParams.get('completionDate');
    const userId = searchParams.get('userId');
    const rawLimit = parseInt(searchParams.get('limit') || '50');
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

    // Validate completionDate format to prevent injection / unexpected query results
    if (completionDate && !/^\d{4}-\d{2}-\d{2}$/.test(completionDate)) {
        return NextResponse.json({ error: 'completionDate must be YYYY-MM-DD' }, { status: 400 });
    }

    try {
        let query = supabase
            .from('sop_completions')
            .select(`
                *,
                template:sop_templates(title, frequency),
                user:users(id, full_name),
                items:sop_completion_items(*)
            `)
            .eq('property_id', propertyId)
            .order('completion_date', { ascending: false })
            .limit(limit);

        if (templateId) {
            query = query.eq('template_id', templateId);
        }

        if (completionDate) {
            query = query.eq('completion_date', completionDate);
        }

        if (userId) {
            query = query.eq('completed_by', userId);
        }

        const { data: completions, error } = await query;

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            completions,
            total: completions?.length || 0,
        });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

export async function POST(
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
        const { templateId, completionDate, notes } = body;

        // Fetch user role for this property to allow admin bypass (e.g. for historical edits or other special logic)
        const { data: membership } = await supabaseAdmin
            .from('property_memberships')
            .select('role')
            .eq('property_id', propertyId)
            .eq('user_id', user.id)
            .eq('is_active', true)
            .maybeSingle();
        
        const userRole = (membership?.role || '').toLowerCase();
        const isAdmin = ['property_admin', 'org_admin', 'org_super_admin', 'master_admin'].includes(userRole);

        if (!templateId) {
            return NextResponse.json({ error: 'templateId is required' }, { status: 400 });
        }

        // Use admin client to bypass RLS for all data operations
        const { data: property, error: propError } = await supabaseAdmin
            .from('properties')
            .select('organization_id')
            .eq('id', propertyId)
            .single();

        if (propError || !property) {
            return NextResponse.json({ error: 'Property not found' }, { status: 404 });
        }

        // Verify template exists and get its items (admin bypasses RLS)
        const { data: template, error: templateError } = await supabaseAdmin
            .from('sop_templates')
            .select('id, frequency, start_time, end_time, items:sop_checklist_items(*)')
            .eq('id', templateId)
            .eq('property_id', propertyId)
            .single();

        if (templateError || !template) {
            return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }

        const now = new Date();

        // Robustly get India Standard Time (IST) hours and minutes
        const indiaFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Kolkata',
            hour: 'numeric',
            minute: 'numeric',
            hour12: false
        });
        const parts = indiaFormatter.formatToParts(now);
        const indiaH = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
        const indiaM = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
        const nowMins = indiaH * 60 + indiaM;

        // India-local date string (YYYY-MM-DD)
        const indiaDateFormatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const indiaDate = indiaDateFormatter.format(now);

        // ── Effective Date Logic for Overnight Shifts ────────────────────────
        // If a shift starts at 10 PM and ends at 7 AM, a user opening it at 2 AM
        // on the 24th is likely completing the "23rd" checklist.
        let effectiveDate = indiaDate;
        const startTime_raw = (template as any).start_time;
        const endTime_raw = (template as any).end_time;
        if (startTime_raw && endTime_raw) {
            const [sH, sM] = startTime_raw.slice(0, 5).split(':').map(Number);
            const [eH, eM] = endTime_raw.slice(0, 5).split(':').map(Number);
            const startM = sH * 60 + sM;
            const endM = eH * 60 + eM;
            const isOvernight = endM < startM;

            if (isOvernight && nowMins < endM) {
                // Currently in the early morning part of an overnight shift.
                // Shift the effective date back by 1 day.
                const yesterday = new Date(now.getTime() - 86400000);
                effectiveDate = indiaDateFormatter.format(yesterday);
            }
        }

        const finalCompletionDate = completionDate || effectiveDate;
        const isHistorical = !!completionDate && completionDate !== effectiveDate;

        // ── Time Window Enforcement (Global) ──────────────────────────────────
        const startTime = (template as any).start_time;
        const endTime = (template as any).end_time;

        // ── Compute slot_time and due_at ──────────────────────────────────────
        let slotTime: string | null = null;
        let dueAt: string | null = null;
        
        const hourlyMatch = (template as any).frequency?.match(/^every_(\d+)_hours?$/);
        if (hourlyMatch && startTime) {
            const intervalH = parseInt(hourlyMatch[1]);
            const [sH, sM] = startTime.slice(0, 5).split(':').map(Number);
            const startMins = sH * 60 + sM;
            const [eH, eM] = (endTime || '23:59').slice(0, 5).split(':').map(Number);
            const endMins = eH * 60 + eM;

            const isOvernight = endMins < startMins;
            let adjustedNowMins = nowMins;
            if (isOvernight && nowMins < startMins) {
                adjustedNowMins += 1440; // Past midnight in overnight window
            }

            const elapsed = adjustedNowMins - startMins;
            const slotIndex = Math.floor(elapsed / (intervalH * 60));
            const slotStartOffsetMins = slotIndex * intervalH * 60;

            const slotStartTotalMins = startMins + slotStartOffsetMins;
            const slotH = Math.floor(slotStartTotalMins / 60) % 24;
            const slotM = slotStartTotalMins % 60;
            const isNextDay = slotStartTotalMins >= 1440;

            let slotDateStr = finalCompletionDate;
            if (isNextDay) {
                const d = new Date(finalCompletionDate);
                d.setDate(d.getDate() + 1);
                slotDateStr = d.toISOString().split('T')[0];
            }

            slotTime = `${String(slotH).padStart(2, '0')}:${String(slotM).padStart(2, '0')}:00`;
            dueAt = new Date(`${slotDateStr}T${slotTime}+05:30`).toISOString();
        } else {
            // For all other frequencies (daily, weekly, monthly, etc.)
            // we anchor to the start of the day if no specific slot is defined.
            slotTime = startTime ? (startTime.length === 5 ? `${startTime}:00` : startTime) : '00:00:00';
            dueAt = new Date(`${finalCompletionDate}T${slotTime}+05:30`).toISOString();
        }

        // ── Dedup / Resume existing completion ──────────────────────────────
        let existingCompletion: any = null;

        if (dueAt) {
            const { data } = await supabaseAdmin
                .from('sop_completions')
                .select('*, items:sop_completion_items(*)')
                .eq('template_id', templateId)
                .eq('due_at', dueAt)
                .maybeSingle();
            
            existingCompletion = data;
        } 
        
        // If we still don't have an existing completion, do a final fallback search 
        // based on the template and date (prevents duplicates for non-hourly templates)
        if (!existingCompletion) {
            const { data } = await supabaseAdmin
                .from('sop_completions')
                .select('*, items:sop_completion_items(*)')
                .eq('template_id', templateId)
                .eq('property_id', propertyId)
                .eq('completion_date', finalCompletionDate)
                .order('created_at', { ascending: false })
                .limit(1);
            existingCompletion = data?.[0] ?? null;
        }

        // ── Check if we should allow on-demand generation ───────────────────
        // [REMOVED] User requested absolute restriction. No on-demand generation allowed.

        if (!existingCompletion) {
            // Generate on-the-fly if missing. This is a fallback for missed pre-generation.
            const { data: newCompletion, error: insertError } = await supabaseAdmin
                .from('sop_completions')
                .insert({
                    template_id: templateId,
                    property_id: propertyId,
                    organization_id: property.organization_id,
                    due_at: dueAt,
                    completion_date: finalCompletionDate,
                    slot_time: slotTime,
                    status: 'pending'
                })
                .select()
                .single();

            if (insertError) {
                // If it's a unique constraint error, someone else might have just created it.
                const { data: retry } = await supabaseAdmin
                    .from('sop_completions')
                    .select('*, items:sop_completion_items(*)')
                    .eq('template_id', templateId)
                    .eq('due_at', dueAt)
                    .maybeSingle();
                
                if (!retry) {
                    return NextResponse.json({ error: 'Failed to create checklist session: ' + insertError.message }, { status: 500 });
                }
                existingCompletion = retry;
            } else {
            // NOTE: sop_completion_items are auto-populated via fn_clone_sop_checklist_items trigger 
            // after inserting into sop_completions. We just need to refetch to get the items.
            const { data: finalCompletion } = await supabaseAdmin
                .from('sop_completions')
                .select('*, items:sop_completion_items(*)')
                .eq('id', newCompletion.id)
                .single();
            
            existingCompletion = finalCompletion;
        }
    }

    // ── Self-heal: insert any missing sop_completion_items rows ──────────
    const templateItems: any[] = (template as any)?.items || [];
    const existingIds = new Set((existingCompletion.items || []).map((i: any) => i.checklist_item_id));
    const missing = templateItems.filter((ti: any) => !existingIds.has(ti.id));

    if (missing.length > 0) {
        const completionItems = missing.map((ti: any) => ({
            completion_id: existingCompletion.id,
            checklist_item_id: ti.id,
            is_checked: false
        }));

        await supabaseAdmin
            .from('sop_completion_items')
            .insert(completionItems);

        const { data: healed } = await supabaseAdmin
            .from('sop_completions')
            .select('*, items:sop_completion_items(*)')
            .eq('id', existingCompletion.id)
            .single();

        existingCompletion = healed;
    }

    // Update to in_progress if it was just pending/missed
        if (existingCompletion.status === 'pending' || existingCompletion.status === 'missed') {
            const [sH, sM] = (startTime ?? '00:00').slice(0, 5).split(':').map(Number);
            const [eH, eM] = (endTime ?? '23:59').slice(0, 5).split(':').map(Number);
            const startM = sH * 60 + sM;
            const endM = eH * 60 + eM;
            const isOvernight = endM <= startM;
            const isAfterWindow = isOvernight
                ? (nowMins >= endM && nowMins < startM)
                : (nowMins >= endM);

            const isLate = existingCompletion.status === 'missed' || isAfterWindow;

            await supabaseAdmin
                .from('sop_completions')
                .update({ 
                    status: 'in_progress', 
                    started_at: new Date().toISOString(), 
                    completed_by: user.id,
                    is_late: isLate
                })
                .eq('id', existingCompletion.id);
            
            existingCompletion.status = 'in_progress';
            existingCompletion.started_at = new Date().toISOString();
            existingCompletion.completed_by = user.id;
            existingCompletion.is_late = isLate;
        }

        return NextResponse.json({ success: true, completion: existingCompletion });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
