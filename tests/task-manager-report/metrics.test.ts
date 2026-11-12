import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { channelOf, computeUsageReport, regularTarget } from '../../backend/lib/reports/taskManagerUsage/metrics';
import { audit, done, input, PEOPLE, sampleInput, task } from './fixture';

const kpi = (r: ReturnType<typeof computeUsageReport>, key: string) => r.kpis.find(k => k.key === key)!;

describe('regular-use target', () => {
    it('is 3 per 7 days, rounded up, and never below 3', () => {
        assert.equal(regularTarget(1), 3);
        assert.equal(regularTarget(7), 3);
        assert.equal(regularTarget(14), 6);
        assert.equal(regularTarget(30), 13);
        assert.equal(regularTarget(366), 157);
    });
});

describe('cycles', () => {
    it('needs a task both created and completed in the period', () => {
        const r = computeUsageReport(input({
            tasks: [
                done('2026-11-03T05:00:00Z', '2026-11-04T05:00:00Z'),
                done('2026-10-20T05:00:00Z', '2026-11-04T05:00:00Z'),
                task({ created_at: '2026-11-03T05:00:00Z' }),
            ],
        }));
        assert.equal(r.execution.cycles, 1);
        assert.equal(r.execution.completed, 2);
        assert.equal(r.execution.created, 2);
    });

    it('credits a delegated task to both people and a self-assigned task once', () => {
        const delegated = Array.from({ length: 3 }, () => done('2026-11-03T05:00:00Z', '2026-11-04T05:00:00Z', { employee_id: 'ben', assigned_by: 'asha' }));
        const self = Array.from({ length: 2 }, () => done('2026-11-03T05:00:00Z', '2026-11-04T05:00:00Z', { employee_id: 'ben', assigned_by: 'ben' }));
        const r = computeUsageReport(input({ tasks: [...delegated, ...self] }));
        const cycles = Object.fromEntries(r.people.regulars.map(p => [p.name, p.cycles]));
        assert.deepEqual(cycles, { 'Ben Thomas': 5, 'Asha Rao': 3 });
    });

    it('does not count Zoho imports or auto-generated fixed tasks, because nobody created them here', () => {
        const r = computeUsageReport(input({
            tasks: [
                done('2026-11-03T05:00:00Z', '2026-11-04T05:00:00Z', { source: 'zoho', assigned_by: null }),
                done('2026-11-03T05:00:00Z', '2026-11-04T05:00:00Z', { task_template_id: 'daily', assigned_by: null }),
            ],
        }));
        assert.equal(r.execution.cycles, 0);
        assert.equal(r.execution.automatic, 2);
        assert.equal(r.execution.completionPct, null);
    });

    it('uses IST days at the edge of the period', () => {
        const r = computeUsageReport(input({
            // 19:00 UTC on 8 Nov is already 9 Nov in IST, so this completion falls outside the period.
            tasks: [done('2026-11-03T05:00:00Z', '2026-11-08T19:00:00Z')],
        }));
        assert.equal(r.execution.cycles, 0);
    });

    it('raises the regular target on a longer range', () => {
        const tasks = Array.from({ length: 5 }, () => done('2026-11-03T05:00:00Z', '2026-11-04T05:00:00Z'));
        const week = computeUsageReport(input({ tasks }));
        const fortnight = computeUsageReport(input({ from: '2026-10-26', tasks }));
        assert.equal(week.people.regulars.length, 1);
        assert.equal(fortnight.regularTarget, 6);
        assert.equal(fortnight.people.regulars.length, 0);
    });

    it('scales the target only over days that have data, so a very long range is judged fairly', () => {
        const tasks = Array.from({ length: 14 }, () => done('2026-11-03T05:00:00Z', '2026-11-04T05:00:00Z'));
        const r = computeUsageReport(input({ from: '2026-05-01', historyFrom: '2026-10-11', tasks }));
        assert.equal(r.period.days, 192);
        assert.equal(r.regularTarget, 13);
        assert.equal(r.people.regulars.length, 1);
        assert.ok(r.notes.some(n => n.includes('counts days from then')));
    });
});

