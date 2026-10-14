import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import type { PettyCashAccess } from './access';
import { randomUUID } from 'crypto';

export async function applyPettyCashAction(access: PettyCashAccess, id: string, action: string, body: Record<string, unknown>) {
    const payload: Record<string, unknown> = { ...body, organization_id: access.organizationId };

    if (action === 'pay') {
        const docs = Array.isArray(payload.documents) ? payload.documents : [];
        if (docs.length === 0) {
            const voucherId = randomUUID();
            await supabaseAdmin.from('petty_cash_uploads').insert({
                id: voucherId,
                organization_id: access.organizationId,
                uploaded_by: access.user.id,
                storage_path: `${access.organizationId}/${access.user.id}/disbursement_voucher.txt`,
                file_name: `Disbursement Voucher (${body.paid_mode || 'Cash'})`,
                file_type: 'text/plain'
            });
            payload.documents = [{ upload_id: voucherId, file_name: `Disbursement Voucher (${body.paid_mode || 'Cash'})` }];
        }
    }

    const { data, error } = await supabaseAdmin.rpc('pc_action', {
        actor: access.user.id,
        rid: id,
        action,
        body: payload
    });
    return { data, error };
}
