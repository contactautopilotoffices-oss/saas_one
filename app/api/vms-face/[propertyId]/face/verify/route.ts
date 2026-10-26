import { NextRequest, NextResponse } from 'next/server';
import { getProperty, getSettings, getUser, isValidImage, normaliseMobile } from '@/backend/lib/vms-face/context';
import { verifyVisitor } from '@/backend/lib/vms-face/face';
import { isBioFrqConfigured } from '@/backend/services/BioFrqService';

/**
 * POST /api/vms-face/[propertyId]/face/verify  { image: data:image/jpeg;base64,..., mobile? }
 * Returning visitor (they said they have visited before, so consent is on file). Without a mobile,
 * searches this organisation's saved faces; with one, compares with that mobile's face only.
 * On a match, returns the fixed details for pre-fill (purpose and host stay empty).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ propertyId: string }> }) {
    const { propertyId } = await params;
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const property = await getProperty(propertyId);
    if (!property) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

    const settings = await getSettings(property.organization_id);
    if (!settings.face_recognition_enabled || !isBioFrqConfigured()) return NextResponse.json({ status: 'disabled' });

    const body = await request.json().catch(() => ({}));
    const mobile = body.mobile ? normaliseMobile(body.mobile) : null;
    if (body.mobile && !mobile) return NextResponse.json({ error: 'Enter a valid 10-digit Indian mobile number' }, { status: 400 });
    if (!isValidImage(body.image)) return NextResponse.json({ error: 'A JPEG or PNG photo is required' }, { status: 400 });

    const outcome = await verifyVisitor(property.organization_id, body.image, settings, mobile);
    if (outcome.status === 'unavailable') console.error('[VMS Face] verify unavailable:', outcome.code, outcome.message);
    return NextResponse.json(outcome);
}
