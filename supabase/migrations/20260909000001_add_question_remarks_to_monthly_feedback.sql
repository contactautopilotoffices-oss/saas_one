-- Add question-level remark columns to monthly_requisition_feedback table
ALTER TABLE public.monthly_requisition_feedback
ADD COLUMN IF NOT EXISTS hk_received_remark TEXT,
ADD COLUMN IF NOT EXISTS hk_quality_remark TEXT,
ADD COLUMN IF NOT EXISTS manpower_quality_remark TEXT,
ADD COLUMN IF NOT EXISTS manpower_reliever_remark TEXT,
ADD COLUMN IF NOT EXISTS amc_report_remark TEXT,
ADD COLUMN IF NOT EXISTS amc_schedule_remark TEXT;
