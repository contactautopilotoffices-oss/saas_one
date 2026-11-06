import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
const {overviewGroups}=loadTs('frontend/lib/pettyCash/overviewGroups.ts');
test('overview groups use stable property/user identities and cent-accurate filtered totals',()=>{
 const row={property_id:'p1',property_name:'Site',requester_id:'u1',requester_name:'Ravi',status:'paid',paid:0.1,spent:0.05,balance:0.05,unresolved_proofs:1};
 const rows=[row,{...row,paid:0.2,status:'closed'},{...row,property_id:'p2',requester_id:'u2',status:'submitted'}];
 const properties=overviewGroups(rows,'property');assert.equal(properties.length,2);assert.equal(properties[0].requests,2);assert.equal(properties[0].pending,1);assert.equal(properties[0].paid,0.3);
 const users=overviewGroups(rows,'requester');assert.equal(users.length,2);assert.equal(users[0].requests,2);assert.equal(users[1].requests,1);
 assert.equal(overviewGroups(rows.filter(r=>r.property_id==='p2'),'requester').length,1);assert.equal(overviewGroups([],'property').length,0);
});
