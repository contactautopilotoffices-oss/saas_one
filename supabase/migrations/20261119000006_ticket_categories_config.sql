-- Categories and SLAs, set from the Brain console (owner 2026-11-19: "i want the categories and slas customizable,
-- where i can add more categories and also customize the sla's timings and who will it be assigned like which team",
-- "ai based suggestions based on past tickets on what categories must be added", suggestions "manual").
-- Code: backend/lib/ticketing/categoryConfig.ts. NOT applied automatically: a person runs this in the Supabase SQL Editor.
--
--   issue_categories.sla_by_priority   optional: a different SLA (hours) for each priority of a new ticket in this
--                                      category, {"low":24,"medium":8,"high":4,"urgent":2}. Empty = the one sla_hours.
--   issue_categories.ai_hint           optional: "what belongs here", shown to the AI that sorts tickets.
--   ticket_category_suggestions        the AI's suggestions (new category, merge, rename, better hint), made only when
--                                      a Tech person presses the button; each waits until a person accepts or dismisses.
--   ticket_category_changes            who changed which category, when, from what to what.
--
-- Safety:   ADDITIVE ONLY. Two nullable columns on issue_categories (no existing value changes; until they are filled
--           every ticket gets exactly the SLA and list it gets today) and two new tables. No row is deleted, ever:
--           a category is switched off, never removed. RLS on the new tables, NO policies: only the server writes them.
-- Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS public.ticket_category_changes; DROP TABLE IF EXISTS public.ticket_category_suggestions;
--           ALTER TABLE public.issue_categories DROP COLUMN IF EXISTS ai_hint, DROP COLUMN IF EXISTS sla_by_priority;

BEGIN;

ALTER TABLE public.issue_categories ADD COLUMN IF NOT EXISTS sla_by_priority jsonb;
ALTER TABLE public.issue_categories ADD COLUMN IF NOT EXISTS ai_hint text;

CREATE TABLE IF NOT EXISTS public.ticket_category_suggestions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    kind                text NOT NULL CHECK (kind IN ('new', 'merge', 'rename', 'hint')),
    -- new: {code,name,team,priority,sla_hours,hint}; merge: {keep,drop[]}; rename: {code,name}; hint: {code,hint}
    payload             jsonb NOT NULL,
    why                 text,
    -- the past tickets it comes from: [{id,text,code}]
    examples            jsonb NOT NULL DEFAULT '[]'::jsonb,
    status              text NOT NULL DEFAULT 'offered' CHECK (status IN ('offered', 'accepted', 'dismissed', 'replaced')),
    model               text,
    created_by          uuid,
    decided_by          uuid,
    decided_at          timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_category_suggestions_org ON public.ticket_category_suggestions (organization_id, created_at DESC);
ALTER TABLE public.ticket_category_suggestions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ticket_category_changes (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    code                text NOT NULL,
    action              text NOT NULL CHECK (action IN ('created', 'edited', 'switched_off', 'switched_on', 'merged')),
    before              jsonb,
    after               jsonb,
    property_ids        uuid[] NOT NULL DEFAULT '{}',
    changed_by          uuid,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_category_changes_org ON public.ticket_category_changes (organization_id, created_at DESC);
ALTER TABLE public.ticket_category_changes ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;
