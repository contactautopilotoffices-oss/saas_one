import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
const {overviewAnalysis,periodDates}=loadTs('frontend/lib/pettyCash/overviewAnalysis.ts');
test('action pipeline sums only each current stage, separates rejection issues and ages open requests only',()=>{
 const row={status:'submitted',created_at:'2026-10-01T00:00:00Z',requested:0.1,allocated:0.2,approved:0.3,balance:0.05,unresolved_proofs:0};
 const analysis=overviewAnalysis([row,{...row,requested:0.2},{...row,status:'closed',unresolved_proofs:2},{...row,status:'paid',created_at:'2026-10-12T00:00:00Z'}],new Date('2026-10-12T12:00:00Z'));
 assert.equal(analysis.stages[0].count,2);assert.equal(analysis.stages[0].amount,0.3);assert.equal(analysis.open,3);assert.equal(analysis.sevenDays,2);assert.equal(analysis.oldest,11);assert.equal(analysis.toAccount,1);assert.equal(analysis.corrections,2);assert.equal(overviewAnalysis([]).oldest,null);
});
test('period filters use inclusive request creation dates and cross-month boundaries',()=>{
 assert.equal(periodDates('7days',new Date('2026-10-03T12:00:00Z')).from,'2026-09-27');assert.equal(periodDates('month',new Date('2026-10-12T12:00:00Z')).from,'2026-10-01');assert.equal(periodDates('all').from,'');
});

test('India month-boundary presets agree with the displayed local request date',async()=>{
 const {execFileSync}=await import('node:child_process');
 const script="import {loadTs} from './tests/petty-cash/load-ts.mjs';const {periodDates,calendarDate}=loadTs('frontend/lib/pettyCash/overviewAnalysis.ts');const now=new Date('2026-10-31T19:30:00Z');console.log(JSON.stringify({period:periodDates('month',now),date:calendarDate(now)}));";
 const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TZ:'Asia/Kolkata'},encoding:'utf8'}));assert.equal(result.period.from,'2026-11-01');assert.equal(result.period.to,'2026-11-01');assert.equal(result.date,'2026-11-01');
});

test('attention notes show actionable advances, preserve money precision and never flag absent optional bills',()=>{
 const {overviewAttention,matchesAttention}=loadTs('frontend/lib/pettyCash/overviewAnalysis.ts');const now=new Date('2026-10-12T12:00:00Z');const row={status:'paid',created_at:'2026-10-12T00:00:00Z',requested:150,allocated:150,approved:150,balance:50.1,unresolved_proofs:0,request_type:'advance'};
 const notes=overviewAttention([row,{...row,balance:0.2},{...row,request_type:'reimbursement',balance:100}],now);assert.equal(notes.length,1);assert.equal(notes[0].key,'cash');assert.equal(notes[0].count,2);assert.equal(notes[0].amount,50.3);assert.equal(matchesAttention(row,'corrections',now),false);
 assert.equal(overviewAttention([],now).length,0);assert.equal(matchesAttention({...row,status:'closed'},'cash',now),false);assert.equal(matchesAttention({...row,status:'sent_back'},'sent_back',now),true);
});
