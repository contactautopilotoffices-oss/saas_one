import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * GET /api/ppm/activity-logs?organization_id=...&property_id=...&limit=50
 * Fetch audit/activity logs for PPM schedules (creations, updates, deletions).
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = request.nextUrl;
        const organizationId = searchParams.get('organization_id');
        const propertyId = searchParams.get('property_id');
        const limitParam = parseInt(searchParams.get('limit') || '50', 10);
        const limit = Math.min(Math.max(1, limitParam), 200);

        if (!organizationId && !propertyId) {
            return NextResponse.json({ error: 'organization_id or property_id is required' }, { status: 400 });
        }

        let query = supabaseAdmin
            .from('audit_logs')
            .select('*')
            .eq('object_type', 'ppm_schedule')
            .order('event_at', { ascending: false })
            .limit(limit);

        if (propertyId) {
            query = query.filter('payload->>property_id', 'eq', propertyId);
        } else if (organizationId) {
            query = query.filter('payload->>organization_id', 'eq', organizationId);
        }

        const { data: rawLogs, error } = await query;
        if (error) {
            console.error('[PPM Activity Logs] fetch error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Format activity logs for easy display
        const logs = (rawLogs || []).map(item => {
            const payload = item.payload || {};
            const actorName = payload.created_by_name ||
                payload.updated_by_name ||
                payload.deleted_by_name ||
                'Team Member';

            let actionType = 'updated';
            if (item.action.endsWith('.created')) actionType = 'created';
            else if (item.action.endsWith('.deleted')) actionType = 'deleted';

            return {
                id: item.id,
                action: actionType,
                raw_action: item.action,
                event_at: item.event_at,
                event_by: item.event_by,
                actor_name: actorName,
                system_name: payload.system_name || payload.task_snapshot?.system_name || 'PPM Task',
                detail_name: payload.detail_name || payload.task_snapshot?.detail_name || null,
                planned_date: payload.planned_date || payload.task_snapshot?.planned_date || null,
                details: payload.details || (actionType === 'deleted' ? 'Task deleted from schedule' : actionType === 'created' ? 'Task added to schedule' : 'Task updated'),
                changes: payload.changes || null,
                task_snapshot: payload.task_snapshot || null,
            };
        });

        return NextResponse.json({ success: true, logs });
    } catch (err: any) {
        console.error('[PPM Activity Logs] Error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
