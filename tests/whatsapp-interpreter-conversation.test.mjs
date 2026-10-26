import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceConversation } from '../backend/lib/whatsapp/interpreter/coordinator.mjs';

const fields = value => ({ property:null,room:null,date:null,start:null,end:null,issue:null,...value });
function harness(extra={}) {
    const calls=[];
    const deps={
        now:()=>new Date('2026-10-05T06:00:00Z'),
        findUser:async()=>({id:'u1'}),
        properties:async()=>[{id:'p1',name:'SS Plaza',organization_id:'o1'}],
        settings:async()=>({enabled:true,bookingEnabled:true,ticketEnabled:true,defaultDate:'ask',pilotUserIds:['u1']}),
        rooms:async()=>[{id:'r1',name:'Conference Room 1'},{id:'r2',name:'Conference Room 2'}],
        availableRooms:async()=>[{id:'r1',name:'Conference Room 1'}],
        creditSummary:async()=>'1 hours required; 2 hours remaining',
        interpret:async()=>({ok:true,intent:'details',fields:fields({room:'conference room 1',date:'today',start:'2.30pm',end:'3 pm'})}),
        findBooking:async()=>null,findTicket:async()=>null,
        bookRange:async value=>{calls.push(['book',value]);return {id:'booking-1'};},
        createTicket:async value=>{calls.push(['ticket',value]);return {id:'ticket-1'};},
        ...extra,
    };
    let state=null;
    return {calls,deps,get state(){return state;},async send(text,other={}){
        const result=await advanceConversation({phone:'919000000000',messageId:'wamid',requestId:`event-${Math.random()}`,text,mediaType:'text',...other},state,deps);
        state=result.session;return result;
    }};
}

test('menu booking collects grounded details, decimal clocks, and requires confirmation',async()=>{
    const h=harness();
    assert.equal((await h.send('hi')).reply.key,'menu');
    await h.send('Book Meeting Room');
    const prepared=await h.send('conference room 1 today from 2.30pm to 3 pm');
    assert.match(prepared.reply.text,/2:30 PM.*3:00 PM/);
    assert.equal(h.calls.length,0);
    const requestId=h.state.drafts.booking.id;
    await h.send('confirm booking');
    assert.equal(h.calls.length,1);
    assert.equal(h.calls[0][1].requestId,requestId);
    assert.equal(h.calls[0][1].startTime,'14:30');
    assert.equal(h.state.drafts.booking,undefined);
    await h.send('confirm booking');
    assert.equal(h.calls.length,1);
});
test('all-user mode works for booking and tickets but excludes other organizations and disabled services',async()=>{
    const h=harness({properties:async()=>[{id:'p1',name:'SS Plaza',organization_id:'o1'},{id:'private',name:'Private Office',organization_id:'o2'}],
        settings:async org=>({enabled:true,accessMode:org==='o1'?'all':'selected',pilotUserIds:[],bookingEnabled:true,ticketEnabled:false,defaultDate:'ask'})});
    const booking=await h.send('Book Meeting Room');
    assert.equal(h.state.active,'booking');
    assert.equal(h.state.drafts.booking.propertyId,'p1');
    assert.doesNotMatch(booking.reply.text,/Private Office/);
    assert.match((await h.send('Create Ticket')).reply.text,/not enabled/);
    h.deps.settings=async()=>({enabled:true,accessMode:'all',pilotUserIds:[],bookingEnabled:true,ticketEnabled:true,defaultDate:'ask'});
    await h.send('Create Ticket');
    assert.equal(h.state.active,'ticket');
    h.deps.properties=async()=>[];
    await h.send('Submit Ticket');
    assert.equal(h.calls.length,0);
});

test('no menu selection, task commands, invalid model output and injected fields cannot create tickets',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({issue:'invented issue'})})});
    await h.send('done all');
    await h.send('lights not working');
    assert.equal(h.state.active,null);
    await h.send('Create Ticket');
    await h.send('lights not working');
    await h.send('submit ticket');
    assert.equal(h.calls.length,0);
});
test('all-user mode creates through the existing services only after explicit confirmation and can be restricted again',async()=>{
    const h=harness({settings:async()=>({enabled:true,accessMode:'all',pilotUserIds:[],bookingEnabled:true,ticketEnabled:true,defaultDate:'ask'})});
    await h.send('Book Meeting Room');await h.send('conference room 1 today from 2.30pm to 3 pm');
    assert.equal(h.calls.length,0);await h.send('Confirm Booking');assert.equal(h.calls[0][0],'book');
    h.deps.interpret=async()=>({ok:true,intent:'details',fields:fields({issue:'Water is leaking'})});
    await h.send('Create Ticket');await h.send('Water is leaking');
    assert.equal(h.calls.length,1);await h.send('Submit Ticket');assert.equal(h.calls[1][0],'ticket');
    await h.send('Book Meeting Room');
    h.deps.settings=async()=>({enabled:true,accessMode:'selected',pilotUserIds:[],bookingEnabled:true,ticketEnabled:true,defaultDate:'ask'});
    await h.send('Confirm Booking');assert.equal(h.calls.length,2);assert.equal(h.state.drafts.booking,undefined);
});

