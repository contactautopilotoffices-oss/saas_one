const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

function deriveOrgInitials(orgName) {
    if (!orgName) return 'AP';
    const trimmed = orgName.trim();
    if (trimmed.toLowerCase().includes('autopilot')) return 'AP';
    if (trimmed.toLowerCase() === 'tcs') return 'TCS';
    
    // Default: initials of words
    const words = trimmed.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return words.map(w => w[0].toUpperCase()).join('');
}

function derivePropertyInitials(name) {
    if (!name || !name.trim()) return 'PRP';
    // Clean unwanted characters like trailing commas or punctuation
    const clean = name.trim().replace(/,/g, '').replace(/\s+/g, ' ');
    // Handle camelCase like MyGate -> My Gate
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
    // Minimum 3 digits, expands to 4 or 5 digits as seqNumber increases
    const minPadding = 3;
    const seqStr = String(seqNumber);
    const padded = seqStr.padStart(Math.max(minPadding, seqStr.length), '0');
    return `${orgInitials}-${propInitials}-${padded}`;
}

async function run() {
    const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
    const { data: props, error } = await s.from('properties').select('id, name, organization_id');
    if (error) console.error('Error fetching props:', error);
    const { data: orgs } = await s.from('organizations').select('id, name');
    const orgMap = new Map((orgs || []).map(o => [o.id, o.name]));
    
    console.log('--- PROPERTY INITIALS MAPPING ---');
    for (const p of props || []) {
        const orgName = orgMap.get(p.organization_id) || 'Autopilot Offices';
        const orgInit = deriveOrgInitials(orgName);
        const propInit = derivePropertyInitials(p.name);
        console.log(`${p.name.padEnd(28)} -> Org: ${orgInit.padEnd(4)} Prop: ${propInit.padEnd(5)} Example: ${formatTicketNumber(orgInit, propInit, 1)} | ${formatTicketNumber(orgInit, propInit, 1420)}`);
    }
}

run();
