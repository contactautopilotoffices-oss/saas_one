import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

/**
 * PATCH /api/tickets/[id]/override-classification
 * Manual category override with feedback loop
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: ticketId } = await params;
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { category_id, skill_group_id, reason } = body;

        if (!category_id) {
            return NextResponse.json({ error: 'category_id is required' }, { status: 400 });
        }

        // Get current ticket for logging
        const { data: ticket } = await supabase
            .from('tickets')
            .select('category_id, skill_group_id, confidence_score')
            .eq('id', ticketId)
            .single();

        if (!ticket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        // Update ticket with manual classification
        const { data: updated, error } = await supabase
            .from('tickets')
            .update({
                category_id,
                skill_group_id: skill_group_id || null,
                classification_source: 'manual',
                confidence_score: 100, // Manual = 100% confidence
                is_vague: false,
                updated_at: new Date().toISOString(),
            })
            .eq('id', ticketId)
            .select(`
        *,
        category:issue_categories(id, code, name)
      `)
            .single();

        if (error) {
            return NextResponse.json({ error: 'Failed to override classification' }, { status: 500 });
        }

        // Log activity
        await supabase.from('ticket_activity_log').insert({
            ticket_id: ticketId,
            user_id: user.id,
            action: 'classification_override',
            old_value: ticket.category_id,
            new_value: category_id,
        });

        // 2026-11-19: a re-sort by hand is a learning example for similar new tickets (only when the category changed).
        // Never a reason for the override to fail.
        if (ticket.category_id !== category_id) await learnFromOverride(updated as Record<string, unknown>, skill_group_id || null);

        return NextResponse.json({
            success: true,
            ticket: updated,
            message: 'Classification overridden successfully',
        });
    } catch (error) {
        console.error('Override classification error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

/** The overridden ticket as a learning example (backend/lib/ticketing/sortLearningStore.ts). Never throws. */
async function learnFromOverride(t: Record<string, unknown>, skillGroupId: string | null): Promise<void> {
    try {
        const category = (Array.isArray(t.category) ? t.category[0] : t.category) as { code?: unknown } | null;
        const code = typeof category?.code === 'string' ? category.code : null;
        const orgId = typeof t.organization_id === 'string' ? t.organization_id : null;
        if (!code || !orgId) return;
        const [{ supabaseAdmin }, { saveExample, learningSetting }, { ticketText }, { maskIdentity }] = await Promise.all([
            import('@/backend/lib/supabase/admin'),
            import('@/backend/lib/ticketing/sortLearningStore'),
            import('@/backend/lib/ticketing/sortReview'),
            import('@/backend/lib/aiLayer/brain/console/view'),
        ]);
        let team: string | null = null;
        if (skillGroupId) {
            const sg = await supabaseAdmin.from('skill_groups').select('code').eq('id', skillGroupId).maybeSingle();
            team = typeof sg.data?.code === 'string' ? sg.data.code : null;
        }
        const setting = await learningSetting(orgId, supabaseAdmin);
        await saveExample({
            orgId, propertyId: typeof t.property_id === 'string' ? t.property_id : null, ticketId: String(t.id),
            text: maskIdentity(ticketText(t), 1000) ?? '', code,
            team: (['technical', 'plumbing', 'vendor', 'soft_services'].includes(String(team)) ? team : null) as never,
            source: 'override',
        }, { admin: supabaseAdmin, meaning: setting.meaning });
    } catch (err) {
        console.warn('[Override] not kept as a learning example:', err instanceof Error ? err.message : err);
    }
}
