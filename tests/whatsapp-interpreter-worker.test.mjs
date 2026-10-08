import test from 'node:test';
import assert from 'node:assert/strict';
import { drainPhone } from '../backend/lib/whatsapp/assistant/worker.mjs';
import { advanceConversation } from '../backend/lib/whatsapp/interpreter/coordinator.mjs';
test('failed dynamic delivery reuses persisted interpretation rather than invoking Groq or booking again',async()=>{
    let calls=0,state=null,ready=false,complete=false,claimCount=0;
    const event={id:'operation-id',payload:{phone:'919000000000',text:'Book Meeting Room',messageId:'wamid'},snapshot:null,reply:null,status:'pending'};
    const deps={now:()=>new Date(),findUser:async()=>({id:'user'}),properties:async()=>[{id:'property',name:'Office',organization_id:'org'}],
        settings:async()=>({enabled:true,bookingEnabled:true,ticketEnabled:true,pilotUserIds:['user'],defaultDate:'ask'}),rooms:async()=>[],interpret:()=>assert.fail('menu does not need Groq')};
    const store={claim:async()=>complete||claimCount++>2?null:{token:'token',event},save:async(_,value,reply)=>{state=value;event.reply=reply;event.status='ready';ready=true;},
        finish:async(_,error)=>{if(!error)complete=true;},fail:()=>assert.fail('transient failure not permanent')};
    const advance=async(...args)=>{calls++;return advanceConversation(...args);};
    await drainPhone('919000000000',{store,advance,dependencies:deps,send:async()=>({success:false,retryable:true})});
    assert.equal(ready,true);assert.equal(state.active,'booking');
    await drainPhone('919000000000',{store,advance,dependencies:deps,send:async()=>({success:true,messageIds:['response-id']})});
    assert.equal(calls,1);assert.equal(complete,true);
});
test('automatic booking survives a state-save failure without a second booking or notification',async()=>{
    const event={id:'direct-operation',payload:{phone:'919000000000',text:'Book Boardroom today from 5 pm to 6 pm',messageId:'direct-wamid'},snapshot:null,reply:null,status:'pending'};
    let stored=null,saveCalls=0,bookingCalls=0,finished=false;
    const deps={now:()=>new Date('2026-10-06T06:00:00Z'),findUser:async()=>({id:'u1'}),
        properties:async()=>[{id:'p1',name:'Office',organization_id:'o1'}],
        settings:async()=>({enabled:true,bookingEnabled:true,pilotUserIds:['u1'],defaultDate:'ask'}),
        rooms:async()=>[{id:'r1',name:'Boardroom'}],availableRooms:async()=>{assert.equal(stored,null);return [{id:'r1'}];},creditSummary:async()=>null,
        interpret:async()=>({ok:true,intent:'details',fields:{property:null,room:'Boardroom',date:'today',start:'5 pm',end:'6 pm',issue:null}}),
        findBooking:async()=>stored,bookRange:async input=>{bookingCalls++;stored={id:'booking',property_id:input.propertyId};return stored;}};
    let claimed=false;
    const store={claim:async()=>finished||claimed?null:(claimed=true,{token:'lease',event}),
        save:async(_,state,reply)=>{if(++saveCalls===1)throw new Error('state save interrupted');event.status='ready';event.reply=reply;},
        finish:async(_,error)=>{if(!error)finished=true;},fail:()=>assert.fail('not a send failure')};
    const worker={store,advance:advanceConversation,dependencies:deps,send:()=>assert.fail('completion is owned by the existing outbox')};
    await drainPhone('919000000000',worker);assert.equal(finished,false);assert.equal(bookingCalls,1);
    claimed=false;await drainPhone('919000000000',worker);
    assert.equal(finished,true);assert.equal(bookingCalls,1);assert.equal(saveCalls,2);
});
test('fresh direct request recovers its committed booking after a save failure across midnight without another model call',async()=>{
    const input={phone:'919000000000',text:'Book Boardroom today from 11.50 pm to 11.55 pm',requestId:'stable-operation',inboundAt:'2026-10-05T18:15:00Z'};
    let stored=null;
    const deps={now:()=>new Date('2026-10-05T18:15:00Z'),findUser:async()=>({id:'u1'}),
        properties:async()=>[{id:'p1',name:'Office',organization_id:'o1'}],settings:async()=>({enabled:true,bookingEnabled:true,pilotUserIds:['u1']}),
        rooms:async()=>[{id:'r1',name:'Boardroom'}],availableRooms:async()=>[{id:'r1'}],creditSummary:async()=>null,
        interpret:async()=>({ok:true,intent:'details',fields:{property:null,room:'Boardroom',date:'today',start:'11.50 pm',end:'11.55 pm',issue:null}}),
        findBooking:async(_request,_user,expected)=>!expected||JSON.parse(expected)[4]===stored?.date?stored:null,
        bookRange:async value=>(stored={id:'booking',property_id:value.propertyId,date:value.date})};
    assert.equal((await advanceConversation(input,null,deps)).reply,null);assert.equal(stored.date,'2026-10-05');
    deps.now=()=>new Date('2026-10-05T18:31:00Z');deps.interpret=()=>assert.fail('completed request must not need another model call');
    deps.availableRooms=()=>assert.fail('completed request must not need another availability check');
    assert.equal((await advanceConversation(input,null,deps)).reply,null);
});
