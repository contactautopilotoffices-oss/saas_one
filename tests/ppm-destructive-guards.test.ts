/**
 * Unit tests for PPM destructive operation guards & summary helpers.
 * No network, no database. Run: npx tsx --test tests/ppm-destructive-guards.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role';

import type { CallerAccess } from '../backend/lib/auth/callerAccess';

function makeCaller(overrides: Partial<CallerAccess> = {}): CallerAccess {
    return {
        userId: 'user-1',
        email: 'user@example.com',
        isMasterAdmin: false,
        orgMemberships: [],
        propertyMemberships: [],
        ...overrides,
    };
}

test('canAdministerPpmProperty enforces org/property admin roles and isolation', async () => {
    const { canAdministerPpmProperty } = await import('../backend/lib/ppm/scheduleGuard');
    const orgId = 'org-1';
    const propId = 'prop-1';

    assert.equal(canAdministerPpmProperty(makeCaller({ isMasterAdmin: true }), orgId, propId), true);
    assert.equal(
        canAdministerPpmProperty(makeCaller({ orgMemberships: [{ organization_id: orgId, role: 'org_admin' }] }), orgId, propId),
        true,
    );
    assert.equal(
        canAdministerPpmProperty(makeCaller({ orgMemberships: [{ organization_id: orgId, role: 'org_super_admin' }] }), orgId, propId),
        true,
    );
    assert.equal(
        canAdministerPpmProperty(makeCaller({ orgMemberships: [{ organization_id: 'org-other', role: 'org_super_admin' }] }), orgId, propId),
        false,
        'org admin of another org must be rejected',
    );
    assert.equal(
        canAdministerPpmProperty(
            makeCaller({ propertyMemberships: [{ property_id: propId, organization_id: orgId, role: 'property_admin' }] }),
            orgId,
            propId,
        ),
        true,
    );
    assert.equal(
        canAdministerPpmProperty(
            makeCaller({ propertyMemberships: [{ property_id: 'prop-other', organization_id: orgId, role: 'property_admin' }] }),
            orgId,
            propId,
        ),
        false,
        'property admin of another property must be rejected',
    );

    for (const nonAdminRole of ['staff', 'mst', 'technician', 'vendor', 'tenant', 'client']) {
        assert.equal(
            canAdministerPpmProperty(
                makeCaller({ propertyMemberships: [{ property_id: propId, organization_id: orgId, role: nonAdminRole }] }),
                orgId,
                propId,
            ),
            false,
            `non-admin role "${nonAdminRole}" must be rejected`,
        );
    }
});

test('guardPpmAdminWrite requires both organization_id and property_id', async () => {
    const { guardPpmAdminWrite } = await import('../backend/lib/ppm/scheduleGuard');
    const dummyReq = new Request('http://localhost/api/ppm/clear', { method: 'DELETE' });

    const missingProp = await guardPpmAdminWrite(dummyReq, 'org-1', null);
    assert.ok(missingProp instanceof Response);
    assert.equal(missingProp.status, 400);

    const emptyProp = await guardPpmAdminWrite(dummyReq, 'org-1', '');
    assert.ok(emptyProp instanceof Response);
    assert.equal(emptyProp.status, 400);

    const missingOrg = await guardPpmAdminWrite(dummyReq, undefined, 'prop-1');
    assert.ok(missingOrg instanceof Response);
    assert.equal(missingOrg.status, 400);
});

test('summarizePpmRows accurately counts statuses and attachment-bearing rows', async () => {
    const { summarizePpmRows } = await import('../backend/lib/ppm/scheduleGuard');
    const summary = summarizePpmRows([
        { status: 'done', attachments: { certificate: 'https://x/a.pdf' }, completion_photos: [] },
        { status: 'done', attachments: {}, completion_photos: ['https://x/p.jpg'] },
        { status: 'pending', attachments: {}, completion_doc_url: 'https://x/d.pdf' },
        { status: 'postponed', attachments: {} },
        { status: 'skipped', attachments: {}, invoice_url: 'https://x/i.pdf' },
    ]);

    assert.deepEqual(summary, {
        total: 5,
        done: 2,
        pending: 1,
        postponed: 1,
        skipped: 1,
        with_attachments: 4,
    });
});
