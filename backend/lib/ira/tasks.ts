/**
 * Ira — daily procurement task list.
 *
 * MVP: the list is seeded here from the team's existing daily sheet so the
 * digest is real on day one. Swap `getDailyTasks()` for a DB query
 * (material_requests / zoho_purchase_orders) once the shape is agreed —
 * nothing downstream cares where the rows come from.
 */

export type TaskStatus =
    | 'need_po'
    | 'waiting_quotation'
    | 'waiting_approval'
    | 'in_progress'
    | 'waiting_update'
    | 'done';

export interface IraTask {
    sr: number;
    task: string;
    site: string;
    remark: string;
    status: TaskStatus;
}

/** Display label + whether it is blocked on a human decision. */
export const STATUS_META: Record<TaskStatus, { label: string; blocking: boolean; tone: string }> = {
    waiting_approval:  { label: 'Waiting for approval',  blocking: true,  tone: '#B0442E' },
    need_po:           { label: 'Need to make PO',       blocking: true,  tone: '#B07206' },
    waiting_quotation: { label: 'Waiting for quotation', blocking: false, tone: '#7A776E' },
    waiting_update:    { label: 'Waiting for update',    blocking: false, tone: '#7A776E' },
    in_progress:       { label: 'Work in progress',      blocking: false, tone: '#3D5A8A' },
    done:              { label: 'Done',                  blocking: false, tone: '#0B6E5F' },
};

/** Order the digest renders in — what is blocked on a human comes first. */
export const STATUS_ORDER: TaskStatus[] = [
    'waiting_approval', 'need_po', 'waiting_quotation', 'waiting_update', 'in_progress', 'done',
];

const SEED: IraTask[] = [
    { sr: 1,  task: 'Diesel Order 800 Ltr',                        site: 'SS Plaza',        remark: 'Quotation received',                    status: 'need_po' },
    { sr: 2,  task: 'Diesel Order 500 Ltr',                        site: 'Indore',          remark: 'Quotation received',                    status: 'need_po' },
    { sr: 3,  task: 'Chair repair',                                site: 'Arcil Noida',     remark: 'Need to colouring',                     status: 'waiting_quotation' },
    { sr: 4,  task: 'New chair required',                          site: 'Digitide Nashik', remark: 'Waiting for quotation',                 status: 'waiting_quotation' },
    { sr: 5,  task: 'Signages for basement parking zone',          site: 'SS Plaza',        remark: 'Waiting for quotation',                 status: 'waiting_quotation' },
    { sr: 6,  task: 'Cable rate negotiate',                        site: 'Radical Mind',    remark: 'Rate negotiate',                        status: 'in_progress' },
    { sr: 7,  task: 'FA - PA rate negotiate',                      site: 'Radical Mind',    remark: 'Rate negotiate',                        status: 'in_progress' },
    { sr: 8,  task: 'Cat 6 cable',                                 site: 'Radical Mind',    remark: 'Rate negotiate',                        status: 'in_progress' },
    { sr: 9,  task: 'Carpet installation PO',                      site: 'Arcil Noida',     remark: 'Need to approve measurement sheet',     status: 'need_po' },
    { sr: 10, task: 'R&M spare part — chair hydraulic',            site: 'Digitide',        remark: 'Comparative shared',                    status: 'waiting_approval' },
    { sr: 11, task: 'Agreement follow-up',                         site: 'SS Plaza',        remark: 'Follow up',                             status: 'in_progress' },
    { sr: 12, task: 'New lift power supply material procurement',  site: 'SS Plaza',        remark: 'Comparative shared',                    status: 'waiting_approval' },
    { sr: 13, task: 'R&M electrical material',                     site: 'SS Plaza',        remark: 'Waiting for one more quotation',        status: 'waiting_quotation' },
    { sr: 14, task: 'Damaged ceiling tile replacement',            site: 'SS Plaza',        remark: 'Comparative shared',                    status: 'waiting_approval' },
    { sr: 15, task: 'AMC quote — safety & security system',        site: 'SS Plaza',        remark: 'Comparative shared',                    status: 'waiting_approval' },
    { sr: 16, task: 'Kone lift AMC renewal',                       site: 'SS Plaza',        remark: 'Negotiation done',                      status: 'waiting_update' },
    { sr: 17, task: 'Single disc machine',                         site: 'SS Plaza',        remark: 'Need to place order',                   status: 'waiting_approval' },
    { sr: 18, task: 'Vending machine replacement',                 site: 'ETPL & SS Plaza', remark: 'Awaiting final draft from legal team',  status: 'in_progress' },
    { sr: 19, task: 'WLD & rodent repellent system',               site: 'Arcil Noida',     remark: 'Work status follow up',                 status: 'in_progress' },
    { sr: 20, task: 'PA system requirement',                       site: 'Arcil Noida',     remark: 'Points forwarded to vendor',            status: 'in_progress' },
    { sr: 21, task: 'Earthing materials requirement',              site: 'Arcil Noida',     remark: 'Getting quotes & making PO',            status: 'need_po' },
    { sr: 22, task: 'Data punching work',                          site: 'Arcil Noida',     remark: 'PO made, payment aligned',              status: 'done' },
    { sr: 23, task: 'Faceplate material issue',                    site: 'Arcil Noida',     remark: 'Material needs to be checked',          status: 'in_progress' },
    { sr: 24, task: 'Electrical, carpentry & plumbing materials',  site: 'Mumbai & Pune',   remark: 'Getting quotes from vendors',           status: 'waiting_quotation' },
    { sr: 25, task: 'Renovation work',                             site: 'Coimbatore',      remark: 'Awaiting final invoices, ledger f/u',   status: 'in_progress' },
    { sr: 26, task: 'LOP replacement at NRK Star',                 site: 'Indore',          remark: 'Further negotiation & approval mail',   status: 'waiting_approval' },
];

export async function getDailyTasks(): Promise<IraTask[]> {
    // TODO(next): replace with a query over material_requests + zoho_purchase_orders
    // scoped to open states. Keep the IraTask shape and nothing else changes.
    return SEED;
}

export interface TaskSummary {
    total: number;
    blocking: number;
    byStatus: { status: TaskStatus; tasks: IraTask[] }[];
    bySite: { site: string; count: number }[];
}

export function summarise(tasks: IraTask[]): TaskSummary {
    const byStatus = STATUS_ORDER
        .map((status) => ({ status, tasks: tasks.filter((t) => t.status === status) }))
        .filter((g) => g.tasks.length > 0);

    const siteCounts = new Map<string, number>();
    for (const t of tasks) siteCounts.set(t.site, (siteCounts.get(t.site) ?? 0) + 1);

    return {
        total: tasks.length,
        blocking: tasks.filter((t) => STATUS_META[t.status].blocking).length,
        byStatus,
        bySite: [...siteCounts.entries()]
            .map(([site, count]) => ({ site, count }))
            .sort((a, b) => b.count - a.count),
    };
}
