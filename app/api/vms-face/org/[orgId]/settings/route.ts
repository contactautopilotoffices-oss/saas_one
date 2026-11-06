import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { getSettings, getUser } from '@/backend/lib/vms-face/context';
import { isHostCallConfigured } from '@/backend/lib/vms-face/hostCall';
import { isBioFrqConfigured } from '@/backend/services/BioFrqService';

/**
 * GET/PUT /api/vms-face/org/[orgId]/settings — the VMS Face (testing) switches for one organisation,
 * plus which integrations are configured on the server (so the UI can explain a disabled feature).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
    const { orgId } = await params;
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    return NextResponse.json({
        settings: await getSettings(orgId),
        configured: {
            biofrq: isBioFrqConfigured(),
            whatsapp_otp: !!process.env.VMS_FACE_OTP_CAMPAIGN,
            host_call: isHostCallConfigured(),
            host_whatsapp: !!process.env.VMS_FACE_HOST_WA_CAMPAIGN,
        },
    });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
    const { orgId } = await params;
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    for (const key of ['face_recognition_enabled', 'liveness_enabled', 'host_call_enabled'] as const) {
        if (typeof body[key] === 'boolean') patch[key] = body[key];
    }
    if (body.otp_delivery === 'screen_test' || body.otp_delivery === 'whatsapp') patch.otp_delivery = body.otp_delivery;
    if (body.match_threshold !== undefined) {
        const t = Number(body.match_threshold);
        if (!Number.isFinite(t) || t < 0.3 || t > 0.99) {
            return NextResponse.json({ error: 'Match threshold must be between 0.30 and 0.99' }, { status: 400 });
        }
        patch.match_threshold = t;
    }

    const { error } = await supabaseAdmin.from('vms_face_settings').upsert({
        ...(await getSettings(orgId)),
        ...patch,
        organization_id: orgId,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ settings: await getSettings(orgId) });
}
