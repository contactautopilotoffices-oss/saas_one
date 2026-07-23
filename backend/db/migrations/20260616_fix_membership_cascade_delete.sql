-- =========================================================
-- FIX MEMBERSHIP CASCADE DELETE
-- Changes ON DELETE CASCADE to ON DELETE SET NULL so that
-- deleting a membership doesn't delete the user from the system.
-- =========================================================

-- Drop existing foreign key constraints
ALTER TABLE property_memberships DROP CONSTRAINT IF EXISTS property_memberships_user_id_fkey;
ALTER TABLE organization_memberships DROP CONSTRAINT IF EXISTS organization_memberships_user_id_fkey;

-- Recreate with SET NULL instead of CASCADE
ALTER TABLE property_memberships ADD CONSTRAINT property_memberships_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE organization_memberships ADD CONSTRAINT organization_memberships_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
