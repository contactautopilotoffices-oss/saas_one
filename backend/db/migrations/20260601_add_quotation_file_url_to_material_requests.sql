-- Migration: Add quotation_file_url column to material_requests
-- Date: 2026-06-01

ALTER TABLE material_requests
  ADD COLUMN quotation_file_url TEXT;