test('ticket photos optional; selected ticket does not delegate to Task Manager',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({issue:'Floor lights are not working'})})});
    await h.send('Create Ticket');
    const result=await h.send('Floor lights are not working');
    assert.match(result.reply.text,/Submit Ticket/);
    await h.send('Submit Ticket');
    assert.equal(h.calls[0][0],'ticket');
    assert.equal(h.calls[0][1].mediaUrl,null);
});

test('Submit confirms the current reviewed ticket without passing the command to the model',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({issue:'Cleaning needs to be done'})})});
    await h.send('Create Ticket');await h.send('Cleaning needs to be done');
    h.deps.interpret=()=>assert.fail('confirmation must not be interpreted as a new issue');
    assert.equal((await h.send('Submit')).reply,null);
    assert.equal(h.calls.length,1);assert.equal(h.calls[0][1].title,'Cleaning needs to be done');
    await h.send('Submit');assert.equal(h.calls.length,1);
});

test('Submit needs a current review and clarification when another conversation could own it',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({issue:'Cleaning needs to be done'})})});
    await h.send('Create Ticket');await h.send('Submit');assert.equal(h.calls.length,0);
    await h.send('Cleaning needs to be done');h.deps.hasTaskContext=async()=>true;
    assert.match((await h.send('Submit')).reply.text,/more than one conversation/);assert.equal(h.calls.length,0);
    const draft=h.state.drafts.ticket;
    h.deps.quote=async()=>({workflow:'ticket',conversation_id:draft.id,revision:draft.revision});
    assert.equal((await h.send('Submit',{quotedIds:['current-ticket-review']})).reply,null);assert.equal(h.calls.length,1);
});

test('Submit cannot confirm an old quote and recovers an expired committed ticket without creating it again',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({issue:'Cleaning needs to be done'})})});
    await h.send('Create Ticket');await h.send('Cleaning needs to be done');
    const draft=h.state.drafts.ticket;
    h.deps.quote=async()=>({workflow:'ticket',conversation_id:draft.id,revision:draft.revision-1});
    assert.match((await h.send('Submit',{quotedIds:['old-ticket-review']})).reply.text,/older/);assert.equal(h.calls.length,0);
    h.deps.findTicket=async(_id,_user,expected)=>{assert.equal(expected.title,'Cleaning needs to be done');return {id:'created-ticket',property_id:'p1'};};
    h.deps.now=()=>new Date('2026-10-05T07:00:00Z');
    assert.equal((await h.send('Submit')).reply,null);assert.equal(h.calls.length,0);assert.equal(h.state.active,null);
});

test('a rejected photo never becomes an attached-photo review again without replacement',async()=>{
    let attempts=0;
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({issue:'Cleaning needs to be done'})}),
        createTicket:async()=>{attempts++;throw Object.assign(new Error('bad photo'),{code:'INVALID_MEDIA',mediaReason:'host_not_allowed'});}});
    await h.send('Create Ticket');await h.send('Cleaning needs to be done',{mediaType:'image',mediaUrl:'https://example.com/old.jpg'});
    await h.send('Submit Ticket');
    const retry=await h.send('Submit Ticket');
    assert.doesNotMatch(retry.reply.text,/Photo attached/);assert.match(retry.reply.text,/No Photo/);assert.equal(attempts,1);
    assert.match((await h.send('Add Photo')).reply.text,/No Photo/);
    await h.send('',{mediaType:'image',mediaUrl:'https://example.com/new.jpg'});
    await h.send('Submit Ticket');assert.equal(attempts,2);
    await h.send('No Photo');assert.equal(h.state.drafts.ticket.mediaUrl,undefined);
});

test('fresh access revocation blocks confirmation and rendering draft details',async()=>{
    const h=harness();
    await h.send('Book Meeting Room');
    await h.send('conference room 1 today from 2.30pm to 3 pm');
    h.deps.properties=async()=>[];
    const result=await h.send('confirm booking');
    assert.equal(h.calls.length,0);
    assert.doesNotMatch(result.reply.text,/Conference Room/);
});

