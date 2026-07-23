-- Add vendor_contact_person column to ppm_schedules for manual vendor entry contact details
ALTER TABLE ppm_schedules
    ADD COLUMN IF NOT EXISTS vendor_contact_person text;
