/**
 * Seed script for Internal Audit Master Items
 * Contains the 35-point checklist for SS Plaza / General Facilities
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const organizationId = 'd8617f6c-843e-4f7d-8f2c-63b7848f0605'; // Example Org ID - change to user's org id

const auditPoints = [
    { si_no: 1, category: 'Fire Safety & HSE', requirement: 'Fire safety & Emergency response procedures and HSE Policy', spoc_name: 'Kiran', period: 'as on date' },
    { si_no: 2, category: 'Interior/Civil', requirement: 'List of existing CWIP for interior and civil work', spoc_name: 'Abhiram', period: 'as on date' },
    { si_no: 3, category: 'Budget', requirement: 'Annual Capex Budget', spoc_name: '', period: "Apr'25 to Mar'26" },
    { si_no: 4, category: 'Fire Safety', requirement: 'Fire safety Certificates and NOCs', spoc_name: 'Kiran', period: 'as on date' },
    { si_no: 5, category: 'Fire Safety', requirement: 'Fire equipment list location wise and service maintainence logs', spoc_name: 'Kiran', period: "Apr'25 to Mar'26" },
    { si_no: 6, category: 'Fire Safety', requirement: 'Fire drill records - FY 25-26 and Fire warden list with training completion status', spoc_name: 'Jai', period: "Apr'25 to Mar'26" },
    { si_no: 7, category: 'Compliance', requirement: 'Compliance certificates - ISO, Food safety, Fire NOC', spoc_name: 'Jai & Kiran', period: 'as on date' },
    { si_no: 8, category: 'Food Safety', requirement: 'Food safety certificates, FSSAI license', spoc_name: 'Manjunath', period: 'as on date' },
    { si_no: 9, category: 'CCTV', requirement: 'CCTV camera inventory – location-wise with operational status', spoc_name: 'Kiran', period: 'as on date' },
    { si_no: 10, category: 'Security', requirement: 'Security vendor contract and deployment plan', spoc_name: 'Jai', period: 'as on date' },
    { si_no: 11, category: 'Security', requirement: 'Incident / security breach log – FY 2025-26', spoc_name: 'Kiran', period: 'as on date' },
    { si_no: 12, category: 'Environment', requirement: 'Waste Management & Environmental Practices', spoc_name: 'Jai', period: "Apr'25 to Mar'26" },
    { si_no: 13, category: 'Environment', requirement: 'Water quality test reports – FY 2025-26', spoc_name: 'Jai', period: "Apr'25 to Mar'26" },
    { si_no: 14, category: 'Water', requirement: 'RO/water purifier AMC and filter replacement log', spoc_name: 'Jai', period: "Apr'25 to Mar'26" },
    { si_no: 15, category: 'Pest Control', requirement: 'Pest control service records and contract', spoc_name: 'Jai', period: "Apr'25 to Mar'26" },
    { si_no: 16, category: 'First Aid', requirement: 'First aid kit inspection checklist & Trained first-aider register', spoc_name: 'Jai', period: 'as on date' },
    { si_no: 17, category: 'Statutory', requirement: 'Statutory licence register – all locations', spoc_name: 'Suraj', period: "Apr'25 to Mar'26" },
    { si_no: 18, category: 'Compliance', requirement: 'Compliance calendar with current status', spoc_name: 'Kiran', period: "Apr'25 to Mar'26" },
    { si_no: 19, category: 'Statutory', requirement: 'Last statutory inspection reports / show-cause notices', spoc_name: 'Suraj', period: "Apr'25 to Mar'26" },
    { si_no: 20, category: 'Utilities', requirement: 'Electricity, water, and HVAC system management', spoc_name: 'Kiran', period: "Apr'25 to Mar'26" },
    { si_no: 21, category: 'Utilities', requirement: 'Backup systems (DG sets, UPS)', spoc_name: 'Kiran', period: 'as on date' },
    { si_no: 22, category: 'Utilities', requirement: 'Preventive maintenance of utility systems', spoc_name: 'Kiran', period: "Apr'25 to Mar'26" },
    { si_no: 23, category: 'Cafeteria', requirement: 'Cafeteria / canteen operator agreement – all locations', spoc_name: 'Manjunath', period: 'as on date' },
    { si_no: 24, category: 'Cafeteria', requirement: 'Tuck shop / vending machine arrangement documents', spoc_name: 'Manjunath', period: 'as on date' },
    { si_no: 25, category: 'MIS', requirement: 'Monthly recovery MIS – meal subsidy, vending, locker, parking', spoc_name: '-', period: "Apr'25 to Mar'26" },
    { si_no: 26, category: 'Food Safety', requirement: 'FSSAI licence copies – all food service operators', spoc_name: 'Jai', period: 'as on date' },
    { si_no: 27, category: 'Cafeteria', requirement: 'Cafeteria hygiene inspection records – FY 2025-26', spoc_name: 'Jai', period: "Apr'25 to Mar'26" },
    { si_no: 28, category: 'Lifts', requirement: 'List of all lifts installed across locations/floors', spoc_name: 'Kiran', period: 'as on date' },
    { si_no: 29, category: 'Lifts', requirement: 'Lift-wise asset details (ID, Make, Capacity, Vendor)', spoc_name: 'Kiran', period: "Apr'25 to Mar'26" },
    { si_no: 30, category: 'Lifts', requirement: 'Copy of lift licenses/registration certificates', spoc_name: 'Kiran', period: "Apr'25 to Mar'26" },
    { si_no: 31, category: 'Lifts', requirement: 'Latest fitness certificates/inspection certificates', spoc_name: 'Kiran', period: 'as on date' },
    { si_no: 32, category: 'Lifts', requirement: 'Lift preventive maintenance schedule/calendar', spoc_name: 'Kiran', period: 'as on date' },
    { si_no: 33, category: 'Lifts', requirement: 'Lift breakdown log along with RCA and Technician logs', spoc_name: 'Kiran', period: "Apr'25 to Mar'26" },
    { si_no: 34, category: 'Lifts', requirement: 'AMC agreements/contracts with lift vendors', spoc_name: 'Kiran', period: 'as on date' },
    { si_no: 35, category: 'Contracts', requirement: 'All AMC, house keeping contracts', spoc_name: 'Jai & Kiran', period: 'as on date' }
];

async function seed() {
    console.log('Seeding Internal Audit Master Items...');
    const items = auditPoints.map(p => ({
        ...p,
        organization_id: organizationId
    }));

    const { data, error } = await supabase
        .from('audit_master_items')
        .upsert(items, { onConflict: 'si_no,organization_id' });

    if (error) {
        console.error('Seed Error:', error);
    } else {
        console.log('Successfully seeded 35 audit points.');
    }
}

seed();
