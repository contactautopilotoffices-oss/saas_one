import './offline-env';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';

import { encryptToken } from '../../backend/lib/mail/accounts';
import { supabaseAdmin } from '../../backend/lib/supabase/admin';
import { TaskDatabaseService } from '../../task-manager/TaskDatabaseService';
import { zohoDeleteDetail } from '../../task-manager/TaskLinks';
import { canUpdateZoho, decideSyncAction, ZOHO_TASK_SCOPES, ZohoTaskSync } from '../../task-manager/ZohoTaskSync';

const DONE_HERE = '2026-11-05T10:00:00+05:30';
const BEFORE = '2026-11-05T09:00:00+05:30';
const AFTER = '2026-11-05T11:00:00+05:30';

describe('which Zoho connections may change a task', () => {
    it('allows what a new connection asks for', () => {
        assert.equal(canUpdateZoho(ZOHO_TASK_SCOPES), true);
        assert.equal(canUpdateZoho('ZohoMail.tasks.ALL'), true);
    });

    it('refuses a read-only or unknown connection', () => {
        assert.equal(canUpdateZoho('ZohoMail.tasks.READ'), false);
        assert.equal(canUpdateZoho(null), false);
        assert.equal(canUpdateZoho(undefined), false);
    });
});

describe('what a sync does with a task on both sides', () => {
    it('completes here what was completed in Zoho', () => {
        assert.equal(decideSyncAction({ status: 'pending' }, { status: 'completed' }, true), 'complete_here');
        assert.equal(decideSyncAction({ status: 'in_progress' }, { status: 'completed' }, false), 'complete_here');
    });

    it('sends Zoho a completion it missed', () => {
        assert.equal(decideSyncAction({ status: 'completed', completedAt: DONE_HERE }, { status: 'pending', modifiedTime: BEFORE }, true), 'push_completed');
    });

    it('still sends it when Zoho gives no modified time', () => {
        assert.equal(decideSyncAction({ status: 'completed', completedAt: DONE_HERE }, { status: 'pending' }, true), 'push_completed');
    });

    it('leaves a task that was reopened in Zoho after it was completed here', () => {
        assert.equal(decideSyncAction({ status: 'completed', completedAt: DONE_HERE }, { status: 'in_progress', modifiedTime: AFTER }, true), 'none');
    });

    it('sends nothing on a read-only connection', () => {
        assert.equal(decideSyncAction({ status: 'completed', completedAt: DONE_HERE }, { status: 'pending', modifiedTime: BEFORE }, false), 'none');
    });

    it('does nothing when both sides already agree', () => {
        assert.equal(decideSyncAction({ status: 'completed', completedAt: DONE_HERE }, { status: 'completed' }, true), 'none');
        assert.equal(decideSyncAction({ status: 'pending' }, { status: 'pending' }, true), 'none');
    });
});

// ── The real push code against a fake Zoho and a fake database ───────────────
type Row = Record<string, unknown>;
type Call = { method: string; path: string; body: unknown };

/** Each test uses its own person: access tokens are cached by refresh token, so one must not reach the next test. */
let person = 0;
let conn: Row | null;
let task: Row;
let connUpdates: Row[];
let audit: Row[];
let imported: string[];
let calls: Call[];
let zoho: (call: Call) => { status: number; json: unknown };

const ok = { status: 200, json: { status: { code: 200, description: 'success' } } };
const refused = { status: 404, json: { status: { code: 404, description: 'not found' } } };

function query(table: string): unknown {
    const filters: Array<(r: Row) => boolean> = [];
    const row = () => (table === 'task_zoho_connections' ? conn : task);
    const rows = () => {
        if (table === 'task_audit_logs') return audit.filter(r => filters.every(f => f(r)));
        return [row()].filter(r => r && filters.every(f => f(r)));
    };
    const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
            // The real database reads the JSON path; the fake only needs the rows it holds.
            filters.push(r => (col === 'details->>fromUserId' ? r.fromUserId === val : !(col in r) || r[col] === val));
            return chain;
        },
        neq: (col: string, val: unknown) => { filters.push(r => r[col] !== val); return chain; },
        in: (col: string, vals: unknown[]) => { filters.push(r => vals.includes(r[col])); return chain; },
        update: (p: Row) => {
            if (table === 'task_zoho_connections') connUpdates.push(p);
            else Object.assign(task, p);
            return chain;
        },
        maybeSingle: async () => ({ data: row(), error: null }),
        single: async () => ({ data: row(), error: null }),
        then: (done: (v: unknown) => unknown) => done({ data: rows(), error: null }),
    };
    return chain;
}

