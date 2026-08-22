export type UrgencyTier = 'P1' | 'P2' | 'P3' | 'COMPLETED';
export type TaskFrequency = 'daily' | 'weekly' | 'emergency' | 'monthly' | 'adhoc';
export type TaskCategory = 'utility_bill' | 'emergency_repair' | 'vendor_amc' | 'raw_material' | 'consumables' | 'contractor_milestone' | 'general_ops';
export type TaskStatus = 'pending_triage' | 'approved_for_payment' | 'in_progress' | 'dispatched' | 'paid' | 'deferred';

export interface TaskLineItem {
    id: string;
    task_code: string;
    title: string;
    description: string;
    property_id: string;
    property_name: string;
    category: TaskCategory;
    frequency: TaskFrequency;
    urgency_tier: UrgencyTier;
    tat_deadline: string; // ISO date string or 'Immediate' / '7 Days' / 'No SLA'
    tat_label: string; // e.g. "Immediate (< 24h)", "7 Days TAT", "Flexible (No SLA)"
    estimated_amount: number;
    vendor_name: string;
    vendor_invoice_ref?: string;
    requested_by_name: string;
    requested_by_email: string;
    requested_at: string;
    triaged_by_name?: string;
    triaged_by_email?: string;
    triaged_at?: string;
    triage_notes?: string;
    status: TaskStatus;
    payment_status: 'unpaid' | 'processing' | 'paid' | 'hold';
    proof_doc_url?: string;
    tags?: string[];
}

