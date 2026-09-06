-- ============================================================================
-- FINDING EVIDENCE — the records a finding points at, kept with the finding.
-- ----------------------------------------------------------------------------
-- Two things need this and neither works without it:
--
--   1. ANSWERING A REPLY. respond.ts builds its fact sheet from the finding row
--      and cites the exact records — "PO-26/27-0609, ₹38,409". It selects refs
--      and stats, which did not exist, so every select errored and Ira answered
--      nobody. Shipped untested; this is the fix.
--
--   2. MATCHING A REPLY BY PO NUMBER. People write "PO-26/27-0216 cancelled",
--      not a hash. To file that against the right finding we have to know which
--      purchase orders a finding was about, after the scan that produced it.
--
-- Both columns mirror the Finding contract in
-- backend/lib/ira/procurement/types.ts and are written by rememberFindings().
-- ============================================================================

ALTER TABLE public.oem_agent_findings
    ADD COLUMN IF NOT EXISTS refs  jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS stats jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.oem_agent_findings.refs IS
    'EntityRef[] — [{kind, label, id}]. label is the human identifier (PO-26/27-0609) and is what an emailed reply is matched on.';
COMMENT ON COLUMN public.oem_agent_findings.stats IS
    '[{label, value}] — the supporting figures shown under the finding, kept so a later reply can be answered without re-running the scan.';

-- Reply matching scans the labels inside refs, so index the containment.
CREATE INDEX IF NOT EXISTS idx_oem_findings_refs ON public.oem_agent_findings USING GIN (refs);
