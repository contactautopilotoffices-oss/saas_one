-- Migration: 20261016000003_property_operation_type.sql
-- Description: Marks each property as OPEX (operational, the default) or CAPEX only
-- (a project or fit-out with no day-to-day operations). Set in Property Management.
-- The Org Super Admin App Usage report leaves CAPEX-only properties out, since they
-- are not expected to use the operational modules.

BEGIN;

ALTER TABLE public.properties
    ADD COLUMN IF NOT EXISTS operation_type text NOT NULL DEFAULT 'opex';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'properties_operation_type_check'
    ) THEN
        ALTER TABLE public.properties
            ADD CONSTRAINT properties_operation_type_check CHECK (operation_type IN ('opex', 'capex'));
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
