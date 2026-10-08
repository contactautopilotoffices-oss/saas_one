import { PC_NOTIFICATION_TEMPLATES, type PcNotificationEvent } from '@/frontend/lib/notifications/pettyCashTemplates';
import type { PcEventPayload } from './notificationEvents';
export function requestNotificationUrl(organizationId: string, requestId: string, configuredOrigin=process.env.PETTY_CASH_APP_URL||process.env.NEXT_PUBLIC_SITE_URL||'https://fms-dev-saas-one.vercel.app') {
    const origin=new URL(configuredOrigin);if(origin.protocol!=='https:'||origin.username||origin.password)throw new Error('Petty Cash application URL must use HTTPS');
    return `${origin.origin}/${encodeURIComponent(organizationId)}/petty-cash?request_id=${encodeURIComponent(requestId)}`;
}
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function pcNotificationVariables(event:PcNotificationEvent,p:PcEventPayload,name:string,propertyName:string,requesterName:string,timezone='UTC'):Record<string,string>{
    try {new Intl.DateTimeFormat('en-GB',{timeZone:timezone});}catch{timezone='UTC';}
    const money=(value:string|null)=>value===null?'Not recorded':`INR ${Number(value).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    const date=(value:string|null)=>value?new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'}):'Not recorded';
    return {user_name:name||'User',request_no:p.request_no,property_name:propertyName,requester_name:requesterName,status_label:event.name.replace(/^Request /,''),event_date:new Date(p.occurred_at).toLocaleString('en-GB',{timeZone:timezone})+` (${timezone})`,event_amount:money(p.amounts[event.amountSource as keyof typeof p.amounts]),next_action:event.nextAction,paid_amount:money(p.amounts.paid),payment_date:date(p.payment_date),request_remaining:money(p.amounts.remaining),expense_amount:money(p.amounts.expense),expense_date:date(p.expense_date),review_status:p.review_status==='accepted'?'Accepted':p.review_status==='rejected'?'Rejected':'Pending',returned_amount:money(p.amounts.return_delta),spent_amount:money(p.amounts.spent),total_returned:money(p.amounts.returned),request_url:requestNotificationUrl(p.organization_id,p.request_id)};
}
export function renderPcNotification(event:PcNotificationEvent,variables:Record<string,string>,mapping:any,customEmail?:{html?:string;subject?:string}){
    const template=PC_NOTIFICATION_TEMPLATES.find(template=>template.name===event.templateName)!;
    const validMapping=mapping?.confirmed_live===true && typeof mapping.campaign_name==='string' && mapping.campaign_name.trim() && Array.isArray(mapping.params) && JSON.stringify(mapping.params)===JSON.stringify(template.params);
    const text=template.body.replace(/{{(\d+)}}/g,(_,n)=>variables[template.params[Number(n)-1]]);
    const defaultHtml=`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:24px"><h2>${escape(event.name)}</h2><p>${escape(variables.event_date)}</p><p>${escape(text).replace(/\n/g,'<br>')}</p><p><a href="${escape(variables.request_url)}">View petty cash request</a></p></div>`;
    const render=(source:string)=>source.replace(/{{\s*([a-z_]+)\s*}}/g,(_,key)=>{if(!(key in variables))throw new Error(`Unknown email variable: ${key}`);return escape(variables[key]);});
    const html=customEmail?.html?render(customEmail.html):defaultHtml;
    if(/{{|}}/.test(html))throw new Error('Unresolved email template variable');
    const subject=customEmail?.subject?customEmail.subject.replace(/{{\s*([a-z_]+)\s*}}/g,(_,key)=>{if(!(key in variables))throw new Error(`Unknown subject variable: ${key}`);return variables[key];}):`${event.name}: ${variables.request_no}`;
    if(/[\r\n]|{{|}}/.test(subject))throw new Error('Invalid email subject');
    return {text,html,subject,campaign:validMapping?mapping.campaign_name.trim():null,params:template.params.map(param=>variables[param])};
}
