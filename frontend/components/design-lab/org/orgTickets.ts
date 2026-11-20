import { SAMPLE_NOW } from '../lab/sample';
import type { LabTicket, Priority, TicketStatus } from '../lab/types';

/**
 * Org wide tickets for the org super admin app.
 *
 * LIVE: the existing GET /api/tickets with propertyId=all and the org id, mapped by the lab's
 * own row mapper (useOrgModel wires it). SAMPLE: the set below, built to agree with the org
 * sample: 63 active tickets split by site as the scorecard says (21, 9, 15, 12, 6), 8 urgent
 * or critical, 7 past SLA, plus two on the waitlist and six resolved today. The four
 * escalated tickets match the Escalations approval queue.
 */

export interface OrgTicketRow extends LabTicket {
    site: string;
}

/** Technicians the sample assigns work to, by skill. */
export const ORG_TECHS = [
    { name: 'Ravi Kumar', skill: 'HVAC', shift: 'on_a_ticket' as const },
    { name: 'Amar S.', skill: 'Electrical', shift: 'free' as const },
    { name: 'Manju A.', skill: 'Plumbing', shift: 'on_a_ticket' as const },
    { name: 'Suresh N.', skill: 'Security', shift: 'free' as const },
    { name: 'Imran P.', skill: 'MST', shift: 'free' as const },
    { name: 'Kavya D.', skill: 'Housekeeping', shift: 'on_a_ticket' as const },
    { name: 'Deepak R.', skill: 'Lift', shift: 'off_shift' as const },
];

export const TICKET_CATEGORIES = ['HVAC', 'Electrical', 'Plumbing', 'Housekeeping', 'Lift', 'Security', 'Civil', 'IT'];

const TECH_FOR: Record<string, string> = {
    HVAC: 'Ravi Kumar', Electrical: 'Amar S.', Plumbing: 'Manju A.', Housekeeping: 'Kavya D.', Lift: 'Deepak R.', Security: 'Suresh N.', Civil: 'Imran P.', IT: 'Imran P.',
};

/** Hours to resolve, by priority. */
export const SLA_HOURS: Record<Priority, number> = { critical: 4, urgent: 6, high: 12, medium: 24, low: 48 };

const POOL: [string, string, string][] = [
    ['AC not cooling in cabin', 'HVAC', 'Open office'], ['Lights flickering in corridor', 'Electrical', 'Corridor'],
    ['Tap leaking in pantry', 'Plumbing', 'Pantry'], ['Washroom needs cleaning', 'Housekeeping', 'Washroom'],
    ['Lift door closing slowly', 'Lift', 'Lift lobby'], ['Access card not working', 'Security', 'Reception'],
    ['Ceiling tile damaged', 'Civil', 'Conference Room 2'], ['Wi-Fi weak in meeting room', 'IT', 'Conference Room 1'],
    ['AHU making a loud noise', 'HVAC', 'Plant room'], ['Power socket dead at desk', 'Electrical', 'Open office'],
    ['Flush not working', 'Plumbing', 'Washroom'], ['Spill in the lobby', 'Housekeeping', 'Lobby'],
    ['Door handle broken', 'Civil', 'Meeting room'], ['CCTV camera offline', 'Security', 'Parking'],
    ['Thermostat not responding', 'HVAC', 'Cabin 4'], ['UPS alarm beeping', 'Electrical', 'Server room'],
    ['Low water pressure', 'Plumbing', 'Washroom'], ['Dustbins overflowing', 'Housekeeping', 'Cafeteria'],
    ['Lift stopping between floors', 'Lift', 'Lift 2'], ['Emergency light not working', 'Electrical', 'Stairwell'],
    ['Drain blocked', 'Plumbing', 'Pantry'], ['Pantry floor sticky', 'Housekeeping', 'Pantry'],
    ['Chilled water drip above ceiling', 'HVAC', 'Corridor'], ['Glass door not locking', 'Security', 'Entrance'],
];

