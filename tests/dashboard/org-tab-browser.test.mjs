import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import ts from 'typescript';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
const root = new URL('../..', import.meta.url).pathname;
const require = createRequire(import.meta.url);
let build;
try { ({ build } = require(process.env.ESBUILD_PACKAGE_PATH || 'esbuild')); }
catch(error) {
    const binary = process.env.PATH.split(':').map(path => join(path, 'esbuild')).find(path => existsSync(path));
    if (!binary) throw new Error('Run with npm exec --package=esbuild -- node --test tests/dashboard/org-tab-browser.test.mjs', { cause: error });
    ({ build } = require(dirname(dirname(realpathSync(binary)))));
}
const scratch = await mkdtemp(join(tmpdir(), 'dashboard-browser-'));
const roleNames = ['UnifiedDashboard','OrgAdminDashboard','PropertyAdminDashboard','MasterAdminDashboard','StaffDashboard','MstDashboard','SecurityDashboard','ProcurementDashboard','SoftServiceManagerDashboard'];
const retained = new Set([
    ...roleNames.map(name => resolve(root, `frontend/components/dashboard/${name}.tsx`)),
    ...['PettyCashShell','DashboardContentSlot','DashboardSidebar','AccountsWorkspace'].map(name => resolve(root, `frontend/components/layout/${name}.tsx`)),
    resolve(root, 'frontend/components/pettyCash/PettyCashNavLink.tsx'),
]);
const namedExports = new Map();
for (const file of [...retained, resolve(root,'app/(dashboard)/layout.tsx')]) {
    const ast = ts.createSourceFile(file, readFileSync(file,'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const node of ast.statements.filter(ts.isImportDeclaration)) {
        const imports = node.importClause?.namedBindings;
        if (!imports || !ts.isNamedImports(imports)) continue;
        const key = node.moduleSpecifier.text;
        const names = namedExports.get(key) || new Set();
        for (const el of imports.elements) if (!el.isTypeOnly) names.add(el.propertyName?.text || el.name.text);
        namedExports.set(key, names);
    }
}
await build({ entryPoints: [join(root,'tests/dashboard/fixtures/app.tsx')], bundle: true, outfile: join(scratch,'app.js'), jsx: 'automatic',
    plugins: [{ name: 'isolated-dashboard-data', setup(builder) {
        const fixtureState = join(root,'tests/dashboard/fixtures/state.ts');
        builder.onResolve({ filter: /^(next\/navigation|next\/link|next\/image|next\/dynamic)$/ }, args => {
            if (args.path === 'next/navigation') return { path: join(root,'tests/dashboard/fixtures/navigation.tsx') };
            return { path: args.path, namespace: 'next-fixture' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'next-fixture' }, args => ({ contents: args.path === 'next/link'
            ? `export { Link as default } from ${JSON.stringify(join(root,'tests/dashboard/fixtures/navigation.tsx'))};`
            : args.path === 'next/image' ? 'import React from "react"; export default function Image({fill,unoptimized,priority,...props}) { return <img {...props}/>; }'
            : 'export default function dynamic(){return ()=>null;}', loader: 'jsx', resolveDir: root }));
        builder.onResolve({ filter: /.*/ }, args => {
            if (args.path === '@utils/supabase/client') return { path: fixtureState };
            if (/frontend\/(context\/(AuthContext|ThemeContext|DataCacheContext)|hooks\/useAppSession|utils\/supabase\/client)$/.test(args.path)) return { path: fixtureState };
            let path = args.path.startsWith('@/') ? resolve(root,args.path.slice(2)) : args.path.startsWith('.') ? resolve(dirname(args.importer),args.path) : '';
            if (path && !existsSync(path)) path += existsSync(path+'.tsx') ? '.tsx' : existsSync(path+'.ts') ? '.ts' : '/index.ts';
            if (path === resolve(root, 'frontend/utils/supabase/client.ts')) return { path: fixtureState };
            if (!path.includes('/frontend/components/') || retained.has(path) || /\/(mockData|procurementFeatureFlags)\.ts$/.test(path)) return undefined;
            const exports = [...(namedExports.get(args.path) || [])];
            return { path: args.path, namespace: 'component-fixture', pluginData: { exports, path } };
        });
        builder.onLoad({ filter: /.*/, namespace: 'component-fixture' }, args => {
            const label = args.pluginData.path.includes('HRTicketsContent') ? 'grievance' : args.pluginData.path.includes('CommandCenter') ? 'overview' : '';
            let code = `import React from 'react'; function Stub(){return ${label ? `<div data-testid=${JSON.stringify(label)}>${label} fixture content</div>` : 'null'};} export default Stub;`;
            for (const name of args.pluginData.exports) code += name === 'useWallpaper' ? 'export const useWallpaper=()=>({});'
                : name === 'useIsDark' ? 'export const useIsDark=()=>false;' : name === 'crmThemeVars' ? 'export const crmThemeVars=()=>({});'
                : `export const ${name}=Stub;`;
            return { contents: code, loader: 'jsx', resolveDir: root };
        });
    }}], define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' }, logLevel:'warning',
});
const bundle = await readFile(join(scratch,'app.js'),'utf8');
const css = (await postcss([tailwind()]).process(await readFile(join(root,'app/globals.css'),'utf8'),{from:join(root,'app/globals.css')})).css;
const server = createServer((_req,res) => {
    res.setHeader('content-type','text/html');
    res.end(`<style>${css}</style><div id="root"></div><script>window.__historyCalls=[];window.__bodyStates=[];history.replaceState({__NA:true,_N:true},'');new MutationObserver(()=>{let m=document.querySelector('main');let s=m?.querySelector('[data-testid="grievance"]')?'grievance':m?.querySelector('[data-testid="overview"]')?'overview':m?.querySelector('[data-testid="petty-body"]')?'petty':'other';window.__bodyStates.push(s)}).observe(document.getElementById('root'),{childList:true,subtree:true});window.fetch=async(input)=>({ok:true,json:async()=>String(input).startsWith('/api/procurement/')?[]:({properties:[],tickets:[],requests:[],users:[],data:[],total_tickets:0})});</script><script>${bundle.replace(/<\/script/gi,'<\\/script')}</script>`);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base = `http://127.0.0.1:${server.address().port}`;
const org = '00000000-0000-0000-0000-000000000001';
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox'] });
process.on('exit',()=>server.close());
test.after(async()=>{await browser.close();await new Promise(done=>server.close(done));});
for (const width of [1440,390]) test(`StrictMode URL navigation and persistent OrgAdmin chrome at ${width}px`,{timeout:60000},async()=>{
    const page = await browser.newPage({viewport:{width,height:1000}});
    const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('Fixture page error:',e.message)});
    const menu = async () => { if(width===390) await page.locator('button').filter({has:page.locator('svg.lucide-menu')}).first().click(); };
    try {
        await page.addInitScript(`localStorage.setItem('active_tab_${org}','overview')`);
        await page.goto(`${base}/${org}/dashboard?tab=grievance&keep=fixture&role=org_super_admin`);
        await page.getByTestId('grievance').waitFor();
        assert.equal(await page.getByTestId('overview').count(),0);
        assert.equal(await page.getByTestId('unused-page').count(),0);
        assert.equal((await page.evaluate(()=>window.__historyCalls)).length,0,'mount/StrictMode must not write history');
        await page.evaluate(()=>{window.__sidebar=document.querySelector('aside');window.__bodyStates=[];});
        const labels = await page.locator('aside').innerText();
        await menu();await page.locator('aside').getByRole('button',{name:'Dashboard',exact:true}).click();
        await page.getByTestId('overview').waitFor();
        assert.equal(new URL(page.url()).searchParams.get('keep'),'fixture');
        assert.equal(await page.evaluate(()=>history.state),null);
        await page.reload();await page.getByTestId('overview').waitFor();
        assert.equal((await page.evaluate(()=>window.__historyCalls)).length,0);
        await page.goBack();await page.getByTestId('grievance').waitFor();
        await page.goForward();await page.getByTestId('overview').waitFor();
        await page.evaluate(()=>window.__sidebar=document.querySelector('aside'));
        await menu();await page.getByRole('link',{name:'Petty Cash',exact:true}).click();
        await page.getByTestId('petty-body').waitFor();
        assert.equal(await page.evaluate(()=>window.__sidebar===document.querySelector('aside')),true,'same sidebar DOM remains mounted');
        assert.equal(await page.locator('aside').innerText(),labels);
        assert.equal(await page.locator('aside a[aria-current=page]').innerText(),'Petty Cash');
        if(width===390)assert.match(await page.locator('aside').getAttribute('class'),/-translate-x-full/);
        await page.reload();await page.getByTestId('petty-body').waitFor();
        await page.goBack();await page.getByTestId('overview').waitFor();
        await page.goForward();await page.getByTestId('petty-body').waitFor();
        await page.screenshot({path:join(scratch,`org-shell-${width}.png`),fullPage:true});
        assert.deepEqual(errors,[]);
    } catch(error) {await page.screenshot({path:join(scratch,`failure-org-${width}.png`),fullPage:true});console.log('Dashboard fixture failure:',scratch,await page.locator('body').innerText());throw error;}
    finally {await page.close();}
});
for (const role of ['ops_super_admin','property_admin','accounts','staff','mst','security','soft_service_manager','procurement','master_admin','bd_rep']) test(`real ${role} shell supports direct petty-cash load, refresh and dashboard return`,{timeout:30000},async()=>{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('Fixture page error:',e.message)});
    try {
        await page.goto(`${base}/${org}/petty-cash?role=${role}`);
        await page.getByTestId('petty-body').waitFor();
        const sidebar=page.locator('aside').first();
        const labels=await sidebar.innerText();assert.match(labels,/Management Hub/i);assert.match(labels,/Petty Cash/);
        assert.equal(await page.getByRole('link',{name:'Petty Cash',exact:true}).getAttribute('aria-current'),'page');
        if(!['accounts','master_admin'].includes(role)) assert.equal(await page.getByRole('link',{name:'Payment Tracker',exact:true}).count(),0);
        await page.reload();await page.getByTestId('petty-body').waitFor();assert.equal(await sidebar.innerText(),labels);
        if(role!=='accounts') {
            const button=sidebar.getByRole('button',{name:/^(Dashboard|Overview|Stock Management)$/}).first();
            if(await button.count()) {await button.click();await page.getByTestId('petty-body').waitFor({state:'detached'});assert.match(new URL(page.url()).pathname,/dashboard$/);await page.goBack();await page.getByTestId('petty-body').waitFor();}
        }
        assert.deepEqual(errors,[]);
    } catch(error) {await page.screenshot({path:join(scratch,`failure-${role}.png`),fullPage:true});console.log('Role fixture failure:',role,scratch,await page.locator('body').innerText());throw error;} finally {await page.close();}
});
test('excluded tenant/vendor shells deny direct petty-cash links',async()=>{
    const page=await browser.newPage();try{for(const role of ['tenant','tenant_user','super_tenant','vendor','food_vendor']) {await page.goto(`${base}/${org}/petty-cash?role=${role}`);await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('link',{name:'Petty Cash',exact:true}).count(),0);}}finally{await page.close();}
});
console.log(`Dashboard browser artifacts: ${scratch}`);

