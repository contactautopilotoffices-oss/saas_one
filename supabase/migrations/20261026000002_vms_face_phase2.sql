-- ============================================================================
-- VMS FACE (TESTING) — phases 2–5: face profiles, WhatsApp-OTP consent, host voice
-- call, retention. Tech Team module only; see docs/VMS_BIOFRQ_PLAN.md.
-- ----------------------------------------------------------------------------
-- WHAT IS STORED WHERE
--   BioFRQ holds the face template. We hold only BioFRQ's subjectId, our own random
--   external_id (never a name or phone) and the visitor's fixed details.
--   Consent is proven by a WhatsApp OTP the visitor reads out to reception.
--   Faces are deleted 12 months after the last visit; every deletion is logged.
--
-- ACCESS: RLS on, no policies, like vms_face_visits. Everything goes through
--   app/api/vms-face/** on the service role.
-- ============================================================================

-- Per-organisation switches. No row = defaults below.
CREATE TABLE IF NOT EXISTS public.vms_face_settings (
    organization_id            UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    face_recognition_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    liveness_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
    -- BioFRQ identify threshold (0–1). Below it, a face counts as "no match".
    match_threshold            NUMERIC(4,3) NOT NULL DEFAULT 0.600 CHECK (match_threshold > 0 AND match_threshold <= 1),
    -- 'screen_test' shows the OTP on the Tech screen until the WhatsApp template is approved.
    otp_delivery               TEXT NOT NULL DEFAULT 'screen_test' CHECK (otp_delivery IN ('screen_test','whatsapp')),
    -- Bolna voice call to the host on check-in. Off by default: it rings a real phone.
    host_call_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by                 UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per consenting visitor whose face is enrolled in BioFRQ.
CREATE TABLE IF NOT EXISTS public.vms_face_profiles (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id    UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    first_property_id  UUID REFERENCES public.properties(id) ON DELETE SET NULL,
    biofrq_subject_id  TEXT NOT NULL UNIQUE,
    -- Random UUID sent to BioFRQ as externalId. Never a name or phone.
    external_id        UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    -- Fixed details only. Purpose and host are picked fresh on every visit.
    name               TEXT NOT NULL,
    mobile             TEXT NOT NULL,
    coming_from        TEXT,
    last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vms_face_profiles_org_last_seen
    ON public.vms_face_profiles (organization_id, last_seen_at);

-- One OTP sent to a visitor's mobile. Only a hash of the code is kept.
CREATE TABLE IF NOT EXISTS public.vms_face_otp_challenges (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    property_id      UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    mobile           TEXT NOT NULL,
    otp_hash         TEXT NOT NULL,
    delivery         TEXT NOT NULL CHECK (delivery IN ('screen_test','whatsapp')),
    attempts         INTEGER NOT NULL DEFAULT 0,
    expires_at       TIMESTAMPTZ NOT NULL,
    verified_at      TIMESTAMPTZ,
    -- Set once the verified OTP has been spent on an enrollment, so it cannot be reused.
    consumed_at      TIMESTAMPTZ,
    created_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vms_face_otp_mobile_created
    ON public.vms_face_otp_challenges (mobile, created_at DESC);

-- Proof of consent. Kept after the face is deleted (profile link set to null).
CREATE TABLE IF NOT EXISTS public.vms_face_consents (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    face_profile_id       UUID REFERENCES public.vms_face_profiles(id) ON DELETE SET NULL,
    mobile                TEXT NOT NULL,
    consent_text_version  TEXT NOT NULL,
    consent_text          TEXT NOT NULL,
    otp_challenge_id      UUID NOT NULL REFERENCES public.vms_face_otp_challenges(id),
    -- True when the OTP was shown on screen (template not yet approved), not sent by WhatsApp.
    is_test_delivery      BOOLEAN NOT NULL DEFAULT FALSE,
    captured_by           UUID REFERENCES public.users(id) ON DELETE SET NULL,
    consented_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit log of every face deletion (BioFRQ returns a deletionId).
CREATE TABLE IF NOT EXISTS public.vms_face_deletions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    face_profile_id     UUID,
    biofrq_subject_id   TEXT NOT NULL,
    biofrq_deletion_id  TEXT,
    reason              TEXT NOT NULL CHECK (reason IN ('retention_12_months','visitor_request','admin')),
    deleted_by          UUID REFERENCES public.users(id) ON DELETE SET NULL,
    deleted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Visit ↔ face, and the host voice-call state.
ALTER TABLE public.vms_face_visits
    ADD COLUMN IF NOT EXISTS face_profile_id         UUID REFERENCES public.vms_face_profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS face_match_score        NUMERIC(5,4),
    ADD COLUMN IF NOT EXISTS approved_via            TEXT CHECK (approved_via IS NULL OR approved_via IN ('auto','reception','voice_call')),
    ADD COLUMN IF NOT EXISTS host_call_status        TEXT NOT NULL DEFAULT 'not_started'
        CHECK (host_call_status IN ('not_started','calling','answered','no_answer','failed','skipped')),
    ADD COLUMN IF NOT EXISTS host_call_attempts      INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS host_call_execution_id  TEXT,
    ADD COLUMN IF NOT EXISTS host_call_updated_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS host_call_transcript    TEXT,
    ADD COLUMN IF NOT EXISTS host_whatsapp_sent_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_vms_face_visits_profile_open
    ON public.vms_face_visits (face_profile_id, status);
CREATE INDEX IF NOT EXISTS idx_vms_face_visits_call_exec
    ON public.vms_face_visits (host_call_execution_id);

ALTER TABLE public.vms_face_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vms_face_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vms_face_otp_challenges  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vms_face_consents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vms_face_deletions       ENABLE ROW LEVEL SECURITY;
