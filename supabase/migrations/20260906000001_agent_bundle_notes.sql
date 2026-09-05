-- =============================================================================
-- oem_agent_bundles.notes — the column the code has always assumed exists.
--
-- 20260825000001 put `notes` INSIDE the bundle jsonb (see its own comment:
-- "{ tables: [...], notes }"), but every code path treats it as a top-level
-- column: app/api/agents/bundles/route.ts selects it by name and its Zod schema
-- accepts it as a sibling of `bundle`, and AgentTriView sends it that way.
--
-- The consequence was worse than a broken save. The read failed with
-- "column oem_agent_bundles.notes does not exist", which isMissingSchema() in
-- app/api/agents/_shared.ts matches on the substring "does not exist" — so a
-- missing COLUMN was reported to operators as a missing TABLE, under the banner
-- "The agent runtime tables are not in this database yet. Run migration
-- 20260825000001_org_efficiency_meter." That migration was already applied.
-- Running it again would have changed nothing, which is exactly what happened.
--
-- Additive and idempotent.
-- =============================================================================

ALTER TABLE public.oem_agent_bundles
    ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN public.oem_agent_bundles.notes IS
    'Free-text note on why this bundle version exists (e.g. "Accepted from DESCRIBE IT."). Top-level, not inside the bundle jsonb.';