describe('who is in the report', () => {
    const superuserRows = {
        tasks: [
            task({ title: 'SECRET superuser task', employee_id: 'super', assigned_by: 'super' }),
            done('2026-11-03T05:00:00Z', '2026-11-04T05:00:00Z', { title: 'SECRET done', employee_id: 'super', assigned_by: 'super' }),
        ],
        audit: [audit('super', 'task_completed', '2026-11-04T05:00:00Z')],
    };

    it('leaves superusers out of names, titles and totals', () => {
        const r = computeUsageReport(input(superuserRows));
        assert.equal(JSON.stringify(r).includes('SECRET'), false);
        assert.equal(r.base.people, 6);
        assert.equal(r.execution.created, 0);
        assert.equal(kpi(r, 'active').display, '0 of 6');
    });

    it('still shows an employee’s task that a superuser gave them, without crediting the superuser', () => {
        const r = computeUsageReport(input({ tasks: [done('2026-11-03T05:00:00Z', '2026-11-04T05:00:00Z', { employee_id: 'ben', assigned_by: 'super' })] }));
        assert.equal(r.execution.cycles, 1);
        assert.equal(kpi(r, 'active').display, '1 of 6');
    });

    it('lists only departments that have someone in the base', () => {
        const r = computeUsageReport(input({ people: PEOPLE.filter(p => p.departmentId !== 'proc') }));
        assert.deepEqual(r.departments.map(d => d.id).sort(), ['hr', 'tech']);
        assert.equal(r.base.departments, 2);
    });

    it('includes HR task titles', () => {
        const r = computeUsageReport(sampleInput());
        const hr = r.departments.find(d => d.id === 'hr')!;
        assert.ok(hr.recentlyCompleted.some(w => w.title === 'Update attendance tracker'));
    });
});

describe('activity', () => {
    it('ignores what the system did and what a person outside the base did', () => {
        const r = computeUsageReport(input({
            audit: [
                audit('asha', 'whatsapp_sent', '2026-11-04T05:00:00Z'),
                audit('asha', 'team_digest_sent', '2026-11-04T05:00:00Z'),
                audit('stranger', 'task_completed', '2026-11-04T05:00:00Z'),
            ],
        }));
        assert.equal(kpi(r, 'active').display, '0 of 6');
    });

    it('tells web from WhatsApp', () => {
        assert.equal(channelOf({ event_type: 'task_completed', details: { via: 'web_tasks_tab' } }), 'web');
        assert.equal(channelOf({ event_type: 'task_completed', details: null }), 'whatsapp');
        assert.equal(channelOf({ event_type: 'task_assigned', details: { via: 'whatsapp_import' } }), 'whatsapp');
        assert.equal(channelOf({ event_type: 'brain_live', details: { via: 'voice' } }), 'whatsapp');
        assert.equal(channelOf({ event_type: 'ai_tool_call', details: { channel: 'whatsapp' } }), 'whatsapp');
        assert.equal(channelOf({ event_type: 'meeting_created', details: null }), 'web');
    });

    it('counts Zoho imports for the people who own them, because nobody assigned them', () => {
        const r = computeUsageReport(input({ tasks: [task({ source: 'zoho', assigned_by: null, employee_id: 'esha' }), task({ source: 'zoho', assigned_by: null, employee_id: 'esha' })] }));
        const zoho = r.engagement.features.find(f => f.label === 'Zoho task imports')!;
        assert.deepEqual([zoho.uses, zoho.people], [2, 1]);
    });

    it('splits people who stopped from people who were already quiet', () => {
        const r = computeUsageReport(input({
            audit: [audit('ben', 'task_completed', '2026-10-28T05:00:00Z'), audit('asha', 'task_completed', '2026-11-04T05:00:00Z')],
        }));
        assert.deepEqual(r.people.stopped.map(p => p.name), ['Ben Thomas']);
        assert.equal(r.people.quiet.length, 4);
        assert.equal(r.people.stopped[0].lastActive, '2026-10-28');
    });
});

