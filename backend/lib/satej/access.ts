/**
 * Who may use Satej, for the /api/satej routes.
 *
 * The same rule as the procurement catalogue (backend/lib/procurement/catalogAccess.ts):
 * an active membership of the organisation with the procurement, org super
 * admin or master admin role. The organisation id comes from the caller and is
 * only trusted after that membership check — never on its own.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { isProcurementUser } from '@/backend/lib/procurement/catalogAccess';
import { isValidUuid } from '@/backend/lib/utils';

export interface SatejCaller {
    userId: string;
    name: string;
}

export async function requireSatejCaller(organizationId: string | null | undefined): Promise<SatejCaller | NextResponse> {
    if (!organizationId || !isValidUuid(organizationId)) {
        return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
    }
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!(await isProcurementUser(user.id, organizationId))) {
        return NextResponse.json({ error: 'Satej is available to the procurement team and org super admins.' }, { status: 403 });
    }
    const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string };
    return { userId: user.id, name: meta.full_name || meta.name || user.email || 'Team member' };
}
