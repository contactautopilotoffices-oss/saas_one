import test from 'node:test';
import assert from 'node:assert/strict';

// Helper tests for ticket numbering logic
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

test('deriveOrgInitials properly maps Autopilot Offices to AP', () => {
    assert.equal(deriveOrgInitials('Autopilot Offices'), 'AP');
    assert.equal(deriveOrgInitials('Autopilot Offices\n'), 'AP');
    assert.equal(deriveOrgInitials('tcs'), 'TCS');
    assert.equal(deriveOrgInitials('Global Tech Hub'), 'GTH');
});

test('derivePropertyInitials handles single-word and multi-word names', () => {
    assert.equal(derivePropertyInitials('SS Plaza'), 'SSP');
    assert.equal(derivePropertyInitials('Rabale'), 'RAB');
    assert.equal(derivePropertyInitials('Indore'), 'IND');
    assert.equal(derivePropertyInitials('ETPL Digitide'), 'ED');
    assert.equal(derivePropertyInitials('AMR Altruist'), 'AA');
    assert.equal(derivePropertyInitials('C Mafatlal Chambers ,'), 'CMC');
    assert.equal(derivePropertyInitials('3i Cresent'), '3IC');
});

test('formatTicketNumber pads minimum 3 digits and grows automatically', () => {
    assert.equal(formatTicketNumber('AP', 'SSP', 1), 'AP-SSP-001');
    assert.equal(formatTicketNumber('AP', 'SSP', 99), 'AP-SSP-099');
    assert.equal(formatTicketNumber('AP', 'SSP', 100), 'AP-SSP-100');
    assert.equal(formatTicketNumber('AP', 'SSP', 1621), 'AP-SSP-1621');
    assert.equal(formatTicketNumber('AP', 'SSP', 10000), 'AP-SSP-10000');
});
