/**
 * migrate-leads.js — precision importer for "Performance Marketing Leads (1).xlsx"
 *
 * Reads the BD workbook sheet-by-sheet, normalises the messy real-world data
 * (dual phone numbers, float artifacts, ordinal/typo dates, per-rep status
 * variants), tags every lead with city + campaign + channel + cohort, and
 * parses the reverse-chron "Update" log into individual dated activity rows.
 *
 * SAFE BY DEFAULT: runs a DRY RUN and writes nothing unless you pass --commit.
 *
 *   node scripts/migrate-leads.js --org=<ORG_UUID>            # dry run (preview)
 *   node scripts/migrate-leads.js --org=<ORG_UUID> --commit   # actually write
 *
 * Optional:
 *   --file="Performance Marketing Leads (1).xlsx"   (default; relative to cwd)
 *   --user=<USER_UUID>   created_by override (default: first bd_admin/org_admin of org)
 *   --new-only           skip the "(Old)" sheets
 */

const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
try { require('dotenv').config({ path: path.join(process.cwd(), '.env.local') }); } catch {}

// ── connection ────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xvucakstcmtfoanmgcql.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) { console.error('✗ SUPABASE_SERVICE_ROLE_KEY missing (set it in .env.local)'); process.exit(1); }
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── args ────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const COMMIT = !!args.commit;
const ORG_ID = args.org;
const NEW_ONLY = !!args['new-only'];
const FILE = args.file || 'Performance Marketing Leads (1).xlsx';
if (!ORG_ID) { console.error('✗ --org=<ORG_UUID> is required'); process.exit(1); }

// ── sheet → market metadata ───────────────────────────────────────────────────
const SHEET_META = {
    'Lower Parel (New) - Meta':      { city: 'Mumbai',        campaign: 'Lower Parel', channel: 'Meta Lead Ads', cohort: 'New' },
    'Lower Parel (New) - LinkedIn':  { city: 'Mumbai',        campaign: 'Lower Parel', channel: 'LinkedIn',      cohort: 'New' },
    'Kalyan Meta ':                  { city: 'Mumbai',        campaign: 'Kalyan',      channel: 'Meta Lead Ads', cohort: 'New' },
    'Andheri (New) - LinkedIn':      { city: 'Mumbai',        campaign: 'Andheri',     channel: 'LinkedIn',      cohort: 'New' },
    'Andheri (New) - Meta':          { city: 'Mumbai',        campaign: 'Andheri',     channel: 'Meta Lead Ads', cohort: 'New' },
    'F1 Skymark (Noida) - LinkedIn': { city: 'Delhi & Noida', campaign: 'F1 Skymark',  channel: 'LinkedIn',      cohort: 'New' },
    'Bangalore - Meta':              { city: 'Bangalore',     campaign: 'Bangalore',   channel: 'Meta Lead Ads', cohort: 'New' },
    // The "(Old)" sheets carry junk headers (A,B,C…) at row 3 and real labels at
    // row 4 (Who's Handling / Phone number / Interaction Log …). Those labels are
    // in HEADER_ALIAS, so detectHeader() finds row 4 automatically. Lower Parel
    // (Old) also has an UNHEADERED temperature column — handled by content scan.
    'Lower Parel (Old)': { city: 'Mumbai', campaign: 'Lower Parel', channel: 'Other', cohort: 'Old' },
    'Andheri (Old)':      { city: 'Mumbai', campaign: 'Andheri',     channel: 'Other', cohort: 'Old' },
};

// Lower Parel (Old) keeps the Hot/Warm/Cold temperature in an unheadered column.
const TEMP_RE = /^(hot|warm|cold)(\s*lead)?\.?$/i;

