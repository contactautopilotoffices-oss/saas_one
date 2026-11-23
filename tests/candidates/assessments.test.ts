import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, after, describe, it } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assessmentChoices, assessmentReceipts, sendAssessment, type AssessmentSendDeps } from '../../backend/lib/candidates/assessments';
import { createRecord } from '../../backend/lib/candidates/records';
import { freshDb } from './db-stub';
import { pgliteSupabase } from './pglite-supabase';

const ORG = randomUUID(), OTHER = randomUUID(), USER = randomUUID(), TEST = randomUUID(), SECOND = randomUUID(), FOREIGN = randomUUID(), CONN = randomUUID();
const by = { id: USER, name: 'Recruiter' };
describe('candidate assessment invitations', () => {
  let db: PGlite, client: SupabaseClient, applicationId: string, candidateId: string;
  const sent: { channel: string; value: unknown }[] = [];
  const deps: AssessmentSendDeps = {
    whatsapp: async o => { sent.push({ channel: 'whatsapp', value: o }); return { success: true }; },
    email: async o => { sent.push({ channel: 'email', value: o }); return { status: 'sent' }; },
  };
  before(async () => {
    db = await freshDb(); client = pgliteSupabase(db);
    await db.exec('create table proctor_tests (id uuid primary key, organization_id uuid, title text, duration_minutes int, public_token text, is_active boolean, created_at timestamptz default now())');
    await db.exec(readFileSync('supabase/migrations/20261122000005_candidate_assessments.sql', 'utf8'));
    await db.query('insert into organizations(id) values ($1),($2)', [ORG, OTHER]);
    await db.query('insert into auth.users(id) values ($1)', [USER]);
    await db.query("insert into proctor_tests(id, organization_id, title, duration_minutes, public_token, is_active) values ($1,$2,'Aptitude',20,'public-link',true),($3,$2,'Technical',30,'second-link',true),($4,$5,'Foreign',10,'other-link',true)", [TEST, ORG, SECOND, FOREIGN, OTHER]);
    const result = await createRecord(client, ORG, USER, { fullName: 'Asha Rao', email: 'asha@example.test', phone: '9876543210' });
    applicationId = result.record.id; candidateId = result.record.candidateId;
  });
  after(async () => db.close());
  const input = (channel: 'email' | 'whatsapp', testId = TEST) => ({ applicationId, testId, channel, connectionId: CONN });
  it('lists existing active assessments without exposing questions or crossing organisations', async () => {
    const choices = await assessmentChoices(client, ORG, 'https://app.example.test');
    assert.equal(choices.length, 2);
    assert.deepEqual(choices.find(t => t.id === TEST), { id: TEST, title: 'Aptitude', duration: 20, url: 'https://app.example.test/t/public-link' });
    await assert.rejects(sendAssessment(client, ORG, by, input('email', FOREIGN), 'https://app.example.test', deps), /unavailable/);
    await assert.rejects(sendAssessment(client, OTHER, by, input('email'), 'https://app.example.test', deps), /no longer exists/);
    assert.equal(sent.length, 0);
  });
  it('sends the real assessment link by both channels once and records candidate history', async () => {
    assert.equal((await sendAssessment(client, ORG, by, input('email'), 'https://app.example.test', deps)).status, 'sent');
    assert.equal((await sendAssessment(client, ORG, by, input('whatsapp'), 'https://app.example.test', deps)).status, 'sent');
    assert.equal((await sendAssessment(client, ORG, by, input('email'), 'https://app.example.test', deps)).status, 'sent');
    assert.equal(sent.length, 2);
    assert.match(JSON.stringify(sent[0].value), /https:\/\/app.example.test\/t\/public-link/);
    assert.match(JSON.stringify(sent[1].value), /919876543210/);
    assert.equal((await assessmentReceipts(client, ORG, applicationId)).length, 2);
    const history = await db.query("select * from candidate_actions where action = 'outreach_sent' and candidate_id = $1", [candidateId]);
    assert.equal(history.rows.length, 2);
  });
  it('rejects inactive assessments, missing contacts and blacklisted candidates before delivery', async () => {
    await db.query('update proctor_tests set is_active = false where id = $1', [SECOND]);
    await assert.rejects(sendAssessment(client, ORG, by, input('email', SECOND), '', deps), /unavailable/);
    await db.query('update proctor_tests set is_active = true where id = $1', [SECOND]);
    const noContact = await createRecord(client, ORG, USER, { fullName: 'No contact' });
    await assert.rejects(sendAssessment(client, ORG, by, { ...input('email', SECOND), applicationId: noContact.record.id }, '', deps), /valid candidate email/);
    await assert.rejects(sendAssessment(client, ORG, by, { ...input('whatsapp', SECOND), applicationId: noContact.record.id }, '', deps), /valid Indian mobile/);
    await db.query('update candidates set blacklisted_at = now(), blacklist_reason = $2 where id = $1', [candidateId, 'asked_not_to_contact']);
    await assert.rejects(sendAssessment(client, ORG, by, input('email', SECOND), '', deps), /blacklisted/);
    await db.query('update candidates set blacklisted_at = null, blacklist_reason = null where id = $1', [candidateId]);
    assert.equal(sent.length, 2);
  });
  it('claims concurrent sends once and never automatically retries an uncertain result', async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(r => { enter = r; });
    const held = new Promise<void>(r => { release = r; });
    let calls = 0;
    const slow: AssessmentSendDeps = { ...deps, whatsapp: async () => { calls++; enter(); await held; return { success: false, ambiguous: true, error: 'Timeout' }; } };
    const first = sendAssessment(client, ORG, by, input('whatsapp', SECOND), 'https://app.example.test', slow);
    await entered;
    assert.equal((await sendAssessment(client, ORG, by, input('whatsapp', SECOND), 'https://app.example.test', slow)).status, 'sending');
    release();
    assert.equal((await first).status, 'unknown');
    assert.equal((await sendAssessment(client, ORG, by, input('whatsapp', SECOND), 'https://app.example.test', slow)).status, 'unknown');
    assert.equal(calls, 1);
  });
  it('allows retry after a definite rejection, without another send after success', async () => {
    let calls = 0;
    const rejected = { ...deps, email: async () => { calls++; return { status: calls === 1 ? 'failed' : 'sent', error: calls === 1 ? 'Rejected' : null }; } };
    assert.equal((await sendAssessment(client, ORG, by, input('email', SECOND), 'https://app.example.test', rejected)).status, 'failed');
    assert.equal((await sendAssessment(client, ORG, by, input('email', SECOND), 'https://app.example.test', rejected)).status, 'sent');
    await sendAssessment(client, ORG, by, input('email', SECOND), 'https://app.example.test', rejected);
    assert.equal(calls, 2);
    const privileges = await db.query<{ allowed: boolean }>("select has_table_privilege('authenticated','candidate_assessment_invites','SELECT') as allowed");
    assert.equal(privileges.rows[0].allowed, false);
  });
});
