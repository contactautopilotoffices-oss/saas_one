import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Starting Task Manager Testing & Whitelist Suite...\n');

    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskNotificationService } = await import('../TaskNotificationService');
    const { TaskMessageRouter } = await import('../TaskMessageRouter');

    // 1. Save Test Config
    const testConfig = {
        enabled: true,
        manager: { name: 'Test Manager', phone: '9999900001' },
        notifyManager: true,
        employees: [
            { name: 'Test Subordinate', phone: '9999900002' }
        ]
    };

    await TaskDatabaseService.saveTestingConfig(testConfig);
    console.log('✓ 1. Testing config successfully saved in DB.');

    // 2. Fetch Test Config
    const fetched = await TaskDatabaseService.getTestingConfig();
    if (!fetched.enabled || fetched.employees?.length !== 1 || fetched.employees[0].phone !== '9999900002') {
        throw new Error('Fetched testing config does not match saved config');
    }
    console.log('✓ 2. Testing config accurately fetched from DB.');

    // 3. Verify Outbound Whitelist Protection
    const notifResult = await TaskNotificationService.sendMorningNotifications({
        dryRun: true
    });

    // Ensure NO real employees received it (only at most the 2 test numbers if they exist in DB)
    const outsideRecipients = notifResult.details.filter(d => {
        const dDigits = d.phone.replace(/\D/g, '').slice(-10);
        return dDigits !== '9999900001' && dDigits !== '9999900002';
    });

    if (outsideRecipients.length > 0) {
        throw new Error(`Security Violation: ${outsideRecipients.length} non-whitelisted employees were included in notification run!`);
    }
    console.log(`✓ 3. Outbound Notification Whitelist Verified: 0 non-whitelisted employees contacted.`);

    // 4. Verify Inbound Whitelist Protection
    const outsidePhone = '9123456789'; // Non-whitelisted phone
    const routeOutside = await TaskMessageRouter.routeInboundMessage({
        phone: outsidePhone,
        text: 'tasks',
        sendReply: false
    });

    if (routeOutside.handledByTaskManager || routeOutside.system !== 'FACILITY') {
        throw new Error('Security Violation: Non-whitelisted inbound message was routed to Task Manager!');
    }
    console.log(`✓ 4. Inbound Whitelist Verified: Outside phone (${outsidePhone}) routed safely away to Facility.`);

    // 5. Cleanup: Disable test mode for now
    await TaskDatabaseService.saveTestingConfig({
        enabled: false,
        manager: { name: '', phone: '' },
        notifyManager: false,
        employees: []
    });
    console.log('✓ 5. Reset testing config back to clean default state.');

    console.log('\n🎉 TASK MANAGER TESTING TAB VERIFICATION PASSED WITH 100% SUCCESS!\n');
}

run().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