describe('comparison with the previous period', () => {
    it('is shown when the history fully covers it', () => {
        const r = computeUsageReport(sampleInput());
        assert.deepEqual(r.previousPeriod, { from: '2026-10-26', to: '2026-11-01' });
        assert.notEqual(kpi(r, 'active').change, null);
    });

    it('is withheld rather than shown against a partial period', () => {
        const r = computeUsageReport(sampleInput({ historyFrom: '2026-10-28' }));
        assert.equal(r.previousPeriod, null);
        assert.equal(kpi(r, 'active').change, null);
        assert.ok(r.notes.some(n => n.includes('No comparison')));
    });
});

describe('execution', () => {
    it('counts overdue tasks at the end of the period, not today', () => {
        const r = computeUsageReport(input({
            tasks: [
                task({ created_at: '2026-11-03T05:00:00Z', due_date: '2026-11-05' }),
                task({ created_at: '2026-11-03T05:00:00Z', due_date: '2026-11-20' }),
                done('2026-11-03T05:00:00Z', '2026-11-10T05:00:00Z', { due_date: '2026-11-05' }),
                task({ created_at: '2026-11-12T05:00:00Z', due_date: '2026-11-05' }),
            ],
        }));
        assert.equal(r.execution.overdue, 2);
        assert.equal(r.execution.openAtEnd, 3);
    });

    it('works out on-time delivery only for tasks due in the period', () => {
        const r = computeUsageReport(input({
            tasks: [
                done('2026-11-03T05:00:00Z', '2026-11-04T05:00:00Z', { due_date: '2026-11-05' }),
                done('2026-11-03T05:00:00Z', '2026-11-07T05:00:00Z', { due_date: '2026-11-05' }),
                task({ created_at: '2026-11-03T05:00:00Z', due_date: '2026-11-06' }),
                task({ created_at: '2026-11-03T05:00:00Z' }),
            ],
        }));
        assert.deepEqual(r.execution.due, { tasksDue: 3, onTime: 1, onTimePct: 33, coveragePct: 75 });
    });

    it('takes the median time from creation to completion', () => {
        const r = computeUsageReport(input({
            tasks: [
                done('2026-11-03T00:00:00Z', '2026-11-03T02:00:00Z'),
                done('2026-11-03T00:00:00Z', '2026-11-03T04:00:00Z'),
                done('2026-11-03T00:00:00Z', '2026-11-03T12:00:00Z'),
            ],
        }));
        assert.equal(r.execution.medianHoursToComplete, 4);
    });
});

describe('trend', () => {
    it('goes day by day up to 31 days, then week by week', () => {
        const short = computeUsageReport(input());
        assert.equal(short.adoption.trendUnit, 'day');
        assert.equal(short.adoption.trend.length, 7);
        const long = computeUsageReport(input({ from: '2026-09-01' }));
        assert.equal(long.adoption.trendUnit, 'week');
        assert.equal(long.adoption.trend.length, 10);
    });
});

describe('takeaways', () => {
    it('states the numbers and never mentions a confidentiality marking', () => {
        const r = computeUsageReport(sampleInput());
        assert.ok(r.takeaways[0].includes('of 6 people'));
        assert.equal(JSON.stringify(r).toLowerCase().includes('confidential'), false);
    });

    it('says plainly when nothing needs following up', () => {
        const tasks = PEOPLE.flatMap(p => Array.from({ length: 3 }, () =>
            done('2026-11-03T05:00:00Z', '2026-11-04T05:00:00Z', { employee_id: p.userId, assigned_by: 'asha', due_date: '2026-11-05' })));
        const r = computeUsageReport(input({ tasks, people: PEOPLE }));
        assert.ok(r.actions.every(a => !a.includes('Follow up')));
    });
});
