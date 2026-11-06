-- =================================================================================
-- Migration: 20261028140001_task_manager_ai_models.sql
-- Description: owner 2026-10-28 — which AI model each Task Manager job uses (Control Center → "AI models").
--   task_manager_ai_models: one row per job, `models` = main model first, then backups (at most 4).
--   No row = the job uses today's models (exactly as before this table existed).
-- Safety: ADDITIVE ONLY. One new empty table (row level security on, no policies: only server code with the service role
--         reads or writes it). No existing table or row is touched. Safe to re-run.
--         The app works before this is applied: every job keeps today's models and the dropdowns are disabled.
-- How to apply: run this file once in the Supabase SQL Editor (after 20261028100001).
-- Rollback:   DROP TABLE public.task_manager_ai_models;
-- =================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.task_manager_ai_models (
    job TEXT PRIMARY KEY CHECK (job IN (
        'wa_understand', 'wa_reply', 'wa_tidy', 'voice_transcribe', 'voice_cleanup',
        'import_image', 'import_text', 'superuser_chat', 'learning_loop', 'duplicate_check'
    )),
    models TEXT[] NOT NULL CHECK (cardinality(models) BETWEEN 1 AND 4),
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.task_manager_ai_models ENABLE ROW LEVEL SECURITY;

COMMIT;
