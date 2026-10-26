import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTs } from '../petty-cash/load-ts.mjs';
const { ORG_DASHBOARD_TABS, resolveOrgDashboardTab, pushDashboardNavigation } = loadTs('frontend/lib/dashboard/orgTabs.ts');

test('organization tabs accept the complete linkable set and default malformed/bare URLs to overview', () => {
    for (const tab of ORG_DASHBOARD_TABS) assert.equal(resolveOrgDashboardTab(tab), tab);
    for (const tab of [null, '', 'not-a-tab', 'Overview', '<script>', '__proto__']) assert.equal(resolveOrgDashboardTab(tab), 'overview');
    for (const tab of ['org_progress', 'org_efficiency', 'agent_console']) assert.equal(resolveOrgDashboardTab(tab, true), 'overview');
    assert.equal(resolveOrgDashboardTab('grievance', true), 'grievance');
});

test('user actions create history entries without copying framework state or mutating identical URLs', () => {
    const calls = [];
    const history = { state: { __NA: true, _N: true }, pushState: (...args) => calls.push(args) };
    const location = { pathname: '/org/dashboard', search: '?tab=overview&keep=1', hash: '#section' };
    pushDashboardNavigation('/org/dashboard?tab=overview&keep=1#section', history, location);
    assert.equal(calls.length, 0);
    pushDashboardNavigation('/org/dashboard?tab=grievance&keep=1#section', history, location);
    assert.deepEqual(Array.from(calls[0]), [null, '', '/org/dashboard?tab=grievance&keep=1#section']);
    assert.deepEqual(history.state, { __NA: true, _N: true });
});

test('OrgAdmin has one validated URL owner and restoration never calls a history-writing tab setter', () => {
    const source = readFileSync('frontend/components/dashboard/OrgAdminDashboard.tsx', 'utf8');
    assert.match(source, /resolveOrgDashboardTab\(searchParams\.get\('tab'\)/);
    assert.doesNotMatch(source, /setActiveTabRaw|active_tab_|setActiveTab\(/);
    assert.match(source, /else pushDashboardNavigation\(/);
    assert.match(source, /new URLSearchParams\(window\.location\.search\)/);
});
