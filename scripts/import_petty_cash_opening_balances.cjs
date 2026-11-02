/**
 * Import Opening Petty Cash Balances for November 2026.
 *
 * Usage:
 *   node scripts/import_petty_cash_opening_balances.cjs           # Dry-run mode (safe preview)
 *   node scripts/import_petty_cash_opening_balances.cjs --commit  # Commit changes to database
 */

const fs = require('fs');
const path = require('path');

let createClient;
try {
    createClient = require('@supabase/supabase-js').createClient;
} catch (e) {
    createClient = require('d:/Projects/saas_one/node_modules/@supabase/supabase-js').createClient;
}

const COMMIT = process.argv.includes('--commit');
const DRY_RUN = !COMMIT;

// Resolve .env file
const envPath = fs.existsSync('.env') ? '.env' : 'd:/Projects/saas_one/.env';
if (!fs.existsSync(envPath)) {
    console.error(`Missing .env file at ${envPath}`);
    process.exit(1);
}

const envFile = fs.readFileSync(envPath, 'utf8');
const urlMatch = envFile.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/);
const keyMatch = envFile.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/);
const supabaseUrl = urlMatch ? urlMatch[1].trim().replace(/^['"]|['"]$/g, '') : '';
const supabaseKey = keyMatch ? keyMatch[1].trim().replace(/^['"]|['"]$/g, '') : '';

if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase URL or Service Role Key missing in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Target Organization ID (WorkSquare / Default Organization)
const ORG_ID = '211e1330-ad83-446d-941f-dcea48396798';

// Source data for November 2026
const ENTRIES = [
    {
        nameKey: 'Altamash.C',
        userId: '1a1d781a-1b3a-4dac-8d1b-1944ab5be743',
        fullName: 'Altamash Sirajuddin Chaugule',
        email: 'altamash.chaugule@worksquare.in',
        propertyId: 'bf345711-06fc-405f-b3a6-0a4888fff8b2',
        propertyName: 'ETPL Digitide',
        amount: 36000
    },
    {
        nameKey: 'Sanket.B',
        userId: '30043641-1c46-49a3-b926-f9180505154d',
        fullName: 'sanket bate',
        email: 'sanket.bate@worksquare.in',
        propertyId: 'f9f503ad-ec60-470a-87fa-d45a45b9b237',
        propertyName: 'Rabale',
        amount: 26000
    },
    {
        nameKey: 'Abhijeet.J',
        userId: '0695b650-7fd5-4ca2-ac73-369413db5fde',
        fullName: 'Abhijeet Anil Jadhav',
        email: 'abhijeet.jadhav@worksquare.in',
        propertyId: '7d0c1c03-7fdf-443c-b3d7-ff87e2c64a29',
        propertyName: 'MyGate',
        amount: 19000
    },
    {
        nameKey: 'Rahul .P',
        userId: 'cdf3b3af-34cb-461f-9d25-21bf3de34b9e',
        fullName: 'Rahul Patel',
        email: 'rahul.patel@worksquare.in',
        propertyId: '0f674e41-e94a-4ac0-8a88-fd1dffccd81a',
        propertyName: 'Indore',
        amount: 27000
    },
    {
        nameKey: 'Sachin G',
        userId: '9003fcb8-985e-4e04-b17e-c6d31a9f7672',
        fullName: 'Sachin Goswami',
        email: 'sachin.goswami@worksquare.in',
        propertyId: '2e6aa55c-9378-447c-b326-d9cb79957968',
        propertyName: 'Mahindra Finance - Delhi',
        amount: 20900
    },
    {
        nameKey: 'Siddalingappa N',
        userId: '6ba34561-ee29-4e0b-ab19-2d25dcfcaf0a',
        fullName: 'Siddalingappa',
        email: 'siddunagond1@gmail.com',
        propertyId: '12f45b38-ba14-4696-9969-2f79fa9b9945',
        propertyName: 'AMR Altruist',
        amount: 20000
    },
    {
        nameKey: 'Godwin.G',
        userId: 'dfb3f9e0-f245-492f-ae50-079ae7d98675',
        fullName: 'Godwin Gabriel',
        email: 'godwingabriel2002@gmail.com',
        propertyId: '79ba1aa5-bf91-4956-9dbe-ce9986790b53',
        propertyName: 'SS Plaza',
        amount: 30000
    },
    {
        nameKey: 'Kanai.D',
        userId: 'dd04064c-2bb3-4c9e-ad2b-cf5470b61465',
        fullName: 'Kanai Das',
        email: 'kanai.das567@gmail.com',
        propertyId: '0c0cae9c-6d11-47e5-866f-d55d76b73327',
        propertyName: 'Bajaj Kolkata',
        amount: 16000
    },
    {
        nameKey: 'Sonia.G',
        userId: 'b1ce3700-7aeb-4a2a-b1c8-a683048a50b5',
        fullName: 'frontdesk Noida (Sonia)',
        email: 'frontdesk.noida@worksquare.in',
        propertyId: '1249bab4-86ae-4d0c-a99a-347125335125',
        propertyName: 'Noida',
        amount: 15000
    },
    {
        nameKey: 'Irfan. M',
        userId: '2d906169-ebbe-467b-a4a2-91c09cc5ca78',
        fullName: 'Irfan Mulla',
        email: 'irfan.mulla@worksquare.in',
        propertyId: '1b83117c-e0c4-429b-a612-3f3f8f9e8f1e',
        propertyName: 'RUPA SOLITAIRE',
        amount: 15000
    },
    {
        nameKey: 'Meena.C',
        userId: 'd348888d-a319-4aea-b986-f0d1778e39b8',
        fullName: 'Meenaa Chavan',
        email: 'meenaa@worksquare.in',
        propertyId: '4f0f44eb-5169-4c67-9d09-325016125a8d',
        propertyName: 'D Mafatlal Chambers',
        amount: 75500
    }
];

async function run() {
    console.log('================================================================');
    console.log(`PETTY CASH OPENING BALANCES IMPORT (${DRY_RUN ? 'DRY RUN' : '*** LIVE COMMIT ***'})`);
    console.log(`Month: November 2026`);
    console.log(`Target Organization ID: ${ORG_ID}`);
    console.log('================================================================\n');

    let totalAmount = 0;
    const pendingActions = [];

    for (const entry of ENTRIES) {
        totalAmount += entry.amount;

        // Check existing requests or wallet entries
        const { data: existingReqs } = await supabase
            .from('petty_cash_requests')
            .select('id, request_no, status, paid_amount, created_at')
            .eq('organization_id', ORG_ID)
            .eq('requester_id', entry.userId)
            .ilike('purpose', '%November 2026%');

        const { data: walletEntries } = await supabase
            .from('petty_cash_wallet_entries')
            .select('id, kind, amount, created_at')
            .eq('organization_id', ORG_ID)
            .eq('requester_id', entry.userId);

        let currentBalance = 0;
        if (walletEntries) {
            for (const w of walletEntries) {
                if (w.kind === 'credit') currentBalance += Number(w.amount);
                else currentBalance -= Number(w.amount);
            }
        }

        console.log(`User: ${entry.nameKey.padEnd(16)} -> ${entry.fullName} (${entry.email})`);
        console.log(`  Property: ${entry.propertyName} (${entry.propertyId})`);
        console.log(`  Current Wallet Balance: ₹${currentBalance.toLocaleString('en-IN')}`);
        console.log(`  New November Credit:    ₹${entry.amount.toLocaleString('en-IN')}`);
        console.log(`  Projected Balance:      ₹${(currentBalance + entry.amount).toLocaleString('en-IN')}`);

        if (existingReqs && existingReqs.length > 0) {
            console.log(`  ⚠️  WARNING: Existing November 2026 request found: ${existingReqs[0].request_no} (Status: ${existingReqs[0].status}, ₹${existingReqs[0].paid_amount})`);
        }

        pendingActions.push({
            entry,
            currentBalance,
            projectedBalance: currentBalance + entry.amount
        });
        console.log('----------------------------------------------------------------');
    }

    console.log(`\nSUMMARY:`);
    console.log(`Total Accounts to Credit: ${ENTRIES.length}`);
    console.log(`Total Amount to Credit:   ₹${totalAmount.toLocaleString('en-IN')}`);

    if (DRY_RUN) {
        console.log('\n[DRY RUN COMPLETE] No records were created or modified in the database.');
        console.log('To execute this import after user confirmation, run with `--commit`.');
        return;
    }

    // --- LIVE COMMIT PHASE ---
    console.log('\n[EXECUTING LIVE COMMIT...]');

    // 1. Create Backup directory
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const backupDir = path.join('D:', 'Backups', `${timestamp}_petty_cash_import`);
    fs.mkdirSync(backupDir, { recursive: true });

    // Fetch existing tables state for backup
    const { data: preRequests } = await supabase.from('petty_cash_requests').select('*').eq('organization_id', ORG_ID);
    const { data: preLedger } = await supabase.from('petty_cash_wallet_entries').select('*').eq('organization_id', ORG_ID);
    fs.writeFileSync(path.join(backupDir, 'pre_requests.json'), JSON.stringify(preRequests, null, 2));
    fs.writeFileSync(path.join(backupDir, 'pre_ledger.json'), JSON.stringify(preLedger, null, 2));
    console.log(`Backup saved to: ${backupDir}`);

    const createdRecords = [];

    for (const item of pendingActions) {
        const { entry } = item;

        // Check if already created in previous attempt
        const { data: alreadyDone } = await supabase
            .from('petty_cash_requests')
            .select('id, request_no')
            .eq('organization_id', ORG_ID)
            .eq('requester_id', entry.userId)
            .ilike('purpose', '%November 2026%');

        if (alreadyDone && alreadyDone.length > 0) {
            console.log(`⏩ Skipping ${entry.fullName} (Already imported with request ${alreadyDone[0].request_no || alreadyDone[0].id})`);
            continue;
        }

        // 1. Insert Request
        const requestPayload = {
            organization_id: ORG_ID,
            property_id: entry.propertyId,
            requester_id: entry.userId,
            recipient_name: entry.fullName,
            purpose: `Opening Petty Cash Balance - November 2026 (updated directly)`,
            amount_requested: entry.amount,
            allocated_amount: entry.amount,
            approved_amount: entry.amount,
            paid_amount: entry.amount,
            paid_mode: 'Bank Transfer',
            payment_ref: `OPENING-BAL-NOV26-${entry.nameKey.replace(/[^A-Za-z0-9]/g, '')}`,
            status: 'paid',
            workflow_version: 2,
            allocation_remarks: 'updated directly',
            approval_remarks: 'updated directly',
            paid_at: new Date().toISOString(),
            approved_at: new Date().toISOString(),
            allocated_at: new Date().toISOString()
        };

        const { data: newReq, error: reqErr } = await supabase
            .from('petty_cash_requests')
            .insert(requestPayload)
            .select()
            .single();

        if (reqErr) {
            console.error(`Failed to create request for ${entry.fullName}:`, reqErr.message);
            continue;
        }

        // 2. Insert Wallet Credit Entry
        const walletPayload = {
            organization_id: ORG_ID,
            requester_id: entry.userId,
            request_id: newReq.id,
            kind: 'credit',
            amount: entry.amount,
            actor_id: entry.userId
        };

        const { data: newWallet, error: wallErr } = await supabase
            .from('petty_cash_wallet_entries')
            .insert(walletPayload)
            .select()
            .single();

        if (wallErr) {
            console.error(`Failed to credit wallet for ${entry.fullName}:`, wallErr.message);
            continue;
        }

        // 3. Insert Activity Log
        await supabase.from('petty_cash_activity').insert({
            request_id: newReq.id,
            organization_id: ORG_ID,
            actor_id: entry.userId,
            action: 'opening_balance_credited',
            from_status: null,
            to_status: 'paid',
            remark: `Opening advance ₹${entry.amount.toLocaleString('en-IN')} credited for November 2026 (updated directly)`
        });

        console.log(`✅ Successfully credited ₹${entry.amount.toLocaleString('en-IN')} for ${entry.fullName} (Request No: ${newReq.request_no || newReq.id})`);
        createdRecords.push({ user: entry.fullName, amount: entry.amount, requestId: newReq.id });
    }

    // Log to D:\AgentLogs\actions.log
    const logLine = `[${new Date().toISOString()}] Successfully imported November 2026 opening petty cash balances for ${createdRecords.length} users (Total: ₹${totalAmount}). Backup at: ${backupDir}\n`;
    try {
        fs.appendFileSync('D:/AgentLogs/actions.log', logLine);
    } catch (e) {
        console.error('Could not append to actions.log:', e.message);
    }

    console.log('\n[IMPORT COMPLETE]');
}

run().catch(console.error);
