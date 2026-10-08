import { execSync } from 'child_process';
import path from 'path';

const testFiles = [
    'test_phase1.ts',
    'test_phase2.ts',
    'test_phase3.ts',
    'test_phase4.ts',
    'test_phase5.ts',
    'test_phase6.ts',
    'test_phase7.ts',
    'test_phase8_9_10.ts',
    'test_phase11_12.ts',
    'test_phase13.ts',
    'test_phase14_15.ts',
    'test_phase16.ts',
    'test_phase17.ts',
    'test_phase18.ts',
    'test_phase19.ts',
    'test_phase20_e2e.ts'
];

console.log('====================================================');
console.log('🧪 RUNNING ALL TASK MANAGER AUTOMATED TEST SUITES');
console.log('====================================================\n');

let passedCount = 0;
let failedCount = 0;
const results: Array<{ test: string; status: 'PASSED' | 'FAILED'; error?: string }> = [];

for (const file of testFiles) {
    const fullPath = path.join(__dirname, file);
    process.stdout.write(`⏳ Running ${file}... `);
    try {
        execSync(`npx tsx "${fullPath}"`, {
            cwd: path.resolve(__dirname, '../..'),
            stdio: 'pipe',
            timeout: 60000
        });
        console.log('✅ PASSED');
        passedCount++;
        results.push({ test: file, status: 'PASSED' });
    } catch (err: any) {
        console.log('❌ FAILED');
        const stderr = err.stderr ? err.stderr.toString() : err.message;
        const stdout = err.stdout ? err.stdout.toString() : '';
        console.error(`\n--- ERROR IN ${file} ---`);
        console.error(stderr || stdout);
        console.error('------------------------\n');
        failedCount++;
        results.push({ test: file, status: 'FAILED', error: stderr || stdout });
    }
}

console.log('\n====================================================');
console.log(`📊 FINAL TEST RUN RESULTS: ${passedCount}/${testFiles.length} PASSED`);
if (failedCount > 0) {
    console.log(`❌ ${failedCount} SUITE(S) FAILED`);
    process.exit(1);
} else {
    console.log('🎉 ALL 16 TEST SUITES (PHASES 1 - 20) PASSED WITH 100% SUCCESS!');
    console.log('====================================================\n');
}
