import { NextRequest, NextResponse } from 'next/server';
import { getProperty, getSettings, getUser, normaliseMobile } from '@/backend/lib/vms-face/context';
import { findProfileByMobile } from '@/backend/lib/vms-face/face';
import { isBioFrqConfigured } from '@/backend/services/BioFrqService';

/**
 * POST /api/vms-face/[propertyId]/face/lookup  { mobile }
 * Step 1 of check-in, before any photo: does this mobile have a saved face (consent on file)?
 *   → { status: 'returning' }  scan the face and compare with that one saved face
 *   → { status: 'new' }        ask for consent (OTP) first, photo after
 *   → { status: 'disabled' }   face recognition off; manual check-in
 * No visitor details are returned here: they are only filled in after the face matches.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ propertyId: string }> }) {
    const { propertyId } = await params;
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const property = await getProperty(propertyId);
    if (!property) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const mobile = normaliseMobile(body.mobile);
    if (!mobile) return NextResponse.json({ error: 'Enter a valid 10-digit Indian mobile number' }, { status: 400 });

    const settings = await getSettings(property.organization_id);
    if (!settings.face_recognition_enabled || !isBioFrqConfigured()) return NextResponse.json({ status: 'disabled' });

    const profile = await findProfileByMobile(property.organization_id, mobile);
    return NextResponse.json({ status: profile ? 'returning' : 'new' });
}
