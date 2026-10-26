import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
import { NextRequest } from 'next/server';

async function run() {
    console.log('🧪 Testing Phase 3: Manual On-Demand Trigger API...\n');

    const { POST, GET } = await import('../../app/api/task-manager/testing-config/route');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');

    // ── Test 1: Trigger Task Generation ──
    console.log('--- Test 1: Action trigger_generate ---');
    const req1 = new NextRequest('http://localhost:3000/api/task-manager/testing-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger_generate' })
    });
    const res1 = await POST(req1);
    const json1 = await res1.json();

    if (!json1.success || !json1.result) {
        throw new Error(`trigger_generate failed: ${JSON.stringify(json1)}`);
    }
    console.log('✓ 1. Manual task generation successful:', json1.message);

    // ── Test 2: Trigger Notification Dispatch (Dry-Run) ──
    console.log('\n--- Test 2: Action trigger_dispatch (Dry Run) ---');
    const req2 = new NextRequest('http://localhost:3000/api/task-manager/testing-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger_dispatch', dryRun: true })
    });
    const res2 = await POST(req2);
    const json2 = await res2.json();

    if (!json2.success || !json2.dryRun) {
        throw new Error(`trigger_dispatch failed: ${JSON.stringify(json2)}`);
    }
    console.log('✓ 2. Manual notification dispatch (dry-run simulation) successful:', json2.message);

    // ── Test 3: Save Schedule from UI ──
    console.log('\n--- Test 3: Update Schedule Settings ---');
    const req3 = new NextRequest('http://localhost:3000/api/task-manager/testing-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cronTiming: '11:15', cronEnabled: true })
    });
    const res3 = await POST(req3);
    const json3 = await res3.json();

    if (!json3.success || json3.config.cronTiming !== '11:15' || json3.config.cronEnabled !== true) {
        throw new Error(`Saving schedule failed: ${JSON.stringify(json3)}`);
    }
    console.log('✓ 3. Schedule successfully updated to 11:15 AM IST (Enabled).');

    // Verify GET returns updated schedule
    const getRes = await GET();
    const getJson = await getRes.json();
    if (getJson.config.cronTiming !== '11:15' || getJson.config.cronEnabled !== true) {
        throw new Error(`GET config did not reflect updated schedule: ${JSON.stringify(getJson)}`);
    }
    console.log('✓ 4. GET /api/task-manager/testing-config verified updated settings.');

    // ── Reset ──
    await TaskDatabaseService.saveTestingConfig({
        cronTiming: '09:00',
        cronEnabled: true,
        cronLastRunDate: null,
        cronLastRunSummary: null
    });
    console.log('\n✓ 5. Reset schedule back to clean default state (09:00 AM, enabled).');

    console.log('\n🎉 Phase 3 Verification Passed 100% Successfully!\n');
}

run().catch(err => {
    console.error('❌ Phase 3 test failed:', err);
    process.exit(1);
});
