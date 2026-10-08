import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess,isPettyCashAccessError,readOrgId } from '@/backend/lib/pettyCash/access';
export async function GET(request: NextRequest) {
    const access=await resolvePettyCashAccess(request,readOrgId(request));if(isPettyCashAccessError(access))return access;
    if(!access.canManageRouting)return NextResponse.json({error:'Forbidden'},{status:403});
    const {data,error}=await supabaseAdmin.from('petty_cash_notification_deliveries').select('id,channel,status,attempt_count,last_error,created_at').eq('organization_id',access.organizationId).order('created_at',{ascending:false}).limit(30);
    if(error)return NextResponse.json({error:'Petty Cash notification migration must be applied to show delivery status.'},{status:503});
    return NextResponse.json({deliveries:data});
}
