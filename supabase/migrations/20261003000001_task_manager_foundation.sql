-- =================================================================================
-- Migration: 20261003000001_task_manager_foundation.sql
-- Description: Phase 1 Database Foundation for WhatsApp Employee Task Manager
-- Approach: Adapts existing employee_profiles (no separate employees table)
-- Safety: Completely additive and safe against reruns.
-- =================================================================================

-- 1. Helper function for updated_at timestamps
CREATE OR REPLACE FUNCTION public.set_task_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =================================================================================
-- 2. Departments Table
-- =================================================================================
CREATE TABLE IF NOT EXISTS public.departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    code TEXT UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed Canonical and Existing Departments from employee_profiles (14 departments)
INSERT INTO public.departments (name, code)
VALUES
    ('Operations', 'OPS'),
    ('Procurement', 'PROC'),
    ('Tech', 'TECH'),
    ('Business Development & Growth', 'BD'),
    ('Human Resources', 'HR'),
    ('Accounts', 'ACC'),
    ('Legal', 'LEGAL'),
    ('Design', 'DES'),
    ('Administration', 'ADMIN'),
    ('Business', 'BUS'),
    ('IT', 'IT'),
    ('Infrastructure', 'INFRA'),
    ('Management', 'MGMT'),
    ('Marketing', 'MKTG')
ON CONFLICT (name) DO UPDATE 
SET is_active = true;

-- Dynamically insert any additional distinct departments found in employee_profiles
INSERT INTO public.departments (name)
SELECT DISTINCT TRIM(department)
FROM public.employee_profiles
WHERE department IS NOT NULL AND TRIM(department) != ''
ON CONFLICT (name) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_departments_name ON public.departments(name);

-- =================================================================================
-- 3. Adapt Existing employee_profiles Table
--    Adds department_id foreign key & 3-tier task_role without duplicating users
-- =================================================================================
ALTER TABLE public.employee_profiles 
    ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS task_role TEXT DEFAULT 'employee' CHECK (task_role IN ('employee', 'reporting_manager', 'superuser'));

CREATE INDEX IF NOT EXISTS idx_employee_profiles_dept_id ON public.employee_profiles(department_id);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_task_role ON public.employee_profiles(task_role);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_user_id ON public.employee_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_phone ON public.employee_profiles(phone);

-- Backfill department_id and task_role from existing data
DO $$
BEGIN
    -- 1. Link department_id by matching existing department name
    UPDATE public.employee_profiles ep
    SET department_id = d.id
    FROM public.departments d
    WHERE LOWER(TRIM(ep.department)) = LOWER(TRIM(d.name))
      AND (ep.department_id IS NULL OR ep.department_id != d.id);

    -- 2. Set task_role = 'reporting_manager' for employees with direct reports
    -- (Note: 'superuser' roles are not auto-assigned and will be set manually)
    UPDATE public.employee_profiles
    SET task_role = 'reporting_manager'
    WHERE user_id IN (
        SELECT DISTINCT reporting_manager_id 
        FROM public.employee_profiles 
        WHERE reporting_manager_id IS NOT NULL
    ) AND (task_role = 'employee' OR task_role IS NULL);
END $$;

