const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

function deriveOrgInitials(orgName) {
    if (!orgName) return 'AP';
    const trimmed = orgName.trim();
    if (trimmed.toLowerCase().includes('autopilot')) return 'AP';
    if (trimmed.toLowerCase() === 'tcs') return 'TCS';
    
    const words = trimmed.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return words.map(w => w[0].toUpperCase()).join('');
}

function derivePropertyInitials(name) {
    if (!name || !name.trim()) return 'PRP';
    const clean = name.trim().replace(/,/g, '').replace(/\s+/g, ' ');
    const separated = clean.replace(/([a-z])([A-Z])/g, '$1 $2');
    const words = separated.split(/[\s-]+/).filter(w => w.length > 0);
    
    if (words.length === 1) {
        return words[0].slice(0, 3).toUpperCase();
    }
    
    let res = '';
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w.toUpperCase() === 'SS') {
            res += 'SS';
        } else if (w.toLowerCase() === '3i') {
            res += '3I';
        } else {
            res += w[0].toUpperCase();
        }
    }
    return res;
}

function formatTicketNumber(orgInitials, propInitials, seqNumber) {
    const minPadding = 3;
    const seqStr = String(seqNumber);
    const padded = seqStr.padStart(Math.max(minPadding, seqStr.length), '0');
    return `${orgInitials}-${propInitials}-${padded}`;
}

async function main() {
    const isExecute = process.argv.includes('--execute');
    console.log(`=== TICKET RENUMBERING (${isExecute ? 'LIVE EXECUTION' : 'SIMULATION'}) ===\n`);
    
    const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
    
    // 1. Fetch properties & orgs
    const { data: props } = await s.from('properties').select('id, name, organization_id');
    const { data: orgs } = await s.from('organizations').select('id, name');
    const orgMap = new Map((orgs || []).map(o => [o.id, o.name]));
    const propMap = new Map((props || []).map(p => [p.id, {
        name: p.name,
        orgName: orgMap.get(p.organization_id) || 'Autopilot Offices',
        orgInit: deriveOrgInitials(orgMap.get(p.organization_id) || 'Autopilot Offices'),
        propInit: derivePropertyInitials(p.name)
    }]));
    
    // 2. Fetch all tickets
    console.log('Fetching all tickets from DB...');
    let from = 0;
    const step = 1000;
    const allTickets = [];
    while (true) {
        const { data, error } = await s.from('tickets')
            .select('id, ticket_number, property_id, organization_id, created_at')
            .range(from, from + step - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allTickets.push(...data);
        from += step;
    }
    console.log(`Fetched total ${allTickets.length} tickets.\n`);

    let backupDir = '';
    let backupFile = '';
    if (isExecute) {
        // BACKUP TO D:\Backups\<timestamp>
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        backupDir = path.join('D:', 'Backups', timestamp);
        fs.mkdirSync(backupDir, { recursive: true });
        backupFile = path.join(backupDir, 'tickets_backup.json');
        fs.writeFileSync(backupFile, JSON.stringify(allTickets, null, 2));
        console.log(`✅ [SAFETY] Full backup created at: ${backupFile} (${allTickets.length} records)`);
    }

    // 3. Group and sort
    const ticketsByProp = new Map();
    for (const t of allTickets) {
        const pId = t.property_id || 'UNKNOWN';
        if (!ticketsByProp.has(pId)) ticketsByProp.set(pId, []);
        ticketsByProp.get(pId).push(t);
    }

    const updates = [];
    const sequenceSeeds = [];

    for (const [pId, propTickets] of ticketsByProp.entries()) {
        const propInfo = propMap.get(pId) || {
            name: 'Unknown Property',
            orgName: 'Autopilot Offices',
            orgInit: 'AP',
            propInit: 'UNK'
        };
        
        propTickets.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        
        for (let i = 0; i < propTickets.length; i++) {
            const t = propTickets[i];
            const seq = i + 1;
            const newNumber = formatTicketNumber(propInfo.orgInit, propInfo.propInit, seq);
            updates.push({
                id: t.id,
                old_number: t.ticket_number,
                new_number: newNumber,
                seq: seq,
                property_id: pId
            });
        }

        if (pId !== 'UNKNOWN') {
            sequenceSeeds.push({
                property_id: pId,
                last_sequence: propTickets.length
            });
        }
    }

    console.log(`Total ticket updates prepared: ${updates.length}`);

    if (!isExecute) {
        console.log('\nDRY-RUN mode complete. To apply changes, run with --execute after user approval.');
        return;
    }

    // Save mapping file for complete audit and rollback capability
    const mappingPath = path.join(backupDir, 'ticket_number_mapping.json');
    fs.writeFileSync(mappingPath, JSON.stringify(updates, null, 2));
    console.log(`✅ [AUDIT] Mapping file created at: ${mappingPath}`);

    // EXECUTE CHUNKED UPDATES
    console.log('\nApplying updates in batches of 50...');
    const chunkSize = 50;
    let completed = 0;

    for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        await Promise.all(chunk.map(u => 
            s.from('tickets').update({
                ticket_number: u.new_number
            }).eq('id', u.id)
        ));
        completed += chunk.length;
        if (completed % 500 === 0 || completed === updates.length) {
            console.log(`Progress: ${completed} / ${updates.length} tickets renumbered`);
        }
    }

    // LOG ACTION TO D:\AgentLogs\actions.log
    const logDir = path.join('D:', 'AgentLogs');
    fs.mkdirSync(logDir, { recursive: true });
    const logEntry = `[${new Date().toISOString()}] Ticket renumbering executed: ${updates.length} tickets updated to AP-[PROP]-[SEQ] format. Backup at: ${backupFile}. Mapping at: ${mappingPath}\n`;
    fs.appendFileSync(path.join(logDir, 'actions.log'), logEntry);

    console.log('\n✅ Renumbering complete and logged to D:\\AgentLogs\\actions.log!');
}

main().catch(console.error);
