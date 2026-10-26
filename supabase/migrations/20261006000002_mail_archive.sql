-- ============================================================================
-- MAIL ARCHIVE — the intake half of the organisational brain. Sandbox first.
-- ----------------------------------------------------------------------------
-- Every email in a chosen set of mailboxes, past and future, read automatically
-- and stored ONCE. Nothing here understands the mail yet: no AI, no extraction.
-- That is deliberate. The first question is whether the plumbing holds — how
-- fast history comes in, how much it weighs, and whether it stays current —
-- before anything is built on top of it.
--
-- Three tables:
--
--   mail_archive_mailboxes  the roster: which mailboxes are read, plus each
--                           one's bookmarks and health. A mailbox is archived
--                           only because someone put it HERE — connecting a
--                           mailbox for an agent does not enrol it.
--   mail_archive_messages   one row per email PER MAILBOX it sits in. Small:
--                           headers, folder, a short summary.
--   mail_archive_bodies     one row per UNIQUE email, holding its text. The
--                           same mail CC'd to five people is fetched and stored
--                           once, matched on email_key.
--
-- ── PRIVACY ────────────────────────────────────────────────────────────────
-- The purchase@ digest deliberately never stored bodies. This archive does,
-- including personal work mailboxes, because the founder asked for it
-- (2026-10-06). So: RLS on, NO permissive policy, service role only. The only
-- route that reads these tables is /api/mail-archive, which is limited to super
-- admins and returns counts and health — never a message.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mail_archive_mailboxes (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    address             text NOT NULL,
    is_active           boolean NOT NULL DEFAULT true,
    added_by            uuid REFERENCES public.users(id),
    added_at            timestamptz NOT NULL DEFAULT now(),

    -- Live bookmark: the newest email seen. The sweeper reads back to here
    -- (minus an overlap) every run.
    newest_received_at  timestamptz,
    -- History bookmark: how many emails, newest first, have been walked. Each
    -- run resumes slightly before this, so a few deletions cannot skip mail.
    backfill_offset     integer NOT NULL DEFAULT 0,
    backfill_oldest_at  timestamptz,
    backfill_done_at    timestamptz,

    -- One run at a time per mailbox, even if the cron is also fired by hand.
    locked_until        timestamptz,

    last_run_at         timestamptz,
    last_ok_at          timestamptz,
    last_error          text,
    last_run_stats      jsonb,

    UNIQUE (organization_id, address)
);

CREATE TABLE IF NOT EXISTS public.mail_archive_messages (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    mailbox_id          uuid NOT NULL REFERENCES public.mail_archive_mailboxes(id) ON DELETE CASCADE,

    zoho_message_id     text NOT NULL,
    folder_id           text,
    folder_name         text,
    thread_id           text,
    -- Same value for every copy of one email across mailboxes: a hash of the
    -- sender, Zoho's sent-time field, and the subject. See ingest.ts emailKey().
    email_key           text NOT NULL,

    subject             text,
    from_address        text,
    from_name           text,
    to_addresses        text[] NOT NULL DEFAULT '{}',
    cc_addresses        text[] NOT NULL DEFAULT '{}',
    -- No sent_at: Zoho's sentDateInGMT is the header time shifted by 7 hours
    -- (measured 2026-10-06), so it would show the wrong time. Received is exact.
    received_at         timestamptz NOT NULL,
    has_attachment      boolean NOT NULL DEFAULT false,
    size_bytes          integer,
    summary             text,

    -- pending → done | skipped (newsletters, notifications) | failed (3 tries)
    body_state          text NOT NULL DEFAULT 'pending'
                        CHECK (body_state IN ('pending', 'done', 'skipped', 'failed')),
    body_attempts       smallint NOT NULL DEFAULT 0,
    body_error          text,

    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (mailbox_id, zoho_message_id)
);

CREATE INDEX IF NOT EXISTS idx_mail_archive_messages_key
    ON public.mail_archive_messages(organization_id, email_key);
-- The body queue: newest pending first, per mailbox.
CREATE INDEX IF NOT EXISTS idx_mail_archive_messages_queue
    ON public.mail_archive_messages(mailbox_id, received_at DESC) WHERE body_state = 'pending';
CREATE INDEX IF NOT EXISTS idx_mail_archive_messages_received
    ON public.mail_archive_messages(mailbox_id, received_at DESC);

CREATE TABLE IF NOT EXISTS public.mail_archive_bodies (
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email_key           text NOT NULL,
    body_text           text NOT NULL,
    body_chars          integer NOT NULL,
    fetched_from        uuid REFERENCES public.mail_archive_mailboxes(id) ON DELETE SET NULL,
    fetched_message_id  text,
    fetched_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, email_key)
);

COMMENT ON TABLE public.mail_archive_bodies IS
    'Email text, including personal work mailboxes. RLS on with no permissive policy: service role only. Never returned by any API yet.';

ALTER TABLE public.mail_archive_mailboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_archive_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_archive_bodies    ENABLE ROW LEVEL SECURITY;
-- Deliberately NO permissive policies. Service role only.

-- ── SANDBOX ROSTER (2026-10-06) ─────────────────────────────────────────────
-- purchase@ and three of the purchase team, for Autopilot Offices only. A no-op
-- on any database without that organisation. purchase@ is already readable;
-- the other three start reading once each person connects their mailbox.
INSERT INTO public.mail_archive_mailboxes (organization_id, address)
SELECT o.id, a.address
FROM public.organizations o
CROSS JOIN (VALUES
    ('purchase@worksquare.in'),
    ('vidya.pawar@worksquare.in'),
    ('sahil.sitaprao@worksquare.in'),
    ('satej.sadhye@autopilotoffices.com')
) AS a(address)
WHERE o.id = '211e1330-ad83-446d-941f-dcea48396798'
ON CONFLICT (organization_id, address) DO NOTHING;
