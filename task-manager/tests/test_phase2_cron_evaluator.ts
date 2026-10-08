import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
import { NextRequest } from 'next/server';

async function run() {
    console.log('🧪 Testing Phase 2: Dynamic Heartbeat Cron Evaluator...\n');

    const { GET } = await import('../../app/api/cron/task-manager/route');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');

    const todayStr = new Date().toISOString().slice(0, 10);

    // ── Test 1: Paused state ──
    console.log('--- Test 1: Master Pause Switch ---');
    await TaskDatabaseService.saveTestingConfig({
        cronEnabled: false,
        cronTiming: '09:00',
        cronLastRunDate: null
    });

    const req1 = new NextRequest('http://localhost:3000/api/cron/task-manager?action=auto', {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET || 'dev'}` }
    });
    const res1 = await GET(req1);
    const json1 = await res1.json();

    if (json1.action !== 'paused') {
        throw new Error(`Expected action 'paused' but got '${json1.action}'`);
    }
    console.log('✓ 1. Correctly paused when cronEnabled is false.');

    // ── Test 2: Scheduled time in the future (Waiting) ──
    console.log('\n--- Test 2: Waiting for Scheduled Time ---');
    await TaskDatabaseService.saveTestingConfig({
        cronEnabled: true,
        cronTiming: '23:59', // Late night
        cronLastRunDate: null
    });

    const req2 = new NextRequest('http://localhost:3000/api/cron/task-manager?action=auto&dryRun=true', {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET || 'dev'}` }
    });
    const res2 = await GET(req2);
    const json2 = await res2.json();

    if (json2.action !== 'waiting') {
        throw new Error(`Expected action 'waiting' but got '${json2.action}'`);
    }
    console.log(`✓ 2. Correctly waiting for 23:59 IST. (Current IST: ${json2.currentIST})`);

    // ── Test 3: Scheduled time has arrived (Execution & Stamping) ──
    console.log('\n--- Test 3: Dispatched on Target Time ---');
    await TaskDatabaseService.saveTestingConfig({
        cronEnabled: true,
        cronTiming: '06:00', // Past morning time
        cronLastRunDate: null
    });

    const req3 = new NextRequest('http://localhost:3000/api/cron/task-manager?action=auto&dryRun=true', {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET || 'dev'}` }
    });
    const res3 = await GET(req3);
    const json3 = await res3.json();

    if (json3.action !== 'dispatched') {
        throw new Error(`Expected action 'dispatched' but got '${json3.action}'`);
    }
    console.log('✓ 3. Successfully triggered execution on scheduled time.');
    console.log(`   Summary: ${json3.summary}`);

    // Verify DB stamp
    const stampedConfig = await TaskDatabaseService.getTestingConfig();
    if (!stampedConfig.cronLastRunDate) {
        throw new Error('cronLastRunDate was not stamped in database after dispatch!');
    }
    console.log(`✓ 4. Stamped cronLastRunDate in database: ${stampedConfig.cronLastRunDate}`);

    // ── Test 4: Deduplication (Already executed today) ──
    console.log('\n--- Test 4: Daily Deduplication ---');
    const req4 = new NextRequest('http://localhost:3000/api/cron/task-manager?action=auto&dryRun=true', {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET || 'dev'}` }
    });
    const res4 = await GET(req4);
    const json4 = await res4.json();

    if (json4.action !== 'already_executed_today') {
        throw new Error(`Expected action 'already_executed_today' but got '${json4.action}'`);
    }
    console.log('✓ 5. Deduplication verified: Repeated cron ping safely skipped (0 duplicates).');

    // ── Test 5: Clean Reset ──
    await TaskDatabaseService.saveTestingConfig({
        cronEnabled: true,
        cronTiming: '09:00',
        cronLastRunDate: null,
        cronLastRunSummary: null
    });
    console.log('\n✓ 6. Reset config back to clean default state (09:00 AM, enabled).');

    console.log('\n🎉 Phase 2 Verification Passed 100% Successfully!\n');
}

run().catch(err => {
    console.error('❌ Phase 2 test failed:', err);
    process.exit(1);
});
