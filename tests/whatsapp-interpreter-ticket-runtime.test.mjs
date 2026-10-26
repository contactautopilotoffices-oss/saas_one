import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
const source=await readFile(new URL('../backend/lib/whatsapp/assistant/runtime.ts',import.meta.url),'utf8');
const request={phone:'919000000000',userId:'u1',propertyId:'p1',title:'Water is leaking',mediaUrl:'https://expired.aisensy.com/photo',messageId:'wamid',requestId:'operation-id',interpreter:true};
const hash=value=>createHash('sha256').update(JSON.stringify([value.userId,value.propertyId,value.title,value.mediaUrl || null])).digest('hex');
function harness(booking=null,photo={}) {
    let markerFailure=photo.markerFailure??true,calls=0;
    const rpcCalls=[],notifications=[],warnings=[],uploads=[];
    const row={id:'ticket-1',wa_assistant_input_hash:hash(request),wa_assistant_completed:false,photo_before_url:photo.download?null:'https://storage.example.com/stored.jpg'};
    const admin={rpc:async(name,params)=>{rpcCalls.push({name,params});return {data:{id:'new-booking',comment:params.p_purpose},error:null};},from(table){let updating=false;const query={select(){return query;},update(){updating=true;return query;},eq(){return query;},async maybeSingle(){return {data:table==='meeting_room_bookings'?booking:row,error:null};},then(resolve){
        if(updating&&markerFailure){markerFailure=false;return Promise.resolve(resolve({error:new Error('marker unavailable')}));}
        if(updating)row.wa_assistant_completed=true;return Promise.resolve(resolve({error:null}));
    }};return query;}};
    const imports={'node:crypto':{randomUUID,createHash},'@/backend/lib/supabase/admin':{supabaseAdmin:admin},
        '@/backend/lib/whatsapp/processMessage':{processIncomingMessage:async(...args)=>{calls++;assert.equal(args[9],'wamid');assert.equal(args[10].skipTaskRouting,true);assert.equal(args[10].interpreterInputHash,hash(request));uploads.push(args[10].mediaBuffer);return {id:row.id};}},
        '@/backend/services/AiSensyService':{},'@/backend/services/NotificationService':{NotificationService:{afterRoomBooked:async id=>notifications.push(id)}},'@/backend/utils/timezone':{},'./access':{},'./engine.mjs':{},'./worker.mjs':{},
        '../interpreter/coordinator.mjs':{},'../interpreter/interpret.mjs':{},'../interpreter/delivery.mjs':{},'../interpreter/context':{},'@/task-manager/TaskDatabaseService':{},
        '../interpreter/booking-credits.mjs':{},
        '../interpreter/media.mjs':{fetchPhoto:()=>{if(photo.error)throw photo.error;if(photo.download)return photo.buffer;assert.fail('stored attachment must not be downloaded from expired source');}},sharp:{default:photo.download?sharp:()=>assert.fail('no new image download')}};
    const exports={};const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(compiled+'\nexports.testDependencies = dependencies;',{exports,require:name=>{if(!(name in imports))throw new Error(name);return imports[name];},process:{env:{}},console:{...console,warn:(_label,info)=>warnings.push(info)},Date,Buffer,URL});
    return {create:exports.testDependencies.createTicket,dependencies:exports.testDependencies,row,rpcCalls,notifications,warnings,uploads,get calls(){return calls;}};
}
test('ticket retry resumes stored attachment after marker failure without downloading expired provider URL',async()=>{
    const h=harness();await assert.rejects(h.create(request),/marker unavailable/);
    assert.equal(h.row.wa_assistant_completed,false);
    assert.equal((await h.create(request)).id,'ticket-1');assert.equal(h.row.wa_assistant_completed,true);
    await h.create(request);assert.equal(h.calls,2);
});