test('switching workflows preserves separate drafts; unknown and stale quotes never execute',async()=>{
    const h=harness({quote:async()=>null});
    await h.send('Book Meeting Room');
    await h.send('conference room 1 today from 2.30pm to 3 pm');
    const original=h.state.drafts.booking.id;
    await h.send('Create Ticket');
    assert.equal(h.state.drafts.booking.id,original);
    const unknown=await h.send('yes',{quotedIds:['other-user-message']});
    assert.match(unknown.reply.text,/cannot link/i);
    assert.equal(h.calls.length,0);
    h.deps.quote=async()=>({workflow:'booking',conversation_id:original,revision:0});
    const stale=await h.send('confirm booking',{quotedIds:['old-review']});
    assert.match(stale.reply.text,/older|latest/i);
    assert.equal(h.calls.length,0);
});

test('partial request retains time and asks for missing date and room; ambiguous AM/PM stays missing',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({start:'3 pm',end:'4 pm'})})});
    await h.send('Book Meeting Room');
    const answer=await h.send('book for 3 pm to 4 pm');
    assert.match(answer.reply.text,/date/i);
    assert.match(answer.reply.text,/room/i);
    assert.equal(h.state.drafts.booking.fields.start,'3 pm');
    h.deps.interpret=async()=>({ok:true,intent:'details',fields:fields({start:'3',end:'4'})});
    const ambiguous=await h.send('instead 3 to 4');
    assert.match(ambiguous.reply.text,/AM\/PM/);
    assert.equal(h.calls.length,0);
});

test('multiple properties require a scoped choice; unknown property is not silently substituted',async()=>{
    const h=harness({properties:async()=>[{id:'p1',name:'SS Plaza',organization_id:'o1'},{id:'p2',name:'Other Office',organization_id:'o1'}],interpret:async()=>({ok:true,intent:'details',fields:fields({property:'Private Building'})})});
    await h.send('Book Meeting Room');
    const denied=await h.send('Book in Private Building');
    assert.match(denied.reply.text,/property/i);
    assert.equal(h.state.drafts.booking.propertyId,undefined);
    await h.send('1');
    assert.equal(h.state.drafts.booking.propertyId,'p1');
    assert.equal(h.calls.length,0);
});

test('task notification and bare yes cannot confirm a booking or consume numbered property choices',async()=>{
    const h=harness({hasTaskContext:async()=>true});
    await h.send('Book Meeting Room');
    await h.send('conference room 1 today from 2.30pm to 3 pm');
    const original=structuredClone(h.state.drafts.booking.fields);
    await h.send('yes');
    await h.send('I completed the inspection task at 3 pm');
    assert.deepEqual(h.state.drafts.booking.fields,original);
    assert.equal(h.calls.length,0);
    await h.send('Confirm Booking');
    assert.equal(h.calls.length,1);
});

test('menu button can start collection if provider has not returned campaign message IDs',async()=>{
    const h=harness({quote:async()=>null});
    await h.send('Book Meeting Room',{quotedIds:['unmapped-menu']});
    assert.equal(h.state.active,'booking');
    assert.equal(h.calls.length,0);
});

test('correction invalidates prior review and unavailable room or insufficient credits never reports success',async()=>{
    const h=harness();
    await h.send('Book Meeting Room');
    await h.send('conference room 1 today from 2.30pm to 3 pm');
    h.deps.interpret=async()=>({ok:true,intent:'details',fields:fields({start:'4 pm',end:'5 pm'})});
    await h.send('instead 4 pm to 5 pm');
    h.deps.availableRooms=async()=>[];
    const unavailable=await h.send('Confirm Booking');
    assert.match(unavailable.reply.text,/unavailable/);assert.equal(h.calls.length,0);
    h.deps.availableRooms=async()=>[{id:'r1'}];
    h.deps.bookRange=async()=>{throw Object.assign(new Error('credits'),{code:'INSUFFICIENT_CREDITS'});};
    await h.send('Confirm Booking'); // refresh review after availability changed
    const failure=await h.send('Confirm Booking');
    assert.match(failure.reply.text,/credits/);
    assert.ok(h.state.drafts.booking);
});

test('captioned photo is grounded ticket evidence; bare photo asks for issue and retains attachment',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({issue:'Water is leaking'})})});
    await h.send('Create Ticket');
    const bare=await h.send('',{mediaType:'image',mediaUrl:'https://example.com/photo.jpg'});
    assert.match(bare.reply.text,/issue/);
    await h.send('Water is leaking',{mediaType:'image',mediaUrl:'https://example.com/photo.jpg'});
    await h.send('Submit Ticket');
    assert.equal(h.calls[0][1].mediaUrl,'https://example.com/photo.jpg');
});

test('completed operation is recovered after worker crash without recreating resource',async()=>{
    const h=harness({findBooking:async()=>({id:'already-created'})});
    await h.send('Book Meeting Room');
    await h.send('conference room 1 today from 2.30pm to 3 pm');
    h.deps.availableRooms=async()=>[];
    await h.send('Confirm Booking');
    assert.equal(h.calls.length,0);assert.equal(h.state.active,null);
});