const RAISERS = ['Rohan Shah', 'Meera Pillai', 'Ankit Jain', 'Neha Rao', 'Front desk', 'Vivek Menon', 'Facility team', 'Security desk'];
const COMPANIES = ['Northwind Labs', 'Globex', 'Initech', 'Facility team', 'Umbrella Corp', null];

const now = SAMPLE_NOW.getTime();
const minAgo = (m: number) => new Date(now - m * 60_000);

function ticket(p: Omit<OrgTicketRow, 'raisedAt' | 'company' | 'resolvedAt' | 'escalationLevel' | 'escalations' | 'photoBefore' | 'hasMaterialRequest' | 'source' | 'slaDue' | 'slaHours' | 'description'> & {
    ageMin: number; company?: string | null; description?: string | null; escalatedMinAgo?: number; noSla?: boolean; resolvedMinAgo?: number; material?: boolean;
}): OrgTicketRow {
    const { ageMin, escalatedMinAgo, noSla, resolvedMinAgo, material, ...rest } = p;
    const slaHours = noSla ? null : SLA_HOURS[p.priority];
    return {
        ...rest,
        raisedAt: minAgo(ageMin),
        company: p.company ?? null,
        description: p.description ?? null,
        slaHours,
        slaDue: slaHours === null ? null : minAgo(ageMin - slaHours * 60),
        resolvedAt: resolvedMinAgo !== undefined ? minAgo(resolvedMinAgo) : null,
        escalationLevel: escalatedMinAgo !== undefined ? 1 : 0,
        escalations: escalatedMinAgo !== undefined ? [{ at: minAgo(escalatedMinAgo), to: 'You' }] : [],
        photoBefore: null,
        hasMaterialRequest: !!material,
        source: 'sample',
    };
}

/** The four escalated tickets, matching the Escalations queue: hours past SLA as there. */
const ESCALATED: OrgTicketRow[] = [
    ticket({ id: 'tkt-148', number: 'TKT-148', title: 'AC not cooling in Conference Room 3', site: 'SS Plaza Tower A', location: 'Level 2, Conference Room 3', category: 'HVAC', priority: 'high', status: 'assigned', assignee: 'Ravi Kumar', raisedBy: 'Rohan Shah', company: 'Northwind Labs', ageMin: (12 + 3) * 60, escalatedMinAgo: 50,
        description: 'The AC is running but blowing warm air. The room reads 27°C and there is a client meeting at 11 AM.' }),
    ticket({ id: 'tkt-131', number: 'TKT-131', title: 'Basement exhaust fan not running', site: 'Metro Hub', location: 'Basement parking', category: 'Electrical', priority: 'urgent', status: 'in_progress', assignee: 'Amar S.', raisedBy: 'Facility team', ageMin: (6 + 26) * 60, escalatedMinAgo: 20 * 60,
        description: 'Exhaust fan 2 tripped overnight. CO levels are fine but rising near ramp B.' }),
    ticket({ id: 'tkt-151', number: 'TKT-151', title: 'Water leak near 2nd floor washroom', site: 'Harbour Point', location: 'Level 2, washroom', category: 'Plumbing', priority: 'critical', status: 'open', assignee: null, raisedBy: 'Meera Pillai', company: 'Globex', ageMin: (4 + 2) * 60, escalatedMinAgo: 35,
        description: 'Water seeping under the washroom door into the corridor. Wet floor sign placed.' }),
    ticket({ id: 'tkt-144', number: 'TKT-144', title: 'Parking boom barrier stuck open', site: 'Lakeside One', location: 'Basement entry', category: 'Security', priority: 'high', status: 'assigned', assignee: 'Suresh N.', raisedBy: 'Security desk', ageMin: (12 + 5) * 60, escalatedMinAgo: 22 * 60,
        description: 'Barrier arm stays up after the last car. A guard is checking vehicles by hand.' }),
];

