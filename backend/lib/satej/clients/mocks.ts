/**
 * Canned Engy, Exa, Bolna and WhatsApp, so the whole pipeline runs end to end
 * with SATEJ_MOCK_MODE=true and no keys — scripts/satej-simulate.ts uses them.
 * Ported unchanged in behaviour from the procurement-agent package.
 */

import { parseJsonLoose } from '../util';

type MockProfile = {
    name: string;
    phone: string;
    area: string;
    gst: 'yes' | 'no' | 'unknown';
    years: number | null;
    turnoverLakhs: number | null;
    turnaroundDays: number | null;
    clients: string[];
    refs: boolean;
    match: 'exact' | 'strong' | 'partial' | 'weak';
    auth: number;
    website: string;
    reached: boolean;
    flags: string[];
};

export const MOCK_PROFILES: MockProfile[] = [
    { name: 'Shree Ganesh Interiors', phone: '+919820011111', area: 'Lower Parel', gst: 'yes', years: 14, turnoverLakhs: 350, turnaroundDays: 10, clients: ['WeWork BKC', 'Kotak Mahindra Bank', 'Smartworks'], refs: true, match: 'exact', auth: 9, website: 'shreeganeshinteriors.in', reached: true, flags: [] },
    { name: 'Mumbai Gypsum Works', phone: '+919820022222', area: 'Worli', gst: 'yes', years: 6, turnoverLakhs: 90, turnaroundDays: 14, clients: ['Local hospital fit-out'], refs: false, match: 'strong', auth: 6, website: '', reached: true, flags: ['Could not name a specific client project'] },
    { name: 'Om Sai Ceiling Solutions', phone: '+919820033333', area: 'Dadar', gst: 'no', years: 3, turnoverLakhs: 20, turnaroundDays: 20, clients: [], refs: false, match: 'partial', auth: 4, website: '', reached: true, flags: ['Not GST registered'] },
    { name: 'Prime Drywall Systems LLP', phone: '+919820044444', area: 'Parel', gst: 'yes', years: 9, turnoverLakhs: 180, turnaroundDays: 7, clients: ['Regus Andheri', 'HDFC Life'], refs: true, match: 'exact', auth: 8, website: 'primedrywall.co.in', reached: true, flags: [] },
    { name: 'Krishna POP and Gypsum', phone: '+919820055555', area: 'Byculla', gst: 'unknown', years: 11, turnoverLakhs: null, turnaroundDays: 12, clients: ['Residential towers'], refs: false, match: 'strong', auth: 5, website: '', reached: true, flags: ['Avoided the turnover question'] },
    { name: 'Metro False Ceiling Co', phone: '+919820066666', area: 'Mahalaxmi', gst: 'unknown', years: null, turnoverLakhs: null, turnaroundDays: null, clients: [], refs: false, match: 'weak', auth: 0, website: '', reached: false, flags: [] },
];

function profileFor(text: string): MockProfile | undefined {
    return MOCK_PROFILES.find((p) => text.includes(p.name));
}

export function mockLlm(task: string, user: string): unknown {
    if (task === 'structure') {
        const jsonStart = user.indexOf('{');
        const jsonEnd = user.indexOf('\n}', jsonStart);
        const input = (parseJsonLoose(user.slice(jsonStart, jsonEnd + 2)) ?? {}) as Record<string, string>;
        const hasAnswers = user.includes('CLARIFICATION ANSWERS');
        const questions = !input.quantity && !hasAnswers ? ['Roughly how many square feet of ceiling is needed?'] : [];
        return {
            itemCategory: 'gypsum false ceiling',
            itemSummary: 'Gypsum false ceiling supply and installation for an office floor',
            specs: ['12.5 mm gypsum board', 'GI framing'],
            quantity: input.quantity || '1200',
            unit: input.unit || 'sqft',
            quantityText: 'about 1,200 square feet',
            scopeType: 'supply_and_install',
            locationCity: input.locationCity || 'Mumbai',
            locationArea: input.locationArea || 'Lower Parel',
            locationText: `${input.locationArea || 'Lower Parel'}, ${input.locationCity || 'Mumbai'}`,
            timelineDays: 15,
            timelineText: 'within 15 days',
            vendorTypes: ['false ceiling contractor', 'gypsum board dealer'],
            searchQueries: ['false ceiling contractor in Lower Parel Mumbai', 'gypsum ceiling contractor Mumbai justdial'],
            mustHave: ['GST registered'],
            questions,
        };
    }
    if (task === 'discover') {
        const marker = user.indexOf('MOCKVENDORS:');
        if (marker < 0) return { vendors: [] };
        return parseJsonLoose(user.slice(marker + 'MOCKVENDORS:'.length)) ?? { vendors: [] };
    }
    if (task === 'analyze') {
        const p = profileFor(user);
        if (!p || !p.reached) {
            return {
                reachedRightPerson: false, contactPerson: '', gstRegistered: 'unknown', gstin: '', yearsExperience: null,
                annualTurnoverText: '', annualTurnoverLakhs: null, hasWebsite: 'unknown', websiteUrl: '', hasCompanyProfile: 'unknown',
                turnaroundDays: null, turnaroundText: '', specialisations: [], specialisationMatch: 'weak', clients: [],
                referencesOffered: false, testimonialsText: '', usps: [], authenticityScore: 0,
                authenticityReasons: ['Call did not connect to the business'], redFlags: [], summary: 'Could not reach the business.', evidence: [],
            };
        }
        return {
            reachedRightPerson: true,
            contactPerson: 'Mr. Patil',
            gstRegistered: p.gst,
            gstin: p.gst === 'yes' ? '27ABCDE1234F1Z5' : '',
            yearsExperience: p.years,
            annualTurnoverText: p.turnoverLakhs ? `about ${p.turnoverLakhs} lakh` : '',
            annualTurnoverLakhs: p.turnoverLakhs,
            hasWebsite: p.website ? 'yes' : 'no',
            websiteUrl: p.website,
            hasCompanyProfile: p.auth >= 6 ? 'yes' : 'no',
            turnaroundDays: p.turnaroundDays,
            turnaroundText: p.turnaroundDays ? `${p.turnaroundDays} days` : '',
            specialisations: ['gypsum false ceiling', 'drywall partitions'],
            specialisationMatch: p.match,
            clients: p.clients.map((c) => ({ name: c, sector: 'commercial' })),
            referencesOffered: p.refs,
            testimonialsText: p.refs ? 'Offered to connect us with the facility manager at a past client.' : '',
            usps: p.auth >= 8 ? ['Own installation team of 25', 'Works at night for occupied offices'] : ['Competitive pricing'],
            authenticityScore: p.auth,
            authenticityReasons: p.auth >= 7 ? ['Specific named clients', 'Consistent answers', 'Website matches'] : ['Some vague answers'],
            redFlags: p.flags,
            summary: `${p.name} from ${p.area}, ${p.years ?? 'unknown'} years in business. GST: ${p.gst}.`,
            evidence: [{ field: 'gst', quote: p.gst === 'yes' ? 'Haan, GST registered hai.' : 'GST abhi nahi hai.' }],
        };
    }
    return {};
}

