-- Read-only checks AFTER the additive interpreter migration.
-- All rows should report ready=true before enabling the pilot.
SELECT check_name, ready FROM (VALUES
    ('assistant sessions', to_regclass('public.whatsapp_assistant_sessions') IS NOT NULL),
    ('assistant events', to_regclass('public.whatsapp_assistant_events') IS NOT NULL),
    ('Task Manager conversation context', to_regclass('public.conversation_context') IS NOT NULL),
    ('Task Manager audit', to_regclass('public.task_audit_logs') IS NOT NULL),
    ('interpreter settings', to_regclass('public.whatsapp_interpreter_settings') IS NOT NULL),
    ('quoted reply context', to_regclass('public.whatsapp_outgoing_context') IS NOT NULL),
    ('assistant enqueue RPC', to_regprocedure('public.whatsapp_assistant_enqueue(jsonb)') IS NOT NULL),
    ('assistant property access RPC', to_regprocedure('public.whatsapp_assistant_properties(uuid)') IS NOT NULL),
    ('assistant claim RPC', to_regprocedure('public.whatsapp_assistant_claim(text,uuid)') IS NOT NULL),
    ('assistant save RPC', to_regprocedure('public.whatsapp_assistant_save(uuid,uuid,jsonb,jsonb)') IS NOT NULL),
    ('assistant finish RPC', to_regprocedure('public.whatsapp_assistant_finish(uuid,uuid,text)') IS NOT NULL),
    ('assistant fail RPC', to_regprocedure('public.whatsapp_assistant_fail(uuid,uuid,text)') IS NOT NULL),
    ('booking range RPC', to_regprocedure('public.whatsapp_assistant_book_range(uuid,uuid,uuid,date,time,time,uuid)') IS NOT NULL),
    ('booking notes RPC', to_regprocedure('public.whatsapp_assistant_book_range(uuid,uuid,uuid,date,time,time,uuid,text)') IS NOT NULL),
    ('ticket request ID', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tickets' AND column_name='wa_assistant_request_id')),
    ('ticket completion marker', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tickets' AND column_name='wa_assistant_completed')),
    ('ticket immutable input', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tickets' AND column_name='wa_assistant_input_hash')),
    ('booking request ID', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='meeting_room_bookings' AND column_name='wa_assistant_request_id')),
    ('ticket idempotency uniqueness', EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid
        WHERE c.conrelid=to_regclass('public.tickets') AND c.contype='u' AND a.attname='wa_assistant_request_id' AND c.conkey=ARRAY[a.attnum])),
    ('booking idempotency uniqueness', EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid
        WHERE c.conrelid=to_regclass('public.meeting_room_bookings') AND c.contype='u' AND a.attname='wa_assistant_request_id' AND c.conkey=ARRAY[a.attnum])),
    ('booking overlap protection', EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.meeting_room_bookings')
        AND conname='meeting_room_no_overlap' AND contype='x')),
    ('settings RLS', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.whatsapp_interpreter_settings')),false)),
    ('reply context RLS', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.whatsapp_outgoing_context')),false))
) AS checks(check_name,ready) ORDER BY check_name;
