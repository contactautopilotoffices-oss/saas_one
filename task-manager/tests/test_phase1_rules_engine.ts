import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
import { NextRequest } from 'next/server';

async function run() {
    console.log('🧪 Starting Phase 1 Multi-Rule Engine Verification Tests...\n');

    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { GET: cronGET } = await import('../../app/api/cron/task-manager/route');
    const { POST: configPOST } = await import('../../app/api/task-manager/testing-config/route');

    // ── Test 1: Schema & Default Rules Migration ─────────────────────────────
    console.log('Test 1: Verifying default rules generation and backward compatibility...');
    const config = await TaskDatabaseService.getTestingConfig();
    if (!config.rules || config.rules.length < 3) {
        throw new Error(`Expected at least 3 default notification rules, found ${config.rules?.length}`);
    }
    const morningRule = config.rules.find(r => r.id === 'rule_morning_digest');
    const middayRule = config.rules.find(r => r.id === 'rule_pending_reminder');
    const eodRule = config.rules.find(r => r.id === 'rule_eod_summary');

    if (!morningRule || !middayRule || !eodRule) {
        throw new Error('Default rules do not include morning, midday, and eod rules!');
    }
    console.log(`✓ 1. Default rules present: [${config.rules.map(r => r.name).join(', ')}]`);

    // ── Test 2: Update Rule Persistence ──────────────────────────────────────
    console.log('\nTest 2: Verifying per-rule updates...');
    const updatedConfig = await TaskDatabaseService.updateNotificationRule('rule_pending_reminder', {
        targetTimeIST: '15:15',
        enabled: true
    });
    const updatedMidday = updatedConfig.rules?.find(r => r.id === 'rule_pending_reminder');
    if (updatedMidday?.targetTimeIST !== '15:15') {
        throw new Error(`Failed to update targetTimeIST on rule_pending_reminder. Got: ${updatedMidday?.targetTimeIST}`);
    }
    console.log('✓ 2. Successfully updated rule_pending_reminder to 15:15 IST and verified persistence.');

    // ── Test 3: API Route: Reset and Update Actions ──────────────────────────
    console.log('\nTest 3: Verifying Testing Config API actions (update_rule & reset_rule)...');
    const updateReq = new NextRequest('http://localhost:3000/api/task-manager/testing-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'update_rule',
            ruleId: 'rule_morning_digest',
            updates: { targetTimeIST: '08:45' }
        })
    });
    const updateRes = await configPOST(updateReq);
    const updateJson = await updateRes.json();
    if (!updateJson.success || updateJson.config.rules.find((r: any) => r.id === 'rule_morning_digest')?.targetTimeIST !== '08:45') {
        throw new Error('API update_rule failed');
    }
    console.log('✓ 3a. POST /api/task-manager/testing-config action=update_rule succeeded.');

    // ── Test 4: Cron Route Multi-Rule Heartbeat Evaluation ────────────────────
    console.log('\nTest 4: Verifying automated cron multi-rule evaluation loop...');
    const autoReq = new NextRequest('http://localhost:3000/api/cron/task-manager?action=auto', {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET || 'test'}` }
    });
    const autoRes = await cronGET(autoReq);
    const autoJson = await autoRes.json();
    if (!autoJson.ok || !autoJson.results) {
        throw new Error(`Cron auto-evaluation failed: ${JSON.stringify(autoJson)}`);
    }
    console.log(`✓ 4. Cron evaluated ${autoJson.rulesEvaluated} rules cleanly (Result: ${autoJson.action}).`);

    // ── Test 5: Forced Single Rule Execution (Dry-Run) ───────────────────────
    console.log('\nTest 5: Verifying single rule dry-run dispatch with deduplication...');
    // Ensure clean stamp first
    await TaskDatabaseService.resetNotificationRuleRun('rule_morning_digest');

    const forceReq = new NextRequest('http://localhost:3000/api/cron/task-manager?action=auto&ruleId=rule_morning_digest&dryRun=true&force=true', {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET || 'test'}` }
    });
    const forceRes = await cronGET(forceReq);
    const forceJson = await forceRes.json();
    if (!forceJson.ok || forceJson.rulesDispatched !== 1) {
        throw new Error(`Failed to dispatch targeted rule: ${JSON.stringify(forceJson)}`);
    }
    console.log('✓ 5a. Dispatched rule_morning_digest with force=true & dryRun=true.');

    // Second call without force must encounter deduplication
    const dedupReq = new NextRequest('http://localhost:3000/api/cron/task-manager?action=auto&ruleId=rule_morning_digest&dryRun=true', {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET || 'test'}` }
    });
    const dedupRes = await cronGET(dedupReq);
    const dedupJson = await dedupRes.json();
    const morningResult = dedupJson.results?.find((r: any) => r.ruleId === 'rule_morning_digest');
    if (morningResult?.status !== 'already_executed_today') {
        throw new Error(`Expected already_executed_today for rule_morning_digest, got: ${morningResult?.status}`);
    }
    console.log('✓ 5b. Verified per-rule deduplication guard blocked duplicate run today.');

    // ── Test 6: Per-Rule Reset ───────────────────────────────────────────────
    console.log('\nTest 6: Verifying resetting single rule...');
    const resetReq = new NextRequest('http://localhost:3000/api/task-manager/testing-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'reset_rule',
            ruleId: 'rule_morning_digest'
        })
    });
    const resetRes = await configPOST(resetReq);
    const resetJson = await resetRes.json();
    const resetRule = resetJson.config.rules.find((r: any) => r.id === 'rule_morning_digest');
    if (resetRule.lastRunDate !== null) {
        throw new Error('Rule lastRunDate was not reset to null!');
    }
    console.log('✓ 6. Rule lastRunDate reset to null successfully.');

    // ── Test 7: Clean reset to standard defaults ─────────────────────────────
    console.log('\nTest 7: Resetting rules to standard clean state...');
    await TaskDatabaseService.saveTestingConfig({
        cronTiming: '09:00',
        cronLastRunDate: null,
        cronLastRunSummary: null,
        rules: TaskDatabaseService.getDefaultNotificationRules('09:00')
    });
    console.log('✓ 7. Clean reset complete.');

    console.log('\n🎉 ALL PHASE 1 VERIFICATION TESTS PASSED 100% SUCCESSFULLY!\n');
}

run().catch(err => {
    console.error('❌ Phase 1 test failed:', err);
    process.exit(1);
});
