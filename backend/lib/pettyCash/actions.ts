import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import type { PettyCashAccess } from './access';
export async function applyPettyCashAction(access: PettyCashAccess, id: string, action: string, body: Record<string, unknown>) {
    const { data, error } = await supabaseAdmin.rpc('pc_action', { actor: access.user.id, rid: id, action, body: { ...body, organization_id: access.organizationId } });
    return { data, error };
}
