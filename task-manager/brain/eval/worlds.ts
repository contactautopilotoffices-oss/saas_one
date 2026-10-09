import type { BrainContext, BrainPerson, BrainTask, PendingState } from '../types';

/**
 * Evaluation "worlds": small fake companies the test messages are sent in. Fixed ids, so an expected answer can
 * say "task t2" or "person u3". Nothing here is real data.
 */

const P = (id: string, name: string, department: string, role: BrainPerson['role'] = 'employee'): BrainPerson => ({ id, name, department, role });

export const PRIYANKA = P('u1', 'Priyanka Shah', 'Procurement');
export const SANIEL = P('u9', 'Saniel Mehta', 'Management', 'superuser');

const PEOPLE: BrainPerson[] = [
    PRIYANKA,
    P('u2', 'Vidya Nair', 'Procurement'),
    P('u3', 'Lohit Kumar', 'Tech'),
    P('u4', 'Harsh Patel', 'Tech'),
    P('u5', 'Suraj Verma', 'Procurement'),
    P('u6', 'Dipti Rao', 'Procurement'),
    P('u7', 'Neha Joshi', 'Finance'),
    SANIEL,
];

const TASKS: BrainTask[] = [
    { n: 1, id: 't1', title: 'Carpet Installation PO', status: 'pending' },
    { n: 2, id: 't2', title: 'Kone Lift AMC Renewal', status: 'in_progress' },
    { n: 3, id: 't3', title: 'AMC Quote for Safety & Security System', status: 'pending' },
    { n: 4, id: 't4', title: 'Damaged Ceiling Tile Replacement', status: 'pending' },
    { n: 5, id: 't5', title: 'Single Disc Machine', status: 'pending' },
    { n: 6, id: 't6', title: 'Agreement Followup', status: 'completed' },
];

const DEPARTMENTS = ['Procurement', 'Tech', 'Finance', 'Management'];
const TODAY = '2026-10-08'; // a Thursday

export const PING: PendingState = { kind: 'ping_reply', assigner: 'Vidya Nair', taskIds: ['p1', 'p2'], taskTitles: ['Approve measurement sheet', 'Sign the AMC'] };
export const CONFIRM: PendingState = { kind: 'confirm', summary: 'Add 1 task for Lohit Kumar: review the RFID rollout' };
export const PICK: PendingState = { kind: 'pick', options: ['Lohit Kumar (Tech)', 'Lohit Mehta (Procurement)'] };

export type WorldName = 'default' | 'twoLohits' | 'superuser' | 'single' | 'empty';

export function world(name: WorldName, pending: PendingState | null = null): BrainContext {
    const base: BrainContext = {
        today: TODAY, sender: PRIYANKA, people: PEOPLE, assignableIds: ['u2', 'u3', 'u4', 'u5', 'u6'],
        tasks: TASKS, departments: DEPARTMENTS, pending,
    };
    switch (name) {
        case 'twoLohits':
            return { ...base, people: [...PEOPLE, P('u8', 'Lohit Mehta', 'Procurement')], assignableIds: [...base.assignableIds, 'u8'] };
        case 'superuser':
            return { ...base, sender: SANIEL, people: PEOPLE, assignableIds: PEOPLE.filter(p => p.id !== 'u9').map(p => p.id), tasks: [{ n: 1, id: 's1', title: 'Approve annual budget', status: 'pending' }] };
        case 'single':
            return { ...base, tasks: [TASKS[0], TASKS[5]] };
        case 'empty':
            return { ...base, tasks: [] };
        default:
            return base;
    }
}
