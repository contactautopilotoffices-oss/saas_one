import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

test('recruitment navigation, layouts, theme and responsive error states', { timeout: 180000 }, async () => {
 const root = process.cwd();
 const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Workspace from './frontend/components/recruitment/workspace/RecruitmentWorkspace'; import {ThemeProvider} from './frontend/context/ThemeContext'; createRoot(document.getElementById('root')).render(<ThemeProvider><Workspace orgId="test-org"/></ThemeProvider>);`, loader:'tsx', resolveDir:root },
  bundle:true, write:false, format:'iife', platform:'browser', tsconfig:resolve('tsconfig.json'), define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},
  plugins:[{name:'test-host', setup(b){
   b.onResolve({filter:/^(next\/navigation|next\/link|.*\/context\/AuthContext|.*\/layout\/DashboardSidebar)$/}, args=>({path:args.path,namespace:'host'}));
   b.onLoad({filter:/.*/,namespace:'host'}, args=>({loader:'jsx',resolveDir:root,contents:
    args.path.includes('AuthContext') ? `export const useAuth=()=>({user:{id:'user',email:'recruiter@example.com',user_metadata:{full_name:'Aditi Rao',role:'hr'}},membership:{},loading:false});` :
    args.path.includes('DashboardSidebar') ? `export const HR_SIDEBAR_ROLES=['hr'];` :
    args.path==='next/link' ? `import React from 'react'; export default function Link(p){return <a {...p}/>}` :
    `import {useSyncExternalStore} from 'react'; const sub=f=>{addEventListener('popstate',f);return()=>removeEventListener('popstate',f)}; const router={replace(url){history.replaceState(null,'',url);dispatchEvent(new PopStateEvent('popstate'))},push(url){this.replace(url)}}; export const useRouter=()=>router; export const usePathname=()=>'/test-org/recruitment'; export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(sub,()=>location.search)); export const useParams=()=>({orgId:'test-org'});` }));
  }}]
 });
 const css=(await postcss([tailwind()]).process(await readFile('app/globals.css','utf8'),{from:resolve('app/globals.css')})).css;
 const manrope=await readFile('public/fonts/manrope/Manrope-Variable.ttf');
 const server=createServer((req,res)=>{
  if(req.url==='/fonts/manrope/Manrope-Variable.ttf') { res.setHeader('content-type','font/ttf');res.end(manrope);return; }
  res.setHeader('content-type','text/html');res.end(`<style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script>`);
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 let browser;
 try {
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(existsSync)});
  await mkdir('artifacts/recruitment',{recursive:true});
  for(const width of [1440,390]) {
   const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
   const errors=[]; page.on('pageerror',e=>{errors.push(e.message); console.error(e.message)});
   const candidate = {id:'candidate-1',candidateId:'person-1',fullName:'Asha Rao',email:'asha@example.com',phone:'9876543210',currentDesignation:'Facility Manager',currentOrganization:'Example Ltd',location:'Mumbai',role:'Senior Facility Manager',status:'in_process',totalExpMonths:72,relevantExpMonths:48,noticePeriodDays:30,currentInhand:50000,expectedInhand:65000,sheetId:null,sheetName:null,sourceRow:null,candidateSource:'Referral',sourcingDate:'2026-11-20',remark:null,createdAt:'2026-11-20',updatedAt:'2026-11-25',deletedAt:null,indexed:true};
   const stages=[{key:'screening',name:'Screening',column:'Screening',kind:'progress',tone:'violet',whatsapp:false,message:null,needsRemark:false,hidden:false},{key:'interview',name:'Interview',column:'Interview',kind:'progress',tone:'teal',whatsapp:false,message:null,needsRemark:false,hidden:false}];
   const position={id:'position-1',title:'Senior Facility Manager',status:'open',department:'Operations',location:'Mumbai',employmentType:'full_time',createdAt:'2026-11-20',daysOpen:6,targetDays:30,inPipeline:1,counts:{screening:1},filters:{},prefer:{},summary:'Lead workplace operations and a growing facilities team.',openings:2,recruiterId:null,budgetMin:null,budgetMax:null};
   const offer={id:'offer-1',candidateName:'Asha Rao',candidateId:'person-1',positionTitle:position.title,positionId:position.id,status:'pending',proposedCtc:780000,bandMin:600000,bandMax:900000,variancePct:null,breakup:{},joiningDate:'2026-12-15',canDecide:true,currentLevel:'hr_head',letterGaps:[],events:[],createdAt:'2026-11-25'};
   await page.route('**/api/**',route=>{
    const url=route.request().url();
    let body;
    if(/\/candidate-[12]\/positions\?/.test(url)) body={memberships:[]};
    else if(url.includes('/positions?')) body={positions:[position]};
    else if(url.includes('/members?')) body={members:[{id:'member-1',applicationId:candidate.id,record:candidate,stage:'screening',stageChangedAt:'2026-11-10',addedAt:'2026-11-10',remark:null}]};
    else if(url.includes('/stages?')) body={stages,changes:[],counts:{}};
    else if(url.includes('/recruiters?')) body={people:[]};
    else if(url.includes('/dashboard?')) body={roles:[{...position,recruiterName:null,ageing:false,nextAction:'Review screening candidates'}],funnel:[{column:'Screening',count:1,rejected:0},{column:'Interview',count:0,rejected:0}],sources:[{source:'Referral',count:1}],today:{interviews:[],scorecardsPending:[],waiting:[],offersAwaiting:[]},metrics:null};
    else if(url.includes('/offers?')) body=url.includes('handovers=')?{handovers:[]}:{offers:[offer,{...offer,id:'offer-2',candidateName:'Priya Shah',canDecide:false}]};
    else if(new URL(url).pathname==='/api/candidates') body={records:[candidate,{...candidate,id:'candidate-2',candidateId:'person-2',fullName:'Priya Shah'}],total:2,page:1,pageSize:50};
    else if(url.includes('/sheets?')) body={sheets:[]};
    else if(url.includes('/requisitions?')) body={requisitions:[{id:'request-1',requisitionNo:'REQ-001',status:'submitted',currentLevel:'hr_head',currentApproverName:'Aditi Rao',roleTitle:'Facility Executive',department:'Operations',location:'Mumbai',positions:2,ageDays:3,budgetMinCtc:400000,budgetMaxCtc:600000,submittedAt:'2026-11-23',requiredSkills:[]}],access:{configured:true,userId:'user',approverLevels:['hr_head'],seesAll:true},departments:['Operations']};
    return route.fulfill({status:body?200:503,contentType:'application/json',body:JSON.stringify(body || {error:'Could not load this section. Try again.'})});
   });
   await page.goto(`http://127.0.0.1:${server.address().port}/test-org/recruitment`);
   await page.getByRole('tab',{name:'Overview',exact:true}).waitFor();
   await page.evaluate(()=>document.fonts.ready);
   assert.ok(await page.evaluate(()=>document.fonts.check('16px Manrope')));
   assert.equal(await page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--primary').trim()), '#353535');
   assert.equal(await page.locator('.recruitment-header h1').evaluate(el=>getComputedStyle(el).fontWeight), '800');
   assert.equal(await page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--success').trim()), '#15803d');
   assert.equal(await page.locator('#recruitment-nav-home').getAttribute('aria-current'),'page');
   await page.getByRole('tab',{name:'Overview',exact:true}).focus();
   await page.keyboard.press('End');
   assert.equal(await page.getByRole('tab',{name:'Insights',exact:true}).getAttribute('aria-selected'),'true');
   await page.keyboard.press('Home');
   const spotlight=page.getByRole('region',{name:'Candidate spotlight',exact:true});
   await spotlight.getByRole('heading',{name:'Asha Rao',exact:true}).waitFor();
   await page.getByRole('region',{name:'People in your talent pool',exact:true}).getByRole('button',{name:/Priya Shah/}).click();
   await spotlight.getByRole('heading',{name:'Priya Shah',exact:true}).waitFor();
   await spotlight.getByRole('button',{name:'Open profile',exact:true}).click();
   await page.getByRole('dialog').waitFor();
   await page.keyboard.press('Escape');
   await page.getByRole('dialog').waitFor({state:'hidden'});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`home fits ${width}px`);
   await page.screenshot({path:`artifacts/recruitment/home-${width}.png`,fullPage:true});
   await page.locator('#recruitment-nav-positions').click();
   await page.getByRole('button',{name:'Senior Facility Manager',exact:true}).waitFor();
   await page.getByRole('button',{name:'List view',exact:true}).click();
   assert.equal(await page.locator('[data-job-layout]').getAttribute('data-job-layout'),'list');
   await page.getByRole('searchbox',{name:'Search jobs',exact:true}).fill('Senior');
   await page.locator('#recruitment-nav-home').click();
   await page.locator('#recruitment-nav-positions').click();
   assert.equal(await page.getByRole('searchbox',{name:'Search jobs',exact:true}).inputValue(),'Senior');
   await page.getByRole('button',{name:'Grid view',exact:true}).click();
   await page.getByRole('button',{name:/Past the hiring target/}).click();
   await page.getByText('No job matches that', {exact:true}).waitFor();
   await page.getByRole('button',{name:/Roles in this view/}).click();
   await page.getByRole('button',{name:'Senior Facility Manager',exact:true}).waitFor();
   await page.screenshot({path:`artifacts/recruitment/positions-${width}.png`,fullPage:true});
   for(const id of ['search','requisitions','pipeline','offers','candidates','resumes','email','outreach','sheets','dashboard','settings']) {
    await page.locator(`#recruitment-nav-${id}`).click();
    await page.locator(`[data-recruitment-screen="${id}"]`).waitFor();
    assert.equal(await page.locator(`#recruitment-nav-${id}`).getAttribute('aria-current'),'page');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${id} fits ${width}px`);
    const screen=page.locator(`[data-recruitment-screen="${id}"]`);
    if(id==='offers') {
     await screen.getByRole('navigation',{name:'Offer list'}).getByRole('button',{name:/Priya Shah/}).click();
     assert.equal(await screen.getByRole('button',{name:'Approve',exact:true}).count(),0);
     await screen.getByRole('button',{name:'My approvals',exact:true}).click();
     await screen.getByRole('button',{name:'Ask to revise',exact:true}).click();
     await screen.getByRole('textbox',{name:'What to revise'}).fill('Confirm the joining date');
     await page.locator('#recruitment-nav-home').click(); await page.locator('#recruitment-nav-offers').click();
     assert.equal(await screen.getByRole('textbox',{name:'What to revise'}).inputValue(),'Confirm the joining date');
    }
    if(id==='candidates') { await screen.getByRole('button',{name:'Cards',exact:true}).click(); await screen.getByRole('button',{name:'Asha Rao',exact:true}).waitFor(); }
    if(id==='resumes') { await screen.getByRole('button',{name:'Import & sources',exact:true}).click(); await screen.getByRole('heading',{name:'Add resumes',exact:true}).waitFor(); await screen.getByRole('button',{name:'Resume library',exact:true}).click(); }
    if(id==='outreach') { await screen.getByRole('button',{name:'Choose candidates',exact:true}).click(); assert.equal(await page.locator('#recruitment-nav-search').getAttribute('aria-current'),'page'); await page.locator('#recruitment-nav-outreach').click(); }
    if(id==='sheets') { assert.equal(await screen.getByRole('button',{name:'Clear all data',exact:true}).count(),0); await screen.getByRole('button',{name:'Import a sheet',exact:true}).click(); await screen.getByRole('heading',{name:'Bring your sourcing data together'}).waitFor(); }
    if(id==='dashboard') { await screen.getByRole('button',{name:'Role health',exact:true}).click(); await screen.getByRole('region',{name:'Roles',exact:true}).waitFor(); }
    if(id==='settings') { await screen.getByRole('button',{name:'Offer letters',exact:true}).click(); await screen.getByRole('heading',{name:'Offer letters',exact:true}).waitFor(); }
    if(id==='requisitions') { await screen.getByRole('button',{name:/Waiting for your decision/}).click(); await screen.getByRole('region',{name:'Approval inbox'}).waitFor(); }
    if(id==='pipeline') { await screen.getByRole('region',{name:'Role brief'}).waitFor(); await screen.getByText('1 candidate needs a follow-up').click(); }
    await page.screenshot({path:`artifacts/recruitment/${id}-${width}.png`,fullPage:true});
   }
   await page.getByRole('button',{name:'Switch to dark theme'}).click();
   assert.ok(await page.locator('html').evaluate(el=>el.classList.contains('dark')));
   await page.getByRole('button',{name:'Switch to light theme'}).click();
   assert.equal(await page.getByRole('link',{name:'Autopilot',exact:true}).getAttribute('href'),'/test-org/hr-tickets');
   assert.deepEqual(errors,[]);
   await page.close();
  }
 } finally {await browser?.close(); await new Promise(done=>server.close(done));}
});
