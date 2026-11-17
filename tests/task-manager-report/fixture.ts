import type { AuditRow, MetricInput, ReportPerson, TaskRow } from '../../backend/lib/reports/taskManagerUsage/types';

/** Made-up people and tasks for the report tests and for previewing the PDF design. No real data. */

export const PEOPLE: ReportPerson[] = [
    { userId: 'asha', name: 'Asha Rao', departmentId: 'hr', departmentName: 'Human Resources' },
    { userId: 'ben', name: 'Ben Thomas', departmentId: 'hr', departmentName: 'Human Resources' },
    { userId: 'chitra', name: 'Chitra Nair', departmentId: 'tech', departmentName: 'Tech' },
    { userId: 'dev', name: 'Dev Shah', departmentId: 'tech', departmentName: 'Tech' },
    { userId: 'esha', name: 'Esha Iyer', departmentId: 'proc', departmentName: 'Procurement' },
    { userId: 'farid', name: 'Farid Khan', departmentId: 'proc', departmentName: 'Procurement' },
];

let nextId = 0;
export function task(over: Partial<TaskRow>): TaskRow {
    nextId += 1;
    return {
        id: `t${nextId}`,
        title: `Task ${nextId}`,
        employee_id: 'asha',
        assigned_by: 'asha',
        assigned_date: '2026-11-02',
        status: 'pending',
        created_at: '2026-11-02T05:00:00Z',
        completed_at: null,
        due_date: null,
        task_template_id: null,
        source: null,
        assign_group_id: null,
        ...over,
    };
}

export const done = (createdAt: string, completedAt: string, over: Partial<TaskRow> = {}): TaskRow =>
    task({ status: 'completed', created_at: createdAt, completed_at: completedAt, ...over });

export function audit(actor: string | null, eventType: string, createdAt: string, details: Record<string, unknown> | null = null): AuditRow {
    return { event_type: eventType, actor_id: actor, created_at: createdAt, details };
}

export function input(over: Partial<MetricInput> = {}): MetricInput {
    return {
        orgName: 'Example Offices',
        from: '2026-11-02',
        to: '2026-11-08',
        generatedAt: '2026-11-09T03:30:00Z',
        historyFrom: '2026-10-01',
        people: PEOPLE,
        tasks: [],
        audit: [],
        ...over,
    };
}

/** A full, believable period: enough data to fill every section of the PDF. */
export function sampleInput(over: Partial<MetricInput> = {}): MetricInput {
    const titles: Record<string, string[]> = {
        asha: ['Prepare November onboarding pack', 'Review leave policy draft', 'Schedule exit interviews', 'Update attendance tracker'],
        ben: ['Collect probation feedback', 'Share payroll inputs with Accounts'],
        chitra: ['Fix ticket attachment upload', 'Review report tab design', 'Rotate staging credentials', 'Plan database clean-up'],
        dev: ['Deploy WhatsApp bot update', 'Investigate slow dashboard'],
        esha: ['Compare diesel vendor quotes', 'Raise PO for pantry supplies', 'Chase pending vendor invoices'],
    };
    const tasks: TaskRow[] = [];
    const log: AuditRow[] = [];
    const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
    for (const [person, list] of Object.entries(titles)) {
        list.forEach((title, i) => {
            const start = days[i % days.length];
            const finish = days[Math.min(i % days.length + 1, days.length - 1)];
            tasks.push(done(`${start}T04:${10 + i}:00Z`, `${finish}T09:${10 + i}:00Z`, { title, employee_id: person, assigned_by: person }));
            log.push(audit(person, 'task_assigned', `${start}T04:${10 + i}:00Z`, { via: 'web_tasks_tab' }));
            log.push(audit(person, 'task_completed', `${finish}T09:${10 + i}:00Z`, { via: i % 2 ? 'web_tasks_tab' : undefined }));
            log.push(audit(person, 'brain_live', `${finish}T06:${10 + i}:00Z`));
        });
    }
    tasks.push(task({ title: 'Renew fire safety vendor contract', employee_id: 'esha', assigned_by: 'chitra', created_at: '2026-10-20T05:00:00Z', due_date: '2026-10-30' }));
    tasks.push(task({ title: 'Audit laptop inventory', employee_id: 'dev', assigned_by: 'chitra', created_at: '2026-11-03T05:00:00Z', due_date: '2026-11-05' }));
    tasks.push(task({ title: 'Draft referral bonus note', employee_id: 'ben', assigned_by: 'asha', created_at: '2026-11-05T05:00:00Z', due_date: '2026-11-12' }));
    tasks.push(done('2026-11-03T05:00:00Z', '2026-11-04T05:00:00Z', { title: 'Vendor invoice from Zoho', employee_id: 'esha', assigned_by: null, source: 'zoho' }));
    for (const person of ['asha', 'chitra']) {
        tasks.push(done('2026-10-27T05:00:00Z', '2026-10-28T05:00:00Z', { employee_id: person, assigned_by: person }));
        log.push(audit(person, 'task_completed', '2026-10-28T05:00:00Z', { via: 'web_tasks_tab' }));
    }
    log.push(audit('farid', 'task_completed', '2026-10-29T05:00:00Z', { via: 'web_tasks_tab' }));
    log.push(audit('asha', 'task_deleted', '2026-11-04T07:00:00Z', { via: 'web_tasks_tab' }));
    log.push(audit('chitra', 'voice_note', '2026-11-04T08:00:00Z'));
    log.push(audit('asha', 'meeting_created', '2026-11-05T08:00:00Z'));
    return input({ tasks, audit: log, ...over });
}