export const INITIAL_TEST_TASKS: TaskLineItem[] = [
    // --- P1: Immediate / <24h TAT ---
    {
        id: 'task-p1-001',
        task_code: 'PUT-0821-01',
        title: 'Emergency Diesel Generator Coolant & Filter Replacement',
        description: 'DG set 2 tripped due to coolant overheating at SS Plaza. Immediate replenishment required before peak working hours to avoid outage.',
        property_id: 'prop-ss-plaza',
        property_name: 'SS Plaza Tower A',
        category: 'emergency_repair',
        frequency: 'emergency',
        urgency_tier: 'P1',
        tat_deadline: '2026-08-22T10:00:00.000Z',
        tat_label: 'Immediate (< 24h)',
        estimated_amount: 48500,
        vendor_name: 'Sterling Powertech Solutions',
        vendor_invoice_ref: 'INV-ST-9921',
        requested_by_name: 'Rohan Sharma (Site MST)',
        requested_by_email: 'rohan.sharma@autopilotoffices.com',
        requested_at: '2026-08-21T09:15:00.000Z',
        triaged_by_name: 'Org Super Admin',
        triaged_by_email: 'superadmin@autopilotoffices.com',
        triaged_at: '2026-08-21T10:00:00.000Z',
        triage_notes: 'Classified P1: Critical uptime equipment. Release 50% advance immediately to vendor.',
        status: 'approved_for_payment',
        payment_status: 'processing',
        tags: ['Critical', 'DG Power', 'Advance Needed']
    },
    {
        id: 'task-p1-002',
        task_code: 'PUT-0821-02',
        title: 'Municipal Water Tanker Batch (3 Tankers 20KL)',
        description: 'Underground raw water reservoir at 18% capacity. Immediate refill needed for plumbing and HVAC chillers.',
        property_id: 'prop-cyber-city',
        property_name: 'Cyber City Hub 4',
        category: 'utility_bill',
        frequency: 'daily',
        urgency_tier: 'P1',
        tat_deadline: '2026-08-21T20:00:00.000Z',
        tat_label: 'Immediate (< 24h)',
        estimated_amount: 19200,
        vendor_name: 'AquaPure Tanker Logistics',
        vendor_invoice_ref: 'TANK-CY-4412',
        requested_by_name: 'Kavita Verma (Procurement)',
        requested_by_email: 'kavita.verma@autopilotoffices.com',
        requested_at: '2026-08-21T08:30:00.000Z',
        triaged_by_name: 'Org Super Admin',
        triaged_by_email: 'superadmin@autopilotoffices.com',
        triaged_at: '2026-08-21T09:00:00.000Z',
        triage_notes: 'P1 approved. Instant UPI/NEFT clearance authorized.',
        status: 'in_progress',
        payment_status: 'processing',
        tags: ['Water', 'Daily Requirement']
    },
    {
        id: 'task-p1-003',
        task_code: 'PUT-0821-03',
        title: 'Server Room Precision AC Gas Leakage Fix',
        description: 'Server room PAC unit 1 throwing low suction pressure error. Temperature rising above 26°C.',
        property_id: 'prop-golf-course',
        property_name: 'Golf Course One',
        category: 'emergency_repair',
        frequency: 'emergency',
        urgency_tier: 'P1',
        tat_deadline: '2026-08-22T06:00:00.000Z',
        tat_label: 'Immediate (< 24h)',
        estimated_amount: 32000,
        vendor_name: 'Voltas Facility Care Ltd',
        vendor_invoice_ref: 'PAC-88402',
        requested_by_name: 'Manish Joshi (IT Lead)',
        requested_by_email: 'manish.joshi@autopilotoffices.com',
        requested_at: '2026-08-21T11:45:00.000Z',
        triaged_by_name: 'Org Super Admin',
        triaged_by_email: 'superadmin@autopilotoffices.com',
        triaged_at: '2026-08-21T12:10:00.000Z',
        triage_notes: 'P1 emergency. Release PO and dispatch technician on site.',
        status: 'approved_for_payment',
        payment_status: 'unpaid',
        tags: ['Server Room', 'HVAC', 'SLA 4h']
    },

    // --- P2: 7 Days TAT ---
    {
        id: 'task-p2-001',
        task_code: 'PUT-0821-04',
        title: 'Weekly Housekeeping & Hygiene Consumables Restock',
        description: 'Bulk order for microfiber mops, hand sanitizers, taski chemicals, and paper rolls for all floors.',
        property_id: 'prop-ss-plaza',
        property_name: 'SS Plaza Tower A',
        category: 'consumables',
        frequency: 'weekly',
        urgency_tier: 'P2',
        tat_deadline: '2026-08-28T18:00:00.000Z',
        tat_label: '7 Days TAT',
        estimated_amount: 86400,
        vendor_name: 'Diversey Hygiene Supplies',
        vendor_invoice_ref: 'DIV-WK-3401',
        requested_by_name: 'Aakash Gupta (Soft Services)',
        requested_by_email: 'aakash.gupta@autopilotoffices.com',
        requested_at: '2026-08-21T07:30:00.000Z',
        triaged_by_name: 'Org Super Admin',
        triaged_by_email: 'superadmin@autopilotoffices.com',
        triaged_at: '2026-08-21T09:30:00.000Z',
        triage_notes: 'P2: Standard weekly delivery schedule. Consolidate with Golf Course order for 5% bulk discount.',
        status: 'in_progress',
        payment_status: 'unpaid',
        tags: ['Weekly Cycle', 'Housekeeping']
    },
    {
        id: 'task-p2-002',
        task_code: 'PUT-0821-05',
        title: 'Monthly Lift AMC Maintenance Bill (Otis)',
        description: 'Comprehensive quarterly preventive maintenance and inspection certification for 6 passenger elevators.',
        property_id: 'prop-cyber-city',
        property_name: 'Cyber City Hub 4',
        category: 'vendor_amc',
        frequency: 'monthly',
        urgency_tier: 'P2',
        tat_deadline: '2026-08-27T18:00:00.000Z',
        tat_label: '7 Days TAT',
        estimated_amount: 145000,
        vendor_name: 'Otis Elevator India Co',
        vendor_invoice_ref: 'OTIS-Q3-1092',
        requested_by_name: 'Deepak Rao (Procurement)',
        requested_by_email: 'deepak.rao@autopilotoffices.com',
        requested_at: '2026-08-20T14:20:00.000Z',
        triaged_by_name: 'Org Super Admin',
        triaged_by_email: 'superadmin@autopilotoffices.com',
        triaged_at: '2026-08-21T08:45:00.000Z',
        triage_notes: 'P2: Verified service log sheets. Clear within net-7 vendor cycle.',
        status: 'approved_for_payment',
        payment_status: 'unpaid',
        tags: ['Elevator AMC', 'Contractual']
    },
    {
        id: 'task-p2-003',
        task_code: 'PUT-0821-06',
        title: 'Cafeteria RO Water Filter Membrane Replacement',
        description: 'TDS levels in 4th floor cafeteria RO unit rising to 280 ppm. Replace sediment filters & RO membrane.',
        property_id: 'prop-omr',
        property_name: 'OMR Tech Park Chennai',
        category: 'raw_material',
        frequency: 'weekly',
        urgency_tier: 'P2',
        tat_deadline: '2026-08-26T18:00:00.000Z',
        tat_label: '7 Days TAT',
        estimated_amount: 28900,
        vendor_name: 'Kent RO Commercial Systems',
        vendor_invoice_ref: 'KNT-RO-7721',
        requested_by_name: 'Suresh Kumar (Facility Mgr)',
        requested_by_email: 'suresh.kumar@autopilotoffices.com',
        requested_at: '2026-08-20T16:00:00.000Z',
        triaged_by_name: 'Org Super Admin',
        triaged_by_email: 'superadmin@autopilotoffices.com',
        triaged_at: '2026-08-21T10:15:00.000Z',
        triage_notes: 'P2 approved. Ensure service technician arrives before Wednesday.',
        status: 'in_progress',
        payment_status: 'unpaid',
        tags: ['RO Water', 'Soft Services']
    },

    // --- P3: Flexible / No SLA ---
    {
        id: 'task-p3-001',
        task_code: 'PUT-0821-07',
        title: 'Lounge Area Ergonomic Chairs Refurbishment & Re-upholstery',
        description: 'Aesthetic re-cushioning and fabric touch up for 14 breakout armchairs in ground floor visitor lounge.',
        property_id: 'prop-golf-course',
        property_name: 'Golf Course One',
        category: 'general_ops',
        frequency: 'adhoc',
        urgency_tier: 'P3',
        tat_deadline: 'Flexible (No SLA)',
        tat_label: 'Flexible (No SLA)',
        estimated_amount: 54000,
        vendor_name: 'Featherlite Seating Care',
        vendor_invoice_ref: 'FL-UPH-550',
        requested_by_name: 'Ananya Roy (Community Lead)',
        requested_by_email: 'ananya.roy@autopilotoffices.com',
        requested_at: '2026-08-19T11:00:00.000Z',
        triaged_by_name: 'Org Super Admin',
        triaged_by_email: 'superadmin@autopilotoffices.com',
        triaged_at: '2026-08-21T11:00:00.000Z',
        triage_notes: 'P3: Non-urgent aesthetic upgrade. Place on hold until next month capex review.',
        status: 'pending_triage',
        payment_status: 'hold',
        tags: ['Furniture', 'Discretionary']
    },
    {
        id: 'task-p3-002',
        task_code: 'PUT-0821-08',
        title: 'Outdoor Garden Planter Pots & Seasonal Botanical Plantation',
        description: 'Quarterly landscape replenishment with 50 ornamental shrubs and terracotta planters for entrance driveway.',
        property_id: 'prop-ss-plaza',
        property_name: 'SS Plaza Tower A',
        category: 'general_ops',
        frequency: 'monthly',
        urgency_tier: 'P3',
        tat_deadline: 'Flexible (No SLA)',
        tat_label: 'Flexible (No SLA)',
        estimated_amount: 38000,
        vendor_name: 'GreenEarth Landscape Nursery',
        vendor_invoice_ref: 'GEN-Q3-09',
        requested_by_name: 'Vikas Mehra (Horticulture)',
        requested_by_email: 'vikas.mehra@autopilotoffices.com',
        requested_at: '2026-08-18T15:30:00.000Z',
        triaged_by_name: 'Org Super Admin',
        triaged_by_email: 'superadmin@autopilotoffices.com',
        triaged_at: '2026-08-20T17:00:00.000Z',
        triage_notes: 'P3: Can wait for seasonal monsoon window.',
        status: 'deferred',
        payment_status: 'unpaid',
        tags: ['Landscaping', 'Flexible']
    },
    {
        id: 'task-p3-003',
        task_code: 'PUT-0821-09',
        title: 'Meeting Room Wall Acoustic Foam Panels & Cable Organizers',
        description: 'Supplementary soundproofing dampening foam tiles for Pod 4 & 5 video conferencing rooms.',
        property_id: 'prop-cyber-city',
        property_name: 'Cyber City Hub 4',
        category: 'raw_material',
        frequency: 'adhoc',
        urgency_tier: 'P3',
        tat_deadline: 'Flexible (No SLA)',
        tat_label: 'Flexible (No SLA)',
        estimated_amount: 22500,
        vendor_name: 'AcousticPro Solutions',
        vendor_invoice_ref: 'AP-55201',
        requested_by_name: 'Rajat Verma (Audio/Visual Lead)',
        requested_by_email: 'rajat.verma@autopilotoffices.com',
        requested_at: '2026-08-17T12:00:00.000Z',
        triaged_by_name: 'Org Super Admin',
        triaged_by_email: 'superadmin@autopilotoffices.com',
        triaged_at: '2026-08-20T10:00:00.000Z',
        triage_notes: 'P3: Low priority acoustic padding.',
        status: 'pending_triage',
        payment_status: 'unpaid',
        tags: ['Meeting Rooms', 'AV Acoustics']
    },

    // --- COMPLETED ---
    {
        id: 'task-done-001',
        task_code: 'PUT-0820-10',
        title: 'Main Incomer Transformer HT Oil Filtration & Testing',
        description: 'Annual mandatory statutory testing and dielectric strength filtration for 1500kVA transformer.',
        property_id: 'prop-ss-plaza',
        property_name: 'SS Plaza Tower A',
        category: 'vendor_amc',
        frequency: 'emergency',
        urgency_tier: 'COMPLETED',
        tat_deadline: '2026-08-20T18:00:00.000Z',
        tat_label: 'Executed',
        estimated_amount: 62000,
        vendor_name: 'Schneider Electric Engineering',
        vendor_invoice_ref: 'SE-HT-8812',
        requested_by_name: 'Rohan Sharma (Site MST)',
        requested_by_email: 'rohan.sharma@autopilotoffices.com',
        requested_at: '2026-08-19T08:00:00.000Z',
        triaged_by_name: 'Org Super Admin',
        triaged_by_email: 'superadmin@autopilotoffices.com',
        triaged_at: '2026-08-19T09:30:00.000Z',
        triage_notes: 'P1 approved, payment cleared via RTGS, work completed successfully.',
        status: 'paid',
        payment_status: 'paid',
        tags: ['Electrical HT', 'Statutory', 'Done']
    }
];

export const TEST_PROPERTIES = [
    { id: 'all', name: 'All Properties' },
    { id: 'prop-ss-plaza', name: 'SS Plaza Tower A (Gurugram)' },
    { id: 'prop-cyber-city', name: 'Cyber City Hub 4 (Gurugram)' },
    { id: 'prop-golf-course', name: 'Golf Course One (Gurugram)' },
    { id: 'prop-omr', name: 'OMR Tech Park (Chennai)' }
];
