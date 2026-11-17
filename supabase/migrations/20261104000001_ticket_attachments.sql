-- =================================================================================
-- Migration: 20261104000001_ticket_attachments.sql
-- Description: owner 2026-11-03 — optional file attachments on requests (tickets): PDF, Word, Excel and images
--   (PNG, JPG, WEBP), at most 5 files per request and 10 MB per file. Files can be added when the request is raised
--   and later from the request page. Anyone who can open the request can see and download its files.
--   ticket_attachments  one row per file on a request. The files live in the new PRIVATE storage bucket
--                       "ticket-attachments"; only server code (service role) reads or writes them and hands out
--                       download links that expire after 10 minutes (same design as task_attachments,
--                       20261026000003_task_manager_upgrades.sql).
-- Safety: ADDITIVE ONLY. One new table, one new private bucket. Existing tables, rows and policies are unchanged.
--         The app works before this is applied (the Attach option just says it is not switched on yet).
--         Safe to re-run.
-- How to apply: run this file once in the Supabase SQL Editor.
-- Rollback:   DROP TABLE public.ticket_attachments;
--             DELETE FROM storage.buckets WHERE id = 'ticket-attachments';  (empty the bucket first)
-- =================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ticket_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    storage_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER NOT NULL CHECK (file_size > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket ON public.ticket_attachments(ticket_id, created_at);

-- Server code only (service role bypasses RLS); no policies, so browsers cannot read the table directly.
ALTER TABLE public.ticket_attachments ENABLE ROW LEVEL SECURITY;

-- Private bucket: 10 MB per file, documents and images only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'ticket-attachments', 'ticket-attachments', false, 10485760,
    ARRAY[
        'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;