export function mockExaSearch(query: string) {
    // Two pages: a directory page with several vendors, and one vendor website. Duplicates on purpose.
    const dir = MOCK_PROFILES.slice(0, 4).map((p) => ({
        name: p.name, phones: [p.phone.replace('+91', '0')], address: `${p.area}, Mumbai`, area: p.area, city: 'Mumbai',
        website: p.website, sells: 'False ceiling and gypsum work', yearsInBusiness: p.years, relevance: 8,
    }));
    const site: Record<string, unknown>[] = MOCK_PROFILES.slice(3).map((p) => ({
        name: p.name, phones: [p.phone], address: `${p.area}, Mumbai`, area: p.area, city: 'Mumbai',
        website: p.website, sells: 'POP and gypsum ceilings', yearsInBusiness: null, relevance: 7,
    }));
    site.push({ name: 'Random Plumbing Co', phones: ['+919999900000'], address: 'Thane', area: 'Thane', city: 'Thane', website: '', sells: 'Plumbing', yearsInBusiness: null, relevance: 1 });
    return [
        { url: `https://www.justdial.com/mock/${encodeURIComponent(query)}`, title: 'False ceiling contractors in Lower Parel', text: 'MOCKVENDORS:' + JSON.stringify({ vendors: dir }) },
        { url: `https://example-vendor-site.in/${encodeURIComponent(query)}`, title: 'Ceiling contractors Mumbai', text: 'MOCKVENDORS:' + JSON.stringify({ vendors: site }) },
    ];
}

// ---------- Bolna ----------

const batches = new Map<string, { rows: Record<string, string>[]; ran: boolean }>();

function parseCsv(csv: string): Record<string, string>[] {
    const [head, ...lines] = csv.trim().split('\n');
    const cols = head.split(',');
    return lines.map((line) => {
        const cells: string[] = [];
        let cur = '';
        let q = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (q) {
                if (ch === '"' && line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else if (ch === '"') q = false;
                else cur += ch;
            } else if (ch === '"') q = true;
            else if (ch === ',') {
                cells.push(cur);
                cur = '';
            } else cur += ch;
        }
        cells.push(cur);
        return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
    });
}

export const mockBolna = {
    createBatch(csv: string) {
        const id = 'mockbatch' + Math.random().toString(16).slice(2, 10);
        batches.set(id, { rows: parseCsv(csv), ran: false });
        return id;
    },
    getBatch(id: string) {
        return { status: batches.get(id)?.ran ? 'completed' : 'scheduled' };
    },
    listExecutions(batchId: string): Record<string, unknown>[] {
        const b = batches.get(batchId);
        if (!b) return [];
        b.ran = true;
        return b.rows.map((row, i) => {
            const p = MOCK_PROFILES.find((x) => x.phone === row.contact_number);
            const reached = p?.reached ?? false;
            return {
                id: `exec-${batchId}-${i}`,
                batch_id: batchId,
                status: reached ? 'completed' : 'no-answer',
                conversation_duration: reached ? 150 : 0,
                transcript: reached
                    ? `assistant: Hello, am I speaking with ${row.vendor_name}?\nuser: Haan ji, ${row.vendor_name} bol raha hoon.\nassistant: Is your business GST registered?\nuser: ${p?.gst === 'no' ? 'Nahi, abhi GST nahi hai.' : 'Yes, we are GST registered.'}\nuser: We have done work for ${(p?.clients ?? []).join(', ') || 'many people'}.`
                    : '',
                summary: reached ? `Spoke with ${row.vendor_name}.` : null,
                extracted_data: reached ? { gst_registered: p?.gst } : null,
                context_details: { recipient_data: row },
                telephony_data: { to_number: row.contact_number, recording_url: reached ? 'https://example.com/rec.mp3' : '' },
                batch_run_details: { retried: 0 },
                created_at: new Date().toISOString(),
            };
        });
    },
};

// ---------- WhatsApp ----------

export const mockWhatsapp = {
    sent: [] as { to: string; template: string; params: string[] }[],
    sendTemplate(to: string, template: string, params: string[]) {
        this.sent.push({ to, template, params });
        return { ok: true };
    },
};
