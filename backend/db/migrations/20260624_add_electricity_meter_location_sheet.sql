-- Migration: Add location and sheet_name to electricity_meters
-- Created: 2026-06-24
-- Description: Adds physical location and spreadsheet "sheet" grouping columns
--              to electricity_meters so dashboards can display
--              "Sheet · Location · Meter Name" context per meter.

ALTER TABLE electricity_meters
    ADD COLUMN IF NOT EXISTS location TEXT,
    ADD COLUMN IF NOT EXISTS sheet_name TEXT;

CREATE INDEX IF NOT EXISTS idx_electricity_meters_sheet
    ON electricity_meters(property_id, sheet_name);