for(const width of [1440,390])test(`Accounts navigation keeps Petty Cash visible above the footer with a long table at ${width}px`,{timeout:60000},async()=>{
    const height=width===390?600:800;const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
    try{
        await page.goto(`${base}/${org}/accounts?role=accounts`);await page.getByRole('heading',{name:'Payment Tracker — local fixture'}).waitFor();
        if(width===390)await page.getByRole('button',{name:'Open menu',exact:true}).click();
        const sidebar=page.locator('aside:visible');const cash=sidebar.getByRole('link',{name:'Petty Cash',exact:true});await cash.waitFor();
        const cashBefore=await cash.boundingBox();const tracker=await sidebar.getByRole('link',{name:'Payment Tracker',exact:true}).boundingBox();
        assert.ok(cashBefore.y-tracker.y<240,'Management Hub should immediately follow finance links, without filling the page height');
        const asideBefore=await sidebar.boundingBox();assert.ok(asideBefore.height<=height,'Sidebar must fit within the viewport');
        const signOut=await sidebar.getByRole('button',{name:'Sign out',exact:true}).boundingBox();assert.ok(signOut.y>=0&&signOut.y+signOut.height<=height,'Sign out must be visible without scrolling the table');
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Layout must not overflow horizontally');
        await page.screenshot({path:join(scratch,`accounts-sidebar-${width}.png`)});
        if(width===1440){
            await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));assert.ok(await page.evaluate(()=>window.scrollY>1000),'Fixture must reproduce a long payment table');
            const cashAfter=await cash.boundingBox();assert.ok(Math.abs(cashAfter.y-cashBefore.y)<2,'Petty Cash must stay visible when the payment table scrolls');await page.screenshot({path:join(scratch,'accounts-sidebar-scrolled.png')});
        }
        await cash.click();await page.getByTestId('petty-body').waitFor();assert.equal(new URL(page.url()).pathname,`/${org}/petty-cash`);if(width===390)assert.equal(await page.getByRole('button',{name:'Close menu',exact:true}).count(),0);
        assert.deepEqual(errors,[]);
    }catch(error){await page.screenshot({path:join(scratch,`accounts-sidebar-failure-${width}.png`)});throw error;}finally{await page.close();}
});
