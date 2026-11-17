/**
 * VMS Face (testing) — shared request context, settings and consent text.
 * Tech Team module only; see docs/VMS_BIOFRQ_PLAN.md.
 */
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export interface VmsFaceSettings {
    face_recognition_enabled: boolean;
    liveness_enabled: boolean;
    match_threshold: number;
    otp_delivery: 'screen_test' | 'whatsapp';
    host_call_enabled: boolean;
}

export const DEFAULT_SETTINGS: VmsFaceSettings = {
    face_recognition_enabled: true,
    liveness_enabled: false,
    match_threshold: 0.6,
    otp_delivery: 'screen_test',
    host_call_enabled: false,
};

/** Bump the version whenever the wording changes; each consent row stores the version it was given under. */
export const CONSENT_TEXT_VERSION = 'v1-2026-10-26';
export const CONSENT_TEXT =
    'Sharing this code means you agree to Autopilot storing your face image to speed up your future visits. ' +
    'It is deleted after 12 months without a visit, or earlier on request.';

/** Largest base64 image accepted from the browser (~1.5 MB of JPEG). */
export const MAX_IMAGE_BASE64_LENGTH = 2_000_000;

export async function getUser() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

export async function getProperty(propertyId: string) {
    const { data } = await supabaseAdmin
        .from('properties')
        .select('id, organization_id, code, name')
        .eq('id', propertyId)
        .maybeSingle();
    return data as { id: string; organization_id: string; code: string | null; name: string | null } | null;
}

export async function getSettings(organizationId: string): Promise<VmsFaceSettings> {
    const { data } = await supabaseAdmin
        .from('vms_face_settings')
        .select('face_recognition_enabled, liveness_enabled, match_threshold, otp_delivery, host_call_enabled')
        .eq('organization_id', organizationId)
        .maybeSingle();
    if (!data) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...data, match_threshold: Number(data.match_threshold) };
}

/** +91XXXXXXXXXX for a 10-digit Indian mobile (with or without +91 / 91 / 0), else null. */
export function normaliseMobile(raw: unknown): string | null {
    let digits = String(raw || '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

export function isValidImage(image: unknown): image is string {
    return typeof image === 'string'
        && image.length > 100
        && image.length <= MAX_IMAGE_BASE64_LENGTH
        && /^data:image\/(jpeg|jpg|png);base64,/.test(image);
}
