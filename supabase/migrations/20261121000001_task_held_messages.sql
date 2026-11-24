-- =========================================================
-- Task assistant: messages to other people wait 1 minute (owner 2026-11-21: "don't ask for a yes confirmation. just
-- perform and give an undo option", option A: "the message to the other person waits 1 minute before it goes").
--
-- When the WhatsApp task assistant changes something (gives, hands over, changes, reminds, marks done, answers a request),
-- the WhatsApp message and the app bell for any OTHER person are parked here for 1 minute instead of being sent at once.
-- "undo" within that minute cancels them, so the other person never hears about it. The job /api/cron/task-held-messages
-- (every minute) sends the ones whose minute is up, through the same sending code as before (kill switches, Pretend Mode).
--
-- Until this file is run, nothing is parked: messages go at once, exactly as before (the code falls back by itself).
-- Additive only: one new table, nothing else is changed. Safe to run twice.
-- =========================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.task_held_messages (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id     uuid NOT NULL,                      -- the person whose change caused the message
    kind         text NOT NULL CHECK (kind IN ('whatsapp', 'bell')),
    payload      jsonb NOT NULL,                     -- whatsapp: {phone, text, options} · bell: the taskBell input
    send_after   timestamptz NOT NULL,
    status       text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'sending', 'sent', 'cancelled', 'failed')),
    attempts     integer NOT NULL DEFAULT 0,
    last_error   text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz
);

CREATE INDEX IF NOT EXISTS task_held_messages_due_idx ON public.task_held_messages (send_after) WHERE status = 'held';
CREATE INDEX IF NOT EXISTS task_held_messages_actor_idx ON public.task_held_messages (actor_id, created_at DESC);

-- Server only (the service role). Nobody reads or writes it from the browser.
ALTER TABLE public.task_held_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_held_messages FROM anon, authenticated;

COMMIT;
