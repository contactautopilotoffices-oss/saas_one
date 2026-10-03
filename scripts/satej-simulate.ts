/**
 * Satej end to end with canned Engy / Exa / Bolna / WhatsApp. No keys, no
 * database, no calls, no messages — an in-memory store stands in for Supabase.
 *
 *   npx tsx scripts/satej-simulate.ts
 *
 * Walks one requirement through every stage and asserts what the team would
 * see: a blocking question, de-duplicated vendors, the approval gate, the exact
 * CSV Bolna receives, call results arriving by webhook, the ranking, the
 * WhatsApp templates, and the do-not-recall rule on a second round.
 */

process.env.SATEJ_MOCK_MODE = 'true';
process.env.SATEJ_BOLNA_AGENT_ID = 'mock-meera';
process.env.SATEJ_CALL_WINDOW_START = '00:00';
process.env.SATEJ_CALL_WINDOW_END = '23:59';
process.env.SATEJ_CALL_DAYS = '0,1,2,3,4,5,6';
delete process.env.SATEJ_AUTO_START_CALLS; // the default: a person approves the call list
// supabaseAdmin is built at import time and needs a URL. Nothing here reaches it —
// the in-memory store replaces the database — so an unroutable address is enough.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'simulation-has-no-database';

import assert from 'node:assert/strict';

const ORG = '00000000-0000-4000-8000-000000000001';
const TEAM = '+919000000001';