beforeEach(() => {
    person++;
    conn = { refresh_token_enc: encryptToken(`refresh-${person}`), dc: 'com', is_active: true, scopes: ZOHO_TASK_SCOPES };
    task = { id: 'a1', employee_id: `u${person}`, source: 'zoho', external_id: '777', status: 'pending' };
    connUpdates = [];
    audit = [];
    imported = [];
    calls = [];
    zoho = () => ok;
    (supabaseAdmin as unknown as { from: unknown }).from = query;
    TaskDatabaseService.createTaskAssignment = (async (p: { externalId?: string }) => { imported.push(String(p.externalId)); return {}; }) as typeof TaskDatabaseService.createTaskAssignment;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        const { pathname, search } = new URL(url);
        if (pathname === '/oauth/v2/token') {
            return new Response(JSON.stringify({ access_token: 'tok', api_domain: 'https://mail.example', expires_in: 3600 }));
        }
        const call: Call = { method: init?.method ?? 'GET', path: pathname + search, body: init?.body ? JSON.parse(String(init.body)) : null };
        calls.push(call);
        const answer = zoho(call);
        return new Response(JSON.stringify(answer.json), { status: answer.status });
    }) as typeof fetch;
});

const puts = () => calls.filter(c => c.method === 'PUT');

describe('sending a status to Zoho', () => {
    it('completes a personal task with the call Zoho documents', async () => {
        await ZohoTaskSync.pushStatus({ userId: 'u', externalId: '777', done: true });
        assert.deepEqual(puts(), [{ method: 'PUT', path: '/api/tasks/me/777', body: { status: 'completed' } }]);
        assert.deepEqual(connUpdates, []);
    });

    it('reopens with the value Zoho accepts', async () => {
        await ZohoTaskSync.pushStatus({ userId: 'u', externalId: '777', done: false });
        assert.deepEqual(puts()[0].body, { status: 'inprogress' });
    });

    it('finds the group of a task that is not personal', async () => {
        zoho = c => {
            if (c.method === 'GET') return { status: 200, json: { data: { tasks: [{ id: '777', namespaceId: '5551' }] } } };
            return c.path.startsWith('/api/tasks/me/') ? refused : ok;
        };
        await ZohoTaskSync.pushStatus({ userId: 'u', externalId: '777', done: true });
        assert.equal(puts().at(-1)?.path, '/api/tasks/groups/5551/777');
        assert.deepEqual(connUpdates, []);
    });

    it('treats a refusal inside an HTTP 200 as a failure', async () => {
        zoho = c => (c.method === 'GET' ? { status: 200, json: { data: { tasks: [] } } } : { status: 200, json: { status: { code: 500, description: 'nope' } } });
        await ZohoTaskSync.pushStatus({ userId: 'u', externalId: '777', done: true });
        assert.match(String(connUpdates[0]?.last_error), /Could not update Zoho: Zoho 500: nope/);
    });

    it('never throws when Zoho refuses, and records why', async () => {
        zoho = c => (c.method === 'GET' ? { status: 200, json: { data: { tasks: [] } } } : refused);
        await assert.doesNotReject(ZohoTaskSync.pushStatus({ userId: 'u', externalId: '777', done: true }));
        assert.match(String(connUpdates[0]?.last_error), /Could not update Zoho/);
    });

    it('sends nothing on a read-only connection or with no connection', async () => {
        conn = { ...conn, scopes: 'ZohoMail.tasks.READ' };
        await ZohoTaskSync.pushStatus({ userId: 'u', externalId: '777', done: true });
        conn = null;
        await ZohoTaskSync.pushStatus({ userId: 'u', externalId: '777', done: true });
        assert.deepEqual(calls, []);
    });
});

describe('completing a task in the Task Manager', () => {
    it('completes an imported task in Zoho', async () => {
        await TaskDatabaseService.updateAssignmentStatus({ assignmentId: 'a1', status: 'completed' });
        assert.deepEqual(puts()[0], { method: 'PUT', path: '/api/tasks/me/777', body: { status: 'completed' } });
    });

    it('still completes it here when Zoho is down', async () => {
        zoho = () => { throw new Error('network down'); };
        const updated = await TaskDatabaseService.updateAssignmentStatus({ assignmentId: 'a1', status: 'completed' });
        assert.equal(updated.status, 'completed');
    });

    it('leaves a task made in this app out of it', async () => {
        task.source = null;
        task.external_id = null;
        await TaskDatabaseService.updateAssignmentStatus({ assignmentId: 'a1', status: 'completed' });
        assert.deepEqual(calls, []);
    });

    it('does not echo a completion that came from Zoho', async () => {
        await TaskDatabaseService.updateAssignmentStatus({ assignmentId: 'a1', status: 'completed', skipZohoPush: true });
        assert.deepEqual(calls, []);
    });

    it('reopens in Zoho only a task that was completed', async () => {
        task.status = 'completed';
        await TaskDatabaseService.updateAssignmentStatus({ assignmentId: 'a1', status: 'pending' });
        assert.deepEqual(puts()[0].body, { status: 'inprogress' });
    });

    it('leaves Zoho alone when an open task only moves to in progress', async () => {
        await TaskDatabaseService.updateAssignmentStatus({ assignmentId: 'a1', status: 'in_progress' });
        assert.deepEqual(calls, []);
    });
});

