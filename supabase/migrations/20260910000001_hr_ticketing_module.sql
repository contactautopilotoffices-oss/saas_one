-- Migration: 20260910000001_hr_ticketing_module.sql
-- Description: HR Ticketing Module Schema with RLS, Sequence Generator, and Audit Triggers

-- 0. Extend app_role enum for HR personas
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hr';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hr_head';

-- 1. Employee Profiles table
CREATE TABLE IF NOT EXISTS public.employee_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    employee_code TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    department TEXT,
    designation TEXT,
    location TEXT,
    reporting_manager_code TEXT,
    reporting_manager_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    alternate_manager_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    is_director_authority BOOLEAN DEFAULT FALSE,
    is_hr_authority BOOLEAN DEFAULT FALSE,
    is_hr_manager_authority BOOLEAN DEFAULT FALSE,
    reconciliation_status TEXT DEFAULT 'unlinked' CHECK (reconciliation_status IN ('linked', 'unlinked', 'pending_approval')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT employee_code_org_unique UNIQUE (organization_id, employee_code)
);

CREATE INDEX IF NOT EXISTS idx_employee_profiles_user_id ON public.employee_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_email ON public.employee_profiles(email);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_rep_mgr ON public.employee_profiles(reporting_manager_id);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_code ON public.employee_profiles(employee_code);

-- 2. HR Ticket Categories Master
CREATE TABLE IF NOT EXISTS public.hr_ticket_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    ticket_type TEXT NOT NULL CHECK (ticket_type IN ('grievance', 'hr_query', 'confidential_feedback', 'anonymous_feedback')),
    category_name TEXT NOT NULL,
    sub_category_name TEXT,
    first_level_owner_type TEXT NOT NULL DEFAULT 'reporting_manager' CHECK (first_level_owner_type IN ('reporting_manager', 'hr', 'director', 'specific_user')),
    default_hr_owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    l1_sla_days INT DEFAULT 3,
    l2_sla_days INT DEFAULT 7,
    l3_sla_days INT DEFAULT 10,
    l4_sla_days INT DEFAULT 12,
    is_confidential BOOLEAN DEFAULT FALSE,
    is_anonymous BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_categories_type ON public.hr_ticket_categories(ticket_type);

-- 3. HR Ticket Sequences Table & Property-Aware Generator (Format: HR-[Org]-[Prop]-[Year]-[Serial])
CREATE TABLE IF NOT EXISTS public.hr_ticket_sequences (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    last_val INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.generate_hr_ticket_number(
    p_org_id UUID,
    p_property_id UUID DEFAULT NULL,
    p_location TEXT DEFAULT NULL
)
RETURNS TEXT AS $$
DECLARE
    v_year TEXT := TO_CHAR(NOW(), 'YYYY');
    v_org_code TEXT := 'WS';
    v_prop_code TEXT := 'LP';
    v_next_val INT;
BEGIN
    -- Fetch org initials
    SELECT COALESCE(UPPER(SUBSTRING(code FROM 1 FOR 4)), 'WS') INTO v_org_code
    FROM public.organizations WHERE id = p_org_id;

    -- Fetch property code or derive location initials
    IF p_property_id IS NOT NULL THEN
        SELECT COALESCE(UPPER(SUBSTRING(code FROM 1 FOR 3)), UPPER(SUBSTRING(name FROM 1 FOR 2))) INTO v_prop_code
        FROM public.properties WHERE id = p_property_id;
    ELSIF p_location IS NOT NULL AND p_location != '' THEN
        v_prop_code := UPPER(
            COALESCE(
                (SELECT STRING_AGG(SUBSTRING(w FROM 1 FOR 1), '') FROM UNNEST(STRING_TO_ARRAY(p_location, ' ')) w),
                SUBSTRING(p_location FROM 1 FOR 2)
            )
        );
    END IF;

    IF v_prop_code IS NULL OR v_prop_code = '' THEN
        v_prop_code := 'GEN';
    END IF;

    -- Atomic sequence increment
    INSERT INTO public.hr_ticket_sequences (organization_id, last_val, updated_at)
    VALUES (p_org_id, 1, NOW())
    ON CONFLICT (organization_id) DO UPDATE
    SET last_val = hr_ticket_sequences.last_val + 1, updated_at = NOW()
    RETURNING last_val INTO v_next_val;

    RETURN 'HR-' || COALESCE(v_org_code, 'WS') || '-' || v_prop_code || '-' || v_year || '-' || LPAD(v_next_val::text, 5, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. HR Tickets Master Table
CREATE TABLE IF NOT EXISTS public.hr_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    ticket_number TEXT NOT NULL UNIQUE,
    ticket_type TEXT NOT NULL CHECK (ticket_type IN ('grievance', 'hr_query', 'confidential_feedback', 'anonymous_feedback')),
    category_id UUID REFERENCES public.hr_ticket_categories(id) ON DELETE RESTRICT,
    raised_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    anonymous_token TEXT,
    employee_snapshot JSONB DEFAULT '{}'::jsonb,
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    attachment_urls TEXT[] DEFAULT '{}',
    current_level INT DEFAULT 1 CHECK (current_level BETWEEN 1 AND 4),
    assigned_to_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
        'new', 'assigned', 'in_progress', 'awaiting_employee_response', 
        'awaiting_manager_response', 'awaiting_hr_response', 'awaiting_internal_approval',
        'awaiting_external_party', 'escalated', 'resolved', 'closed', 'reopened', 'cancelled'
    )),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    sla_due_at TIMESTAMPTZ,
    is_confidential BOOLEAN DEFAULT FALSE,
    is_anonymous BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    reopened_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_tickets_org ON public.hr_tickets(organization_id);