// ── header aliases → canonical field ────────────────────────────────────────────
const HEADER_ALIAS = {
    'location': 'location', 'date': 'date', 'handled by': 'handled_by',
    'first name': 'first_name', 'last name': 'last_name',
    'contact number': 'contact_number', 'phone': 'contact_number', 'mobile': 'contact_number',
    'email id': 'email', 'email': 'email', 'designation': 'designation',
    'company name': 'company', 'company': 'company', 'requirement': 'requirement',
    'mail sent': 'mail_sent', 'status': 'status', 'inventory': 'inventory', 'update': 'update',
    // "(Old)"-sheet / alternate labels
    "who's handling": 'handled_by', 'whos handling': 'handled_by',
    'phone number': 'contact_number', 'email id ': 'email',
    'requirements/notes': 'requirement', 'requirement/notes': 'requirement',
    'interaction log': 'update', 'seats requested (numeric)': 'seats',
    'move-in timeline': 'timeline', 'next follow up date': 'followup',
    'campaign name': 'campaign_cell', 'visit status': 'visit_status', 'lead type': 'inventory',
};

// ── status canon: raw (lowercased) → canonical CRM status name ──────────────────
const STATUS_CANON = [
    [/won|closed won|booked|deal done/, 'Won'],
    [/lost|not interested|declined/, 'Lost'],
    [/drop/, 'Dropped'],
    [/hot/, 'Hot Lead'],
    [/warm/, 'Warm Lead'],
    [/cold/, 'Cold Lead'],
    [/not respons|not answer|no response|switch ?off|unreachable/, 'Not Responsive'],
    [/hold/, 'On Hold'],
    [/negotiat/, 'Negotiation'],
    [/proposal|commercial|quotation/, 'Proposal Shared'],
    [/site ?visit|visit/, 'Site Visit Scheduled'],
    [/meeting|meet/, 'Meeting Scheduled'],
    [/contact|spoke|reached/, 'Contacted'],
    [/none of the above|unqualified|junk/, 'Cold Lead'],
];
// statuses we may need to create that aren't in migration-1 defaults
const STATUS_FLAGS = {
    'Won': { is_won: true, is_terminal: true, color: '#22C55E' },
    'Lost': { is_lost: true, is_terminal: true, color: '#EF4444' },
    'Dropped': { is_lost: true, is_terminal: true, color: '#6B7280' },
    'Hot Lead': { color: '#EF4444' },
    'Warm Lead': { color: '#F97316' },
    'Cold Lead': { color: '#3B82F6' },
    'Not Responsive': { color: '#94A3B8' },
    'On Hold': { color: '#374151' },
};
const DEFAULT_STATUS = 'New Lead';

const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, april: 3, apirl: 3, may: 4, jun: 5, june: 5,
    jul: 6, july: 6, aug: 7, sep: 8, sept: 9, september: 8, oct: 9, nov: 10, dec: 11,
};

// ── normalisers ─────────────────────────────────────────────────────────────
function cleanStr(v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); }

function normalizePhones(raw) {
    if (raw == null) return { primary: null, secondary: null };
    let s = String(raw).trim();
    const parts = s.split(/[\/,;|]| or /i);
    const valid = [];
    for (let p of parts) {
        let d = p.replace(/\.0+$/, '').replace(/\D/g, '');   // strip float artifact + non-digits
        if (d.length > 10 && d.startsWith('91')) d = d.slice(-10);
        if (d.length > 10) d = d.slice(-10);
        if (d.length === 10) valid.push(d);
    }
    return { primary: valid[0] || null, secondary: valid[1] || null };
}

function parseDate(val, fallbackYear) {
    if (val == null || val === '') return null;
    if (val instanceof Date && !isNaN(val)) return val;
    let s = String(val).trim();
    // ISO / datetime
    const iso = new Date(s);
    if (/^\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(iso)) return iso;
    // "22nd May" / "25 Apirl" / "8th April 2026"
    const m = s.match(/(\d{1,2})\s*(?:st|nd|rd|th)?[ -]+([a-z]+)\.?(?:[ ,]+(\d{4}))?/i);
    if (m) {
        const day = parseInt(m[1], 10);
        const mon = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
        if (mon != null) return new Date(m[3] ? +m[3] : fallbackYear, mon, day);
    }
    // dd/mm/yyyy or dd-mm-yy
    const dmy = s.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
    if (dmy) {
        let y = +dmy[3]; if (y < 100) y += 2000;
        return new Date(y, +dmy[2] - 1, +dmy[1]);
    }
    return null;
}

