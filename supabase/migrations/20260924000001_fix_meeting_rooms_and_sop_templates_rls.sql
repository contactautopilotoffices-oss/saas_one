-- Migration: Simplify RLS Policies for SOP Templates, SOP Checklist Items, and Meeting Rooms
-- Allows all authenticated users full CRUD operations so role schema updates require zero future SQL migrations.

-- ============================================================================
-- 1. SOP TEMPLATES RLS POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "sop_templates_manage" ON public.sop_templates;
DROP POLICY IF EXISTS "sop_templates_read" ON public.sop_templates;
DROP POLICY IF EXISTS "sop_templates_authenticated_all" ON public.sop_templates;

CREATE POLICY "sop_templates_authenticated_all" ON public.sop_templates
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- 2. SOP CHECKLIST ITEMS RLS POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "sop_items_manage" ON public.sop_checklist_items;
DROP POLICY IF EXISTS "sop_items_read" ON public.sop_checklist_items;
DROP POLICY IF EXISTS "sop_items_authenticated_all" ON public.sop_checklist_items;

CREATE POLICY "sop_items_authenticated_all" ON public.sop_checklist_items
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- 3. MEETING ROOMS RLS POLICIES
-- ============================================================================

ALTER TABLE public.meeting_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meeting_rooms_read" ON public.meeting_rooms;
DROP POLICY IF EXISTS "meeting_rooms_manage" ON public.meeting_rooms;
DROP POLICY IF EXISTS "meeting_rooms_authenticated_all" ON public.meeting_rooms;

CREATE POLICY "meeting_rooms_authenticated_all" ON public.meeting_rooms
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);