CREATE INDEX IF NOT EXISTS idx_hr_tickets_raised_by ON public.hr_tickets(raised_by_user_id);
CREATE INDEX IF NOT EXISTS idx_hr_tickets_assigned ON public.hr_tickets(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_hr_tickets_status ON public.hr_tickets(status);
CREATE INDEX IF NOT EXISTS idx_hr_tickets_type ON public.hr_tickets(ticket_type);

-- 5. HR Ticket Comments (Dual-Channel: Public vs Internal Notes)
CREATE TABLE IF NOT EXISTS public.hr_ticket_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES public.hr_tickets(id) ON DELETE CASCADE,
    sender_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    sender_name TEXT NOT NULL,
    content TEXT NOT NULL,
    attachment_urls TEXT[] DEFAULT '{}',
    is_internal BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_comments_ticket ON public.hr_ticket_comments(ticket_id);

-- 6. HR Ticket Audit Logs
CREATE TABLE IF NOT EXISTS public.hr_ticket_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES public.hr_tickets(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    old_values JSONB DEFAULT '{}'::jsonb,
    new_values JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_audit_ticket ON public.hr_ticket_audit_logs(ticket_id);

-- 7. RLS Policies
ALTER TABLE public.employee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_ticket_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_ticket_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_employee_profiles_policy" ON public.employee_profiles;
CREATE POLICY "authenticated_employee_profiles_policy" ON public.employee_profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_hr_categories_policy" ON public.hr_ticket_categories;
CREATE POLICY "authenticated_hr_categories_policy" ON public.hr_ticket_categories FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_hr_tickets_policy" ON public.hr_tickets;
CREATE POLICY "authenticated_hr_tickets_policy" ON public.hr_tickets FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_hr_comments_policy" ON public.hr_ticket_comments;
CREATE POLICY "authenticated_hr_comments_policy" ON public.hr_ticket_comments FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_hr_audit_policy" ON public.hr_ticket_audit_logs;
CREATE POLICY "authenticated_hr_audit_policy" ON public.hr_ticket_audit_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 8. Fix Outbox Trigger on organization_memberships (replaces invalid NEW.id reference with NEW.user_id)
CREATE OR REPLACE FUNCTION public.fn_organization_memberships_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type TEXT;
    v_payload JSONB;
    v_user_name TEXT;
    v_user_email TEXT;
    v_user_phone TEXT;
    v_org_name TEXT;
    v_is_active BOOLEAN;
    v_old_is_active BOOLEAN;
BEGIN
    v_is_active := COALESCE(NEW.is_active, false);
    v_old_is_active := CASE WHEN TG_OP = 'UPDATE' THEN COALESCE(OLD.is_active, false) ELSE false END;

    IF TG_OP = 'INSERT' THEN
        IF v_is_active = false THEN
            v_event_type := 'USER_PENDING_APPROVAL';
        ELSE
            v_event_type := 'USER_APPROVED';
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF v_is_active = true AND v_old_is_active = false THEN
            v_event_type := 'USER_APPROVED';
        ELSIF v_is_active = false AND v_old_is_active = true THEN
            v_event_type := 'USER_PENDING_APPROVAL';
        END IF;
    END IF;

    IF v_event_type IS NULL THEN
        RETURN NEW;
    END IF;

    -- Resolve user details
    SELECT full_name, email, phone
    INTO v_user_name, v_user_email, v_user_phone
    FROM public.users
    WHERE id = NEW.user_id;

    -- Resolve organization name
    SELECT name
    INTO v_org_name
    FROM public.organizations
    WHERE id = NEW.organization_id;

    -- Assemble payload
    v_payload := jsonb_build_object(
        'membership_id', NEW.user_id,
        'id', NEW.user_id,
        'user_id', NEW.user_id,
        'full_name', COALESCE(v_user_name, 'New User'),
        'email', v_user_email,
        'phone', v_user_phone,
        'role', NEW.role,
        'requested_role', NEW.role,
        'organization_id', NEW.organization_id,
        'organization_name', COALESCE(v_org_name, 'Organization'),
        'is_active', v_is_active,
        'status', CASE WHEN v_is_active THEN 'approved' ELSE 'pending_approval' END,
        'created_at', COALESCE(NEW.created_at, NOW())
    );

    -- Insert into event_outbox
    INSERT INTO public.event_outbox (event_type, entity_id, payload)
    VALUES (v_event_type, NEW.user_id, v_payload);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

