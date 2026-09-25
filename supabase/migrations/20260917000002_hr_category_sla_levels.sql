-- Migration: 20260917000002_hr_category_sla_levels.sql
-- Description: Add l5_sla_days..l10_sla_days columns and convert SLA columns to NUMERIC(10, 6) for fractional day TATs (hours & minutes)

ALTER TABLE IF EXISTS public.hr_ticket_categories
ADD COLUMN IF NOT EXISTS l5_sla_days NUMERIC(10, 6) DEFAULT 15,
ADD COLUMN IF NOT EXISTS l6_sla_days NUMERIC(10, 6) DEFAULT 18,
ADD COLUMN IF NOT EXISTS l7_sla_days NUMERIC(10, 6) DEFAULT 21,
ADD COLUMN IF NOT EXISTS l8_sla_days NUMERIC(10, 6) DEFAULT 24,
ADD COLUMN IF NOT EXISTS l9_sla_days NUMERIC(10, 6) DEFAULT 27,
ADD COLUMN IF NOT EXISTS l10_sla_days NUMERIC(10, 6) DEFAULT 30;

ALTER TABLE IF EXISTS public.hr_ticket_categories
ALTER COLUMN l1_sla_days TYPE NUMERIC(10, 6) USING l1_sla_days::NUMERIC(10, 6),
ALTER COLUMN l2_sla_days TYPE NUMERIC(10, 6) USING l2_sla_days::NUMERIC(10, 6),
ALTER COLUMN l3_sla_days TYPE NUMERIC(10, 6) USING l3_sla_days::NUMERIC(10, 6),
ALTER COLUMN l4_sla_days TYPE NUMERIC(10, 6) USING l4_sla_days::NUMERIC(10, 6),
ALTER COLUMN l5_sla_days TYPE NUMERIC(10, 6) USING l5_sla_days::NUMERIC(10, 6),
ALTER COLUMN l6_sla_days TYPE NUMERIC(10, 6) USING l6_sla_days::NUMERIC(10, 6),
ALTER COLUMN l7_sla_days TYPE NUMERIC(10, 6) USING l7_sla_days::NUMERIC(10, 6),
ALTER COLUMN l8_sla_days TYPE NUMERIC(10, 6) USING l8_sla_days::NUMERIC(10, 6),
ALTER COLUMN l9_sla_days TYPE NUMERIC(10, 6) USING l9_sla_days::NUMERIC(10, 6),
ALTER COLUMN l10_sla_days TYPE NUMERIC(10, 6) USING l10_sla_days::NUMERIC(10, 6);
