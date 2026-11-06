-- =================================================================================
-- Migration: 20261011000003_whatsapp_bot_learning.sql
-- Phase 5 learning review, permanent live evaluation cases, and versioned prompt sections.
-- ADDITIVE ONLY. Service-role only; RLS enabled with no client policies. Safe to re-run.
-- This file is written by the agent but must be applied manually by the owner.
-- Rollback (manual): DROP FUNCTION public.whatsapp_bot_activate_prompt(uuid,text);
--   DROP FUNCTION public.whatsapp_bot_rollback_prompt(text,text);
--   DROP FUNCTION public.whatsapp_bot_label_review(uuid,jsonb,text);
--   DROP TABLE public.whatsapp_bot_prompts, public.whatsapp_bot_eval_cases, public.whatsapp_bot_review_items;
-- =================================================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_bot_review_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), message_id TEXT UNIQUE, phone_key TEXT NOT NULL,
    message_text TEXT NOT NULL, interpretation JSONB, context_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    triggers TEXT[] NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'provisional' CHECK (status IN ('provisional','waiting','labelled','ignored')),
    label JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'), reviewed_at TIMESTAMPTZ, reviewed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_bot_review_waiting ON public.whatsapp_bot_review_items(status, created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_bot_review_expiry ON public.whatsapp_bot_review_items(expires_at);

CREATE TABLE IF NOT EXISTS public.whatsapp_bot_eval_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), review_item_id UUID UNIQUE REFERENCES public.whatsapp_bot_review_items(id),
    case_key TEXT UNIQUE NOT NULL, group_name TEXT NOT NULL DEFAULT 'live', message_text TEXT NOT NULL,
    context_snapshot JSONB NOT NULL, expectation JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.whatsapp_bot_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), prompt_key TEXT NOT NULL DEFAULT 'task_brain_understand', version INTEGER NOT NULL,
    sections JSONB NOT NULL, status TEXT NOT NULL CHECK (status IN ('draft','evaluating','waiting','active','rejected','retired')),
    change_summary TEXT, eval_before JSONB, eval_after JSONB, evaluation_state JSONB,
    estimated_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0, run_date DATE, source_label_at TIMESTAMPTZ,
    rejection_reason TEXT, created_by TEXT NOT NULL CHECK (created_by IN ('auto-tune','admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at TIMESTAMPTZ, activated_by TEXT, UNIQUE(prompt_key, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_bot_one_active_prompt ON public.whatsapp_bot_prompts(prompt_key) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_bot_one_nightly_run ON public.whatsapp_bot_prompts(prompt_key, run_date) WHERE run_date IS NOT NULL;

ALTER TABLE public.whatsapp_bot_review_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_bot_eval_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_bot_prompts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_bot_review_items, public.whatsapp_bot_eval_cases, public.whatsapp_bot_prompts FROM anon, authenticated;
GRANT ALL ON public.whatsapp_bot_review_items, public.whatsapp_bot_eval_cases, public.whatsapp_bot_prompts TO service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_label_review(p_review_id uuid, p_label jsonb, p_reviewer text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.whatsapp_bot_review_items; out_id uuid;
BEGIN
  SELECT * INTO v FROM public.whatsapp_bot_review_items WHERE id=p_review_id AND status='waiting' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'review item is not waiting'; END IF;
  INSERT INTO public.whatsapp_bot_eval_cases(review_item_id,case_key,message_text,context_snapshot,expectation,created_by)
  VALUES(v.id,'live-'||v.id,v.message_text,v.context_snapshot,p_label,p_reviewer)
  ON CONFLICT(review_item_id) DO UPDATE SET expectation=EXCLUDED.expectation, created_by=EXCLUDED.created_by RETURNING id INTO out_id;
  UPDATE public.whatsapp_bot_review_items SET status='labelled',label=p_label,reviewed_at=now(),reviewed_by=p_reviewer,updated_at=now() WHERE id=v.id;
  RETURN out_id;
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_activate_prompt(p_prompt_id uuid, p_actor text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text;
BEGIN
  SELECT prompt_key INTO k FROM public.whatsapp_bot_prompts WHERE id=p_prompt_id AND status='waiting' FOR UPDATE;
  IF k IS NULL THEN RAISE EXCEPTION 'prompt is not waiting'; END IF;
  UPDATE public.whatsapp_bot_prompts SET status='retired',updated_at=now() WHERE prompt_key=k AND status='active';
  UPDATE public.whatsapp_bot_prompts SET status='active',activated_at=now(),activated_by=p_actor,updated_at=now() WHERE id=p_prompt_id;
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_rollback_prompt(p_prompt_key text, p_actor text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE active_id uuid; previous_id uuid;
BEGIN
  SELECT id INTO active_id FROM public.whatsapp_bot_prompts WHERE prompt_key=p_prompt_key AND status='active' FOR UPDATE;
  IF active_id IS NULL THEN RAISE EXCEPTION 'no active database prompt'; END IF;
  SELECT id INTO previous_id FROM public.whatsapp_bot_prompts
    WHERE prompt_key=p_prompt_key AND status='retired' ORDER BY activated_at DESC NULLS LAST, version DESC LIMIT 1 FOR UPDATE;
  IF previous_id IS NULL THEN
    UPDATE public.whatsapp_bot_prompts SET status='retired',updated_at=now() WHERE id=active_id;
    RETURN NULL;
  END IF;
  UPDATE public.whatsapp_bot_prompts SET status='retired',updated_at=now() WHERE id=active_id;
  UPDATE public.whatsapp_bot_prompts SET status='active',activated_at=now(),activated_by=p_actor,updated_at=now() WHERE id=previous_id;
  RETURN previous_id;
END $$;

REVOKE ALL ON FUNCTION public.whatsapp_bot_label_review(uuid,jsonb,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_bot_activate_prompt(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_bot_rollback_prompt(text,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_label_review(uuid,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_activate_prompt(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_rollback_prompt(text,text) TO service_role;
