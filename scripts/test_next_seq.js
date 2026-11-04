const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    let res = '';
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w.toUpperCase() === 'SS') res += 'SS';
        else if (w.toLowerCase() === '3i') res += '3I';
        else res += w[0].toUpperCase();
    }
    return res;
}

function formatTicketNumber(orgInitials, propInitials, seqNumber) {
    const minPadding = 3;
    const seqStr = String(seqNumber);
    const padded = seqStr.padStart(Math.max(minPadding, seqStr.length), '0');
    return `${orgInitials}-${propInitials}-${padded}`;
}

async function getNext(pId) {
    const { data: prop } = await s.from('properties').select('id, name, organization_id').eq('id', pId).single();
    const { data: org } = await s.from('organizations').select('name').eq('id', prop.organization_id).single();
    const orgInit = deriveOrgInitials(org.name);
    const propInit = derivePropertyInitials(prop.name);
    const { data: recentTickets } = await s.from('tickets')
        .select('ticket_number')
        .eq('property_id', pId)
        .order('created_at', { ascending: false })
        .limit(100);
    let maxSeq = 0;
    const prefix = `${orgInit}-${propInit}-`;
    for (const t of recentTickets || []) {
        if (t.ticket_number && t.ticket_number.startsWith(prefix)) {
            const seq = parseInt(t.ticket_number.substring(prefix.length), 10);
            if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
        }
    }
    return formatTicketNumber(orgInit, propInit, maxSeq + 1);
}

async function testAll() {
    console.log('Next SS Plaza ticket:     ', await getNext('79ba1aa5-bf91-4956-9dbe-ce9986790b53'));
    console.log('Next Rabale ticket:       ', await getNext('f9f503ad-ec60-470a-87fa-d45a45b9b237'));
    console.log('Next ETPL Digitide ticket:', await getNext('bf345711-06fc-405f-b3a6-0a4888fff8b2'));
}
testAll().catch(console.error);
