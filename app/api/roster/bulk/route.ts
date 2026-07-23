import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { propertyId, assignments } = body;

        if (!propertyId || !Array.isArray(assignments)) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        // Prepare records for upsert
        const upsertData = assignments.map((a: any) => ({
            property_id: propertyId,
            user_id: a.user_id,
            roster_date: a.roster_date,
            shift_id: a.shift_id,
            is_reliever: a.is_reliever || false,
            relieving_user_id: a.relieving_user_id || null,
            updated_by: user.id,
            updated_at: new Date().toISOString()
        }));

        // Fetch existing records to determine what changed for the audit log
        const dateList = Array.from(new Set(assignments.map((a: any) => a.roster_date)));
        const userList = Array.from(new Set(assignments.map((a: any) => a.user_id)));

        const { data: existingRecords } = await supabase
            .from('staff_rosters')
            .select('user_id, roster_date, shift_id')
            .eq('property_id', propertyId)
            .in('roster_date', dateList)
            .in('user_id', userList);

        // Upsert into staff_rosters
        const { data, error } = await supabase
            .from('staff_rosters')
            .upsert(upsertData, { 
                onConflict: 'property_id,user_id,roster_date',
                ignoreDuplicates: false 
            })
            .select('*');

        if (error) {
            console.error('[POST /api/roster/bulk] Upsert error:', error);
            return NextResponse.json({ error: 'Failed to save roster assignments' }, { status: 500 });
        }

        // Prepare and insert audit logs
        const auditLogs = assignments.map((a: any) => {
            const existing = existingRecords?.find(r => r.user_id === a.user_id && r.roster_date === a.roster_date);
            const oldShiftId = existing ? existing.shift_id : null;
            const action = !existing ? 'CREATED' : (oldShiftId !== a.shift_id ? 'UPDATED' : 'MODIFIED_RELIEVER');
            
            return {
                property_id: propertyId,
                user_id: a.user_id,
                roster_date: a.roster_date,
                old_shift_id: oldShiftId,
                new_shift_id: a.shift_id,
                changed_by: user.id,
                action: action
            };
        });

        // Only log changes where shift actually changed or was created
        const meaningfulLogs = auditLogs.filter(log => log.action === 'CREATED' || log.action === 'UPDATED');

        if (meaningfulLogs.length > 0) {
            const { error: auditError } = await supabase
                .from('roster_audit_logs')
                .insert(meaningfulLogs);
                
            if (auditError) {
                console.error('[POST /api/roster/bulk] Audit log error:', auditError);
                // We don't fail the request if audit logging fails, but we log it.
            }
        }

        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error('[POST /api/roster/bulk] API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
