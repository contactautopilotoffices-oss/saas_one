-- ============================================================================
-- TICKET NOTIFICATIONS -> OMNICHANNEL, VIA TRIGGERS ONLY   (owner 2026-11-16)
--
-- The ticket API routes no longer notify anyone directly. Every alert now starts
-- from the two triggers below, and EventProcessor / WhatsAppEventProcessor resolve
-- the recipients and the channels from the Omnichannel matrix, so
-- Settings -> Notifications -> Tickets is the only place that decides who is told
-- and how. Anything that writes to these tables raises the same notifications --
-- the web app, the WhatsApp bot and the mobile app alike.
--
-- NOTHING IS DROPPED. No DROP, DELETE, TRUNCATE or ALTER anywhere in this file.
-- Each function body is swapped in place with CREATE OR REPLACE, so a live trigger
-- keeps pointing at it and never stops firing. Each trigger is created only when
-- this database does not already have it. Safe to run more than once.
--
-- PART 1  ticket_comments  -- the reply trigger. A 2026-11-16 inventory shows
--         public.ticket_comments carrying only ticket_comments_update_timestamp, so
--         the trigger from 20261104000003 was never installed and no reply has ever
--         raised an outbox event here. This is the one new trigger in this file.
-- PART 2  tickets          -- trg_tickets_outbox is already live; only the function
--         body changes, to add the three fields its handlers always needed.
-- ============================================================================


-- ============================================================================
-- PART 1 -- TICKET REPLIES
--
-- The old function picked exactly ONE recipient itself, and only when the ticket
-- had both a requester and an assignee AND the commenter was one of those two. So a
-- property admin or staff member replying on an unassigned client ticket notified
-- nobody, and the recipients and roles chosen under "Ticket Reply" were ignored.
--
-- Now the trigger only reports what happened -- who replied, on which ticket, who the
-- requester and the assignee are. The processors choose the recipients from
-- notification_matrix.tickets.ticket_reply, with the author always excluded.
-- Internal notes and system status lines still never leave the building.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_ticket_comments_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_ticket RECORD;
    v_org_id UUID;
BEGIN
    IF COALESCE(NEW.is_internal, FALSE) OR COALESCE(NEW.metadata->>'system_update', '') = 'true' THEN
        RETURN NEW;
    END IF;

    SELECT id, ticket_number, title, property_id, organization_id, raised_by, assigned_to
    INTO v_ticket
    FROM public.tickets
    WHERE id = NEW.ticket_id;

    IF NOT FOUND THEN
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
        'requester_id', v_ticket.raised_by,
        'assignee_id', v_ticket.assigned_to,
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

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_ticket_comments_outbox'
          AND tgrelid = 'public.ticket_comments'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_ticket_comments_outbox
            AFTER INSERT ON public.ticket_comments
            FOR EACH ROW EXECUTE FUNCTION public.fn_ticket_comments_outbox();
        RAISE NOTICE 'Created trg_ticket_comments_outbox on public.ticket_comments';
    ELSE
        RAISE NOTICE 'trg_ticket_comments_outbox already present; left as it is';
    END IF;
END $$;


-- ============================================================================
-- PART 2 -- THE TICKET ITSELF
--
-- Three gaps in the old payload stopped the matrix from governing everything:
--   1. no old_priority, so isTicketEscalatedToCritical() always answered "no" and
--      the Critical Priority alert never fired from the outbox at all;
--   2. an UPDATE that only changed priority raised no event, so escalating a ticket
--      to Critical was invisible;
--   3. no validation_status, so a client approving or rejecting completed work could
--      not be told apart from any other status change.
--
-- is_internal and validation_status are read through to_jsonb(NEW) rather than
-- NEW.<column>: if either column is missing on this database the field simply arrives
-- as null, where a direct reference would raise and take the ticket insert or update
-- down with it.
--
-- Event names are unchanged (TICKET_CREATED / TICKET_UPDATED), so every existing
-- handler keeps working and only receives more of what it already asked for.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_tickets_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type TEXT;
    v_payload JSONB;
    v_org_id UUID;
    v_new JSONB;
    v_old JSONB;
