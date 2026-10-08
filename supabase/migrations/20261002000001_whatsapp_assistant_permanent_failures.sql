BEGIN;

-- Terminal provider/configuration failures should not hold up later greetings.
-- Keep the existing retry RPC unchanged for timeouts, rate limits and server errors.
CREATE OR REPLACE FUNCTION public.whatsapp_assistant_fail(p_id uuid, p_token uuid, p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_phone text;
BEGIN
    IF p_token IS NULL OR p_error IS NULL THEN RAISE EXCEPTION 'A lease and failure reason are required'; END IF;
    SELECT phone INTO v_phone FROM whatsapp_assistant_events WHERE id = p_id;
    PERFORM 1 FROM whatsapp_assistant_sessions WHERE phone = v_phone AND lease_token = p_token FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assistant lease lost'; END IF;
    UPDATE whatsapp_assistant_events SET status = 'failed', error = p_error, updated_at = now()
        WHERE id = p_id AND status IN ('processing', 'ready');
    IF NOT FOUND THEN RAISE EXCEPTION 'Event is not claimed'; END IF;
    UPDATE whatsapp_assistant_sessions SET lease_token = NULL, locked_until = NULL, updated_at = now()
        WHERE phone = v_phone;
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_assistant_fail(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_assistant_fail(uuid,uuid,text) TO service_role;

COMMIT;
