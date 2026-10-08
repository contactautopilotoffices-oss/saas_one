import 'dotenv/config';
import { TaskCommandHandler } from '../task-manager/TaskCommandHandler';
import { TaskMessageRouter } from '../task-manager/TaskMessageRouter';

async function main() {
    const lohitPhone = '9100256500';

    console.log('\n======================================================');
    console.log('🧪 PHASE 1 TEST: REPORTING MANAGER WHATSAPP BOT');
    console.log('📱 Phone:', lohitPhone);
    console.log('======================================================\n');

    // 1. Test "team" query
    console.log('--- 1. Testing "team" command ---');
    const res1 = await TaskCommandHandler.handleCommand({
        phone: lohitPhone,
        text: 'team',
        sendReply: false
    });
    console.log('Command result:', res1.command, res1.success);
    console.log('Bot Reply:\n' + res1.replyText);

    // 2. Test "assign" help guide
    console.log('\n--- 2. Testing "assign" guide ---');
    const res2 = await TaskCommandHandler.handleCommand({
        phone: lohitPhone,
        text: 'assign',
        sendReply: false
    });
    console.log('Bot Reply:\n' + res2.replyText);

    // 3. Test "assign Harsh ..." command
    console.log('\n--- 3. Testing "assign Harsh ..." command ---');
    const res3 = await TaskCommandHandler.handleCommand({
        phone: lohitPhone,
        text: 'assign Harsh Verify Phase 1 WhatsApp Manager Bot',
        sendReply: false
    });
    console.log('Bot Reply:\n' + res3.replyText);

    // 4. Test Inbound Router Classification
    console.log('\n--- 4. Testing TaskMessageRouter classification ---');
    const class1 = await TaskMessageRouter.classifyMessage(lohitPhone, 'team');
    const class2 = await TaskMessageRouter.classifyMessage(lohitPhone, 'assign Harsh Test feature');
    console.log('Router (team):', class1);
    console.log('Router (assign):', class2);

    console.log('\n✅ ALL PHASE 1 TESTS COMPLETED SUCCESSFULLY!\n');
}

main().catch(err => {
    console.error('Test failed with error:', err);
    process.exit(1);
});
