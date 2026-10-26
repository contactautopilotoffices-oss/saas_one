import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Testing Phase 1: Task Manager Cron Configuration in DB...\n');

    const { TaskDatabaseService } = await import('../TaskDatabaseService');

    // 1. Fetch initial config
    const initialConfig = await TaskDatabaseService.getTestingConfig();
    console.log('✓ 1. Fetched initial testing config:', {
        cronTiming: initialConfig.cronTiming,
        cronEnabled: initialConfig.cronEnabled,
        cronLastRunDate: initialConfig.cronLastRunDate
    });

    // 2. Save custom cron timing & enabled toggle without touching other fields
    const updated = await TaskDatabaseService.saveTestingConfig({
        cronTiming: '10:30',
        cronEnabled: true,
        cronLastRunSummary: 'Test run OK'
    });

    if (updated.cronTiming !== '10:30' || updated.cronEnabled !== true || updated.cronLastRunSummary !== 'Test run OK') {
        throw new Error('Cron config was not updated correctly!');
    }
    console.log('✓ 2. Successfully updated cronTiming to "10:30" and enabled to true.');

    // 3. Verify getTestingConfig returns updated data
    const fetched = await TaskDatabaseService.getTestingConfig();
    if (fetched.cronTiming !== '10:30' || fetched.cronEnabled !== true) {
        throw new Error('Fetched config does not match newly updated cron values!');
    }
    console.log('✓ 3. Verified getTestingConfig reflects new cron configuration.');

    // 4. Test updating cronLastRunDate
    const todayStr = new Date().toISOString().slice(0, 10);
    const stamped = await TaskDatabaseService.saveTestingConfig({
        cronLastRunDate: todayStr
    });

    if (stamped.cronLastRunDate !== todayStr || stamped.cronTiming !== '10:30') {
        throw new Error('Partial update broke existing cronTiming or failed to set date!');
    }
    console.log(`✓ 4. Partial update preserved cronTiming (${stamped.cronTiming}) and stamped date (${stamped.cronLastRunDate}).`);

    // 5. Clean reset
    await TaskDatabaseService.saveTestingConfig({
        cronTiming: '09:00',
        cronEnabled: true,
        cronLastRunDate: null,
        cronLastRunSummary: null
    });
    console.log('✓ 5. Reset cron config to clean default state (09:00 AM, enabled).');

    console.log('\n🎉 Phase 1 Verification Passed 100% Successfully!\n');
}

run().catch(err => {
    console.error('❌ Phase 1 test failed:', err);
    process.exit(1);
});
