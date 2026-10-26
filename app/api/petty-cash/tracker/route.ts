import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { pcError } from '@/backend/lib/pettyCash/api';
interface ReportRow {assigned_allocator_id?:string;assigned_approver_id?:string;assigned_allocator_name?:string;assigned_approver_name?:string}
export async function GET(request: NextRequest) {
    const access = await resolvePettyCashAccess(request, readOrgId(request));
    if (isPettyCashAccessError(access)) return access;
    const { data, error } = await supabaseAdmin.rpc('pc_report', { actor: access.user.id, org: access.organizationId });
    if(error) return pcError(error);
    const rows:ReportRow[] = Array.isArray(data?.rows) ? data.rows : [];
    const actorIds = [...new Set<string>(rows.flatMap(row => [!row.assigned_allocator_name&&row.assigned_allocator_id,!row.assigned_approver_name&&row.assigned_approver_id]).filter((id:unknown):id is string => typeof id==='string' && !!id))];
    const names = new Map<string,string>();
    for(let offset=0;offset<actorIds.length;offset+=200){
        const {data: users,error: userError} = await supabaseAdmin.from('users').select('id,full_name').in('id',actorIds.slice(offset,offset+200));
        if(userError) return pcError(userError);
        for(const user of users || []) names.set(user.id,user.full_name || 'Unnamed user');
    }
    return NextResponse.json({...data,rows:rows.map(row=>({...row,assigned_allocator_name:row.assigned_allocator_name || (row.assigned_allocator_id?names.get(row.assigned_allocator_id):null),assigned_approver_name:row.assigned_approver_name || (row.assigned_approver_id?names.get(row.assigned_approver_id):null)}))});
}
