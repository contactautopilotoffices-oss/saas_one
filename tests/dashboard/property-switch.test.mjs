import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('PropertyAdminDashboard switches property via query param without rewriting /property/[id] route segment', () => {
    const source = readFileSync('frontend/components/dashboard/PropertyAdminDashboard.tsx', 'utf8');

    assert.match(source, /propPropertyId \|\| searchParams\.get\('propertyId'\) \|\| urlPropertyId/);
    assert.match(source, /currentUrl\.searchParams\.set\('propertyId', id\);\s*pushDashboardNavigation\(/);
    assert.doesNotMatch(source, /router\.push\(`\$\{newPath\}/);

    // Selecting All Properties on the roster tab renders the property prompt instead of passing propertyId="all"
    assert.match(source, /openTab === 'roster' && property && \(\s*property\.id === 'all'/);
    assert.match(source, /<RosterDashboard key=\{property\.id\} propertyId=\{property\.id\} \/>/);
});

test('OrgAdminDashboard switches property client-side without full router navigation and keys RosterDashboard by property', () => {
    const source = readFileSync('frontend/components/dashboard/OrgAdminDashboard.tsx', 'utf8');

    const fnMatch = source.match(/const handlePropertyChange = \(id: string\) => \{[\s\S]*?\n    \};/);
    assert.ok(fnMatch, 'handlePropertyChange should exist in OrgAdminDashboard');
    assert.doesNotMatch(fnMatch[0], /router\.(push|replace)\(/);
    assert.match(fnMatch[0], /window\.history\.replaceState\(null, '', href\)/);
    assert.match(source, /<RosterDashboard key=\{selectedPropertyId\} propertyId=\{selectedPropertyId\} \/>/);
});