test('expired draft and changed account cannot be confirmed',async()=>{
    const h=harness();
    await h.send('Book Meeting Room');
    await h.send('conference room 1 today from 2.30pm to 3 pm');
    h.deps.now=()=>new Date('2026-10-05T07:00:00Z');
    await h.send('Confirm Booking');
    assert.equal(h.calls.length,0);
    h.deps.findUser=async()=>({id:'u2'});
    const switched=await h.send('Confirm Booking');
    assert.equal(switched.session,null);
});

test('relative date midnight and singleton room replacement require a new review',async()=>{
    const h=harness({now:()=>new Date('2026-10-05T18:25:00Z'),settings:async()=>({enabled:true,bookingEnabled:true,ticketEnabled:true,pilotUserIds:['u1'],defaultDate:'today'}),rooms:async()=>[{id:'r1',name:'Room A'}],interpret:async()=>({ok:true,intent:'details',fields:fields({start:'11.58pm',end:'11.59pm'})})});
    await h.send('Book Meeting Room');
    await h.send('book 11.58pm to 11.59pm');
    const revision=h.state.drafts.booking.revision;
    h.deps.now=()=>new Date('2026-10-05T18:31:00Z');
    const midnight=await h.send('Confirm Booking');
    assert.match(midnight.reply.text,/06 Oct 2026/);assert.equal(h.calls.length,0);
    assert.ok(h.state.drafts.booking.revision>revision);
    h.deps.rooms=async()=>[{id:'r2',name:'Room B'}];h.deps.availableRooms=async()=>[{id:'r2'}];
    const replaced=await h.send('Confirm Booking');
    assert.match(replaced.reply.text,/Room B/);assert.equal(h.calls.length,0);
});

test('failed photo-caption interpretation cannot change a reviewed ticket',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({issue:'Water is leaking'})})});
    await h.send('Create Ticket');await h.send('Water is leaking');
    const original=structuredClone(h.state.drafts.ticket);
    h.deps.interpret=async()=>({ok:false,reason:'provider_error'});
    await h.send('unknown caption',{mediaType:'image',mediaUrl:'https://example.com/new.jpg'});
    assert.equal(h.state.drafts.ticket.mediaUrl,undefined);
    assert.deepEqual(h.state.drafts.ticket.review,original.review);
    await h.send('Submit Ticket');assert.equal(h.calls[0][1].mediaUrl,null);
});

test('committed booking is recovered even if its time and draft expiry have passed',async()=>{
    const h=harness();await h.send('Book Meeting Room');await h.send('conference room 1 today from 2.30pm to 3 pm');
    h.deps.now=()=>new Date('2026-10-05T10:00:00Z');
    h.deps.findBooking=async()=>({id:'stored',property_id:'p1'});
    const result=await h.send('Confirm Booking');assert.equal(result.reply,null);assert.equal(h.calls.length,0);
});

test('blocked media fails before ticket creation and user can remove photo and submit normally',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({issue:'Water is leaking'})})});
    await h.send('Create Ticket');await h.send('Water is leaking',{mediaType:'image',mediaUrl:'https://example.com/photo'});
    h.deps.createTicket=async()=>{throw Object.assign(new Error('blocked photo'),{code:'INVALID_MEDIA'});};
    const blocked=await h.send('Submit Ticket');assert.match(blocked.reply.text,/No Photo/);assert.equal(h.calls.length,0);
    await h.send('No Photo');assert.equal(h.state.drafts.ticket.mediaUrl,undefined);
    h.deps.createTicket=async value=>{h.calls.push(['ticket',value]);return {id:'ticket-1'};};
    await h.send('Submit Ticket');assert.equal(h.calls.length,1);assert.equal(h.calls[0][1].mediaUrl,null);
});

test('duplicate room names use the displayed backend ID and do not change with list ordering',async()=>{
    const h=harness({rooms:async()=>[{id:'r1',name:'Conference Room'},{id:'r2',name:'Conference Room'}],availableRooms:async()=>[{id:'r2'}],interpret:async()=>({ok:true,intent:'details',fields:fields({date:'tomorrow',start:'3 pm',end:'4 pm'})})});
    await h.send('Book Meeting Room');await h.send('tomorrow 3 pm to 4 pm');
    h.deps.rooms=async()=>[{id:'r2',name:'Conference Room'},{id:'r1',name:'Conference Room'}];
    await h.send('2');await h.send('Confirm Booking');
    assert.equal(h.calls[0][1].roomId,'r2');
});

