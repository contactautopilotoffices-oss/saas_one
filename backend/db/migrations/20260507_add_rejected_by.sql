-- Add rejected_by column to material_requests
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES users(id);