const WAITING: OrgTicketRow[] = [
    ticket({ id: 'tkt-098', number: 'TKT-098', title: 'Lift B making grinding noise', site: 'Metro Hub', location: 'Lift B', category: 'Lift', priority: 'high', status: 'waitlist', assignee: 'Deepak R.', raisedBy: 'Facility team', ageMin: 11 * 24 * 60, noSla: true, material: true,
        description: 'Gearbox wear confirmed by Otis. Waiting for parts on PO-2236. Lift B is out of service until then.' }),
    ticket({ id: 'tkt-109', number: 'TKT-109', title: 'Cracked glass panel, Level 5', site: 'Lakeside One', location: 'Level 5, east wing', category: 'Civil', priority: 'medium', status: 'waitlist', assignee: 'Imran P.', raisedBy: 'Neha Rao', ageMin: 4 * 24 * 60, noSla: true,
        description: 'Taped and cordoned. Waiting for the glass vendor to cut a replacement.' }),
];

/** Active tickets per site, with how many are urgent or critical and how many are past SLA. */
const SITES: { name: string; active: number; urgent: number; breached: number }[] = [
    { name: 'Harbour Point', active: 21, urgent: 4, breached: 3 },
    { name: 'SS Plaza Tower B', active: 9, urgent: 3, breached: 1 },
    { name: 'Metro Hub', active: 15, urgent: 1, breached: 1 },
    { name: 'SS Plaza Tower A', active: 12, urgent: 0, breached: 1 },
    { name: 'Lakeside One', active: 6, urgent: 0, breached: 1 },
];

const STATUS_CYCLE: TicketStatus[] = ['open', 'in_progress', 'assigned', 'in_progress', 'open', 'assigned', 'in_progress', 'open'];
const CALM: Priority[] = ['medium', 'high', 'medium', 'low', 'medium', 'high', 'medium', 'low'];

function generate(): OrgTicketRow[] {
    const out: OrgTicketRow[] = [];
    let i = 0;
    for (const s of SITES) {
        const fixed = ESCALATED.filter(t => t.site === s.name);
        out.push(...fixed);
        let urgentLeft = s.urgent - fixed.filter(t => t.priority === 'critical' || t.priority === 'urgent').length;
        let breachLeft = s.breached - fixed.length;
        for (let k = fixed.length; k < s.active; k++, i++) {
            const [title, category, area] = POOL[(i * 7) % POOL.length];
            const priority: Priority = urgentLeft > 0 ? (urgentLeft-- % 2 === 0 ? 'urgent' : 'critical') : CALM[i % CALM.length];
            const breached = breachLeft > 0 && (priority === 'urgent' || priority === 'critical' || urgentLeft <= 0);
            if (breached) breachLeft--;
            const window = SLA_HOURS[priority] * 60;
            const ageMin = breached ? window + 25 + ((i * 41) % 180) : Math.max(8, Math.min(window - 25, 12 + ((i * 97) % (window - 30))));
            const status = STATUS_CYCLE[i % STATUS_CYCLE.length];
            out.push(ticket({
                id: `tkt-${300 + i}`, number: `TKT-${300 + i}`, title, site: s.name, location: `Floor ${(i * 3) % 9 + 1}, ${area}`, category, priority, status,
                assignee: status === 'open' ? null : TECH_FOR[category], raisedBy: RAISERS[i % RAISERS.length], company: COMPANIES[i % COMPANIES.length], ageMin,
            }));
        }
    }
    // Resolved earlier today, one or two per site.
    for (let k = 0; k < 6; k++, i++) {
        const [title, category, area] = POOL[(i * 5) % POOL.length];
        out.push(ticket({
            id: `tkt-${300 + i}`, number: `TKT-${300 + i}`, title, site: SITES[k % SITES.length].name, location: `Floor ${(i * 2) % 9 + 1}, ${area}`, category,
            priority: CALM[k], status: 'resolved', assignee: TECH_FOR[category], raisedBy: RAISERS[k], ageMin: 300 + k * 40, resolvedMinAgo: 30 + k * 25,
        }));
    }
    return [...out, ...WAITING];
}

export const ORG_SAMPLE_TICKETS: OrgTicketRow[] = generate();
