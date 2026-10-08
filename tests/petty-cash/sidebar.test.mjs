import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadTs } from './load-ts.mjs';
const org='00000000-0000-0000-0000-000000000001';
const matrix=loadTs('frontend/constants/capabilities.ts').CAPABILITY_MATRIX;
const roles=[...new Set([...Object.keys(matrix),'org_super_admin','hr_manager','hr_ops','security','procurement','owner','admin','employee','tenant','tenant_admin','food_vendor','maintenance_vendor','pantry_vendor','cafeteria_vendor','external_vendor'])];
const empty={__esModule:true,default:()=>null};
test('all 42 internal/external role fixtures render exactly the intended shared-sidebar Petty Cash link',()=>{
 for(const role of roles){
  const membership={org_id:org,org_role:role,all_org_memberships:[{org_id:org,role}],properties:[{id:'property-a',organization_id:org,role,name:'Property A'}]};
  const mocks={react:React,'next/link':{__esModule:true,default:({href,children,...props})=>React.createElement('a',{href,...props},children)},'next/navigation':{useParams:()=>({orgId:org}),usePathname:()=>`/${org}/dashboard`,useSearchParams:()=>new URLSearchParams()},'@/frontend/context/AuthContext':{useAuth:()=>({membership,user:{id:'fixture',user_metadata:{role}},signOut:()=>{}})},'@/frontend/constants/bdSuperAdmins':{isBdSuperAdmin:()=>false},'../auth/CapabilityWrapper':{__esModule:true,default:({domain,action,children})=>matrix[role]?.[domain]?.includes(action)?children:null},'../ui/FeedbackModal':empty,'../ui/SignOutModal':empty,'@/frontend/components/dashboard/NotificationBell':empty};
  const Sidebar=loadTs('frontend/components/layout/DashboardSidebar.tsx',mocks).default;
  const html=renderToStaticMarkup(React.createElement(Sidebar));
  const count=(html.match(new RegExp(`href="/${org}/petty-cash"`,'g'))||[]).length;
  assert.equal(count,/tenant|vendor/.test(role)?0:1,role);
 }
});
test('role dashboards reuse their established body and put Petty Cash in Management Hub',()=>{
 for(const name of ['OrgDashboard','OrgAdminDashboard','MasterAdminDashboard','PropertyAdminDashboard','StaffDashboard','MstDashboard','SecurityDashboard','ProcurementDashboard','SoftServiceManagerDashboard']){
  const source=readFileSync(`frontend/components/dashboard/${name}.tsx`,'utf8');
  assert.match(source,/useDashboardContent\(\)/,name);
  assert.match(source,/dashboardContent \?\? \(<>/,name);
  assert.equal((source.match(/<PettyCashNavLink/g)||[]).length,1,name);
  const hub=source.indexOf('Management Hub');
  const petty=source.indexOf('<PettyCashNavLink');
  assert.ok(hub!==-1&&hub<petty,name);
  const personal=source.indexOf('System & Personal',hub);
  if(personal!==-1) assert.ok(petty<personal,name);
 }
 const nested=readFileSync('app/(dashboard)/[orgId]/petty-cash/layout.tsx','utf8');
 assert.doesNotMatch(nested,/AccountsWorkspace/);
 const parent=readFileSync('app/(dashboard)/layout.tsx','utf8');
 assert.match(parent,/isFullDashboard \|\| isPettyCashWorkspace/);
 assert.match(parent,/<PettyCashShell>/);
});
test('shared email handler changes leave all non-petty-cash action functions unchanged',async()=>{
 const ts=(await import('typescript')).default;
 const path='backend/lib/emailActions/handlers.ts';
 const before=execFileSync('git',['show',`5140c02a7f0e2692f8c33c5663ad9ec28576ee6a:${path}`],{encoding:'utf8'});const after=readFileSync(path,'utf8');
 const functions=source=>{const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);return new Map(ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text!=='handlePettyCash').map(n=>[n.name.text,n.getText(ast)]));};
 assert.deepEqual(functions(after),functions(before));
});
