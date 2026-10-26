/**
 * VMS Face (testing) — WhatsApp OTP that proves a first-time visitor's consent.
 * The visitor reads the code out; reception types it. Only a hash of the code is stored.
 *
 * Until the WhatsApp authentication template is approved, delivery is 'screen_test': the code is
 * returned to the Tech screen instead of sent, and the consent row is flagged is_test_delivery.
 */
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { AiSensyService } from '@/backend/services/AiSensyService';

const OTP_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;
const RESEND_GAP_MS = 30_000;

const hashOtp = (challengeId: string, code: string) =>
    createHash('sha256').update(`${challengeId}:${code}`).digest('hex');

type SendResult =
    | { ok: true; challengeId: string; delivery: 'screen_test' | 'whatsapp'; testCode?: string; expiresAt: string }
    | { ok: false; error: string; status: number };

export async function sendOtp(args: {
    organizationId: string;
    propertyId: string;
    mobile: string;
    userId: string;
    delivery: 'screen_test' | 'whatsapp';
}): Promise<SendResult> {
    const { data: last } = await supabaseAdmin
        .from('vms_face_otp_challenges')
        .select('created_at')
        .eq('mobile', args.mobile)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (last && Date.now() - new Date(last.created_at).getTime() < RESEND_GAP_MS) {
        return { ok: false, error: 'Please wait 30 seconds before sending another code.', status: 429 };
    }

    const campaign = process.env.VMS_FACE_OTP_CAMPAIGN;
    if (args.delivery === 'whatsapp' && !campaign) {
        return { ok: false, error: 'WhatsApp OTP template is not configured (VMS_FACE_OTP_CAMPAIGN).', status: 503 };
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const challengeId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

    const { error } = await supabaseAdmin.from('vms_face_otp_challenges').insert({
        id: challengeId,
        organization_id: args.organizationId,
        property_id: args.propertyId,
        mobile: args.mobile,
        otp_hash: hashOtp(challengeId, code),
        delivery: args.delivery,
        expires_at: expiresAt,
        created_by: args.userId,
    });
    if (error) return { ok: false, error: error.message, status: 500 };

    if (args.delivery === 'whatsapp') {
        const sent = await AiSensyService.sendTemplate({ phone: args.mobile, campaignName: campaign!, templateParams: [code] });
        if (!sent.success) {
            await supabaseAdmin.from('vms_face_otp_challenges').update({ expires_at: new Date().toISOString() }).eq('id', challengeId);
            return { ok: false, error: `WhatsApp send failed: ${sent.error || 'unknown error'}`, status: 502 };
        }
        return { ok: true, challengeId, delivery: 'whatsapp', expiresAt };
    }
    return { ok: true, challengeId, delivery: 'screen_test', testCode: code, expiresAt };
}

type VerifyResult = { ok: true } | { ok: false; error: string; attemptsLeft?: number };

export async function verifyOtp(challengeId: string, propertyId: string, code: string): Promise<VerifyResult> {
    const { data: ch } = await supabaseAdmin
        .from('vms_face_otp_challenges')
        .select('id, otp_hash, attempts, expires_at, verified_at')
        .eq('id', challengeId)
        .eq('property_id', propertyId)
        .maybeSingle();

    if (!ch) return { ok: false, error: 'Code not found. Send a new one.' };
    if (ch.verified_at) return { ok: true };
    if (new Date(ch.expires_at).getTime() < Date.now()) return { ok: false, error: 'Code expired. Send a new one.' };
    if (ch.attempts >= MAX_ATTEMPTS) return { ok: false, error: 'Too many wrong attempts. Send a new code.' };

    const given = Buffer.from(hashOtp(ch.id, String(code || '').trim()));
    const match = given.length === ch.otp_hash.length && timingSafeEqual(given, Buffer.from(ch.otp_hash));

    if (!match) {
        const attempts = ch.attempts + 1;
        await supabaseAdmin.from('vms_face_otp_challenges').update({ attempts }).eq('id', ch.id);
        return { ok: false, error: 'Wrong code.', attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts) };
    }

    await supabaseAdmin.from('vms_face_otp_challenges').update({ verified_at: new Date().toISOString() }).eq('id', ch.id);
    return { ok: true };
}

/** Claim a verified, unexpired, unused challenge for one enrollment. Returns it, or null. */
export async function consumeVerifiedOtp(challengeId: string, propertyId: string) {
    const { data } = await supabaseAdmin
        .from('vms_face_otp_challenges')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', challengeId)
        .eq('property_id', propertyId)
        .not('verified_at', 'is', null)
        .is('consumed_at', null)
        .gte('verified_at', new Date(Date.now() - 30 * 60_000).toISOString())
        .select('id, mobile, delivery')
        .maybeSingle();
    return data as { id: string; mobile: string; delivery: 'screen_test' | 'whatsapp' } | null;
}

/** Give a claimed challenge back if enrollment failed, so reception can retry without a new OTP. */
export async function releaseOtp(challengeId: string) {
    await supabaseAdmin.from('vms_face_otp_challenges').update({ consumed_at: null }).eq('id', challengeId);
}
