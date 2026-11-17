const { createClient } = require('@supabase/supabase-js');
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

async function dryRun() {
    console.log('=== DRY-RUN: TICKET RENUMBERING SIMULATION ===');
    const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
    
    // 1. Fetch properties and organizations
    const { data: props, error: pErr } = await s.from('properties').select('id, name, organization_id');
    if (pErr) throw pErr;
    const { data: orgs, error: oErr } = await s.from('organizations').select('id, name');
    if (oErr) throw oErr;
    
    const orgMap = new Map((orgs || []).map(o => [o.id, o.name]));
    const propMap = new Map((props || []).map(p => [p.id, {
        name: p.name,
        orgName: orgMap.get(p.organization_id) || 'Autopilot Offices',
        orgInit: deriveOrgInitials(orgMap.get(p.organization_id) || 'Autopilot Offices'),
        propInit: derivePropertyInitials(p.name)
    }]));
    
    // 2. Fetch all tickets paginated, ordered by property_id, created_at ASC
    console.log('Fetching all tickets from database...');
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
    
    // Group tickets by property_id
    const ticketsByProp = new Map();
    for (const t of allTickets) {
        const pId = t.property_id || 'UNKNOWN';
        if (!ticketsByProp.has(pId)) ticketsByProp.set(pId, []);
        ticketsByProp.get(pId).push(t);
    }
    
    console.log('--- PROPERTY-BY-PROPERTY SIMULATION ---');
    let totalRenumbered = 0;
    const sampleResults = [];
    
    for (const [pId, propTickets] of ticketsByProp.entries()) {
        const propInfo = propMap.get(pId) || {
            name: 'Unknown Property',
            orgName: 'Autopilot Offices',
            orgInit: 'AP',
            propInit: 'UNK'
        };
        
        // Sort chronologically ascending
        propTickets.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        
        const count = propTickets.length;
        totalRenumbered += count;
        
        const firstTicket = propTickets[0];
        const lastTicket = propTickets[count - 1];
        
        const firstNewNum = formatTicketNumber(propInfo.orgInit, propInfo.propInit, 1);
        const lastNewNum = formatTicketNumber(propInfo.orgInit, propInfo.propInit, count);
        
        console.log(`Property: ${propInfo.name.padEnd(25)} | Tickets: ${String(count).padStart(5)} | Range: ${firstNewNum} -> ${lastNewNum}`);
        
        sampleResults.push({
            propertyName: propInfo.name,
            totalTickets: count,
            sampleFirst: {
                id: firstTicket.id,
                old_number: firstTicket.ticket_number,
                new_number: firstNewNum,
                seq: 1,
                created_at: firstTicket.created_at
            },
            sampleLast: {
                id: lastTicket.id,
                old_number: lastTicket.ticket_number,
                new_number: lastNewNum,
                seq: count,
                created_at: lastTicket.created_at
            }
        });
    }
    
    console.log(`\nTOTAL TICKETS IN SCOPE FOR RENUMBERING: ${totalRenumbered}`);
    console.log('\nSample Before -> After:');
    for (const s of sampleResults.slice(0, 5)) {
        console.log(`\n[${s.propertyName}] (${s.totalTickets} tickets):`);
        console.log(`  First: ${s.sampleFirst.old_number} -> ${s.sampleFirst.new_number} (created ${s.sampleFirst.created_at})`);
        console.log(`  Last:  ${s.sampleLast.old_number} -> ${s.sampleLast.new_number} (created ${s.sampleLast.created_at})`);
    }
}

dryRun().catch(console.error);
