import test from 'node:test';
import assert from 'node:assert/strict';

test('non-tenant review never reads company membership or credit balances',async()=>{
    const {summarizeBookingCredits}=await import('../backend/lib/whatsapp/interpreter/booking-credits.mjs');
    const admin={rpc:async(name,args)=>{assert.equal(name,'whatsapp_assistant_requires_credits');assert.deepEqual(args,{p_user_id:'admin',p_property_id:'property'});return {data:false};},from:()=>assert.fail('non-tenants must not read credits')};
    assert.equal(await summarizeBookingCredits(admin,'admin','property',{start_time:'14:00',end_time:'15:00'}),null);
});
test('tenant review uses property-scoped company credits and clearly reports missing allocation',async()=>{
    const {summarizeBookingCredits}=await import('../backend/lib/whatsapp/interpreter/booking-credits.mjs');
    const filters=[];let credit={remaining_hours:2};
    const admin={rpc:async()=>({data:true}),from(table){const q={select(){return q;},eq(k,v){filters.push([table,k,v]);return q;},is(k,v){filters.push([table,k,v]);return q;},
        maybeSingle(){return q;},then(resolve,reject){return Promise.resolve({data:table==='company_members'?[{company_id:'tenant-company'}]:credit,error:null}).then(resolve,reject);}};return q;}};
    const summary=await summarizeBookingCredits(admin,'tenant','property',{start_time:'14:00',end_time:'14:30'});
    assert.match(summary,/0.5.*required.*2.*remaining/s);
    assert.ok(filters.some(([t,k,v])=>t==='company_members'&&k==='company.property_id'&&v==='property'));
    assert.ok(filters.some(([t,k,v])=>t==='meeting_room_credits'&&k==='company_id'&&v==='tenant-company'));
    credit=null;assert.match(await summarizeBookingCredits(admin,'tenant','property',{start_time:'14:00',end_time:'15:00'}),/No.*credits.*assigned/i);
});
test('unavailable role policy fails closed before any balance lookup',async()=>{
    const {summarizeBookingCredits}=await import('../backend/lib/whatsapp/interpreter/booking-credits.mjs');
    await assert.rejects(summarizeBookingCredits({rpc:async()=>({error:new Error('policy unavailable')}),from:()=>assert.fail('no balance read')},'user','property',{start_time:'14:00',end_time:'15:00'}),/policy unavailable/);
});
