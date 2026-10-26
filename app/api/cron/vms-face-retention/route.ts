import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { deleteFaceProfile } from '@/backend/lib/vms-face/face';

/**
 * Daily: delete VMS Face (testing) faces not seen for 12 months — from BioFRQ and our table,
 * each deletion logged in vms_face_deletions. Unused OTP challenges older than 30 days are
 * also removed; ones spent on an enrollment stay, as the consent record points at them.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH = 200;

export async function GET(request: NextRequest) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 12);

    const { data: expired, error } = await supabaseAdmin
        .from('vms_face_profiles')
        .select('id, organization_id')
        .lt('last_seen_at', cutoff.toISOString())
        .limit(BATCH);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let deleted = 0;
    const failed: string[] = [];
    for (const p of expired || []) {
        const res = await deleteFaceProfile(p.id, p.organization_id, 'retention_12_months', null);
        if (res.ok) deleted++;
        else failed.push(`${p.id}: ${res.error}`);
    }

    // Unused OTP challenges (never spent on an enrollment, so no consent row points at them).
    const { error: otpError } = await supabaseAdmin
        .from('vms_face_otp_challenges')
        .delete()
        .is('consumed_at', null)
        .lt('created_at', new Date(Date.now() - 30 * 86400_000).toISOString());

    return NextResponse.json({
        checked: expired?.length || 0,
        deleted,
        failed,
        more_pending: (expired?.length || 0) === BATCH,
        otp_cleanup_error: otpError?.message || null,
    });
}
