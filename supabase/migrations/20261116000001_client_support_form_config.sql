-- ============================================================================
-- Client Support (QR guest requests): per-property intake form configuration
-- and the fix for status updates failing from the dashboard.
--
-- Safe to paste whole into the Supabase SQL editor. Every statement is
-- idempotent, so re-running it changes nothing.
--
-- Covers three things:
--   1. property_ticket_form_configs  - which fields each property's QR form shows
--   2. guest_requests.form_data      - answers for fields with no dedicated column
--   3. guest_request_events INSERT policy - was missing in production, which is why
--      the status timeline never recorded "Mark In Progress"
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Per-property form configuration
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.property_ticket_form_configs (
    property_id UUID PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
    fields      JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  UUID REFERENCES public.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.property_ticket_form_configs IS
    'Which fields the public QR client-support form (/q/request) shows for a property. '
    'A property with no row here uses DEFAULT_GUEST_FORM_FIELDS from frontend/lib/guestTicketForm.ts.';
COMMENT ON COLUMN public.property_ticket_form_configs.fields IS
    'Ordered array of {key,label,type,enabled,required,placeholder?,options?}.';

ALTER TABLE public.property_ticket_form_configs ENABLE ROW LEVEL SECURITY;

-- Read: any active member of the property or of its organisation.
DROP POLICY IF EXISTS "ticket_form_config_select" ON public.property_ticket_form_configs;
CREATE POLICY "ticket_form_config_select"
ON public.property_ticket_form_configs FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.property_memberships pm
        WHERE pm.property_id = property_ticket_form_configs.property_id
          AND pm.user_id = auth.uid()
          AND pm.is_active = true
    )
    OR EXISTS (
        SELECT 1 FROM public.properties p
        JOIN public.organization_memberships om ON p.organization_id = om.organization_id
        WHERE p.id = property_ticket_form_configs.property_id
          AND om.user_id = auth.uid()
          AND om.is_active = true
    )
);

-- Writes go through /api/properties/[propertyId]/ticket-form-config, which guards the caller
-- and uses the service role. No client-side write policy is granted on purpose.


-- ---------------------------------------------------------------------------
-- 2. Answers for configured fields that have no dedicated column
--    (the "ID" field, and any custom field a property adds)
-- ---------------------------------------------------------------------------
ALTER TABLE public.guest_requests
    ADD COLUMN IF NOT EXISTS form_data JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.guest_requests.form_data IS
    'Answers to configured intake fields with no dedicated column, e.g. {"client_id":"E-1042"}.';


-- ---------------------------------------------------------------------------
-- 3. Status updates: let the timeline be written
--
--    Production has only a SELECT policy on guest_request_events
--    ("guest_events_select_clean"), so inserting a timeline row from the
--    dashboard was rejected by RLS. The dashboard now updates status through
--    /api/properties/[propertyId]/guest-requests/[requestId]/status (service
--    role), so this policy is not strictly required any more - but without it
--    any direct client-side insert stays broken, so restore it.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "guest_events_insert_clean" ON public.guest_request_events;
CREATE POLICY "guest_events_insert_clean"
ON public.guest_request_events FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM public.guest_requests gr
        WHERE gr.id = guest_request_events.guest_request_id
          AND (
              EXISTS (
                  SELECT 1 FROM public.property_memberships pm
                  WHERE pm.property_id = gr.property_id
                    AND pm.user_id = auth.uid()
                    AND pm.is_active = true
              )
              OR EXISTS (
                  SELECT 1 FROM public.properties p
                  JOIN public.organization_memberships om ON p.organization_id = om.organization_id
                  WHERE p.id = gr.property_id
                    AND om.user_id = auth.uid()
                    AND om.is_active = true
              )
          )
    )
);

-- Index behind the timeline lookup on the detail panel.
CREATE INDEX IF NOT EXISTS idx_guest_request_events_request
    ON public.guest_request_events (guest_request_id, created_at);

-- Index behind the dashboard's per-property, newest-first list.
CREATE INDEX IF NOT EXISTS idx_guest_requests_property_created
    ON public.guest_requests (property_id, created_at DESC);