function canonStatus(raw) {
    const s = cleanStr(raw).toLowerCase();
    if (!s) return DEFAULT_STATUS;
    for (const [re, name] of STATUS_CANON) if (re.test(s)) return name;
    return DEFAULT_STATUS;
}

function classifyActivity(text) {
    const t = text.toLowerCase();
    if (/site ?visit|visited|came for a visit/.test(t)) return 'site_visit';
    if (/meeting|met him|met her|virtual call/.test(t)) return 'meeting';
    if (/proposal|commercial|quotation|costing|deck|layout|inventory option/.test(t)) return 'proposal_sent';
    if (/\bmail\b|email|e-mail/.test(t)) return 'email_sent';
    if (/spoke|call|ringing|dropped a text|whatsapp|\bwp\b|switch|disconnect|declined|voice note|text/.test(t)) return 'call';
    return 'note_added';
}

// Split the reverse-chron "Update" blob into individual dated activities.
function parseUpdateLog(text, fallbackYear) {
    if (!text) return [];
    const s = String(text);
    const re = /(\d{1,2})\s*(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|april|apirl|may|jun|june|jul|july|aug|sep|sept|september|oct|nov|dec)[a-z]*\.?\s*[:\-]/gi;
    const marks = [];
    let m;
    while ((m = re.exec(s)) !== null) marks.push({ idx: m.index, end: re.lastIndex, day: +m[1], mon: MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)] });
    if (!marks.length) {
        // no dated markers — keep whole text as a single note
        const txt = cleanStr(s);
        return txt ? [{ date: null, type: 'note_added', description: txt }] : [];
    }
    const out = [];
    for (let i = 0; i < marks.length; i++) {
        const start = marks[i].end;
        const stop = i + 1 < marks.length ? marks[i + 1].idx : s.length;
        const body = cleanStr(s.slice(start, stop));
        const date = marks[i].mon != null ? new Date(fallbackYear, marks[i].mon, marks[i].day) : null;
        if (body) out.push({ date, type: classifyActivity(body), description: body });
    }
    return out;
}

// detect header columns for a sheet (row index of header + field→col map)
function detectHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 6); r++) {
        const map = {};
        rows[r].forEach((cell, c) => {
            const key = HEADER_ALIAS[cleanStr(cell).toLowerCase()];
            if (key) map[key] = c;
        });
        if ((map.first_name != null || map.contact_number != null) && map.update != null) return { headerRow: r, map };
        if ((map.first_name != null && map.contact_number != null)) return { headerRow: r, map };
    }
    return null;
}

