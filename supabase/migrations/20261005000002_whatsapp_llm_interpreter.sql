-- Additive pilot configuration and recipient-scoped quoted reply aliases.
-- Existing assistant event/session tables and domain RPCs remain the mutation owners.
BEGIN;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS wa_assistant_completed boolean NOT NULL DEFAULT false;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS wa_assistant_input_hash text;
CREATE TABLE IF NOT EXISTS public.whatsapp_interpreter_settings (
    organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    config jsonb NOT NULL DEFAULT '{"enabled":false,"bookingEnabled":true,"ticketEnabled":true,"defaultDate":"ask","pilotUserIds":[]}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT whatsapp_interpreter_config_object CHECK (jsonb_typeof(config) = 'object')
);
ALTER TABLE public.whatsapp_interpreter_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_interpreter_org_super_admin ON public.whatsapp_interpreter_settings;
CREATE POLICY whatsapp_interpreter_org_super_admin ON public.whatsapp_interpreter_settings
    FOR ALL TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.organization_memberships m JOIN public.users u ON u.id=m.user_id
        WHERE m.user_id=auth.uid() AND m.organization_id=whatsapp_interpreter_settings.organization_id
          AND m.is_active AND m.role='org_super_admin'
          AND (u.is_approved OR u.approval_status='approved')
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.organization_memberships m JOIN public.users u ON u.id=m.user_id
        WHERE m.user_id=auth.uid() AND m.organization_id=whatsapp_interpreter_settings.organization_id
          AND m.is_active AND m.role='org_super_admin'
          AND (u.is_approved OR u.approval_status='approved')
    ));
GRANT SELECT,INSERT,UPDATE ON public.whatsapp_interpreter_settings TO authenticated;
GRANT ALL ON public.whatsapp_interpreter_settings TO service_role;
REVOKE ALL ON public.whatsapp_interpreter_settings FROM anon;

CREATE TABLE IF NOT EXISTS public.whatsapp_outgoing_context (
    project_id text NOT NULL,
    phone text NOT NULL CHECK (phone ~ '^[0-9]{11,15}$'),
    message_alias text NOT NULL CHECK (length(message_alias) BETWEEN 1 AND 512),
    workflow text NOT NULL CHECK (workflow IN ('menu','booking','ticket','task')),
    conversation_id text NOT NULL,
    revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
    PRIMARY KEY(project_id,phone,message_alias)
);
CREATE INDEX IF NOT EXISTS whatsapp_outgoing_context_expiry ON public.whatsapp_outgoing_context(expires_at);
ALTER TABLE public.whatsapp_outgoing_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_outgoing_context FROM anon,authenticated;
GRANT ALL ON public.whatsapp_outgoing_context TO service_role;
COMMIT;
