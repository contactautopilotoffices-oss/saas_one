-- Add vendor_phone column to ppm_schedules for manual vendor entry
ALTER TABLE ppm_schedules
    ADD COLUMN IF NOT EXISTS vendor_phone text;
