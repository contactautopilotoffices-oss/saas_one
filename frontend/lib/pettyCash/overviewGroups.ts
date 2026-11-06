export interface OverviewGroupRow {requester_id:string;requester_name:string;property_id:string;property_name:string;status:string;paid:number;spent:number;balance:number;unresolved_proofs:number}
export function overviewGroups(rows:OverviewGroupRow[],dimension:'property'|'requester'){
 const groups=new Map<string,{id:string;name:string;requests:number;pending:number;paid:number;spent:number;balance:number;proofs:number}>();
 for(const row of rows){const id=dimension==='property'?row.property_id:row.requester_id;const group=groups.get(id)||{id,name:dimension==='property'?row.property_name||'Unnamed property':row.requester_name||'Unnamed user',requests:0,pending:0,paid:0,spent:0,balance:0,proofs:0};group.requests++;if(['draft','submitted','pending_approval','sent_back','approved','paid','settlement_submitted'].includes(row.status))group.pending++;for(const key of ['paid','spent','balance'] as const)group[key]+=Math.round(Number(row[key]||0)*100);group.proofs+=Number(row.unresolved_proofs||0);groups.set(id,group);}
 return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(group=>({...group,paid:group.paid/100,spent:group.spent/100,balance:group.balance/100}));
}
