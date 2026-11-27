import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSopUserRole } from '../frontend/components/sop/resolveSopRole.ts';

const read = (relPath) => readFile(new URL(`../${relPath}`, import.meta.url), 'utf8');

test('ops_super_admin and org_super_admin retain elevated SOP role even with lower property row', () => {
    for (const orgRole of ['ops_super_admin', 'org_super_admin', 'Ops Super Admin', 'Org Super Admin']) {
        const res = resolveSopUserRole({
            membership: {
                org_id: 'org-1',
                org_role: orgRole,
                all_org_memberships: [{ org_id: 'org-1', role: orgRole }],
                properties: [{ id: 'prop-1', role: 'staff', organization_id: 'org-1' }],
            },
            propertyId: 'prop-1',
            organizationId: 'org-1',
        });

        const expected = orgRole.toLowerCase().replace(/\s+/g, '_');
        assert.equal(res.userRole, expected);
        assert.equal(res.isAdmin, true);
        assert.equal(res.isOrgSuperAdmin, true);
    }
});

test('multi-org admin resolves elevated SOP role from matching org without cross-org leakage', () => {
    const membership = {
        org_id: 'org-a',
        org_role: 'staff',
        all_org_memberships: [
            { org_id: 'org-a', role: 'staff' },
            { org_id: 'org-b', role: 'ops_super_admin' },
        ],
        properties: [{ id: 'prop-b1', role: 'staff', organization_id: 'org-b' }],
    };

    const inOrgBByOrgId = resolveSopUserRole({
        membership,
        propertyIds: ['prop-b1', 'prop-b2'],
        organizationId: 'org-b',
    });
    assert.equal(inOrgBByOrgId.userRole, 'ops_super_admin');
    assert.equal(inOrgBByOrgId.isAdmin, true);
    assert.equal(inOrgBByOrgId.isOrgSuperAdmin, true);

    const inOrgBByPropertyOrg = resolveSopUserRole({
        membership,
        propertyId: 'prop-b1',
    });
    assert.equal(inOrgBByPropertyOrg.userRole, 'ops_super_admin');
    assert.equal(inOrgBByPropertyOrg.isAdmin, true);

    const inOrgA = resolveSopUserRole({
        membership,
        organizationId: 'org-a',
        propertyIds: ['prop-a1'],
    });
    assert.equal(inOrgA.userRole, 'staff');
    assert.equal(inOrgA.isAdmin, false);
    assert.equal(inOrgA.isOrgSuperAdmin, false);
});

test('master admin retains full SOP admin access without org or property rows', () => {
    const res = resolveSopUserRole({
        membership: {
            org_id: null,
            org_role: null,
            is_master_admin: true,
            all_org_memberships: [],
            properties: [],
        },
        propertyIds: ['prop-1'],
        organizationId: 'org-1',
    });
    assert.equal(res.userRole, 'master_admin');
    assert.equal(res.isAdmin, true);
    assert.equal(res.isOrgSuperAdmin, true);
});

test('SOPDashboard waits for auth/membership before resolving role or bouncing to history', async () => {
    const src = await read('frontend/components/sop/SOPDashboard.tsx');
    assert.match(src, /isLoading:\s*authLoading,\s*isMembershipLoading/);
    assert.match(src, /if\s*\(\s*authLoading\s*\|\|\s*isMembershipLoading\s*\|\|\s*\(Boolean\(user\)\s*&&\s*!membership\)\s*\)/);
    assert.match(src, /activeView\s*===\s*'settings'\s*&&\s*isAdmin\s*&&\s*!propertyId/);
});

test('AuthContext, OrgAdminDashboard, and checklist deep-link accept NULL is_active memberships and ops_super_admin', async () => {
    const authSrc = await read('frontend/context/AuthContext.tsx');
    assert.doesNotMatch(authSrc, /\.eq\('is_active',\s*true\)/);
    assert.match(authSrc, /\.or\('is_active\.is\.null,is_active\.eq\.true'\)/);

    const orgDashSrc = await read('frontend/components/dashboard/OrgAdminDashboard.tsx');
    assert.match(orgDashSrc, /propertiesLoaded/);
    assert.match(orgDashSrc, /\.is\('deleted_at',\s*null\)/);
    assert.match(orgDashSrc, /checklistPropertyId === 'all' && !propertiesLoaded/);

    const deepLinkSrc = await read('app/checklist/[templateId]/page.tsx');
    assert.match(deepLinkSrc, /organization_memberships/);
    assert.match(deepLinkSrc, /ops_super_admin/);
    assert.match(deepLinkSrc, /is_master_admin/);
});

test('SOPTemplateManager and SOPCompletionHistory guard empty propertyIds arrays', async () => {
    const tmplSrc = await read('frontend/components/sop/SOPTemplateManager.tsx');
    assert.match(tmplSrc, /propertyIds\s*!==\s*undefined\s*&&\s*validPropertyIds\.length\s*===\s*0\s*&&\s*!validPropId/);
    assert.match(tmplSrc, /assigned_to\.eq\.\{\}/);

    const histSrc = await read('frontend/components/sop/SOPCompletionHistory.tsx');
    assert.match(histSrc, /propertyIds\s*!==\s*undefined\s*&&\s*validPropertyIds\.length\s*===\s*0\s*&&\s*!validPropId/);
});

test('migration adds properties SELECT RLS policy for ops_super_admin via is_org_admin_or_ops_admin', async () => {
    const sql = await read('supabase/migrations/20261126000001_fix_properties_ops_super_admin_rls.sql');
    assert.match(sql, /CREATE POLICY "prop_read_org_or_ops_admin"\s+ON public\.properties\s+FOR SELECT/i);
    assert.match(sql, /public\.is_org_admin_or_ops_admin\(organization_id\)/);
    assert.doesNotMatch(sql, /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.is_org_admin_v2/i);
});
