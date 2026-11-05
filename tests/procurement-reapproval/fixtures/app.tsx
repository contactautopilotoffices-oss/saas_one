import React from 'react';
import { createRoot } from 'react-dom/client';
import MonthlyRequisitionsTab from '../../../frontend/components/procurement/MonthlyRequisitionsTab';

// ?as=procurement | approver picks who is signed in; the fixture server reads the same header.
const params = new URLSearchParams(location.search);
const as = params.get('as') || 'procurement';
const people: Record<string, { id: string; role: string; name: string }> = {
    procurement: { id: '22222222-2222-4222-8222-222222222222', role: 'procurement', name: 'Priya Procurement' },
    approver: { id: '33333333-3333-4333-8333-333333333333', role: 'ops_super_admin', name: 'Reviewer' }
};
const person = people[as];
const originalFetch = window.fetch.bind(window);
window.fetch = (url, options) => {
    const headers = new Headers(options?.headers);
    headers.set('x-fixture-actor', person.id);
    return originalFetch(url, { ...options, headers });
};
const user = { id: person.id, email: as + '@example.test',
    user_metadata: { role: person.role, full_name: person.name, organization_id: '11111111-1111-4111-8111-111111111111' } };
createRoot(document.getElementById('root')!).render(
    <main className="p-4"><MonthlyRequisitionsTab user={user} organizationId="11111111-1111-4111-8111-111111111111" userRole={person.role} /></main>
);