describe('the 15-minute sync', () => {
    const inZoho = (status: string, extra: Row = {}) => ({ id: '777', title: 'Imported', status, namespaceId: '5551', ...extra });

    function zohoLists(personal: Row[]) {
        zoho = c => {
            if (c.method === 'PUT') return ok;
            return { status: 200, json: { data: { tasks: c.path.startsWith('/api/tasks/me') ? personal : [] } } };
        };
    }

    it('retries a completion Zoho missed', async () => {
        task = { ...task, status: 'completed', completed_at: DONE_HERE };
        zohoLists([inZoho('In Progress', { modifiedTime: BEFORE })]);
        const r = await ZohoTaskSync.syncUser(String(task.employee_id));
        assert.equal(r.ok, true);
        assert.equal(r.pushed, 1);
        assert.deepEqual(puts()[0].body, { status: 'completed' });
    });

    it('does not fight a task reopened in Zoho', async () => {
        task = { ...task, status: 'completed', completed_at: DONE_HERE };
        zohoLists([inZoho('In Progress', { modifiedTime: AFTER })]);
        const r = await ZohoTaskSync.syncUser(String(task.employee_id));
        assert.equal(r.pushed, 0);
        assert.deepEqual(puts(), []);
    });

    it('keeps importing when Zoho refuses one task, and shows why', async () => {
        task = { ...task, status: 'completed', completed_at: DONE_HERE };
        const personal = [inZoho('In Progress', { modifiedTime: BEFORE })];
        zoho = c => (c.method === 'PUT' ? refused : { status: 200, json: { data: { tasks: c.path.startsWith('/api/tasks/me') ? personal : [] } } });
        const r = await ZohoTaskSync.syncUser(String(task.employee_id));
        assert.equal(r.ok, true);
        assert.equal(r.pushed, 0);
        assert.match(String(connUpdates.at(-1)?.last_error), /Could not update Zoho/);
    });

    it('imports a task that is new to this person', async () => {
        task = { ...task, external_id: 'other' };
        zohoLists([inZoho('In Progress')]);
        const r = await ZohoTaskSync.syncUser(String(task.employee_id));
        assert.equal(r.imported, 1);
        assert.deepEqual(imported, ['777']);
    });

    describe('a task deleted here', () => {
        const ME = 'me';
        const noRowHere = () => { task = { ...task, employee_id: 'nobody', external_id: 'gone' }; };
        const deletedEntry = (holder: string) => ({ task_id: 'a1', event_type: 'task_deleted', target_employee_id: holder, created_at: DONE_HERE, 'details->>zohoTaskId': '777', details: { zohoTaskId: '777' } });

        it('is not imported again for the person who held it', async () => {
            noRowHere();
            audit = [deletedEntry(ME)];
            zohoLists([inZoho('In Progress')]);
            const r = await ZohoTaskSync.syncUser(ME);
            assert.equal(r.ok, true);
            assert.equal(r.imported, 0);
            assert.deepEqual(imported, []);
        });

        it('is not imported again when the new holder deleted it after a hand-over', async () => {
            noRowHere();
            audit = [deletedEntry('new-holder'), { task_id: 'a1', event_type: 'task_handed_over', fromUserId: ME }];
            zohoLists([inZoho('In Progress')]);
            assert.equal((await ZohoTaskSync.syncUser(ME)).imported, 0);
        });

        it('still arrives for someone Zoho reassigned it to', async () => {
            noRowHere();
            audit = [deletedEntry('previous-holder')];
            zohoLists([inZoho('In Progress')]);
            assert.equal((await ZohoTaskSync.syncUser(ME)).imported, 1);
            assert.deepEqual(imported, ['777']);
        });

        it('is completed in Zoho, and never deleted there', async () => {
            noRowHere();
            audit = [deletedEntry(ME)];
            zohoLists([inZoho('In Progress', { modifiedTime: BEFORE })]);
            const r = await ZohoTaskSync.syncUser(ME);
            assert.equal(r.pushed, 1);
            assert.deepEqual(puts(), [{ method: 'PUT', path: '/api/tasks/me/777', body: { status: 'completed' } }]);
            assert.deepEqual(calls.filter(c => c.method === 'DELETE'), []);
        });

        it('is completed in Zoho through the giver when the new holder deleted it', async () => {
            noRowHere();
            audit = [deletedEntry('new-holder'), { task_id: 'a1', event_type: 'task_handed_over', fromUserId: ME }];
            zohoLists([inZoho('In Progress', { modifiedTime: BEFORE })]);
            assert.equal((await ZohoTaskSync.syncUser(ME)).pushed, 1);
        });

        it('stays open in Zoho when someone reopened it there after the delete', async () => {
            noRowHere();
            audit = [deletedEntry(ME)];
            zohoLists([inZoho('In Progress', { modifiedTime: AFTER })]);
            const r = await ZohoTaskSync.syncUser(ME);
            assert.equal(r.pushed, 0);
            assert.deepEqual(puts(), []);
        });

        it('is retried at the next sync when Zoho refuses, and is still not imported', async () => {
            noRowHere();
            audit = [deletedEntry(ME)];
            const open = [inZoho('In Progress', { modifiedTime: BEFORE })];
            zoho = c => (c.method === 'PUT' ? refused : { status: 200, json: { data: { tasks: c.path.startsWith('/api/tasks/me') ? open : [] } } });
            const first = await ZohoTaskSync.syncUser(ME);
            assert.equal(first.pushed, 0);
            assert.equal(first.imported, 0);
            assert.match(String(connUpdates.at(-1)?.last_error), /Could not update Zoho/);
            zohoLists(open);
            assert.equal((await ZohoTaskSync.syncUser(ME)).pushed, 1);
        });

        it('sends nothing on a read-only connection, and is still not imported', async () => {
            noRowHere();
            conn = { ...conn, scopes: 'ZohoMail.tasks.READ' };
            audit = [deletedEntry(ME)];
            zohoLists([inZoho('In Progress', { modifiedTime: BEFORE })]);
            const r = await ZohoTaskSync.syncUser(ME);
            assert.equal(r.imported, 0);
            assert.deepEqual(puts(), []);
        });

        it('is remembered by both places that delete a task', () => {
            assert.deepEqual(zohoDeleteDetail({ source: 'zoho', external_id: '777' }), { zohoTaskId: '777' });
            assert.deepEqual(zohoDeleteDetail({ source: null, external_id: null }), {});
            for (const file of ['task-manager/WorkspaceService.ts', 'app/api/task-manager/tasks/route.ts']) {
                assert.match(readFileSync(file, 'utf8'), /eventType: 'task_deleted'[\s\S]{0,320}zohoDeleteDetail\(/, file);
            }
        });
    });

    describe('a task given to someone else', () => {
        const GIVER = 'giver';
        const handedOver = (status: string, extra: Row = {}) => {
            task = { ...task, employee_id: 'new-holder', status, ...extra };
            audit = [{ task_id: 'a1', event_type: 'task_handed_over', fromUserId: GIVER }];
        };

        it('is not imported again for the person who gave it', async () => {
            handedOver('pending');
            zohoLists([inZoho('In Progress')]);
            const r = await ZohoTaskSync.syncUser(GIVER);
            assert.equal(r.ok, true);
            assert.equal(r.imported, 0);
            assert.deepEqual(imported, []);
        });

        it('is not imported again after an edit moved it either', async () => {
            handedOver('pending');
            audit = [{ task_id: 'a1', event_type: 'task_edited', fromUserId: GIVER }];
            zohoLists([inZoho('In Progress')]);
            assert.equal((await ZohoTaskSync.syncUser(GIVER)).imported, 0);
        });

        it('reaches Zoho through the giver when the new holder completes it', async () => {
            handedOver('completed', { completed_at: DONE_HERE });
            zohoLists([inZoho('In Progress', { modifiedTime: BEFORE })]);
            const r = await ZohoTaskSync.syncUser(GIVER);
            assert.equal(r.pushed, 1);
            assert.deepEqual(puts()[0].body, { status: 'completed' });
        });

        it('is left alone when the giver completes it in Zoho', async () => {
            handedOver('pending');
            zohoLists([inZoho('Completed')]);
            const r = await ZohoTaskSync.syncUser(GIVER);
            assert.equal(r.completed, 0);
            assert.equal(task.status, 'pending');
        });

        it('is still imported by someone Zoho reassigned it to', async () => {
            task = { ...task, employee_id: 'someone-else' };
            zohoLists([inZoho('In Progress')]);
            const r = await ZohoTaskSync.syncUser('reassigned-in-zoho');
            assert.equal(r.imported, 1);
            assert.deepEqual(imported, ['777']);
        });
    });
});
