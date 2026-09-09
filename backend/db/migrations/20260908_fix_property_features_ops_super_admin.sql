-- Fix: Simplify property_features RLS - allow all authenticated users to read
-- The feature flags are not sensitive data, any logged-in user should be able
-- to check if a feature is enabled for a property they're viewing.

-- Drop existing restrictive SELECT policy
DROP POLICY IF EXISTS "Property Admins can view features" ON property_features;

-- Simple: any authenticated user can read property features
CREATE POLICY "Authenticated users can view features" ON property_features
    FOR SELECT TO authenticated
    USING (true);
