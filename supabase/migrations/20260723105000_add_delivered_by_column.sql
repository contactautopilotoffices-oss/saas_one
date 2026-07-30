ALTER TABLE material_requests ADD COLUMN delivered_by UUID REFERENCES auth.users(id);
