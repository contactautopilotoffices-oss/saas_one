-- Drop the unique constraint on (user_id, property_id) to allow vendors to have multiple shops per property
ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_user_id_property_id_key;
