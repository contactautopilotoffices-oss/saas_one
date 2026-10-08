import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../frontend/components/dashboard/OrgAdminDashboard.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('dashboard.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations[0].name.getText(ast) === 'OrgAdminDashboard');
// Exercise the dashboard's actual tab state/effects with real React. Data fetching
// and unrelated dashboard widgets are outside this routing regression's scope.
const statements = declaration.declarationList.declarations[0].initializer.body.statements;
const tabSource = statements.filter(node => {
    if (ts.isVariableStatement(node)) {
        const name = node.declarationList.declarations[0].name.getText(ast);
        return name.includes('activeTab') || name === 'setActiveTab';
    }
    return ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
        && node.expression.expression.getText(ast) === 'useEffect'
        && /setActiveTab|history\.replaceState/.test(node.getText(ast));
}).map(node => node.getText(ast)).join('\n');
const tabLogic = ts.transpileModule(tabSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const modules = {};
for (const [name, path] of Object.entries({
    react: 'react/cjs/react.development.js',
    'react-dom': 'react-dom/cjs/react-dom.development.js',
    'react-dom/client': 'react-dom/cjs/react-dom-client.development.js',
    scheduler: 'scheduler/cjs/scheduler.development.js',
})) {
    const [pkg, ...rest] = path.split('/');
    modules[name] = await readFile(new URL(rest.join('/'), `file://${require.resolve(`${pkg}/package.json`)}`), 'utf8');
}

let browser;
test.before(async () => {
    const systemChromium = await access('/usr/bin/chromium').then(() => '/usr/bin/chromium', () => undefined);
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || systemChromium, args: ['--no-sandbox'] });
});
test.after(async () => { await browser?.close(); });

async function mount(t, { tab = '', saved = 'grievance', role = 'org_super_admin', denyStorage = false } = {}) {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    t.after(() => page.close());
    await page.route('http://dashboard.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
    await page.goto(`http://dashboard.test/org/acme/dashboard${tab ? `?tab=${tab}&propertyId=p1` : ''}`);
    await page.evaluate(({ modules, tabLogic, saved, role, denyStorage }) => {
        localStorage.setItem('active_tab_acme', saved);
        if (denyStorage) Storage.prototype.getItem = () => { throw new Error('Storage disabled'); };
        const cache = {};
        const require = name => {
            if (cache[name]) return cache[name].exports;
            const commonJSModule = cache[name] = { exports: {} };
            new Function('module', 'exports', 'require', 'process', modules[name])(commonJSModule, commonJSModule.exports, require, { env: { NODE_ENV: 'development' } });
            return commonJSModule.exports;
        };
        const React = require('react');
        window.tabRenders = [];
        window.urlWrites = 0;
        const nativeReplace = history.replaceState.bind(history);
        history.replaceState = (...args) => {
            // Bound a broken feedback loop so a regression fails promptly.
            if (++window.urlWrites > 12) return;
            nativeReplace(...args);
            window.dispatchEvent(new Event('popstate'));
        };
        window.navigate = path => {
            history.pushState(null, '', path);
            window.dispatchEvent(new Event('popstate'));
        };
        const DashboardTabs = new Function('React', 'role', `
            const { useState, useEffect, useCallback } = React;
            return function DashboardTabs() {
                const query = React.useSyncExternalStore(
                    React.useCallback(cb => { window.addEventListener('popstate', cb); return () => window.removeEventListener('popstate', cb); }, []),
                    () => window.location.search
                );
                const searchParams = React.useMemo(() => new URLSearchParams(query), [query]);
                const orgSlugOrId = 'acme';
                const isOpsSuperAdmin = role === 'ops_super_admin';
                const setPendingStatusFilter = () => {};
                const setSelectedPropertyId = () => {};
                const setRequestsView = () => {};
                ${tabLogic}
                window.tabRenders.push(activeTab);
                return React.createElement('output', { 'data-tab': activeTab }, activeTab);
            };
        `)(React, role);
        require('react-dom/client').createRoot(document.getElementById('root')).render(
            React.createElement(React.StrictMode, null, React.createElement(DashboardTabs))
        );
    }, { modules, tabLogic, saved, role, denyStorage });
    await page.locator('output').waitFor();
    // Flush effect-triggered renders and browser history notifications.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return page;
}

test('login with a saved grievance tab opens overview without tab or URL oscillation', async t => {
    const page = await mount(t);
    const state = await page.evaluate(() => ({ tabs: window.tabRenders, writes: window.urlWrites }));
    assert.ok(state.tabs.every(tab => tab === 'overview'), `Unexpected tab renders: ${state.tabs}`);
    assert.ok(state.writes <= 1, `URL feedback loop wrote ${state.writes} times`);
});

test('explicit grievance links override storage and bare dashboard navigation returns to overview', async t => {
    const page = await mount(t, { tab: 'grievance', saved: 'overview' });
    assert.equal(await page.locator('output').getAttribute('data-tab'), 'grievance');
    assert.equal(new URL(page.url()).searchParams.get('propertyId'), 'p1');
    await page.evaluate(() => window.navigate('/org/acme/dashboard'));
    await page.waitForFunction(() => document.querySelector('output').dataset.tab === 'overview');
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => document.querySelector('output').dataset.tab === 'grievance');
    assert.ok(await page.evaluate(() => window.urlWrites <= 1));
});

test('dashboard works when browser storage is unavailable', async t => {
    const page = await mount(t, { denyStorage: true });
    assert.equal(await page.locator('output').getAttribute('data-tab'), 'overview');
});

test('ops role restrictions still select overview for a restricted tab', async t => {
    const page = await mount(t, { role: 'ops_super_admin', tab: 'agent_console' });
    assert.equal(await page.locator('output').getAttribute('data-tab'), 'overview');
});
