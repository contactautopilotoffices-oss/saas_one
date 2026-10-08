import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTs } from '../petty-cash/load-ts.mjs';

test('mixed external and internal memberships select an internal shell for petty cash', () => {
    for (const properties of [
        [{ id: 'staff-property', organization_id: 'org', role: 'staff' }],
        [{ id: 'tenant-property', organization_id: 'org', role: 'tenant' }, { id: 'staff-property', organization_id: 'org', role: 'staff' }],
    ]) {
        const membership = { org_id: 'org', org_role: 'tenant', properties };
        const { useDashboardContent: readScope } = loadTs('frontend/components/layout/DashboardContentSlot.tsx', {
            react: { ...React, useContext: () => 'petty body' },
            'next/navigation': { useParams: () => ({ orgId: 'org' }), useRouter: () => ({}) },
            '@/frontend/context/AuthContext': { useAuth: () => ({ membership }) },
        });
        const scope = readScope();
        assert.equal(scope.dashboardRole, 'staff');
        assert.equal(scope.dashboardPropertyId, 'staff-property');
    }
});

test('property-only internal memberships have navigation into their verified organization', () => {
    for (const role of ['staff', 'mst', 'property_admin', 'tenant', 'food_vendor']) {
        const { default: Nav } = loadTs('frontend/components/pettyCash/PettyCashNavLink.tsx', {
            react: React,
            'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
            'next/navigation': { useParams: () => ({ propertyId: 'property' }), usePathname: () => '/property/property/dashboard' },
            '@/frontend/context/AuthContext': { useAuth: () => ({ membership: { properties: [{ id: 'property', name: 'Fixture', organization_id: 'org', role }] } }) },
        });
        const html = renderToStaticMarkup(React.createElement(Nav));
        assert.equal(html.includes('href="/org/petty-cash"'), !/tenant|vendor/.test(role), role);
    }
});

test('role and redirect organization are both selected from the current workspace', () => {
    const { useDashboardContent: readScope } = loadTs('frontend/components/layout/DashboardContentSlot.tsx', {
        react: { ...React, useContext: () => undefined },
        'next/navigation': { useParams: () => ({ orgId: 'selected' }), useRouter: () => ({}) },
        '@/frontend/context/AuthContext': { useAuth: () => ({ membership: { org_id: 'primary', org_role: 'bd_rep',
            all_org_memberships: [{ org_id: 'selected', role: 'accounts' }], properties: [] } }) },
    });
    const scope = readScope();
    assert.equal(scope.dashboardRole, 'accounts');
    assert.equal(scope.dashboardOrgId, 'selected');
});
