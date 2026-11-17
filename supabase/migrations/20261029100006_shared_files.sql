-- =================================================================================
-- Migration: 20261029100006_shared_files.sql
-- Description: owner 2026-10-29 — "Files" tab in the Design console and the Tech console: one shared drive per
--   organisation where both teams upload, download, make folders and delete (anyone on either team, any item).
--   1. public.shared_files   one row per folder or file. parent_id = the folder it is in (null = top level).
--                            A file row starts as 'uploading' and becomes 'ready' once the upload is confirmed.
--   2. storage bucket 'shared-files' (private) — 200 MB per file, any file type. Path: {organization_id}/{file id}.
--   The project's GLOBAL upload limit (Supabase dashboard → Storage → Settings) must also be at least 200 MB,
--   or Supabase still refuses larger files.
-- Safety: ADDITIVE ONLY. One new empty table (row level security on, no policies: only server code with the service
--         role reads or writes it) and one new private bucket. No existing table, row or behaviour changes.
--         Safe to re-run. The rest of the app works before this is applied; the Files tab says it is not set up.
-- How to apply: run once in the Supabase SQL Editor.
-- Rollback:   DROP TABLE public.shared_files;
--             DELETE FROM storage.buckets WHERE id = 'shared-files';  (empty the bucket first)
-- =================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.shared_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- Deleting a folder deletes everything inside it (the app removes the stored files first)
    parent_id UUID REFERENCES public.shared_files(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('folder', 'file')),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
    size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes BETWEEN 0 AND 209715200),
    mime_type TEXT,
    storage_path TEXT,
    status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('uploading', 'ready')),
    -- Which console it was added from: 'design' or 'tech'
    team TEXT NOT NULL CHECK (team IN ('design', 'tech')),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shared_files_folder_idx ON public.shared_files (organization_id, parent_id, status);

ALTER TABLE public.shared_files ENABLE ROW LEVEL SECURITY;

-- Private bucket: 200 MB per file, any type (design files, builds, archives, video).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('shared-files', 'shared-files', false, 209715200, NULL)
ON CONFLICT (id) DO NOTHING;

COMMIT;