async function main() {
    // Loaded here, not at the top: static imports are hoisted above the env lines,
    // and supabaseAdmin reads its env the moment its module loads.
    const { MemoryRepo, setRepo } = await import('../backend/lib/satej/repo');
    const { addVendors, advance, answerClarification, approveCalls, buildCallCsv, createRequirement, editRequirement, ingestExecution, runAgain, spokenName } =
        await import('../backend/lib/satej/pipeline');
    const { mockBolna, mockWhatsapp } = await import('../backend/lib/satej/clients/mocks');
    const { CALL_VARIABLES } = await import('../backend/lib/satej/prompts/voiceAgent');
    const { fullSummary } = await import('../backend/lib/satej/summary');

    const repo = new MemoryRepo();
    setRepo(repo);

    console.log('\n1) The purchase team raises a requirement (quantity left blank on purpose)');
    const r0 = await createRequirement(
        ORG,
        {
            title: 'Gypsum false ceiling, Lower Parel office',
            spendType: 'capex',
            itemDescription: 'Gypsum false ceiling with GI framing for a new office floor',
            quantity: '',
            unit: 'sqft',
            scope: 'Supply and installation',
            locationCity: 'Mumbai',
            locationArea: 'Lower Parel',
            timeline: 'within 15 days',
            requestedBy: 'Satej',
            notifyWhatsapp: '9000000001',
        },
        'https://fms.example',
    );
    assert.equal(r0.input.notifyWhatsapp, TEAM, 'WhatsApp number is normalised to +91');
    let r = (await advance(r0.id))!;
    console.log('   status:', r.status, '| questions:', r.brief?.questions);
    assert.equal(r.status, 'needs_clarification');
    assert.equal(mockWhatsapp.sent.at(-1)?.template, 'satej_input_needed_v1');

    console.log('\n2) The team answers; Satej structures, searches and stops for approval');
    await answerClarification(r, ['About 1200 sqft']);
    r = (await advance(r.id))!;
    const found = await repo.listVendors(r.id);
    console.log('   status:', r.status);
    console.log('   vendors:', found.map((v) => `${v.name} ${v.phone} [${v.status}]`).join('\n            '));
    assert.equal(r.status, 'awaiting_call_approval');
    assert.ok(found.every((v) => v.phone.startsWith('+91')));
    assert.ok(!found.some((v) => v.name === 'Random Plumbing Co'), 'the irrelevant vendor is filtered out');
    assert.equal(new Set(found.map((v) => v.phone)).size, found.length, 'vendors are de-duplicated');
    assert.equal(mockWhatsapp.sent.at(-1)?.template, 'satej_input_needed_v1', 'the team is asked to approve on WhatsApp');

    console.log('\n3) A person approves; the Bolna batch is created and scheduled');
    await approveCalls(r, 'Satej');
    r = (await repo.getRequirement(r.id))!;
    assert.equal(r.status, 'calling');
    assert.ok(r.bolnaBatchId);

    const csv = buildCallCsv(r, (await repo.listVendors(r.id)).filter((v) => v.status !== 'excluded'));
    const [header, firstRow] = csv.split('\n');
    console.log('   CSV Bolna receives:\n     ' + header + '\n     ' + firstRow + '\n     …');
    assert.equal(header, CALL_VARIABLES.join(','), 'CSV columns are exactly the variables Meera uses');
    assert.ok(!csv.includes(' LLP,'), 'legal suffixes are not read out on calls');

    console.log('\n4) Bolna posts each call to the webhook (plus one call from another agent)');
    const ignored = await ingestExecution({ id: 'someone-elses-call', agent_id: 'ira', status: 'completed', batch_id: r.bolnaBatchId });
    assert.equal(ignored, null, "another agent's call is ignored");
    for (const ex of mockBolna.listExecutions(r.bolnaBatchId!)) {
        const owner = await ingestExecution({ ...ex, agent_id: 'mock-meera' });
        assert.equal(owner?.id, r.id);
    }
    r = (await advance(r.id))!;
    console.log('   status:', r.status);
    assert.equal(r.status, 'notified');
    for (const v of r.ranking!) console.log(`     #${v.rank} ${v.vendorName.padEnd(28)} ${String(v.score.total).padStart(3)}/100  ${v.score.qualification}`);
    assert.equal(r.ranking![0].score.qualification, 'qualified');
    assert.equal(r.ranking!.at(-1)!.score.qualification, 'not_reached');

    const summary = mockWhatsapp.sent.at(-1)!;
    console.log('\n5) WhatsApp summary template:', summary.template);
    console.log('   params:', summary.params.join(' | '));
    assert.equal(summary.template, 'satej_vendor_summary_v1');
    assert.equal(summary.params.length, 8);
    assert.ok(summary.params.every((p) => !/[\n\t]/.test(p)), 'template params carry no new lines');
    assert.equal(summary.params[7], `${ORG}/satej?req=${r.code}`, 'the button opens this requirement');

    console.log('\n----- Summary on the Satej page (copy button) -----\n');
    console.log(fullSummary(r));
    console.log('\n---------------------------------------------------');

    console.log('\n6) "Find more vendors": everyone found was just called, so nobody is re-dialled');
    await runAgain(r);
    r = (await advance(r.id))!;
    const all = await repo.listVendors(r.id);
    console.log('   status:', r.status, '| vendors on the requirement:', all.length, '| newly queued to call:', all.filter((v) => v.status === 'found').length);
    assert.equal(r.status, 'failed', 'nobody new to call');
    assert.equal(all.filter((v) => v.status === 'found').length, 0, 'no vendor already called is put back on the list');

    console.log('\n7) "Use my list": no web search, the team adds vendors (messy input on purpose)');
    const own = await createRequirement(ORG, {
        title: 'Pantry supplies, Indore', spendType: 'opex', itemDescription: 'Monthly pantry supplies', quantity: '1', unit: 'month',
        scope: 'Supply only', locationCity: 'Indore', locationArea: 'Vijay Nagar', requestedBy: 'Satej', notifyWhatsapp: '9000000001', vendorSource: 'own',
    }, 'https://fms.example');
    let o = (await advance(own.id))!;
    console.log('   status:', o.status);
    assert.equal(o.status, 'awaiting_call_approval', 'own list skips discovery');
    assert.equal((await repo.listVendors(o.id)).length, 0, 'nothing was searched');
    const res = await addVendors(o, [
        { name: 'Annapurna Traders', phone: '098262 11111' },
        { name: 'Annapurna again', phone: '+91 98262 11111' },
        { name: 'Bad number', phone: '12345' },
        { name: 'Malwa Supplies', phone: '919826322222', area: 'Palasia' },
    ], 'Satej');
    console.log('   added:', res.added, '| skipped:', res.skipped.map((x) => x.reason).join('; '));
    assert.equal(res.added, 2);
    assert.equal(res.skipped.length, 2);
    await editRequirement(o, { timeline: 'by Monday' }, 'Satej');
    o = (await advance(o.id))!;
    assert.equal(o.status, 'awaiting_call_approval');
    assert.equal((await repo.listVendors(o.id)).filter((v) => v.status === 'found').length, 2, 'an edit keeps the team\'s own vendors');
    await approveCalls(o, 'Satej');
    o = (await repo.getRequirement(o.id))!;
    const ownCsv = buildCallCsv(o, (await repo.listVendors(o.id)).filter((v) => v.status !== 'excluded'));
    assert.ok(ownCsv.includes('+919826211111') && ownCsv.includes('+919826322222'), 'only the team\'s vendors are called');
    console.log('   calls scheduled for the team\'s 2 vendors only');

    console.log('\n8) Spoken names');
    for (const [raw, want] of [
        ['Shree Ganesh Interiors Pvt. Ltd.', 'Shree Ganesh Interiors'],
        ['Prime Drywall Systems LLP', 'Prime Drywall Systems'],
        ['Sharma (P) Ltd', 'Sharma'],
        ['Metro Company', 'Metro Company'],
    ]) {
        assert.equal(spokenName(raw), want);
        console.log(`   ${raw} → ${spokenName(raw)}`);
    }

    console.log('\nAll checks passed.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
