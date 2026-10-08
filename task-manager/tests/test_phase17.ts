import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Starting Phase 17 Audit and Logging Tests...\n');

    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');
    const { TaskAuditService } = await import('../TaskAuditService');

    // ── Test 1: Phone Masking ────────────────────────────────────────────────
    console.log('--- Test 1: Phone Masking Unit Test ---');
    const masked1 = TaskAuditService.maskPhone('9820645092');
    const masked2 = TaskAuditService.maskPhone('+91 99303 68976');

    console.log(`  "9820645092" -> "${masked1}"`);
    console.log(`  "+91 99303 68976" -> "${masked2}"`);

    if (masked1 !== '9820****92' || masked2 !== '9930****76') {
        throw new Error(`Phone masking failed: ${masked1}, ${masked2}`);
    }
    console.log('✓ Phone numbers masked correctly without exposing middle digits.');

    // ── Test 2: Credential & Secret Redaction ────────────────────────────────
    console.log('\n--- Test 2: Sensitive Field Redaction ---');
    const unsafePayload = {
        apiKey: 'secret_live_ai_9918231',
        service_password: 'super_secret_pwd',
        token: 'Bearer eyJhbGciOi...',
        phone: '9820645092',
        userNotes: 'Normal employee remark'
    };

    const sanitized = TaskAuditService.sanitizeDetails(unsafePayload);
    console.log('Sanitized Payload:', sanitized);

    if (sanitized.apiKey !== '[REDACTED]' || sanitized.service_password !== '[REDACTED]' || sanitized.token !== '[REDACTED]') {
        throw new Error('Secret credentials were not redacted properly');
    }
    if (sanitized.phone !== '9820****92') {
        throw new Error('Phone in details was not masked');
    }
    if (sanitized.userNotes !== 'Normal employee remark') {
        throw new Error('Safe text was improperly mutated');
    }
    console.log('✓ Sensitive credentials redacted and safe data preserved.');

    // ── Test 3: Database Audit Trail Recording & Querying ────────────────────
    console.log('\n--- Test 3: Database Audit Recording & Retrieval ---');
    const testActorId = '284eaccc-2c10-48f4-a524-2b448e40e012';

    await TaskAuditService.log({
        eventType: 'task_assigned',
        actorId: testActorId,
        details: {
            assignedTitle: '[PHASE17] Audit Verification Task',
            authSecret: 'should_be_stripped',
            phoneNumber: '9820645092'
        }
    });

    const logs = await TaskAuditService.getLogs({
        eventType: 'task_assigned',
        actorId: testActorId,
        limit: 5
    });

    if (logs.length === 0) {
        throw new Error('Logged audit entry could not be retrieved from database');
    }

    const latest = logs[0];
    console.log('Retrieved Latest Audit Record:', {
        id: latest.id,
        eventType: latest.eventType,
        actorId: latest.actorId,
        details: latest.details
    });

    if (latest.details.authSecret !== '[REDACTED]') {
        throw new Error('Database audit log contained unredacted secret');
    }
    if (latest.details.phoneNumber !== '9820****92') {
        throw new Error('Database audit log contained unmasked phone number');
    }
    console.log('✓ Audit entry successfully persisted and verified in Supabase.');

    // ── Cleanup ──────────────────────────────────────────────────────────────
    console.log('\n--- Cleanup ---');
    await supabaseAdmin
        .from('task_audit_logs')
        .delete()
        .eq('id', latest.id);
    console.log('✓ Cleaned up test audit log record.');

    console.log('\n🎉 ALL PHASE 17 TESTS PASSED SUCCESSFULLY!\n');
}

run().catch((err) => {
    console.error('❌ Phase 17 Test Failed:', err);
    process.exit(1);
});
