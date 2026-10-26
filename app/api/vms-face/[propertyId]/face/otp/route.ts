import { NextRequest, NextResponse } from 'next/server';
import { CONSENT_TEXT, getProperty, getSettings, getUser, normaliseMobile } from '@/backend/lib/vms-face/context';
import { sendOtp, verifyOtp } from '@/backend/lib/vms-face/otp';

/**
 * POST /api/vms-face/[propertyId]/face/otp
 *   { action: 'send', mobile }                 → { challenge_id, delivery, test_code? }
 *   { action: 'verify', challenge_id, code }   → { verified: true }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ propertyId: string }> }) {
    const { propertyId } = await params;
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const property = await getProperty(propertyId);
    if (!property) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));

    if (body.action === 'send') {
        const mobile = normaliseMobile(body.mobile);
        if (!mobile) return NextResponse.json({ error: 'Enter a valid 10-digit Indian mobile number' }, { status: 400 });

        const settings = await getSettings(property.organization_id);
        const res = await sendOtp({
            organizationId: property.organization_id,
            propertyId,
            mobile,
            userId: user.id,
            delivery: settings.otp_delivery,
        });
        if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
        return NextResponse.json({
            challenge_id: res.challengeId,
            delivery: res.delivery,
            test_code: res.testCode,
            expires_at: res.expiresAt,
            consent_text: CONSENT_TEXT,
        });
    }

    if (body.action === 'verify') {
        if (!body.challenge_id || !body.code) return NextResponse.json({ error: 'challenge_id and code are required' }, { status: 400 });
        const res = await verifyOtp(String(body.challenge_id), propertyId, String(body.code));
        if (!res.ok) return NextResponse.json({ error: res.error, attempts_left: res.attemptsLeft }, { status: 400 });
        return NextResponse.json({ verified: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
