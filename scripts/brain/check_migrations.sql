-- Which Unified Brain / AI models migrations are applied? READ ONLY: it only looks, it changes nothing.
-- Run it in the Supabase SQL editor. One row per migration: applied = true or false.
-- It checks for the tables, columns and rules each migration creates, so it works however the migration was applied.

WITH has_table AS (
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
), has_column AS (
    SELECT table_name || '.' || column_name AS col FROM information_schema.columns WHERE table_schema = 'public'
), job_rule AS (
    SELECT coalesce(string_agg(pg_get_constraintdef(oid), ' '), '') AS def
    FROM pg_constraint WHERE conname = 'task_manager_ai_models_job_check'
)
SELECT migration, applied FROM (VALUES
    (1, '20261028140001_task_manager_ai_models',
        EXISTS (SELECT 1 FROM has_table WHERE table_name = 'task_manager_ai_models')),
    (2, '20261114000001_unified_brain_ai_model_job',
        (SELECT def LIKE '%brain_turn%' FROM job_rule)),
    (3, '20261114000002_unified_brain',
        (SELECT count(*) = 7 FROM has_table WHERE table_name IN ('ai_brain_settings', 'ai_brain_settings_history', 'ai_brain_threads',
            'ai_brain_turns', 'ai_brain_memory', 'ai_brain_episodes', 'ai_brain_attachments'))),
    (4, '20261114000003_unified_brain_console',
        EXISTS (SELECT 1 FROM has_table WHERE table_name = 'ai_brain_eval_cases')
        AND EXISTS (SELECT 1 FROM has_column WHERE col = 'ai_brain_turns.role_class')),
    (5, '20261114000004_unified_brain_learning',
        EXISTS (SELECT 1 FROM has_table WHERE table_name = 'ai_brain_guidance')
        AND EXISTS (SELECT 1 FROM has_table WHERE table_name = 'ai_brain_guidance_runs')
        AND EXISTS (SELECT 1 FROM has_column WHERE col = 'ai_brain_turns.learning')),
    (6, '20261115000001_ai_models_all_jobs',
        (SELECT def LIKE '%council_default%' FROM job_rule)),
    (7, '20261115000002_unified_brain_suggestions',
        EXISTS (SELECT 1 FROM has_column WHERE col = 'ai_brain_guidance_runs.kind')),
    (8, '20261115000003_ticket_sort_reviews',
        EXISTS (SELECT 1 FROM has_table WHERE table_name = 'ticket_sort_reviews'))
) AS m(n, migration, applied)
ORDER BY n;
