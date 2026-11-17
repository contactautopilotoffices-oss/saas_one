-- ============================================================================
-- MEETINGS — meeting rooms inside FMS, with one of our agents in each.
-- ----------------------------------------------------------------------------
-- A meeting is a live room people join from inside FMS. The meeting names the
-- agent that runs it (agent_slug) and its topic. The first topic is a review of
-- purchase orders stuck at "pending approval": the agenda is built from our own
-- data, and Ira takes each item in turn, asks the people in the room what should
-- happen, and writes down the answer. Other agents and topics are added by
-- adding a topic here and a persona in agents/meeting-agent — not a new room
-- system each time.
--
-- Nothing Ira writes changes anything else. Her decisions are PROPOSALS on this
-- table; a person confirms them on the decision sheet after the meeting, and
-- acting on them (approving or cancelling a PO in Zoho) stays a human step.
--
-- Four tables:
--   meetings              the meeting: title, topic, agent, status, host, room
--   meeting_agenda_items  the agenda, with the facts the agent may quote frozen
--                         at creation, so it never quotes a number from memory
--   meeting_decisions     what was decided per item, or a business rule someone
--                         stated ("under ₹25,000 Saniel approves directly")
--   meeting_lines         the live transcript, one row per spoken turn
--
-- RLS on, NO permissive policy: service role only. Every read and write goes
-- through /api/meetings, which checks organisation membership and role, or
-- through /api/meetings/agent, which checks a shared secret.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.meetings (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    title            text NOT NULL,
    -- Only topics that are built are allowed; a new topic is a new migration.
    topic            text NOT NULL DEFAULT 'po_approvals' CHECK (topic IN ('po_approvals')),
    -- Which of our agents runs the room: oem_agents.slug ('ira', …).
    agent_slug       text NOT NULL DEFAULT 'ira',
    -- The criteria the agenda was built from, for the record.
    criteria         jsonb NOT NULL DEFAULT '{}'::jsonb,
    status           text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended')),
    -- The LiveKit room. One room per meeting, never reused.
    room_name        text NOT NULL UNIQUE,
    host_id          uuid NOT NULL REFERENCES public.users(id),
    started_at       timestamptz,
    ended_at         timestamptz,
    -- Set by the agent, so a room where Ira never arrived is visible.
    agent_joined_at  timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meetings_org ON public.meetings(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.meeting_agenda_items (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id       uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    position         integer NOT NULL,
    kind             text NOT NULL DEFAULT 'po' CHECK (kind IN ('po')),
    -- zoho_purchase_orders.id. Not a foreign key: a resync may replace the row,
    -- and the agenda must survive that as the record of what was discussed.
    ref_id           uuid,
    label            text NOT NULL,              -- "PO-01234"
    -- Frozen at creation: vendor, amount, property, days waiting, last email.
    facts            jsonb NOT NULL DEFAULT '{}'::jsonb,
    status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'current', 'discussed', 'parked')),
    parked_reason    text,
    UNIQUE (meeting_id, position)
);
CREATE INDEX IF NOT EXISTS idx_meeting_agenda_items_meeting ON public.meeting_agenda_items(meeting_id, position);

CREATE TABLE IF NOT EXISTS public.meeting_decisions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id       uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    item_id          uuid REFERENCES public.meeting_agenda_items(id) ON DELETE CASCADE,
    -- 'item': a decision on one agenda item. 'rule': a standing rule someone stated.
    kind             text NOT NULL DEFAULT 'item' CHECK (kind IN ('item', 'rule')),
    decision         text CHECK (decision IN ('approve', 'cancel', 'needs_info', 'hold', 'reassign')),
    owner_name       text,
    due_text         text,                       -- as said: "Friday", "end of month"
    note             text,
    said_by          text,                       -- the participant Ira heard it from
    -- superseded: corrected in the room ("no, not cancel — hold it"); the newer
    -- proposal replaces it on the decision sheet but the history is kept.
    state            text NOT NULL DEFAULT 'proposed'
                     CHECK (state IN ('proposed', 'confirmed', 'rejected', 'superseded')),
    reviewed_by      uuid REFERENCES public.users(id),
    reviewed_at      timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind = 'item' AND item_id IS NOT NULL AND decision IS NOT NULL) OR (kind = 'rule' AND note IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_meeting_decisions_meeting ON public.meeting_decisions(meeting_id, created_at);

CREATE TABLE IF NOT EXISTS public.meeting_lines (
    id               bigserial PRIMARY KEY,
    meeting_id       uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    speaker_identity text NOT NULL,              -- FMS user id, or 'agent'
    speaker_name     text,
    is_agent         boolean NOT NULL DEFAULT false,
    text             text NOT NULL,
    spoken_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meeting_lines_meeting ON public.meeting_lines(meeting_id, id);

COMMENT ON TABLE public.meeting_lines IS
    'Live meeting transcript. People are told on joining that the meeting is transcribed. Service role only.';

ALTER TABLE public.meetings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_agenda_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_lines     ENABLE ROW LEVEL SECURITY;
-- Deliberately NO permissive policies. Service role only.
