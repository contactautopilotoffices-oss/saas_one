-- ============================================================
-- Company Management & Shared Meeting Room Credits
-- ============================================================

-- 1. Create Companies table
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    logo_url TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (property_id, name)
);

-- 2. Create Company Members table (Many-to-One: User belongs to one Company per property)
CREATE TABLE IF NOT EXISTS company_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member', -- member | admin
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, company_id) -- User can be in multiple companies if they are across different properties, but usually one
);

-- 3. Update meeting_room_credits to support company_id
ALTER TABLE meeting_room_credits ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE meeting_room_credits ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE meeting_room_credits ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- 4. Update meeting_room_bookings and credit_log to support company_id tracking
ALTER TABLE meeting_room_bookings ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE meeting_room_bookings ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE meeting_room_credit_log ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE meeting_room_credit_log ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- Update uniqueness constraint: either user_id OR company_id must be unique per property
-- We'll drop the old unique constraint and add new ones
ALTER TABLE meeting_room_credits DROP CONSTRAINT IF EXISTS meeting_room_credits_property_id_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mrc_property_user ON meeting_room_credits (property_id, user_id) WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mrc_property_company ON meeting_room_credits (property_id, company_id) WHERE user_id IS NULL;

-- 5. RLS Policies for Companies
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_members ENABLE ROW LEVEL SECURITY;

-- Only policy: Authenticated users can view company data
CREATE POLICY "authenticated_view_companies" ON companies
    FOR SELECT USING (auth.role() = 'authenticated');

-- Only policy: Authenticated users can view membership data
CREATE POLICY "authenticated_view_members" ON company_members
    FOR SELECT USING (auth.role() = 'authenticated');

-- 6. Refresh PostgREST schema
NOTIFY pgrst, 'reload schema';
