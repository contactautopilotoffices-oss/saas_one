/**
 * VMS Face (testing) — verify, enroll and delete visitor faces with BioFRQ.
 * Consent comes first: a face is only ever compared with the saved face of the visitor whose mobile
 * reception typed (1:1), and a new face is only sent to BioFRQ after the visitor's OTP consent.
 * Never throws; every failure comes back as a status the UI can fall back from.
 */
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import * as BioFrq from '@/backend/services/BioFrqService';
import type { VmsFaceSettings } from './context';

export interface FaceProfile {
    id: string;
    name: string;
    mobile: string;
    coming_from: string | null;
}

export type VerifyOutcome =
    | { status: 'match'; profile: FaceProfile; score: number }
    | { status: 'no_match' }
    | { status: 'no_profile' }
    | { status: 'spoof'; reasons: string[] }
    | { status: 'no_face' }
    | { status: 'unavailable'; code: string; message: string };

const PROFILE_FIELDS = 'id, name, mobile, coming_from';

function unavailable(res: { code: string; message: string }): VerifyOutcome {
    if (res.code === 'NO_FACE_DETECTED' || res.code === 'INVALID_REQUEST') return { status: 'no_face' };
    return { status: 'unavailable', code: res.code, message: res.message };
}

/** The saved (consented) face profile for a mobile in this organisation, or null. */
export async function findProfileByMobile(organizationId: string, mobile: string) {
    const { data } = await supabaseAdmin
        .from('vms_face_profiles')
        .select(`${PROFILE_FIELDS}, biofrq_subject_id`)
        .eq('organization_id', organizationId)
        .eq('mobile', mobile)
        .order('last_seen_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    return data as (FaceProfile & { biofrq_subject_id: string }) | null;
}

/**
 * Recognise a returning visitor. Only used after the visitor says they have visited before (their
 * consent is on file); new visitors give consent before any photo is taken.
 *   - with a mobile: 1:1 — compare with the one face saved for that mobile;
 *   - without: search this organisation's saved faces (all of them consented).
 * Liveness first when switched on.
 */
export async function verifyVisitor(organizationId: string, image: string, settings: VmsFaceSettings, mobile?: string | null): Promise<VerifyOutcome> {
    let subjectIds: string[] | undefined;
    if (mobile) {
        const saved = await findProfileByMobile(organizationId, mobile);
        if (!saved) return { status: 'no_profile' };
        subjectIds = [saved.biofrq_subject_id];
    }

    if (settings.liveness_enabled) {
        const live = await BioFrq.liveness(image);
        if (!live.ok) return unavailable(live);
        if (live.value.verdict === 'spoof') return { status: 'spoof', reasons: live.value.reasons || [] };
    }

    const res = await BioFrq.identify(organizationId, image, settings.match_threshold, subjectIds);
    if (!res.ok) return unavailable(res);
    if (!res.value || (subjectIds && !subjectIds.includes(res.value.subjectId))) return { status: 'no_match' };

    const { data: profile } = await supabaseAdmin
        .from('vms_face_profiles')
        .select(PROFILE_FIELDS)
        .eq('organization_id', organizationId)
        .eq('biofrq_subject_id', res.value.subjectId)
        .maybeSingle();
    // A face in BioFRQ with no profile row (e.g. a half-finished delete) counts as not found.
    if (!profile) return { status: 'no_match' };
    return { status: 'match', profile, score: res.value.score };
}

export type EnrollOutcome =
    | { status: 'enrolled' | 'already_enrolled'; profile: FaceProfile }
    | { status: 'no_face' | 'multiple_faces' }
    | { status: 'unavailable'; code: string; message: string };

interface EnrollInput {
    organizationId: string;
    propertyId: string;
    image: string;
    name: string;
    mobile: string;
    comingFrom: string | null;
    userId: string;
    threshold: number;
}

/** Enroll a consenting visitor. If BioFRQ says the face is already in this org's gallery, reuse that profile. */
export async function enrollVisitor(input: EnrollInput): Promise<EnrollOutcome> {
    const externalId = crypto.randomUUID();
    let res = await BioFrq.enroll(input.organizationId, externalId, input.image);

    if (!res.ok && res.code === 'CONFLICT') {
        // Dedup gate: the face already exists. If it is ours, reuse it; if it belongs to another
        // organisation's group, enroll a separate subject for this organisation.
        const again = await BioFrq.identify(input.organizationId, input.image, input.threshold);
        if (again.ok && again.value) {
            const { data: existing } = await supabaseAdmin
                .from('vms_face_profiles')
                .update({ name: input.name, mobile: input.mobile, coming_from: input.comingFrom, last_seen_at: new Date().toISOString() })
                .eq('organization_id', input.organizationId)
                .eq('biofrq_subject_id', again.value.subjectId)
                .select(PROFILE_FIELDS)
                .maybeSingle();
            if (existing) return { status: 'already_enrolled', profile: existing };
        }
        res = await BioFrq.enroll(input.organizationId, externalId, input.image, true);
    }

    if (!res.ok) {
        if (res.code === 'NO_FACE_DETECTED' || res.code === 'INVALID_REQUEST') return { status: 'no_face' };
        if (res.code === 'MULTIPLE_FACES_DETECTED') return { status: 'multiple_faces' };
        return { status: 'unavailable', code: res.code, message: res.message };
    }

    const { data: profile, error } = await supabaseAdmin
        .from('vms_face_profiles')
        .insert({
            organization_id: input.organizationId,
            first_property_id: input.propertyId,
            biofrq_subject_id: res.value.subject.subjectId,
            external_id: externalId,
            name: input.name,
            mobile: input.mobile,
            coming_from: input.comingFrom,
            created_by: input.userId,
        })
        .select(PROFILE_FIELDS)
        .single();

    if (error || !profile) {
        // Don't leave an orphan face in BioFRQ that we have no record of.
        await BioFrq.deleteSubject(res.value.subject.subjectId);
        return { status: 'unavailable', code: 'DB_ERROR', message: error?.message || 'Could not save face profile' };
    }
    return { status: 'enrolled', profile };
}

export type DeleteReason = 'retention_12_months' | 'visitor_request' | 'admin';

/** Delete a face from BioFRQ and our table, and log it. A face BioFRQ no longer has still gets cleaned up locally. */
export async function deleteFaceProfile(profileId: string, organizationId: string, reason: DeleteReason, userId: string | null) {
    const { data: profile } = await supabaseAdmin
        .from('vms_face_profiles')
        .select('id, biofrq_subject_id')
        .eq('id', profileId)
        .eq('organization_id', organizationId)
        .maybeSingle();
    if (!profile) return { ok: false as const, error: 'Face profile not found' };

    const res = await BioFrq.deleteSubject(profile.biofrq_subject_id);
    if (!res.ok && res.code !== 'SUBJECT_NOT_FOUND') {
        return { ok: false as const, error: `BioFRQ delete failed (${res.code})` };
    }

    await supabaseAdmin.from('vms_face_deletions').insert({
        organization_id: organizationId,
        face_profile_id: profile.id,
        biofrq_subject_id: profile.biofrq_subject_id,
        biofrq_deletion_id: res.ok ? res.value.deletionId : null,
        reason,
        deleted_by: userId,
    });
    const { error } = await supabaseAdmin.from('vms_face_profiles').delete().eq('id', profile.id);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
}