-- =================================================================================
-- 4. Task Templates Table (Reusable & Fixed Routine Tasks)
-- =================================================================================
CREATE TABLE IF NOT EXISTS public.task_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    department_id UUID REFERENCES public.departments(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    task_type TEXT NOT NULL DEFAULT 'fixed' CHECK (task_type IN ('fixed', 'assigned')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_templates_dept ON public.task_templates(department_id);
CREATE INDEX IF NOT EXISTS idx_task_templates_type ON public.task_templates(task_type);
CREATE INDEX IF NOT EXISTS idx_task_templates_active ON public.task_templates(is_active);

DROP TRIGGER IF EXISTS trigger_task_templates_updated_at ON public.task_templates;
CREATE TRIGGER trigger_task_templates_updated_at
    BEFORE UPDATE ON public.task_templates
    FOR EACH ROW
    EXECUTE FUNCTION public.set_task_updated_at();

-- =================================================================================
-- 5. Task Assignments Table (Core Daily Assignments per Employee & Date)
-- =================================================================================
CREATE TABLE IF NOT EXISTS public.task_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_template_id UUID REFERENCES public.task_templates(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    assigned_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
    assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_task_assignments_emp_date ON public.task_assignments(employee_id, assigned_date);
CREATE INDEX IF NOT EXISTS idx_task_assignments_status ON public.task_assignments(status);
CREATE INDEX IF NOT EXISTS idx_task_assignments_date ON public.task_assignments(assigned_date DESC);
CREATE INDEX IF NOT EXISTS idx_task_assignments_assigned_by ON public.task_assignments(assigned_by);
CREATE INDEX IF NOT EXISTS idx_task_assignments_template ON public.task_assignments(task_template_id);

-- Enforce idempotency: an employee cannot receive the exact same template twice on the same date
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_assignment_emp_template_date
    ON public.task_assignments(employee_id, task_template_id, assigned_date)
    WHERE task_template_id IS NOT NULL;

DROP TRIGGER IF EXISTS trigger_task_assignments_updated_at ON public.task_assignments;
CREATE TRIGGER trigger_task_assignments_updated_at
    BEFORE UPDATE ON public.task_assignments
    FOR EACH ROW
    EXECUTE FUNCTION public.set_task_updated_at();

-- =================================================================================
-- 6. Conversation Context Table (Router State: TASK_MANAGER vs FACILITY)
-- =================================================================================
CREATE TABLE IF NOT EXISTS public.conversation_context (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number TEXT NOT NULL,
    system TEXT NOT NULL CHECK (system IN ('TASK_MANAGER', 'FACILITY')),
    context_type TEXT NOT NULL DEFAULT 'ACTIVE',
    context_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_conversation_context_phone_system UNIQUE (phone_number, system)
);

CREATE INDEX IF NOT EXISTS idx_conversation_context_phone ON public.conversation_context(phone_number);
CREATE INDEX IF NOT EXISTS idx_conversation_context_expires ON public.conversation_context(expires_at);

DROP TRIGGER IF EXISTS trigger_conversation_context_updated_at ON public.conversation_context;
CREATE TRIGGER trigger_conversation_context_updated_at
    BEFORE UPDATE ON public.conversation_context
    FOR EACH ROW
    EXECUTE FUNCTION public.set_task_updated_at();

-- =================================================================================
-- 7. Task Audit Logs Table (Full Audit Trail for Phase 17)
-- =================================================================================
CREATE TABLE IF NOT EXISTS public.task_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    target_employee_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    task_id UUID,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_audit_event ON public.task_audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_task_audit_actor ON public.task_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_task_audit_target ON public.task_audit_logs(target_employee_id);
CREATE INDEX IF NOT EXISTS idx_task_audit_created ON public.task_audit_logs(created_at DESC);

-- =================================================================================
-- 8. Enable Row Level Security (RLS) with permissive Service Role access
-- =================================================================================
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_audit_logs ENABLE ROW LEVEL SECURITY;

-- Allow public read access to active departments
DROP POLICY IF EXISTS "Allow read access to active departments" ON public.departments;
CREATE POLICY "Allow read access to active departments" ON public.departments
    FOR SELECT USING (is_active = true);

-- Allow authenticated users to read task templates & assignments
DROP POLICY IF EXISTS "Allow authenticated read on task_templates" ON public.task_templates;
CREATE POLICY "Allow authenticated read on task_templates" ON public.task_templates
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated read on task_assignments" ON public.task_assignments;
CREATE POLICY "Allow authenticated read on task_assignments" ON public.task_assignments
    FOR SELECT TO authenticated USING (true);
