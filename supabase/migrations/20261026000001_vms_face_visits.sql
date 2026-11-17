-- ============================================================================
-- VMS FACE (TESTING) — visit log for the Tech Team's face-verification VMS.
-- ----------------------------------------------------------------------------
-- WHY
--   The Tech Team is trialling a fresh VMS module with BioFRQ face verification
--   (docs/VMS_BIOFRQ_PLAN.md). It is fully separate from the live VMS: test visits
--   live here, never in visitor_logs, so nothing shows up in the existing dashboards,
--   kiosk, notifications or outbox triggers.
--
-- STEP 1 (this file): the visit log only. Face profiles, consent records and OTP
--   challenges come in step 2, in their own migration.
--
-- ACCESS: RLS on, no policies. Reads and writes go through app/api/vms-face/** on
--   the service role.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vms_face_visits (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    property_id      UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    -- Human-readable ID shown to reception, e.g. FV-WS01-48213. Unique per property.
    visitor_code     TEXT NOT NULL,
    category         TEXT NOT NULL DEFAULT 'visitor' CHECK (category IN ('visitor','vendor','other')),
    name             TEXT NOT NULL,
    mobile           TEXT,
    coming_from      TEXT,
    -- Picked fresh on every visit; never pre-filled from a face match.
    purpose          TEXT CHECK (purpose IS NULL OR purpose IN ('meeting','interview','delivery','vendor_work','personal','other')),
    whom_to_meet     TEXT NOT NULL DEFAULT 'General Visit',
    host_id          UUID REFERENCES public.users(id) ON DELETE SET NULL,
    photo_url        TEXT,
    status           TEXT NOT NULL DEFAULT 'checked_in' CHECK (status IN ('checked_in','checked_out')),
    approval_status  TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
    checkin_time     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checkout_time    TIMESTAMPTZ,
    created_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (property_id, visitor_code)
);

CREATE INDEX IF NOT EXISTS idx_vms_face_visits_property_checkin
    ON public.vms_face_visits (property_id, checkin_time DESC);

ALTER TABLE public.vms_face_visits ENABLE ROW LEVEL SECURITY;
