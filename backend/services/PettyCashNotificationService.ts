import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { pcEventDefinition,pcNotificationPayload } from '@/backend/lib/pettyCash/notificationEvents';
import { effectivePcRule,type PcChannel } from '@/backend/lib/pettyCash/notificationRules';
import { pcNotificationVariables,renderPcNotification } from '@/backend/lib/pettyCash/notificationRendering';
import { EmailService } from './EmailService';
import { NotificationService } from './NotificationService';
import { AiSensyService } from './AiSensyService';
type PcOutboxEvent={id:string;entity_id:string;event_type:string;payload:unknown};
type Recipient={id:string;full_name:string|null;email:string|null;phone:string|null};
type Delivery={id:string;event_id:string;organization_id:string;request_id:string;recipient_id:string;channel:PcChannel;destination:string;attempt_count:number;lease_token:string};
const normalizeDestination=(user:Recipient,channel:PcChannel)=>{
    if(channel==='push')return user.id;
    if(channel==='email'){const email=user.email?.trim().toLowerCase()||'';return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;}
    let phone=user.phone?.replace(/\D/g,'')||'';if(phone.length===10)phone='91'+phone;return /^\d{11,15}$/.test(phone)?phone:null;
};
const checked=<T>(result:{data:T;error:any}):T=>{if(result.error)throw new Error(result.error.message||'Petty Cash notification storage failed');return result.data;};
async function context(event:PcOutboxEvent,channel:PcChannel){
    const definition=pcEventDefinition(event.event_type);if(!definition)return null;
    const p=pcNotificationPayload.parse(event.payload);if(p.activity_id!==event.entity_id)throw new Error('Petty Cash activity identity mismatch');
    const [settingsResult,requestResult,systemResult]=await Promise.all([
        supabaseAdmin.from('organization_settings').select('*').eq('organization_id',p.organization_id).maybeSingle(),
        supabaseAdmin.from('petty_cash_requests').select('*').eq('id',p.request_id).eq('organization_id',p.organization_id).maybeSingle(),
        supabaseAdmin.from('system_config').select('key,value').in('key',[`${channel}_notifications_enabled`,`${channel}_petty_cash_enabled`]),
    ]);
    const settings=checked(settingsResult);const request=checked(requestResult);const system=checked(systemResult);
    if(system?.some(row=>row.value===false))return null;
    if(!request||request.property_id!==p.property_id||request.requester_id!==p.requester_id||request.workflow_version!==2||request.request_type!=='advance')return null;
    const rule=effectivePcRule(settings,p.property_id,definition.key,channel);if(!rule)return null;
    if(definition.templateName==='pc_action_required_v1'&&request.version!==p.request_version)return null;
    if(definition.audience==='allocator'&&request.assigned_allocator_id!==p.assigned_allocator_id)return null;
    if(definition.audience==='approver'&&request.assigned_approver_id!==p.assigned_approver_id)return null;
    if(p.expense_id){const expense=checked(await supabaseAdmin.from('petty_cash_expenses').select('review_status').eq('id',p.expense_id).eq('request_id',p.request_id).maybeSingle());if(!expense||expense.review_status!==p.review_status)return null;}
    const recipients=checked(await supabaseAdmin.rpc('pc_notification_recipients',{rid:p.request_id,feature:definition.key,rule})) as Recipient[];
    const mapping=settings?.whatsapp_templates?.[definition.key];
    if(channel==='whatsapp'&&(!mapping?.confirmed_live||!mapping?.campaign_name))return null;
    return {definition,p,settings,mapping,recipients:recipients.filter(user=>normalizeDestination(user,channel))};
}
export const PettyCashNotificationService={
    async enqueue(event:PcOutboxEvent,channel:PcChannel){
        const current=await context(event,channel);if(!current)return;
        const unique=new Map(current.recipients.map(user=>[normalizeDestination(user,channel)!,user]));
        const rows=[...unique].map(([destination,user])=>({event_id:event.id,organization_id:current.p.organization_id,request_id:current.p.request_id,recipient_id:user.id,channel,destination}));
        if(rows.length)checked(await supabaseAdmin.from('petty_cash_notification_deliveries').upsert(rows,{onConflict:'event_id,channel,destination',ignoreDuplicates:true}));
    },
    async dispatch(event:PcOutboxEvent,channel:PcChannel){await this.enqueue(event,channel);return this.processDue(event.id,channel);},
    async processDue(eventId?:string,channel?:PcChannel){
        const rows=checked(await supabaseAdmin.rpc('pc_claim_notification_deliveries',{batch_limit:20,target_event:eventId||null,target_channel:channel||null})) as Delivery[];
        const outcomes:{id:string;status:string}[]=[];
        for(const row of rows){
            let providerStarted=false;
            const finish=async(status:string,error:string|null=null,reference?:string)=>{checked(await supabaseAdmin.from('petty_cash_notification_deliveries').update({status,last_error:error,provider_reference:reference||null,lease_until:null,lease_token:null,updated_at:new Date().toISOString(),next_attempt_at:new Date(Date.now()+Math.min(60*60_000,60_000*2**row.attempt_count)).toISOString()}).eq('id',row.id).eq('lease_token',row.lease_token));outcomes.push({id:row.id,status});};
            try {
                const event=checked(await supabaseAdmin.from('event_outbox').select('*').eq('id',row.event_id).maybeSingle()) as PcOutboxEvent|null;
                if(!event){await finish('skipped','Event no longer available');continue;}
                const current=await context(event,row.channel);
                const user=current?.recipients.find(user=>user.id===row.recipient_id&&normalizeDestination(user,row.channel)===row.destination);
                if(!current||!user){await finish('skipped','Disabled rule, missing campaign, stale task or recipient no longer eligible');continue;}
                const [propertyResult,requesterResult]=await Promise.all([supabaseAdmin.from('properties').select('name').eq('id',current.p.property_id).eq('organization_id',current.p.organization_id).maybeSingle(),supabaseAdmin.from('users').select('full_name').eq('id',current.p.requester_id).maybeSingle()]);
                const property=checked(propertyResult);const requester=checked(requesterResult);if(!property||!requester){await finish('skipped','Request identity unavailable');continue;}
                const vars=pcNotificationVariables(current.definition,current.p,user.full_name||'User',property.name,requester.full_name||'Requester',current.settings?.timezone||'UTC');
                const rendered=renderPcNotification(current.definition,vars,current.mapping,row.channel==='email'?current.settings?.email_templates?.[current.definition.key]:undefined);
                if(row.channel==='whatsapp'&&!rendered.campaign){await finish('skipped','Campaign parameter signature does not match approved template');continue;}
                const claim=checked(await supabaseAdmin.from('petty_cash_notification_deliveries').update({status:'sending',updated_at:new Date().toISOString()}).eq('id',row.id).eq('status','processing').eq('lease_token',row.lease_token).select('id').maybeSingle());if(!claim)continue;
                providerStarted=true;
                const result=row.channel==='push'?await NotificationService.sendOutboxPush({deliveryId:row.id,userId:user.id,organizationId:current.p.organization_id,propertyId:current.p.property_id,type:event.event_type,title:current.definition.name,message:`${current.p.request_no} · ${property.name}: ${current.definition.nextAction}`,deepLink:vars.request_url}):row.channel==='email'?await EmailService.sendTransactionalEmail({to:row.destination,subject:rendered.subject,html:rendered.html,text:rendered.text,idempotencyKey:row.id}):await AiSensyService.sendTemplate({phone:row.destination,campaignName:rendered.campaign!,templateParams:rendered.params,userName:user.full_name||'User'});
                await finish(result.success?'sent':result.ambiguous?'ambiguous':'failed',result.error||null,result.providerReference);
            }catch(reason){await finish(providerStarted?'ambiguous':'failed',reason instanceof Error?reason.message:'Notification processing failed');}
        }
        return outcomes;
    }
};