test('completed ticket recovery matches the immutable reviewed input hash',async()=>{
    const h=harness();h.row.wa_assistant_completed=true;
    assert.equal((await h.dependencies.findTicket('operation-id','u1',request)).id,'ticket-1');
    assert.equal(await h.dependencies.findTicket('operation-id','u1',{...request,title:'New issue'}),null);
});
test('booking retry recognizes the original interval and cannot repurpose its request ID',async()=>{
    const h=harness({id:'booking-1',property_id:'p1',meeting_room_id:'r1',booking_date:'2026-10-06',start_time:'14:30:00',end_time:'15:00:00'});
    const booking={userId:'u1',propertyId:'p1',roomId:'r1',date:'2026-10-06',startTime:'14:30',endTime:'15:00',requestId:'operation-id',interpreter:true};
    assert.equal((await h.dependencies.bookRange(booking)).id,'booking-1');
    await assert.rejects(h.dependencies.bookRange({...booking,startTime:'15:00',endTime:'16:00'}),error=>error.code==='OPERATION_ALREADY_CREATED');
    assert.equal(h.calls,0);
});
test('booking notes are immutable for the same operation and empty notes remain empty',async()=>{
    const booking={userId:'u1',propertyId:'p1',roomId:'r1',date:'2026-10-06',startTime:'14:30',endTime:'15:00',requestId:'operation-id',interpreter:true,purpose:'BD'};
    const row={id:'booking-1',property_id:'p1',meeting_room_id:'r1',booking_date:'2026-10-06',start_time:'14:30:00',end_time:'15:00:00',comment:'BD'};
    const h=harness(row);assert.equal((await h.dependencies.bookRange(booking)).comment,'BD');
    for (const purpose of ['tech team',null]) await assert.rejects(h.dependencies.bookRange({...booking,purpose}),error=>error.code==='OPERATION_ALREADY_CREATED');
    assert.equal((await harness({...row,comment:null}).dependencies.bookRange({...booking,purpose:null})).comment,null);
});
test('the real booking adapter passes supplied notes or null to the atomic RPC before notifying',async()=>{
    for(const purpose of ['BD',null,undefined]) {
        const h=harness(),request={userId:'u1',propertyId:'p1',roomId:'r1',date:'2026-10-07',startTime:'17:00',endTime:'18:00',requestId:'operation-id',interpreter:true,purpose};
        const result=await h.dependencies.bookRange(request);
        assert.equal(result.comment,purpose||null);assert.equal(h.rpcCalls[0].name,'whatsapp_assistant_book_range');
        assert.equal(h.rpcCalls[0].params.p_purpose,purpose||null);assert.deepEqual(h.notifications,['new-booking']);
    }
    const legacy=harness();
    await legacy.dependencies.bookRange({userId:'u1',propertyId:'p1',roomId:'r1',date:'2026-10-07',startTime:'17:00',endTime:'18:00',requestId:'legacy-operation'});
    assert.equal(Object.hasOwn(legacy.rpcCalls[0].params,'p_purpose'),false);
});
test('committed request cannot be reused with a corrected property, issue or photo',async()=>{
    const h=harness();
    for(const change of [{propertyId:'p2'},{title:'New issue'},{mediaUrl:null},{mediaUrl:'https://other/photo'}]) {
        await assert.rejects(h.create({...request,...change}),error=>error.code==='OPERATION_ALREADY_CREATED');
    }
    assert.equal(h.calls,0);assert.equal(h.row.wa_assistant_completed,false);
});

test('real photo decoding creates a bounded JPEG attachment before ticket processing',async()=>{
    const buffer=await sharp({create:{width:1600,height:800,channels:3,background:'#eeeeee'}}).png().toBuffer();
    const h=harness(null,{download:true,buffer,markerFailure:false});await h.create(request);
    const decoded=await sharp(h.uploads[0]).metadata();
    assert.equal(decoded.format,'jpeg');assert.equal(decoded.width,1280);assert.equal(decoded.height,640);assert.equal(h.calls,1);
});

test('photo rejection reports download versus decode without exposing provider URL tokens',async()=>{
    for (const [photo,stage,reason] of [
        [{download:true,error:Object.assign(new Error('private URL?token=secret'),{code:'INVALID_MEDIA',mediaReason:'host_not_allowed'})},'download','host_not_allowed'],
        [{download:true,buffer:Buffer.from('not an image')},'decode','decode_failed']
    ]) {
        const h=harness(null,photo);
        await assert.rejects(h.create(request),error=>error.code==='INVALID_MEDIA'&&error.mediaReason===reason);
        assert.equal(h.calls,0);assert.equal(h.warnings[0].stage,stage);assert.equal(h.warnings[0].reason,reason);
        assert.equal(JSON.stringify(h.warnings).includes('secret'),false);assert.equal(JSON.stringify(h.warnings).includes('/photo'),false);
    }
});
