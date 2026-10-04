import 'dotenv/config';
import { AiSensyService } from '../backend/services/AiSensyService';

/**
 * Standalone verification script for Meta approved Task Manager templates:
 * 1. tm_manager_kickoff_v1
 * 2. tm_employee_kickoff_v1
 *
 * NOTE: Set TARGET_PHONE to your phone number (e.g. '8433649199') before running.
 */
const TARGET_PHONE = '8433649199'; // Sahil Gorde

export async function testManagerKickoff(phone = TARGET_PHONE) {
    console.log(`\n======================================================`);
    console.log(`🚀 Testing Template 1: Manager Kickoff (tm_manager_kickoff_v1)`);
    console.log(`📱 Destination: ${phone}`);
    console.log(`======================================================`);

    const managerName = 'Sahil';
    const deptName = 'Tech';
    const teamMembers = 'Harsh';

    console.log(`Params: [${managerName}, ${deptName}, ${teamMembers}]`);
    console.log(`Quick reply buttons: [View Team Tasks], [Assign Task]\n`);

    const startTime = Date.now();
    const result = await AiSensyService.sendTemplate({
        phone,
        campaignName: 'tm_manager_kickoff_v1',
        templateParams: [managerName, deptName, teamMembers]
    });
    const duration = Date.now() - startTime;

    console.log(`Result: ${result.success ? '✅ SUCCESS (Delivered)' : '❌ FAILED'}`);
    if (result.error) console.log(`Error details:`, result.error);
    console.log(`Time taken: ${duration}ms\n`);
    return result;
}

export async function testEmployeeKickoff(phone = TARGET_PHONE) {
    console.log(`\n======================================================`);
    console.log(`🚀 Testing Template 2: Employee Kickoff (tm_employee_kickoff_v1)`);
    console.log(`📱 Destination: ${phone}`);
    console.log(`======================================================`);

    const employeeName = 'Sahil';
    const deptName = 'Tech';
    const managerName = 'Lohitaksha Ranganathan';

    console.log(`Params: [${employeeName}, ${deptName}, ${managerName}]`);
    console.log(`Quick reply button: [View Tasks]\n`);

    const startTime = Date.now();
    const result = await AiSensyService.sendTemplate({
        phone,
        campaignName: 'tm_employee_kickoff_v1',
        templateParams: [employeeName, deptName, managerName]
    });
    const duration = Date.now() - startTime;

    console.log(`Result: ${result.success ? '✅ SUCCESS (Delivered)' : '❌ FAILED'}`);
    if (result.error) console.log(`Error details:`, result.error);
    console.log(`Time taken: ${duration}ms\n`);
    return result;
}

async function main() {
    const action = process.argv[2];
    if (action === 'manager') {
        await testManagerKickoff();
    } else if (action === 'employee') {
        await testEmployeeKickoff();
    } else {
        console.log(`\nUsage:`);
        console.log(`  npx tsx whatsapp-test/test_kickoff_templates.ts manager   # Test Template 1`);
        console.log(`  npx tsx whatsapp-test/test_kickoff_templates.ts employee  # Test Template 2\n`);
    }
}

if (require.main === module) {
    main().catch(console.error);
}
