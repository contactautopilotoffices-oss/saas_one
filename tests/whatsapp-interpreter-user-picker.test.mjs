import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { chromium } from 'playwright';

const require=createRequire(import.meta.url),modules={};
for(const [name,path] of Object.entries({react:'react/cjs/react.development.js','react/jsx-runtime':'react/cjs/react-jsx-runtime.development.js',
    'react-dom':'react-dom/cjs/react-dom.development.js','react-dom/client':'react-dom/cjs/react-dom-client.development.js',scheduler:'scheduler/cjs/scheduler.development.js'})) {
    const [pkg,...rest]=path.split('/');modules[name]=await readFile(new URL(rest.join('/'),`file://${require.resolve(`${pkg}/package.json`)}`),'utf8');
}
modules.settings=ts.transpileModule(await readFile(new URL('../frontend/components/whatsapp/AssistantSettings.tsx',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
}).outputText;
let browser;
test.before(async()=>{browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});});
test.after(async()=>{await browser?.close();});
async function mount(t,{directoryFailure=false}={}) {
    const page=await browser.newPage();page.setDefaultTimeout(4000);t.after(()=>page.close());
    await page.route('http://app.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
    await page.goto('http://app.test/settings');
    await page.evaluate(({modules,directoryFailure})=>{
        const cache={};const require=name=>{if(cache[name])return cache[name].exports;const m=cache[name]={exports:{}};
            new Function('module','exports','require','process',modules[name])(m,m.exports,require,{env:{NODE_ENV:'development'}});return m.exports;};
        window.saved={enabled:true,bookingEnabled:true,ticketEnabled:true,defaultDate:'ask',pilotUserIds:['alice']};
        window.writes=[];
        let failDirectory=directoryFailure;
        window.fetch=async(url,options={})=>{
            if(options.method==='PUT'){window.saved=JSON.parse(options.body).config;window.writes.push(JSON.parse(options.body));return {ok:true,json:async()=>({config:window.saved})};}
            if(url.includes('view=users')&&failDirectory){failDirectory=false;return {ok:false,json:async()=>({error:'Organization users could not be loaded.'})};}
            if(url.includes('view=users'))return {ok:true,json:async()=>({users:[
                {id:'alice',name:'Alice Patil',email:'alice@example.com',phone:'9000000000',selectable:true},
                {id:'bob',name:'Bob Shah',email:'bob@example.com',phone:'9111111111',selectable:true},
                {id:'pending',name:'Pending User',email:'pending@example.com',phone:'',selectable:false},
            ]})};
            return {ok:true,json:async()=>({config:window.saved,userId:'alice',readiness:{llm:true,projectApi:true,globalEnabled:true}})};
        };
        const React=require('react'),Component=require('settings').default;
        window.root=require('react-dom/client').createRoot(document.getElementById('root'));
        window.renderSettings=key=>window.root.render(React.createElement(Component,{organizationId:'org-a',key}));
        window.renderSettings('first');
    },{modules,directoryFailure});
    return page;
}
test('admin searches names, email and phone, adds and removes users, and selection survives reloading',async t=>{
    const page=await mount(t);
    const search=page.getByLabel('Search organization users');
    await search.fill('Bob');await page.getByRole('button',{name:'Add Bob Shah',exact:true}).click();
    await page.getByRole('button',{name:'Save AI settings'}).click();
    await page.getByText('WhatsApp AI settings saved.',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.writes[0].config.pilotUserIds),['alice','bob']);
    assert.equal(await page.evaluate(()=>window.writes[0].config.accessMode),'selected');
    await page.evaluate(()=>window.renderSettings('reload'));
    await page.getByRole('button',{name:'Remove Bob Shah',exact:true}).waitFor();
    await page.getByRole('button',{name:'Remove Bob Shah',exact:true}).click();
    await search.fill('bob@example.com');await page.getByRole('button',{name:'Add Bob Shah',exact:true}).waitFor();
    await search.fill('911111');await page.getByRole('button',{name:'Add Bob Shah',exact:true}).waitFor();
    await search.fill('Pending');assert.equal(await page.getByRole('button',{name:'Add Pending User',exact:true}).isDisabled(),true);
});
test('all-authorized-users is an explicit saved choice and returning to testing retains selected users',async t=>{
    const page=await mount(t);
    const audience=page.getByLabel('Who can use WhatsApp AI');
    await audience.selectOption('all');
    await page.getByRole('button',{name:'Save AI settings'}).click();
    await page.getByText('WhatsApp AI settings saved.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.writes[0].config.accessMode),'all');
    await audience.selectOption('selected');
    await page.getByRole('button',{name:'Remove Alice Patil',exact:true}).waitFor();
});
test('failed directory load explains disabled controls before the form and retry recovers them',async t=>{
    const page=await mount(t,{directoryFailure:true});
    await page.getByText('Organization users could not be loaded.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Save AI settings'}).isDisabled(),true);
    assert.equal(await page.evaluate(()=>{
        const section=document.querySelector('section');
        return !!(section.querySelector('[role="alert"]')?.compareDocumentPosition(section.querySelector('fieldset'))&Node.DOCUMENT_POSITION_FOLLOWING);
    }),true);
    await page.getByRole('button',{name:'Retry loading settings'}).click();
    await page.getByRole('button',{name:'Remove Alice Patil',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Save AI settings'}).isEnabled(),true);
});
