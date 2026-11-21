-- =========================================================
-- The IT team (owner 2026-11-20: "create IT as a team and not as category"; tickets that tag the IT person go to it,
-- see backend/lib/ticketing/itRule.ts; a starter "IT support" category so it works from day one).
--
-- Only for properties whose organisation has someone with the IT role, so no other organisation is affected.
-- Adds, at each such property:
--   1. the team "IT" (skill_groups, code 'it')
--   2. the category "IT support" (issue_categories, code 'it_support'), team IT, medium priority, 24 h SLA.
--      Rename it, change its SLA or add more IT categories in Brain -> Categories & SLAs.
-- Safe to run twice: nothing is added where it already exists, and nothing is changed or deleted.
-- =========================================================

-- 1. The IT team
INSERT INTO skill_groups (property_id, code, name, description, is_manual_assign, is_active)
SELECT p.id, 'it', 'IT', 'IT support: tickets that tag the IT person', false, true
FROM properties p
WHERE EXISTS (
    SELECT 1 FROM organization_memberships om
    WHERE om.organization_id = p.organization_id AND om.role = 'it' AND om.is_active = true
)
AND NOT EXISTS (
    SELECT 1 FROM skill_groups sg WHERE sg.property_id = p.id AND sg.code = 'it'
);

-- 2. The starter category "IT support", on the property's IT team
INSERT INTO issue_categories (property_id, code, name, skill_group_id, sla_hours, priority, is_active)
SELECT sg.property_id, 'it_support', 'IT support', sg.id, 24, 'medium', true
FROM skill_groups sg
WHERE sg.code = 'it'
AND sg.property_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM issue_categories ic WHERE ic.property_id = sg.property_id AND ic.code = 'it_support'
);

-- Check: one row per property that now has the IT team and its starter category.
SELECT p.name AS property, sg.name AS team, ic.name AS category, ic.sla_hours
FROM skill_groups sg
JOIN properties p ON p.id = sg.property_id
LEFT JOIN issue_categories ic ON ic.property_id = sg.property_id AND ic.code = 'it_support'
WHERE sg.code = 'it'
ORDER BY p.name;
