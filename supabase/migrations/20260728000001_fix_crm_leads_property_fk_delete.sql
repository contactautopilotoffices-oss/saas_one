-- Migration: Preserve location text on leads when property is deleted from Property Management
CREATE OR REPLACE FUNCTION preserve_lead_location_on_property_delete()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE crm_leads
    SET location = COALESCE(NULLIF(location, ''), OLD.name),
        property_interest = NULL
    WHERE property_interest = OLD.id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_preserve_lead_location ON properties;
CREATE TRIGGER trg_preserve_lead_location
BEFORE DELETE ON properties
FOR EACH ROW
EXECUTE FUNCTION preserve_lead_location_on_property_delete();

-- Foreign key constraint update
ALTER TABLE crm_leads
DROP CONSTRAINT IF EXISTS crm_leads_property_interest_fkey;

ALTER TABLE crm_leads
ADD CONSTRAINT crm_leads_property_interest_fkey
FOREIGN KEY (property_interest) REFERENCES properties(id) ON DELETE SET NULL;

