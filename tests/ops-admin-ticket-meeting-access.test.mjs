import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relPath) => readFile(new URL(`../${relPath}`, import.meta.url), 'utf8');

test('ticket PATCH content, DELETE, and materials routes allow ops_super_admin and lowercase org_super_admin', async () => {
    const ticketRoute = await read('app/api/tickets/[id]/route.ts');
    assert.doesNotMatch(ticketRoute, /\.eq\('role',\s*'ORG_SUPER_ADMIN'\)/);
    assert.match(ticketRoute, /resolveCaller\(request\)/);
    assert.match(ticketRoute, /orgRoles\.some\(r\s*=>\s*\[\.\.\.ORG_ADMIN_ROLES/);
    assert.match(ticketRoute, /'ops_super_admin'/);

    const materialsRoute = await read('app/api/tickets/[id]/materials/route.ts');
    assert.match(materialsRoute, /'org_super_admin',\s*'ops_super_admin',\s*'master_admin',\s*'procurement'/);
    assert.match(materialsRoute, /is_master_admin/);
});

test('ticket UI views grant ops_super_admin parity with org_super_admin', async () => {
    const ticketsView = await read('frontend/components/dashboard/TicketsView.tsx');
    assert.match(ticketsView, /'org_super_admin',\s*'ops_super_admin',\s*'org_admin',\s*'master_admin',\s*'owner',\s*'tech'/);

    const ticketDetail = await read('frontend/components/tickets/TicketDetail.tsx');
    assert.match(ticketDetail, /\['org_super_admin',\s*'ops_super_admin'\]/);

    const flowMap = await read('frontend/components/ops/TicketFlowMap.tsx');
    assert.match(flowMap, /'org_admin',\s*'org_super_admin',\s*'ops_super_admin',\s*'owner',\s*'tech'/);
});

test('meeting rooms, credits, slots, refill requests, and cancellation grant ops_super_admin access', async () => {
    const visibility = await read('backend/lib/meetingRooms/bookingVisibility.ts');
    assert.match(visibility, /export async function hasPropertyOrOrgRole/);
    assert.match(visibility, /export async function hasAnyOrgOrPropRole/);
    assert.match(visibility, /is_active\.is\.null,is_active\.eq\.true/);

    const filesExpectingPropOrOrgHelper = [
        'app/api/meeting-rooms/route.ts',
        'app/api/meeting-rooms/[id]/route.ts',
        'app/api/meeting-room-credits/route.ts',
        'app/api/meeting-room-credits/history/route.ts',
        'app/api/meeting-room-credits/refill-requests/route.ts',
        'app/api/meeting-room-credits/refill-requests/[id]/route.ts',
        'backend/lib/meetingRooms/cancelBooking.ts',
    ];
    for (const file of filesExpectingPropOrOrgHelper) {
        const src = await read(file);
        assert.match(src, /hasPropertyOrOrgRole/, file);
        assert.match(src, /ops_super_admin/, file);
    }

    for (const slotFile of ['app/api/meeting-room-slots/route.ts', 'app/api/meeting-room-slots/[id]/route.ts']) {
        const src = await read(slotFile);
        assert.match(src, /hasAnyOrgOrPropRole/, slotFile);
        assert.match(src, /ops_super_admin/, slotFile);
        assert.match(src, /org_super_admin/, slotFile);
    }

    const bookingList = await read('frontend/components/meeting-rooms/AdminBookingList.tsx');
    assert.match(bookingList, /organization_memberships/);
    assert.match(bookingList, /ops_super_admin/);

    const meetingsPage = await read('app/(dashboard)/[orgId]/meetings/page.tsx');
    assert.match(meetingsPage, /'ops_super_admin'/);
});

test('PropertyAdminDashboard and AI Learning Loop handle All Properties checklists safely', async () => {
    const propDash = await read('frontend/components/dashboard/PropertyAdminDashboard.tsx');
    assert.match(propDash, /orgPropertiesLoaded/);
    assert.match(propDash, /property\.id === 'all' && isElevatedRole && !orgPropertiesLoaded/);

    const learningApi = await read('app/api/sop/ai-learning-loop/route.ts');
    assert.match(learningApi, /organizationId/);
    assert.match(learningApi, /is_active\.is\.null,is_active\.eq\.true/);
});
