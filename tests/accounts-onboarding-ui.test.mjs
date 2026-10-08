import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const modules = {};
for (const [name, path] of Object.entries({
    react: 'react/cjs/react.development.js',
    'react/jsx-runtime': 'react/cjs/react-jsx-runtime.development.js',
    'react-dom': 'react-dom/cjs/react-dom.development.js',
    'react-dom/client': 'react-dom/cjs/react-dom-client.development.js',
    scheduler: 'scheduler/cjs/scheduler.development.js',
})) {
    const [pkg, ...rest] = path.split('/');
    modules[name] = await readFile(new URL(rest.join('/'), `file://${require.resolve(`${pkg}/package.json`)}`), 'utf8');
}
for (const [name, path] of Object.entries({
    memberModal: '../frontend/components/dashboard/InviteMemberModal.tsx',
    onboarding: '../app/onboarding/page.tsx',
})) {
    modules[name] = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
}

let browser;
test.before(async () => {
    const systemChromium = await access('/usr/bin/chromium').then(() => '/usr/bin/chromium', () => undefined);
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || systemChromium, args: ['--no-sandbox'] });
});
test.after(async () => { await browser?.close(); });

async function mount(t, name) {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); process.stderr.write(`${error.message}\n`); });
    await page.route('http://app.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
    await page.goto('http://app.test/onboarding');
    await page.evaluate(({ modules, name }) => {
        const cache = {};
        const require = name => {
            if (cache[name]) return cache[name].exports;
            const commonJSModule = cache[name] = { exports: {} };
            new Function('module', 'exports', 'require', 'process', modules[name])(commonJSModule, commonJSModule.exports, require, { env: { NODE_ENV: 'development', NEXT_PUBLIC_AUTOPILOT_ORG_ID: 'o1' } });
            return commonJSModule.exports;
        };
        const React = require('react');
        const dom = tag => function StubElement({ children, ...props }) {
            for (const key of ['initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap', 'layout', 'layoutId']) delete props[key];
            return React.createElement(tag, props, children);
        };
        window.propertyReads = 0;
        const db = {
            from: table => {
                if (table === 'properties') window.propertyReads++;
                return { select() { return this; }, eq() { return this; }, order: async () => ({ data: [{ id: 'p1', name: 'Site One', organization_id: 'o1' }], error: null }), maybeSingle: async () => ({ data: null }) };
            },
        };
        const imports = {
            'framer-motion': { motion: new Proxy({}, { get: (_, tag) => dom(tag) }), AnimatePresence: ({ children }) => children },
            'lucide-react': new Proxy({}, { get: () => dom('svg') }),
            'next/navigation': { useRouter: () => ({ push() {} }) },
            '@/frontend/utils/supabase/client': { createClient: () => db },
            '@/frontend/context/AuthContext': { useAuth: () => ({
                user: { id: 'member', user_metadata: { full_name: 'Member' } },
                isLoading: false, isMembershipLoading: false,
                membership: { onboarding_completed: false }, refreshMembership: async () => {},
            }) },
            '@/frontend/components/ui/Loader': { __esModule: true, default: () => null },
        };
        for (const [key, exports] of Object.entries(imports)) cache[key] = { exports };
        window.requests = [];
        window.fetch = async (url, options) => {
            window.requests.push({ url, body: JSON.parse(options.body) });
            return { ok: true, json: async () => ({ success: true, user: { id: 'member' } }) };
        };
        const Component = require(name).default;
        require('react-dom/client').createRoot(document.getElementById('root')).render(
            React.createElement(Component, name === 'memberModal' ? { isOpen: true, onClose() {}, orgId: 'o1', orgName: 'Autopilot', properties: [{ id: 'p1', name: 'Site One' }] } : {})
        );
    }, { modules, name });
    return { page, errors };
}

test('Add New Member creates Accounts without requiring or sending a property', async t => {
    const { page, errors } = await mount(t, 'memberModal');
    await page.locator('select').first().selectOption('accounts');
    assert.equal(await page.locator('select').count(), 1);
    await page.getByPlaceholder('John Doe').fill('Accounts Member');
    await page.getByPlaceholder('john@example.com').fill('member@example.com');
    await page.locator('input[type=password]').fill('Test-password-123');
    await page.locator('button[type=submit]').click();
    await page.waitForFunction(() => window.requests.length > 0);
    const submitted = await page.evaluate(() => window.requests[0]);
    assert.equal(submitted.url, '/api/users/create');
    assert.equal(submitted.body.role, 'accounts');
    assert.equal(submitted.body.organization_id, 'o1');
    assert.equal(submitted.body.property_id, null);
    assert.deepEqual(errors, []);
});

test('Accounts self-signup reaches Complete Setup without selecting a property', async t => {
    const { page, errors } = await mount(t, 'onboarding');
    await page.getByRole('button', { name: /Continue/ }).click().catch(async error => {
        throw new Error(`${error.message}\nRendered page: ${await page.locator('body').innerText()}\nErrors: ${errors}`);
    });
    await page.getByRole('button', { name: /Continue/ }).click();
    await page.getByRole('button', { name: /Accounts \/ Finance/ }).click();
    assert.equal(await page.getByText('Choose Your Property').count(), 0);
    await page.getByRole('button', { name: /Complete Setup/ }).click();
    await page.waitForFunction(() => window.requests.length > 0);
    const submitted = await page.evaluate(() => window.requests[0]);
    assert.equal(submitted.url, '/api/onboarding/complete');
    assert.equal(submitted.body.selectedRole, 'accounts');
    assert.equal(submitted.body.selectedPropertyId, null);
    assert.equal(await page.evaluate(() => window.propertyReads), 0);
    assert.deepEqual(errors, []);
});

test('property-scoped self-signup still requires a property after choosing a role', async t => {
    const { page, errors } = await mount(t, 'onboarding');
    await page.getByRole('button', { name: /Continue/ }).click();
    await page.getByRole('button', { name: /Continue/ }).click();
    await page.getByRole('button', { name: /Property Admin/ }).click();
    await page.getByRole('button', { name: /Continue/ }).click();
    assert.equal(await page.getByRole('button', { name: /Complete Setup/ }).isDisabled(), true);
    await page.getByRole('button', { name: /Site One/ }).click();
    await page.getByRole('button', { name: /Complete Setup/ }).click();
    await page.waitForFunction(() => window.requests.length > 0);
    const submitted = await page.evaluate(() => window.requests[0]);
    assert.equal(submitted.body.selectedRole, 'property_admin');
    assert.equal(submitted.body.selectedPropertyId, 'p1');
    assert.deepEqual(errors, []);
});