test('completed ticket recovery uses the same trimmed issue as original creation',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({issue:' Water is leaking '})})});
    await h.send('Create Ticket');await h.send('Water is leaking');
    h.deps.now=()=>new Date('2026-10-05T07:00:00Z');
    h.deps.findTicket=async(_id,_user,expected)=>{assert.equal(expected.title,'Water is leaking');return {id:'stored',property_id:'p1'};};
    const result=await h.send('Submit Ticket');assert.equal(result.reply,null);assert.equal(h.calls.length,0);
});
test('booking review is readable, omits non-tenant credits, and still requires the explicit confirmation',async()=>{
    const h=harness({creditSummary:async()=>null});
    await h.send('Book Meeting Room');
    const review=await h.send('conference room 1 today from 2.30pm to 3 pm');
    assert.match(review.reply.text,/📋.*Review booking/);
    assert.match(review.reply.text,/🏢 \*Property:\* SS Plaza/);
    assert.match(review.reply.text,/🕒 \*Time:\* 2:30 PM.*3:00 PM IST/);
    assert.doesNotMatch(review.reply.text,/credit|null|undefined/i);
    h.deps.interpret=async()=>({ok:true,intent:'unclear',fields:fields({})});
    const uncertain=await h.send('Book the room');
    assert.match(uncertain.reply.text,/Confirm Booking/);assert.equal(h.calls.length,0);
    await h.send('Confirm Booking');assert.equal(h.calls.length,1);
});
test('property and room prompts put each numbered choice on its own line and keep partial details',async()=>{
    const h=harness({properties:async()=>[{id:'p1',name:'SS Plaza',organization_id:'o1'},{id:'p2',name:'Other Office',organization_id:'o1'}],interpret:async()=>({ok:true,intent:'details',fields:fields({date:'today',start:'3 pm',end:'4 pm'})})});
    const property=await h.send('Book Meeting Room');assert.match(property.reply.text,/🏢.*Choose a property/);
    assert.match(property.reply.text,/\n1\. SS Plaza\n2\. Other Office/);
    await h.send('1');
    const room=await h.send('today 3 pm to 4 pm');assert.match(room.reply.text,/📝.*Booking details/);
    assert.match(room.reply.text,/\n1\. Conference Room 1\n2\. Conference Room 2/);
    assert.equal(h.state.drafts.booking.fields.start,'3 pm');assert.equal(h.calls.length,0);
});
test('complete direct booking needs no greeting or menu and books once with the real selected details',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({room:'Conference Room 1',date:'today',start:'2.30pm',end:'3 pm'})})});
    const result=await h.send('Book Conference Room 1 today from 2.30pm to 3 pm');
    assert.equal(result.reply,null);assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'book');
    assert.equal(h.calls[0][1].roomId,'r1');assert.equal(h.calls[0][1].startTime,'14:30');
    assert.equal(h.state.active,null);
});
test('direct request with missing property keeps details and books only after an allowed property choice',async()=>{
    const h=harness({properties:async()=>[{id:'p1',name:'SS Plaza',organization_id:'o1'},{id:'p2',name:'Other Office',organization_id:'o1'}]});
    const missing=await h.send('Please book conference room 1 today from 2.30pm to 3 pm');
    assert.match(missing.reply.text,/Choose a property/);assert.equal(h.calls.length,0);
    assert.equal(h.state.drafts.booking.fields.start,'2.30pm');
    const result=await h.send('1');assert.equal(result.reply,null);assert.equal(h.calls.length,1);
    assert.equal(h.calls[0][1].propertyId,'p1');
});
test('direct booking carries only a permitted legacy property choice across the template-to-AI switch',async()=>{
    const h=harness({properties:async()=>[{id:'p1',name:'SS Plaza',organization_id:'o1'},{id:'p2',name:'Other Office',organization_id:'o1'}]});
    const result=await advanceConversation({phone:'919000000000',messageId:'wamid',requestId:'new-request',text:'Book conference room 1 today from 2.30pm to 3 pm'},
        {step:'booking_request',id:'old-request',property:{id:'p1',name:'Untrusted old name'},date:'2099-01-01',startTime:'18:00'},h.deps);
    assert.equal(result.reply,null);assert.equal(h.calls.length,1);
    assert.equal(h.calls[0][1].requestId,'new-request');assert.equal(h.calls[0][1].propertyId,'p1');assert.equal(h.calls[0][1].date,'2026-10-05');
});
test('auto-book requires an explicit date, preserves task ambiguity, and cannot bypass availability or credits',async()=>{
    const h=harness({settings:async()=>({enabled:true,bookingEnabled:true,ticketEnabled:true,pilotUserIds:['u1'],defaultDate:'today'}),
        interpret:async()=>({ok:true,intent:'details',fields:fields({room:'conference room 1',start:'3 pm',end:'4 pm'})})});
    assert.match((await h.send('Book conference room 1 from 3 pm to 4 pm')).reply.text,/Date/);assert.equal(h.calls.length,0);
    h.deps.interpret=async()=>({ok:true,intent:'details',fields:fields({date:'today'})});
    h.deps.availableRooms=async()=>[];
    assert.match((await h.send('today')).reply.text,/unavailable/);assert.equal(h.calls.length,0);
    h.deps.availableRooms=async()=>[{id:'r1'}];
    h.deps.bookRange=async()=>{throw Object.assign(new Error('credits'),{code:'INSUFFICIENT_CREDITS'});};
    assert.match((await h.send('today')).reply.text,/credits/);assert.equal(h.calls.length,0);
});
test('negated, informational and task-related booking text cannot start an automatic booking',async()=>{
    for(const text of ['Do not book conference room 1 today from 2.30pm to 3 pm','Is conference room 1 booked today?','I completed the task to book conference room 1 today','Assign task: book conference room 1 today','Book conference room 1 and create a ticket']) {
        const h=harness({interpret:()=>assert.fail('must not interpret as direct booking')});
        await h.send(text);assert.equal(h.calls.length,0);assert.equal(h.state.active,null);
    }
});
test('replayed direct request recovers the committed booking before its own occupied slot blocks it',async()=>{
    const h=harness({findBooking:async()=>({id:'already-created',property_id:'p1'}),availableRooms:()=>assert.fail('completed operation is recovered before availability')});
    const result=await h.send('Book conference room 1 today from 2.30pm to 3 pm');assert.equal(result.reply,null);assert.equal(h.calls.length,0);
});
test('explicit booking instruction after menu selection also books immediately',async()=>{
    const h=harness();await h.send('Book Meeting Room');
    assert.equal((await h.send('Book conference room 1 today from 2.30pm to 3 pm')).reply,null);
    assert.equal(h.calls.length,1);
});
test('direct booking never accepts unknown or task quotes, ungrounded output or inaccessible legacy property',async()=>{
    for (const quote of [null,{workflow:'task'}]) {
        const h=harness({quote:async()=>quote,interpret:()=>assert.fail('quoted request cannot start booking')});
        assert.ok((await h.send('Book conference room 1 today from 2.30pm to 3 pm',{quotedIds:['old-message']})).reply);
        assert.equal(h.calls.length,0);
    }
    for (const interpretation of [{ok:false,reason:'rate_limited'},{ok:true,intent:'unclear',fields:fields({})},{ok:true,intent:'details',fields:fields({date:'tomorrow',room:'conference room 1',start:'2.30pm',end:'3 pm'})}]) {
        const h=harness({interpret:async()=>interpretation});
        assert.ok((await h.send('Book conference room 1 today from 2.30pm to 3 pm')).reply);
        assert.equal(h.calls.length,0);assert.notEqual(h.state.drafts.booking.autoBook,true);
    }
    const h=harness({properties:async()=>[{id:'p1',name:'SS Plaza',organization_id:'o1'},{id:'p2',name:'Other Office',organization_id:'o1'}]});
    const response=await advanceConversation({phone:'919000000000',requestId:'new',text:'Book conference room 1 today from 2.30pm to 3 pm'},
        {step:'booking_request',property:{id:'private',name:'Hidden property'}},h.deps);
    assert.match(response.reply.text,/Choose a property/);assert.doesNotMatch(response.reply.text,/Hidden property/);assert.equal(h.calls.length,0);
});
test('negation pauses automatic booking until the user explicitly authorizes it again',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({room:'conference room 1',start:'2.30pm',end:'3 pm'})})});
    await h.send('Book conference room 1 from 2.30pm to 3 pm');
    await h.send('Do not book the room');
    h.deps.interpret=async()=>({ok:true,intent:'details',fields:fields({date:'today'})});
    assert.match((await h.send('today')).reply.text,/Confirm Booking/);assert.equal(h.calls.length,0);
});
test('automatic booking keeps the requested calendar date when a missing-detail reply crosses midnight',async()=>{
    const h=harness({now:()=>new Date('2026-10-05T18:28:00Z'),
        interpret:async()=>({ok:true,intent:'details',fields:fields({room:'conference room 1',date:'today'})})});
    await h.send('Book conference room 1 today');
    h.deps.now=()=>new Date('2026-10-05T18:31:00Z');
    h.deps.interpret=async()=>({ok:true,intent:'details',fields:fields({start:'5 pm',end:'6 pm'})});
    assert.match((await h.send('5 pm to 6 pm')).reply.text,/future date/);assert.equal(h.calls.length,0);
});
test('automatic booking rejects competing dates or intervals even if a model picks one grounded subset',async()=>{
    for (const text of ['Book conference room 1 today and tomorrow from 3 pm to 4 pm',
        'Book conference room 1 today from 3 pm to 4 pm and from 5 pm to 6 pm']) {
        const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({room:'conference room 1',date:'today',start:'3 pm',end:'4 pm'})})});
        assert.ok((await h.send(text)).reply);assert.equal(h.calls.length,0);
    }
});
test('automatic booking cannot discard an explicit property that the model omitted',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({room:'conference room 1',date:'today',start:'3 pm',end:'4 pm'})})});
    assert.match((await h.send('Book conference room 1 in Private Building today from 3 pm to 4 pm')).reply.text,/Choose a property/);
    assert.equal(h.calls.length,0);assert.equal(h.state.drafts.booking.propertyId,undefined);
    assert.equal((await h.send('1')).reply,null);assert.equal(h.calls[0][1].propertyId,'p1');
});
test('automatic booking asks which room when a model selects a subset of competing room names',async()=>{
    const h=harness();
    assert.match((await h.send('Book conference room 1 and conference room 2 today from 2.30pm to 3 pm')).reply.text,/Available rooms/);
    assert.equal(h.calls.length,0);assert.equal((await h.send('1')).reply,null);assert.equal(h.calls[0][1].roomId,'r1');
});
test('room ambiguity is retained while an automatic request waits for property selection',async()=>{
    const h=harness({properties:async()=>[{id:'p1',name:'SS Plaza',organization_id:'o1'},{id:'p2',name:'Other Office',organization_id:'o1'}]});
    await h.send('Book conference room 1 and conference room 2 today from 2.30pm to 3 pm');
    assert.match((await h.send('1')).reply.text,/Available rooms/);assert.equal(h.calls.length,0);
    assert.equal((await h.send('1')).reply,null);assert.equal(h.calls.length,1);
});
test('an unknown room omitted by the model cannot become an automatic singleton room booking',async()=>{
    const h=harness({rooms:async()=>[{id:'r1',name:'Conference Room 1'}],
        interpret:async()=>({ok:true,intent:'details',fields:fields({date:'today',start:'3 pm',end:'4 pm'})})});
    assert.match((await h.send('Book room Unknown today from 3 pm to 4 pm')).reply.text,/Available rooms/);assert.equal(h.calls.length,0);
});
test('a known explicit property omitted by the model can resolve only to that permitted property',async()=>{
    const h=harness({properties:async()=>[{id:'p1',name:'SS Plaza',organization_id:'o1'},{id:'p2',name:'Other Office',organization_id:'o1'}]});
    assert.equal((await h.send('Book conference room 1 in SS Plaza today from 2.30pm to 3 pm')).reply,null);
    assert.equal(h.calls[0][1].propertyId,'p1');
});
test('conditional and empty-extraction replies cannot trigger a pending automatic booking',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({room:'conference room 1',start:'3 pm',end:'4 pm'})})});
    await h.send('Book conference room 1 from 3 pm to 4 pm');
    h.deps.interpret=async()=>({ok:true,intent:'details',fields:fields({date:'today'})});
    assert.ok((await h.send('today if finance approves')).reply);assert.equal(h.calls.length,0);
    h.deps.availableRooms=async()=>[];await h.send('today');assert.equal(h.calls.length,0);
    h.deps.availableRooms=async()=>[{id:'r1'}];h.deps.interpret=async()=>({ok:true,intent:'details',fields:fields({})});
    assert.ok((await h.send('how is everything going?')).reply);assert.equal(h.calls.length,0);
});
test('an explicit permitted property replaces a saved property even when extraction omits it',async()=>{
    const h=harness({properties:async()=>[{id:'p1',name:'SS Plaza',organization_id:'o1'},{id:'p2',name:'Other Office',organization_id:'o1'}],
        interpret:async()=>({ok:true,intent:'details',fields:fields({room:'conference room 1',date:'today',start:'3 pm',end:'4 pm'})})});
    await h.send('Book Meeting Room');await h.send('1');
    assert.equal((await h.send('Book conference room 1 for Other Office today from 3 pm to 4 pm')).reply,null);
    assert.equal(h.calls[0][1].propertyId,'p2');
});
test('a model-extracted shorter room name cannot override the explicit longer room target',async()=>{
    const h=harness({rooms:async()=>[{id:'r1',name:'Boardroom'},{id:'r2',name:'Boardroom East'}],availableRooms:async()=>[{id:'r1'},{id:'r2'}],
        interpret:async()=>({ok:true,intent:'details',fields:fields({room:'Boardroom',date:'today',start:'3 pm',end:'4 pm'})})});
    assert.match((await h.send('Book Boardroom East today from 3 pm to 4 pm')).reply.text,/Available rooms/);assert.equal(h.calls.length,0);
    assert.equal((await h.send('2')).reply,null);assert.equal(h.calls[0][1].roomId,'r2');
});
test('the screenshot wording books Boardroom and treats for today as a date rather than a property',async()=>{
    const h=harness({rooms:async()=>[{id:'r1',name:'Boardroom'}],
        interpret:async()=>({ok:true,intent:'details',fields:fields({room:'Boardroom',date:'today',start:'5 pm',end:'6 pm'})})});
    assert.equal((await h.send('Book boardroom for today from 5 pm to 6 pm')).reply,null);
    assert.equal(h.calls[0][1].propertyId,'p1');assert.equal(h.calls[0][1].startTime,'17:00');
});
test('an explicit team purpose is saved on a direct booking without becoming a property or another owner',async()=>{
    const h=harness({rooms:async()=>[{id:'r1',name:'Boardroom'}],
        properties:async()=>[{id:'p1',name:'SS Plaza',organization_id:'o1'},{id:'p2',name:'Tech Team',organization_id:'o1'}],
        interpret:async()=>({ok:true,intent:'details',fields:fields({property:'SS Plaza',room:'Boardroom',date:'tomorrow',start:'5 pm',end:'6 pm',purpose:'tech team'})})});
    assert.equal((await h.send('Book Boardroom in SS Plaza tomorrow from 5 pm to 6 pm for tech team')).reply,null);
    assert.equal(h.calls[0][1].purpose,'tech team');assert.equal(h.calls[0][1].propertyId,'p1');assert.equal(h.calls[0][1].userId,'u1');
});
test('optional purpose survives missing-detail replies and appears in a reviewed booking',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({room:'conference room 1',start:'3 pm',end:'4 pm',purpose:'tech team'})})});
    await h.send('Book Meeting Room');
    assert.match((await h.send('conference room 1 from 3 pm to 4 pm for tech team')).reply.text,/tech team/);
    assert.equal(h.calls.length,0);
    h.deps.interpret=async()=>({ok:true,intent:'details',fields:fields({date:'tomorrow'})});
    assert.match((await h.send('tomorrow')).reply.text,/Purpose.*tech team/);
    await h.send('Confirm Booking');assert.equal(h.calls[0][1].purpose,'tech team');
});
test('booking notes accept an arbitrary supplied description and remain absent when nothing was supplied',async()=>{
    for(const purpose of [null,'BD','client onboarding discussion']) {
        const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({room:'conference room 1',date:'tomorrow',start:'5 pm',end:'6 pm',purpose})})});
        const text=`Book conference room 1 tomorrow from 5 pm to 6 pm${purpose?' for '+purpose:''}`;
        assert.equal((await h.send(text)).reply,null);assert.equal(h.calls[0][1].purpose,purpose);
    }
});
test('task or ticket words inside an explicit meeting purpose remain notes and cannot mutate those services',async()=>{
    for(const purpose of ['task planning','ticket review']) {
        const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({room:'conference room 1',date:'tomorrow',start:'5 pm',end:'6 pm',purpose})})});
        assert.equal((await h.send('Book conference room 1 for tomorrow from 5 pm to 6 pm for '+purpose)).reply,null);
        assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'book');assert.equal(h.calls[0][1].purpose,purpose);
    }
    for (const tail of ['tech team and complete task 1','BD; create a ticket','BD. Complete task 1','create ticket']) {
        const mixed=harness({interpret:()=>assert.fail('mixed service request must not start automatic booking')});
        await mixed.send('Book conference room 1 tomorrow from 5 pm to 6 pm for '+tail);
        assert.equal(mixed.calls.length,0);
    }
    const early=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({room:'conference room 1',date:'tomorrow',start:'5 pm',end:'6 pm',purpose:'task planning'})})});
    assert.equal((await early.send('Book conference room 1 for task planning tomorrow from 5 pm to 6 pm')).reply,null);
    assert.equal(early.calls[0][1].purpose,'task planning');
});
test('a model mislabeled purpose cannot erase an explicit in-property target',async()=>{
    const h=harness({properties:async()=>[{id:'p1',name:'SS Plaza',organization_id:'o1'},{id:'p2',name:'Other Office',organization_id:'o1'}],
        interpret:async()=>({ok:true,intent:'details',fields:fields({room:'conference room 1',date:'tomorrow',start:'5 pm',end:'6 pm',purpose:'Other Office'})})});
    await h.send('Book Meeting Room');await h.send('1');
    await h.send('Book conference room 1 in Other Office tomorrow from 5 pm to 6 pm');
    assert.equal(h.calls.length,1);assert.equal(h.calls[0][1].propertyId,'p2');
    const unknown=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({room:'conference room 1',date:'tomorrow',start:'5 pm',end:'6 pm',purpose:'Private Building'})})});
    assert.match((await unknown.send('Book conference room 1 in Private Building tomorrow from 5 pm to 6 pm')).reply.text,/Choose a property/);
    assert.equal(unknown.calls.length,0);
});
