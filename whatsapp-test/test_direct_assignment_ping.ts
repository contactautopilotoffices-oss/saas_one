import 'dotenv/config';
import { TaskMessagingService } from '../task-manager/TaskMessagingService';

async function main() {
    const targetPhone = '8433649199';
    console.log(`\n==================================================`);
    console.log(`🚀 Sending standalone Task Assignment WhatsApp alert`);
    console.log(`📱 Target: ${targetPhone}`);
    console.log(`==================================================\n`);

    const message = [
        `🔔 *New Task Assigned!*`,
        ``,
        `*Task:* Prepare Product Demo Presentation`,
        `*Details:* Review task workflow and test reporting manager dashboard.`,
        `*Assigned By:* Lohitaksha Ranganathan (Tech)`,
        `*Due Date:* Today`,
        ``,
        `Reply *tasks* to view your full task list, or *done 1* when finished!`
    ].join('\n');

    console.log('Message payload:\n---\n' + message + '\n---\n');
    console.log('Sending via TaskMessagingService.sendMessage...');

    const startTime = Date.now();
    const success = await TaskMessagingService.sendMessage(targetPhone, message);
    const duration = Date.now() - startTime;

    console.log(`\nResult: ${success ? '✅ SUCCESS (Delivered)' : '❌ FAILED'}`);
    console.log(`Time taken: ${duration}ms\n`);
}

main().catch(err => {
    console.error('Fatal error running test:', err);
    process.exit(1);
});
