export interface AnalysisRow {status:string;created_at:string;requested:number;allocated:number;approved:number;balance:number;unresolved_proofs:number}
export function overviewAnalysis(rows:AnalysisRow[],now=new Date()) {
 const pending=rows.filter(row=>['submitted','pending_approval','sent_back','approved','paid','settlement_submitted'].includes(row.status));
 const ages=pending.map(row=>Math.max(0,Math.floor((now.getTime()-new Date(row.created_at).getTime())/86400000))).filter(Number.isFinite);
 const stages=[{status:'submitted',label:'To allocate',amount:'requested'},{status:'pending_approval',label:'To approve',amount:'allocated'},{status:'approved',label:'To pay',amount:'approved'},{status:'settlement_submitted',label:'Settlement review',amount:'balance'}] as const;
 return {stages:stages.map(stage=>({...stage,count:rows.filter(row=>row.status===stage.status).length,amount:rows.filter(row=>row.status===stage.status).reduce((sum,row)=>sum+Math.round(Number(row[stage.amount]||0)*100),0)/100})),open:pending.length,sevenDays:ages.filter(age=>age>=7).length,oldest:ages.length?Math.max(...ages):null,corrections:rows.reduce((sum,row)=>sum+Number(row.unresolved_proofs||0),0),toAccount:rows.filter(row=>row.status==='paid').length};
}
export function calendarDate(value:Date){return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;}
export function periodDates(period:string,now=new Date()) {
 const end=calendarDate(now);const start=new Date(now);
 if(period==='7days')start.setDate(start.getDate()-6);
 else if(period==='30days')start.setDate(start.getDate()-29);
 else if(period==='month'){start.setDate(1);return {from:calendarDate(start),to:end};}
 else if(period==='last_month'){
  const first=new Date(now.getFullYear(),now.getMonth()-1,1);
  const last=new Date(now.getFullYear(),now.getMonth(),0);
  return {from:calendarDate(first),to:calendarDate(last)};
 }
 else return {from:'',to:''};
 return {from:calendarDate(start),to:end};
}

export type AttentionKey='cash'|'corrections'|'sent_back'|'aged'|'settlements'|'payments'|'routing';
export function matchesAttention(row:AnalysisRow & {request_type?:string},key:AttentionKey|null,now=new Date()) {
 if(!key)return true;
 if(row.request_type==='reimbursement')return false;
 switch(key){
  case 'cash':return ['paid','settlement_submitted'].includes(row.status)&&Number(row.balance)>0;
  case 'corrections':return ['paid','settlement_submitted'].includes(row.status)&&Number(row.unresolved_proofs)>0;
  case 'sent_back':return row.status==='sent_back';
  case 'aged':return ['submitted','pending_approval','sent_back','approved','paid','settlement_submitted'].includes(row.status)&&(now.getTime()-new Date(row.created_at).getTime())/86400000>=7;
  case 'settlements':return row.status==='settlement_submitted';
  case 'payments':return row.status==='approved';
  case 'routing':return ['submitted','pending_approval'].includes(row.status);
 }
}
export function overviewAttention(rows:(AnalysisRow & {request_type?:string})[],now=new Date()){
 const definitions:{key:AttentionKey;text:string}[]=[{key:'cash',text:'Requests have cash remaining to spend or return.'},{key:'corrections',text:'Requests contain rejected expenses requiring correction.'},{key:'sent_back',text:'Requests were sent back and need updating.'},{key:'aged',text:'Open requests were created 7+ days ago. Check their next action.'},{key:'settlements',text:'Settlements are awaiting Accounts review and closure.'},{key:'payments',text:'Approved requests are awaiting payment.'},{key:'routing',text:'Requests are awaiting allocation or approval.'}];
 return definitions.map(item=>{const matching=rows.filter(row=>matchesAttention(row,item.key,now));return {...item,count:matching.length,amount:item.key==='cash'?matching.reduce((sum,row)=>sum+Math.round(Number(row.balance)*100),0)/100:null};}).filter(item=>item.count>0);
}
