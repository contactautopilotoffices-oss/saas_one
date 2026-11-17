-- =================================================================================
-- Migration: 20261104000003_ticket_reply_notifications.sql
-- Description: owner 2026-11-04 — WhatsApp notification when someone replies on a ticket, and swipe-reply back from WhatsApp.
--   Example: Lohit raises a ticket, Rahul (assignee) replies "I need the approval first" -> Lohit gets it on WhatsApp.
--   Lohit swipes right on that WhatsApp message and answers -> it becomes Lohit's comment on the ticket -> Rahul gets it.
--
--   trg_ticket_comments_outbox  the ONLY hook. It sits on the table, so web, mobile and WhatsApp replies all pass through it.
--                               All the rules for who is notified live here:
--                                 assignee wrote           -> the raiser is notified
--                                 raiser wrote             -> the assignee is notified
--                                 raiser is the assignee   -> nobody
--                                 anyone else wrote        -> nobody
--                                 internal note            -> nobody
--                                 automatic system comment -> nobody (metadata.system_update = true)
--   event_outbox.entity_id is the COMMENT id, not the ticket id: both 2-minute dedup checks match on entity_id, so with the
--   ticket id a second quick reply on the same ticket would be dropped.
--
--   whatsapp_outgoing_context   gains the 'ticket_reply' workflow: it links a sent WhatsApp message to its comment, which
--                               is how a swipe-reply finds its ticket.
--   ticket_comments.metadata    already exists in the live database but no migration created it; recorded here.
--   idx_ticket_comments_whatsapp_message  the same WhatsApp message can never add the comment twice.
--
-- Safety: ADDITIVE. One new trigger and function, one index, one wider CHECK. No existing row is changed.
--         A failure inside the trigger is logged and never blocks the comment from saving.
--         Safe to re-run: the trigger is dropped before it is created, so it can never be attached twice.
-- Before applying (read-only check). It must list only ticket_comments_update_timestamp, plus trg_ticket_comments_outbox on a re-run.
--   If anything else is listed, stop: it may already send comment notifications.
--     SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--     WHERE tgrelid = 'public.ticket_comments'::regclass AND NOT tgisinternal;
-- How to apply: run this file once in the Supabase SQL Editor, AFTER the ticket_reply_v1 template is approved and the code is deployed.
-- Rollback:   DROP TRIGGER IF EXISTS trg_ticket_comments_outbox ON public.ticket_comments;
--             DROP FUNCTION IF EXISTS public.fn_ticket_comments_outbox();
--             DROP INDEX IF EXISTS public.idx_ticket_comments_whatsapp_message;
--             DELETE FROM public.whatsapp_outgoing_context WHERE workflow = 'ticket_reply';
--             ALTER TABLE public.whatsapp_outgoing_context DROP CONSTRAINT whatsapp_outgoing_context_workflow_check;
--             ALTER TABLE public.whatsapp_outgoing_context ADD CONSTRAINT whatsapp_outgoing_context_workflow_check
--                 CHECK (workflow IN ('menu','booking','ticket','task'));
-- =================================================================================

BEGIN;

ALTER TABLE public.ticket_comments ADD COLUMN IF NOT EXISTS metadata JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_comments_whatsapp_message
    ON public.ticket_comments ((metadata->>'whatsapp_message_id'))
    WHERE (metadata->>'whatsapp_message_id') IS NOT NULL;

ALTER TABLE public.whatsapp_outgoing_context DROP CONSTRAINT IF EXISTS whatsapp_outgoing_context_workflow_check;
ALTER TABLE public.whatsapp_outgoing_context ADD CONSTRAINT whatsapp_outgoing_context_workflow_check
    CHECK (workflow IN ('menu','booking','ticket','task','ticket_reply'));

CREATE OR REPLACE FUNCTION public.fn_ticket_comments_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_ticket RECORD;
    v_org_id UUID;
    v_recipient_id UUID;
    v_recipient_role TEXT;
BEGIN
    IF COALESCE(NEW.is_internal, FALSE) OR COALESCE(NEW.metadata->>'system_update', '') = 'true' THEN
        RETURN NEW;
    END IF;

    SELECT id, ticket_number, title, property_id, organization_id, raised_by, assigned_to
    INTO v_ticket
    FROM public.tickets
    WHERE id = NEW.ticket_id;

    IF NOT FOUND OR v_ticket.raised_by IS NULL OR v_ticket.assigned_to IS NULL
       OR v_ticket.raised_by = v_ticket.assigned_to THEN
        RETURN NEW;
    END IF;

    IF NEW.user_id = v_ticket.assigned_to THEN
        v_recipient_id := v_ticket.raised_by;
        v_recipient_role := 'requester';
    ELSIF NEW.user_id = v_ticket.raised_by THEN
        v_recipient_id := v_ticket.assigned_to;
        v_recipient_role := 'assignee';
    ELSE
        RETURN NEW;
    END IF;

    v_org_id := v_ticket.organization_id;
    IF v_org_id IS NULL AND v_ticket.property_id IS NOT NULL THEN
        SELECT organization_id INTO v_org_id FROM public.properties WHERE id = v_ticket.property_id LIMIT 1;
    END IF;

    INSERT INTO public.event_outbox (event_type, entity_id, payload)
    VALUES ('TICKET_REPLY', NEW.id, jsonb_build_object(
        'comment_id', NEW.id,
        'ticket_id', v_ticket.id,
        'ticket_number', v_ticket.ticket_number,
        'title', v_ticket.title,
        'property_id', v_ticket.property_id,
        'organization_id', v_org_id,
        'sender_id', NEW.user_id,
        'recipient_id', v_recipient_id,
        'recipient_role', v_recipient_role,
        'message', NEW.comment,
        'created_at', NEW.created_at
    ));

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- A missed notification must never cost the person their comment.
    RAISE WARNING 'fn_ticket_comments_outbox failed for comment %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_ticket_comments_outbox ON public.ticket_comments;
CREATE TRIGGER trg_ticket_comments_outbox
    AFTER INSERT ON public.ticket_comments
    FOR EACH ROW EXECUTE FUNCTION public.fn_ticket_comments_outbox();

COMMIT;
