/**
 * Demo seed — electrical contractors for commercial / office buildings, Mumbai region.
 *
 * PROVENANCE: gathered from public company websites via web search on 2026-08-25.
 * These are REAL businesses with REAL numbers. Nothing here has been contacted.
 *
 * Before Ira calls anyone:
 *   1. A human verifies each number is current and correct.
 *   2. Confirm outbound-calling consent/DLT posture for cold B2B calls.
 *   3. Start with ONE vendor, listen to the recording, then widen.
 *
 * This file exists so the pipeline has data today without a search API key.
 * Replace `getSeedVendors()` with a live search call once TAVILY_API_KEY (or
 * equivalent) is set — the shape below is what the search step should return.
 */

export interface VendorLead {
    id: string;
    name: string;
    trade: string;
    city: string;
    phone: string | null;
    email: string | null;
    website: string;
    note: string;
    /** Where this lead came from — shown to the team, and read by Ira on the call. */
    source: string;
    /** Human has eyeballed the number. Ira must not call until this is true. */
    verified: boolean;
}

export const SEED_VENDORS: VendorLead[] = [
    {
        id: 'v-powertrack',
        name: 'Power Track System Pvt. Ltd.',
        trade: 'Electrical contracting — commercial, IT parks, data centres',
        city: 'Rabale, Navi Mumbai',
        phone: '+919322652197',
        email: 'info@powertracksystem.com',
        website: 'https://powertracksystem.com',
        note: 'ISO certified, government licensed, CPRI approved panel manufacturing. 25+ yrs. HT/LT/LV. Located in Rabale — same locality as our own site.',
        source: 'company website',
        verified: false,
    },
    {
        id: 'v-tanvi',
        name: 'Tanvi Engineering & Infra Pvt Ltd',
        trade: 'MEP — electrical, HVAC, ELV, interior fit-outs, AMC',
        city: 'Mumbai',
        phone: null,
        email: null,
        website: 'https://www.tanviengineerings.com',
        note: 'Corporate offices and IT parks, turnkey fit-outs, AMC services. Works with Mumbai & Pune Metro. Strongest fit for multi-service scope.',
        source: 'company website',
        verified: false,
    },
    {
        id: 'v-brid',
        name: 'Brid Electric Corporation',
        trade: 'Electrical contracting — commercial & corporate offices',
        city: 'Ghatkopar (E), Mumbai',
        phone: '+919820043376',
        email: null,
        website: 'https://bridelectric.com',
        note: 'Two decades in Mumbai. Office buildings, retail, commercial complexes. Landline 022-21024353.',
        source: 'company website',
        verified: false,
    },
    {
        id: 'v-intigreat',
        name: 'Intigreat Solutions',
        trade: 'Electrical contracting & panel manufacturing',
        city: 'Mumbai',
        phone: '+918108493978',
        email: null,
        website: 'https://intigreatsolutions.com',
        note: 'Building electrification, IBMS, fire detection, CCTV, data cabling. Serves corporates and MNCs. States 24h response.',
        source: 'company website',
        verified: false,
    },
    {
        id: 'v-kgn',
        name: 'KGN Electrical',
        trade: 'Commercial electrical works',
        city: 'Mumbai',
        phone: '+917021823540',
        email: 'kgnelectrical12@gmail.com',
        website: 'https://www.kgnelectricals.com',
        note: 'Office buildings, shops, factories. Smaller outfit — likely better for maintenance-scale work than projects.',
        source: 'company website',
        verified: false,
    },
    {
        id: 'v-svturnkey',
        name: 'SV Turnkey Projects Pvt Ltd',
        trade: 'Turnkey electrical — office & retail fit-outs',
        city: 'Andheri (E), Mumbai',
        phone: '+912226879989',
        email: null,
        website: 'https://svprojects.net.in',
        note: 'Design through commissioning. Explicitly lists office and retail fit-outs. Landline only.',
        source: 'company website',
        verified: false,
    },
    {
        id: 'v-thakkar',
        name: 'Thakkar Electricals',
        trade: 'Electrical consultancy & contracting',
        city: 'Mumbai',
        phone: null,
        email: null,
        website: 'https://thakkarelectricals.biz',
        note: 'Government licensed, founded 1996. Commercial/corporate, plus networking and office automation. Pan-India delivery.',
        source: 'company website',
        verified: false,
    },
    {
        id: 'v-konstelec',
        name: 'Konstelec Engineers Pvt Ltd',
        trade: 'EPC — electrical & instrumentation',
        city: 'Mumbai',
        phone: null,
        email: null,
        website: 'https://www.konstelec.com',
        note: 'Licensed contractor, two decades. Commercial complexes plus heavy industry. Likely oversized for routine site work — keep for projects.',
        source: 'company website',
        verified: false,
    },
];

export async function getSeedVendors(): Promise<VendorLead[]> {
    return SEED_VENDORS;
}

/** Only verified leads with a number are callable. Guard, not a filter. */
export function callable(vendors: VendorLead[]): VendorLead[] {
    return vendors.filter((v) => v.verified && !!v.phone);
}

/** Leads we can email today — cheaper and lower risk than calling. */
export function mailable(vendors: VendorLead[]): VendorLead[] {
    return vendors.filter((v) => !!v.email);
}
