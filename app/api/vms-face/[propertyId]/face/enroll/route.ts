import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { CONSENT_TEXT, CONSENT_TEXT_VERSION, getProperty, getSettings, getUser, isValidImage } from '@/backend/lib/vms-face/context';
import { enrollVisitor, findProfileByMobile } from '@/backend/lib/vms-face/face';
import { consumeVerifiedOtp, releaseOtp } from '@/backend/lib/vms-face/otp';
import { isBioFrqConfigured } from '@/backend/services/BioFrqService';

/**
 * POST /api/vms-face/[propertyId]/face/enroll  { challenge_id, image, name, coming_from }
 * Store a first-time visitor's face — only after their WhatsApp OTP was verified (their consent).
 * The mobile comes from the verified OTP, never from the request.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ propertyId: string }> }) {
    const { propertyId } = await params;
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const property = await getProperty(propertyId);
    if (!property) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

    const settings = await getSettings(property.organization_id);
    if (!settings.face_recognition_enabled || !isBioFrqConfigured()) {
        return NextResponse.json({ error: 'Face recognition is switched off' }, { status: 409 });
    }

    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    if (!name) return NextResponse.json({ error: 'Visitor name is required' }, { status: 400 });
    if (!isValidImage(body.image)) return NextResponse.json({ error: 'A JPEG or PNG photo is required' }, { status: 400 });
    if (!body.challenge_id) return NextResponse.json({ error: 'Verified OTP is required for consent' }, { status: 400 });

    const otp = await consumeVerifiedOtp(String(body.challenge_id), propertyId);
    if (!otp) return NextResponse.json({ error: 'OTP not verified, expired or already used' }, { status: 400 });

    // One saved face per mobile: a returning visitor is verified against it, never enrolled twice.
    if (await findProfileByMobile(property.organization_id, otp.mobile)) {
        await releaseOtp(otp.id);
        return NextResponse.json({ error: 'This mobile already has a saved face. Use the returning-visitor scan.' }, { status: 409 });
    }

    const outcome = await enrollVisitor({
        organizationId: property.organization_id,
        propertyId,
        image: body.image,
        name,
        mobile: otp.mobile,
        comingFrom: String(body.coming_from || '').trim() || null,
        userId: user.id,
        threshold: settings.match_threshold,
    });

    if (outcome.status !== 'enrolled' && outcome.status !== 'already_enrolled') {
        await releaseOtp(otp.id);
        const message = outcome.status === 'no_face' ? 'No face found in the photo. Retake it.'
            : outcome.status === 'multiple_faces' ? 'More than one face in the photo. Retake it with only the visitor.'
            : 'Face service unavailable. Check in manually.';
        if (outcome.status === 'unavailable') console.error('[VMS Face] enroll unavailable:', outcome.code, outcome.message);
        return NextResponse.json({ error: message, status: outcome.status }, { status: outcome.status === 'unavailable' ? 503 : 400 });
    }

    const { error: consentError } = await supabaseAdmin.from('vms_face_consents').insert({
        organization_id: property.organization_id,
        face_profile_id: outcome.profile.id,
        mobile: otp.mobile,
        consent_text_version: CONSENT_TEXT_VERSION,
        consent_text: CONSENT_TEXT,
        otp_challenge_id: otp.id,
        is_test_delivery: otp.delivery === 'screen_test',
        captured_by: user.id,
    });
    if (consentError) console.error('[VMS Face] consent record failed:', consentError);

    return NextResponse.json({ status: outcome.status, profile: outcome.profile });
}