// ── main ──────────────────────────────────────────────────────────────────────
(async () => {
    console.log(`\n${COMMIT ? '🟢 COMMIT' : '🔵 DRY RUN'}  org=${ORG_ID}  file="${FILE}"\n`);

    // resolve created_by
    let createdBy = args.user;
    if (!createdBy) {
        const { data } = await sb.from('organization_memberships')
            .select('user_id, role').eq('organization_id', ORG_ID).eq('is_active', true)
            .in('role', ['bd_admin', 'org_admin', 'org_super_admin']).limit(1);
        createdBy = data?.[0]?.user_id;
    }
    if (!createdBy) { console.error('✗ could not resolve a created_by user (pass --user=<uuid>)'); process.exit(1); }

    // load statuses (org + global)
    let { data: statusRows } = await sb.from('crm_lead_statuses').select('id, name, organization_id')
        .or(`organization_id.eq.${ORG_ID},organization_id.is.null`);
    const statusByName = new Map((statusRows || []).map(s => [s.name.toLowerCase(), s.id]));

    async function ensureStatus(name) {
        if (statusByName.has(name.toLowerCase())) return statusByName.get(name.toLowerCase());
        const flags = STATUS_FLAGS[name] || {};
        if (!COMMIT) { statusByName.set(name.toLowerCase(), `(new:${name})`); return statusByName.get(name.toLowerCase()); }
        const { data, error } = await sb.from('crm_lead_statuses').insert({
            name, organization_id: ORG_ID, color: flags.color || '#3B82F6',
            is_won: !!flags.is_won, is_lost: !!flags.is_lost, is_terminal: !!flags.is_terminal,
        }).select('id').single();
        if (error) throw error;
        statusByName.set(name.toLowerCase(), data.id);
        return data.id;
    }

    // load sources
    let { data: sourceRows } = await sb.from('crm_lead_sources').select('id, name')
        .or(`organization_id.eq.${ORG_ID},organization_id.is.null`);
    const sourceByName = new Map((sourceRows || []).map(s => [s.name.toLowerCase(), s.id]));
    async function ensureSource(name) {
        if (sourceByName.has(name.toLowerCase())) return sourceByName.get(name.toLowerCase());
        if (!COMMIT) { sourceByName.set(name.toLowerCase(), `(new:${name})`); return sourceByName.get(name.toLowerCase()); }
        const { data, error } = await sb.from('crm_lead_sources').insert({ name, organization_id: ORG_ID }).select('id').single();
        if (error) throw error;
        sourceByName.set(name.toLowerCase(), data.id);
        return data.id;
    }

    // ── Deterministic rep assignment ──────────────────────────────────────────
    // Explicit dictionary (NOT fuzzy) per the approved plan. Excel "Handled by"
    // value (lowercased, trimmed) -> roster email. Combos resolve to the primary.
    const NAME_TO_EMAIL = {
        'shravani': 'shravani.naik@worksquare.in',
        'shravni': 'shravani.naik@worksquare.in',                 // typo variant
        'shravni / saniel': 'shravani.naik@worksquare.in',        // combo -> primary
        'shravani & shubham': 'shravani.naik@worksquare.in',      // combo -> primary
        'shubham': 'shubham.gavali@worksquare.in',
        'harshini': 'harshini.ranganathan@autopilotoffices.com',
        'neha/madhvi': 'neha.kumari@worksquare.in',               // rep does the work
        'neha': 'neha.kumari@worksquare.in',
        'madhvi': 'madhvi.jain@worksquare.in',
    };
    // Empty "Handled by" -> assign by campaign. Kalyan has no roster owner -> null.
    const CAMPAIGN_TO_EMAIL = {
        'Lower Parel': 'shravani.naik@worksquare.in',
        'Andheri': 'shubham.gavali@worksquare.in',
        'Bangalore': 'harshini.ranganathan@autopilotoffices.com',
        'F1 Skymark': 'neha.kumari@worksquare.in',
        'Kalyan': null,
    };
    const MEHUL_EMAIL = 'mehul.kapadia@worksquare.in';

    // Resolve all roster emails -> user ids in one query.
    const allEmails = [...new Set([...Object.values(NAME_TO_EMAIL), ...Object.values(CAMPAIGN_TO_EMAIL).filter(Boolean), MEHUL_EMAIL])];
    const { data: rosterUsers } = await sb.from('users').select('id, email').in('email', allEmails);
    const idByEmail = new Map((rosterUsers || []).map(u => [u.email.toLowerCase(), u.id]));
    const emailById = new Map((rosterUsers || []).map(u => [u.id, u.email]));
    const MEHUL_ID = idByEmail.get(MEHUL_EMAIL) || createdBy;
    const missingRoster = allEmails.filter(e => !idByEmail.has(e.toLowerCase()));
    if (missingRoster.length) console.warn(`  ⚠ roster accounts not found yet (run create-bd-team.js first): ${missingRoster.join(', ')}`);

    // (handledBy raw, campaign) -> assigned user id (or null)
    function resolveRep(handledBy, campaign) {
        const key = cleanStr(handledBy).toLowerCase();
        let email = key ? NAME_TO_EMAIL[key] : CAMPAIGN_TO_EMAIL[campaign];
        if (email === undefined) email = null;          // unknown name -> unassigned (flagged)
        return email ? (idByEmail.get(email.toLowerCase()) || null) : null;
    }

    // existing phones for dedup
    const { data: existing } = await sb.from('crm_leads').select('contact_number').eq('organization_id', ORG_ID);
    const seenPhones = new Set((existing || []).map(e => (e.contact_number || '').replace(/\D/g, '').slice(-10)).filter(Boolean));

    // read workbook
    const wb = XLSX.readFile(path.join(process.cwd(), FILE), { cellDates: true });
    const stats = { sheets: [], statusDist: {}, assignDist: {}, unmatchedReps: new Set(), dateFails: 0, dupes: 0, totalLeads: 0, totalActivities: 0 };
    const toInsert = []; // { lead, activities }

    for (const sheetName of Object.keys(SHEET_META)) {
        if (NEW_ONLY && SHEET_META[sheetName].cohort === 'Old') continue;
        const ws = wb.Sheets[sheetName];
        if (!ws) { console.warn(`  ⚠ sheet not found: ${sheetName}`); continue; }
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null, blankrows: false });
        const meta = SHEET_META[sheetName];
        const det = detectHeader(rows);
        if (!det) { console.warn(`  ⚠ no header detected: ${sheetName}`); continue; }
        const { headerRow, map } = det;
        const sourceId = await ensureSource(meta.channel);
        let sheetCount = 0;

        for (let r = headerRow + 1; r < rows.length; r++) {
            const row = rows[r];
            const get = (k) => map[k] != null ? row[map[k]] : null;
            const first = cleanStr(get('first_name')), last = cleanStr(get('last_name'));
            const { primary, secondary } = normalizePhones(get('contact_number'));
            const company = cleanStr(get('company'));
            if (!first && !last && !primary && !company) continue;   // empty row

            // dedup by phone
            if (primary && seenPhones.has(primary)) { stats.dupes++; continue; }
            if (primary) seenPhones.add(primary);

            const fallbackYear = (parseDate(get('date'), 2026) || new Date(2026, 0, 1)).getFullYear();
            const createdDate = parseDate(get('date'), 2026);
            if (get('date') && !createdDate) stats.dateFails++;

            // status: prefer the mapped Status column; else the unheadered
            // Hot/Warm/Cold temperature column (Lower Parel Old); else default.
            let statusRaw = get('status');
            if (!cleanStr(statusRaw)) statusRaw = row.find(c => TEMP_RE.test(cleanStr(c))) || statusRaw;
            const statusName = canonStatus(statusRaw);
            stats.statusDist[statusName] = (stats.statusDist[statusName] || 0) + 1;
            const statusId = await ensureStatus(statusName);

            // rep assignment (explicit dictionary + campaign default)
            const handledBy = cleanStr(get('handled_by'));
            const repId = resolveRep(handledBy, meta.campaign);
            // "unmatched" = a name we have no dictionary entry for (NOT just a not-yet-created account)
            if (handledBy && NAME_TO_EMAIL[handledBy.toLowerCase()] === undefined) stats.unmatchedReps.add(handledBy);
            const ownerId = repId || MEHUL_ID;   // created_by must be non-null
            const assignLabel = repId ? (emailById.get(repId) || repId.slice(0, 8)) : `«unassigned» (${handledBy || meta.campaign})`;
            stats.assignDist[assignLabel] = (stats.assignDist[assignLabel] || 0) + 1;

            // activities from the Update log — attributed to the assigned rep (or Mehul)
            const activities = parseUpdateLog(get('update'), fallbackYear)
                .map(a => ({ ...a, user_id: ownerId }));
            const lastContacted = activities.map(a => a.date).filter(Boolean).sort((a, b) => b - a)[0] || null;

            const temp = statusName.toLowerCase();
            const priority = temp.includes('hot') ? 'High' : temp.includes('warm') ? 'Medium' : temp.includes('cold') ? 'Low' : 'Medium';

            const remarks = [
                cleanStr(get('designation')) && `Designation: ${cleanStr(get('designation'))}`,
                cleanStr(get('seats')) && `Seats requested: ${cleanStr(get('seats'))}`,
                cleanStr(get('timeline')) && `Move-in: ${cleanStr(get('timeline'))}`,
                cleanStr(get('inventory')) && `Inventory shown: ${cleanStr(get('inventory'))}`,
                cleanStr(get('visit_status')) && `Visit status: ${cleanStr(get('visit_status'))}`,
                secondary && `Alt phone: ${secondary}`,
                handledBy && !repId && `Handled by (unmatched): ${handledBy}`,
            ].filter(Boolean).join(' | ') || null;

            const followupDate = parseDate(get('followup'), fallbackYear);
            const reqParts = [cleanStr(get('requirement')), cleanStr(get('seats')) && !cleanStr(get('requirement')).match(/\d/) ? `${cleanStr(get('seats'))} seats` : ''].filter(Boolean);

            const lead = {
                organization_id: ORG_ID,
                created_by: ownerId,
                assigned_to: repId || null,
                contact_person: cleanStr([first, last].filter(Boolean).join(' ')) || null,
                company_name: company || null,
                contact_number: primary,
                email: cleanStr(get('email')).includes('@') ? cleanStr(get('email')) : null,
                location: cleanStr(get('location')) || meta.campaign,
                city: meta.city,
                campaign: meta.campaign,
                cohort: meta.cohort,
                requirement: reqParts.join(' — ') || null,
                lead_source: sourceId,
                status: statusId,
                priority,
                remarks,
                next_followup_date: followupDate ? followupDate.toISOString() : null,
                last_contacted: lastContacted ? lastContacted.toISOString() : null,
                created_at: (createdDate || new Date(2026, 0, 1)).toISOString(),
            };
            toInsert.push({ lead, activities });
            sheetCount++; stats.totalLeads++; stats.totalActivities += activities.length;
        }
        stats.sheets.push({ name: sheetName, count: sheetCount });
    }

    // ── report ──────────────────────────────────────────────────────────────
    console.log('── Per-sheet ───────────────────────────────');
    stats.sheets.forEach(s => console.log(`  ${s.name.padEnd(34)} ${s.count}`));
    console.log(`\n── Status distribution ─────────────────────`);
    Object.entries(stats.statusDist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(22)} ${v}`));
    console.log(`\n  Total leads:       ${stats.totalLeads}`);
    console.log(`  Total activities:  ${stats.totalActivities} (parsed from Update logs)`);
    console.log(`  Duplicates skipped:${stats.dupes}`);
    console.log(`  Date parse misses: ${stats.dateFails}`);
    console.log(`  Unmatched reps:    ${[...stats.unmatchedReps].join(', ') || '(none)'}`);
    console.log(`\n── Assignment (assigned_to) ────────────────`);
    Object.entries(stats.assignDist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));

    if (stats.totalLeads) {
        const ex = toInsert[0];
        console.log(`\n── Sample lead ─────────────────────────────`);
        console.log('  ', JSON.stringify({ ...ex.lead }, null, 0).slice(0, 600));
        console.log(`  activities (${ex.activities.length}):`);
        ex.activities.slice(0, 4).forEach(a => console.log(`    ${a.date ? a.date.toISOString().slice(0, 10) : '????-??-??'}  [${a.type}]  ${a.description.slice(0, 90)}`));
    }

    if (!COMMIT) {
        console.log(`\n🔵 DRY RUN complete — nothing written. Re-run with --commit to import.\n`);
        return;
    }

    // ── write ─────────────────────────────────────────────────────────────────
    console.log(`\n⏳ inserting ${stats.totalLeads} leads…`);
    let done = 0;
    for (const { lead, activities } of toInsert) {
        const { data, error } = await sb.from('crm_leads').insert(lead).select('id').single();
        if (error) { console.error(`  ✗ lead insert failed (${lead.contact_person}):`, error.message); continue; }
        const leadId = data.id;
        if (activities.length) {
            const rows = activities.map(a => ({
                lead_id: leadId, user_id: a.user_id, activity_type: a.type,
                description: a.description,
                metadata: a.date ? { source: 'excel_import', logged_at: a.date.toISOString() } : { source: 'excel_import' },
                created_at: (a.date || new Date(lead.created_at)).toISOString(),
            }));
            const { error: aErr } = await sb.from('crm_activity_log').insert(rows);
            if (aErr) console.error(`  ⚠ activities for ${leadId}:`, aErr.message);
        }
        if (++done % 25 === 0) console.log(`  …${done}/${stats.totalLeads}`);
    }
    console.log(`\n✅ imported ${done} leads + their activity timelines.\n`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
