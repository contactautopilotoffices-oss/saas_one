-- =================================================================================
-- Migration: 20261014000001_whatsapp_bot_review_upgrade.sql
-- Bot review upgrade (docs/BOT_REVIEW_UPGRADE_PLAN.md): keep the bot's reply and the person's next message with each
-- review item, store the AI's plain-language summary, and a "Needs a developer" list.
-- ADDITIVE: new nullable columns, a wider status list, and the label function also accepting developer items.
-- No rows are changed or removed. Safe to re-run.
-- This file is written by the agent but must be applied manually by the owner.
-- Until it is applied, the code keeps the old behaviour (it checks for these columns first).
-- Rollback (manual):
--   ALTER TABLE public.whatsapp_bot_review_items DROP CONSTRAINT IF EXISTS whatsapp_bot_review_items_status_check;
--   DELETE FROM public.whatsapp_bot_review_items WHERE status IN ('recent','developer');   -- only if rolling back
--   ALTER TABLE public.whatsapp_bot_review_items ADD CONSTRAINT whatsapp_bot_review_items_status_check
--     CHECK (status IN ('provisional','waiting','labelled','ignored'));
--   ALTER TABLE public.whatsapp_bot_review_items DROP COLUMN IF EXISTS bot_reply, DROP COLUMN IF EXISTS follow_up,
--     DROP COLUMN IF EXISTS ai_summary, DROP COLUMN IF EXISTS fix_owner, DROP COLUMN IF EXISTS dev_state;
--   Re-run the whatsapp_bot_label_review function from 20261011000003_whatsapp_bot_learning.sql.
-- =================================================================================

ALTER TABLE public.whatsapp_bot_review_items
    ADD COLUMN IF NOT EXISTS bot_reply TEXT,
    ADD COLUMN IF NOT EXISTS follow_up JSONB,
    ADD COLUMN IF NOT EXISTS ai_summary JSONB,
    ADD COLUMN IF NOT EXISTS fix_owner TEXT,
    ADD COLUMN IF NOT EXISTS dev_state TEXT;

-- 'recent'    = the person's last answered message, kept 10 minutes so a correction ("no, I meant…") can find it.
-- 'developer' = approved as "Needs a developer"; never purged.
ALTER TABLE public.whatsapp_bot_review_items DROP CONSTRAINT IF EXISTS whatsapp_bot_review_items_status_check;
ALTER TABLE public.whatsapp_bot_review_items ADD CONSTRAINT whatsapp_bot_review_items_status_check
    CHECK (status IN ('provisional','recent','waiting','labelled','ignored','developer'));

ALTER TABLE public.whatsapp_bot_review_items DROP CONSTRAINT IF EXISTS whatsapp_bot_review_items_fix_owner_check;
ALTER TABLE public.whatsapp_bot_review_items ADD CONSTRAINT whatsapp_bot_review_items_fix_owner_check
    CHECK (fix_owner IS NULL OR fix_owner IN ('learn','developer'));

ALTER TABLE public.whatsapp_bot_review_items DROP CONSTRAINT IF EXISTS whatsapp_bot_review_items_dev_state_check;
ALTER TABLE public.whatsapp_bot_review_items ADD CONSTRAINT whatsapp_bot_review_items_dev_state_check
    CHECK (dev_state IS NULL OR dev_state IN ('new','in_progress','fixed'));

CREATE INDEX IF NOT EXISTS idx_whatsapp_bot_review_recent ON public.whatsapp_bot_review_items(phone_key, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_bot_review_owner ON public.whatsapp_bot_review_items(fix_owner, updated_at);

-- Same as before, but a developer case marked Fixed can also become a permanent test.
CREATE OR REPLACE FUNCTION public.whatsapp_bot_label_review(p_review_id uuid, p_label jsonb, p_reviewer text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.whatsapp_bot_review_items; out_id uuid;
BEGIN
  SELECT * INTO v FROM public.whatsapp_bot_review_items WHERE id=p_review_id AND status IN ('waiting','developer') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'review item is not waiting'; END IF;
  INSERT INTO public.whatsapp_bot_eval_cases(review_item_id,case_key,message_text,context_snapshot,expectation,created_by)
  VALUES(v.id,'live-'||v.id,v.message_text,v.context_snapshot,p_label,p_reviewer)
  ON CONFLICT(review_item_id) DO UPDATE SET expectation=EXCLUDED.expectation, created_by=EXCLUDED.created_by RETURNING id INTO out_id;
  UPDATE public.whatsapp_bot_review_items SET status='labelled',label=p_label,reviewed_at=now(),reviewed_by=p_reviewer,updated_at=now() WHERE id=v.id;
  RETURN out_id;
END $$;

REVOKE ALL ON FUNCTION public.whatsapp_bot_label_review(uuid,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_label_review(uuid,jsonb,text) TO service_role;
