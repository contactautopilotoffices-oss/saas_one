-- Migration: 20261113000003_prevent_tenant_internal_tickets.sql
-- Enforce that tickets raised by clients/tenants are never flagged as internal.

-- 1. Ensure any existing client-raised tickets marked internal are cleaned up
UPDATE public.tickets t
SET internal = false, is_internal = false
FROM public.property_memberships pm
WHERE t.raised_by = pm.user_id
  AND t.property_id = pm.property_id
  AND pm.role IN ('tenant', 'super_tenant')
  AND (t.internal = true OR t.is_internal = true);

-- 2. Trigger function to prevent any tenant ticket from ever being marked internal
CREATE OR REPLACE FUNCTION public.fn_guard_tenant_ticket_internal()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.internal = true OR NEW.is_internal = true THEN
        IF EXISTS (
            SELECT 1 FROM public.property_memberships
            WHERE user_id = NEW.raised_by
              AND property_id = NEW.property_id
              AND role IN ('tenant', 'super_tenant')
              AND (is_active = true OR is_active IS NULL)
        ) THEN
            NEW.internal := false;
            NEW.is_internal := false;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_tenant_ticket_internal ON public.tickets;
CREATE TRIGGER trg_guard_tenant_ticket_internal
BEFORE INSERT OR UPDATE OF internal, is_internal ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_tenant_ticket_internal();

