-- Migration: 20261112000001_property_call_language.sql
-- Description: The language of the automatic phone call a person gets when a ticket is assigned
-- to them, chosen per property in Property Management: 'en' English (default), 'hi' Hindi,
-- 'mr' Marathi, 'kn' Kannada. The ticket title is always read in English.
-- Read by NotificationService (ticket assignment call) via backend/lib/voice/ticketCallScript.ts.

BEGIN;

ALTER TABLE public.properties
    ADD COLUMN IF NOT EXISTS call_language text NOT NULL DEFAULT 'en';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'properties_call_language_check'
    ) THEN
        ALTER TABLE public.properties
            ADD CONSTRAINT properties_call_language_check CHECK (call_language IN ('en', 'hi', 'mr', 'kn'));
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
