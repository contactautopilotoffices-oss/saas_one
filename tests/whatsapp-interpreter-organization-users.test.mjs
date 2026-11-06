import test from 'node:test';
import assert from 'node:assert/strict';

test('organization picker scopes both membership sources, deduplicates and reads beyond a database page',async()=>{
    const {getOrganizationUsers}=await import('../backend/lib/whatsapp/interpreter/organization-users.mjs');
    const reads=[];
    const alice={id:'alice',full_name:'Alice',email:'alice@example.com',phone:'9000000000',is_approved:true};
    const bob={id:'bob',full_name:'Bob',phone:null,approval_status:'pending'};
    const rows={organization_memberships:Array.from({length:500},()=>({user:alice})),property_memberships:[{user:alice},{user:bob},{user:{id:'deleted',deleted_at:'today'}}]};
    const admin={from(table){const filters={};const q={select(selection){
        // updated_by also references users; embedding must choose the member's user_id.
        assert.match(selection, /user:users!user_id\(/);return q;
    },eq(k,v){filters[k]=v;return q;},order(column){
        // Memberships use composite keys, with no synthetic id column.
        assert.ok(['user_id',...(table==='property_memberships'?['property_id']:[])].includes(column),`Unknown membership column: ${column}`);return q;
    },async range(start,end){
        reads.push({table,filters:{...filters},start});return {data:rows[table].slice(start,end+1),error:null};
    }};return q;}};
    const result=await getOrganizationUsers(admin,'org-a');
    assert.deepEqual(result.map(user=>user.id),['alice','bob']);
    assert.equal(result[0].selectable,true);assert.equal(result[1].selectable,false);
    for(const read of reads) {
        assert.equal(read.filters.is_active,true);
        assert.equal(read.filters[read.table==='organization_memberships'?'organization_id':'properties.organization_id'],'org-a');
    }
    assert.ok(reads.some(read=>read.table==='organization_memberships'&&read.start===500));
});
test('picker database errors do not return a partial user list',async()=>{
    const {getOrganizationUsers}=await import('../backend/lib/whatsapp/interpreter/organization-users.mjs');
    const admin={from(){const q={select(){return q;},eq(){return q;},order(){return q;},range:async()=>({error:new Error('unavailable')})};return q;}};
    await assert.rejects(getOrganizationUsers(admin,'org-a'),/unavailable/);
});