BEGIN
    v_org_id := NEW.organization_id;
    IF v_org_id IS NULL AND NEW.property_id IS NOT NULL THEN
        SELECT organization_id INTO v_org_id FROM public.properties WHERE id = NEW.property_id LIMIT 1;
    END IF;

    v_new := to_jsonb(NEW);

    IF TG_OP = 'INSERT' THEN
        v_event_type := 'TICKET_CREATED';
        v_payload := jsonb_build_object(
            'ticket_id', NEW.id,
            'ticket_number', NEW.ticket_number,
            'title', NEW.title,
            'description', NEW.description,
            'status', NEW.status,
            'priority', NEW.priority,
            'property_id', NEW.property_id,
            'organization_id', v_org_id,
            'raised_by', NEW.raised_by,
            'assigned_to', NEW.assigned_to,
            'is_internal', v_new -> 'is_internal',
            'sla_deadline', NEW.sla_deadline,
            'photo_before_url', NEW.photo_before_url
        );
    ELSIF TG_OP = 'UPDATE' THEN
        v_old := to_jsonb(OLD);
        IF NEW.status IS DISTINCT FROM OLD.status
           OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
           OR NEW.priority IS DISTINCT FROM OLD.priority
           OR (v_new -> 'validation_status') IS DISTINCT FROM (v_old -> 'validation_status') THEN
            v_event_type := 'TICKET_UPDATED';
            v_payload := jsonb_build_object(
                'ticket_id', NEW.id,
                'ticket_number', NEW.ticket_number,
                'title', NEW.title,
                'status', NEW.status,
                'old_status', OLD.status,
                'priority', NEW.priority,
                'old_priority', OLD.priority,
                'property_id', NEW.property_id,
                'organization_id', v_org_id,
                'raised_by', NEW.raised_by,
                'assigned_to', NEW.assigned_to,
                'old_assigned_to', OLD.assigned_to,
                'is_internal', v_new -> 'is_internal',
                'validation_status', v_new -> 'validation_status',
                'old_validation_status', v_old -> 'validation_status',
                'sla_deadline', NEW.sla_deadline,
                'resolution_notes', NEW.resolution_notes,
                'photo_after_url', NEW.photo_after_url
            );
        END IF;
    END IF;

    IF v_event_type IS NOT NULL THEN
        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES (v_event_type, NEW.id, v_payload);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_tickets_outbox'
          AND tgrelid = 'public.tickets'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_tickets_outbox
            AFTER INSERT OR UPDATE ON public.tickets
            FOR EACH ROW EXECUTE FUNCTION public.fn_tickets_outbox();
        RAISE NOTICE 'Created trg_tickets_outbox on public.tickets';
    ELSE
        RAISE NOTICE 'trg_tickets_outbox already present; only its function body was replaced';
    END IF;
END $$;


-- ============================================================================
-- OPTIONAL -- changes data, so it is commented out. Run it only if you want email
-- and in-app/push for ticket replies switched on for organisations that have
-- ALREADY saved Omnichannel settings.
--
-- The new code defaults are email + WhatsApp + in-app/push ON, but a saved matrix
-- always wins, and the saved value for ticket_reply is WhatsApp only. Either flip the
-- three channel buttons per org in Settings -> Notifications -> Tickets ->
-- "Ticket Reply", or uncomment and run this once. Roles and added users are kept.
-- ============================================================================

-- UPDATE public.organization_settings
-- SET notification_matrix = jsonb_set(
--         COALESCE(notification_matrix, '{}'::jsonb),
--         '{tickets,ticket_reply}',
--         COALESCE(notification_matrix -> 'tickets' -> 'ticket_reply', '{}'::jsonb)
--             || jsonb_build_object(
--                 'enabled', TRUE,
--                 'channels', COALESCE(notification_matrix -> 'tickets' -> 'ticket_reply' -> 'channels', '{}'::jsonb)
--                     || jsonb_build_object('email', TRUE, 'whatsapp', TRUE, 'push', TRUE),
--                 'notify_requester', TRUE,
--                 'notify_assignee', TRUE
--             ),
--         TRUE
--     )
-- WHERE notification_matrix -> 'tickets' -> 'ticket_reply' IS NOT NULL;
