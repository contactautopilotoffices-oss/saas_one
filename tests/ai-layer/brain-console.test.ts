// No database, no model key, no network and no WhatsApp: the database below is a small in-memory fake.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseBrainSettings } from '../../backend/lib/aiLayer/brain/config';
import {
    consoleSecret, conversationView, conversationsView, labelTurn, memoryView, overviewView, reviewView, saveSettings, scorecardView, setCaseActive, shadowView,
} from '../../backend/lib/aiLayer/brain/console/server';
import {
    conversations, costView, cycleWindow, diffSettings, flagTurns, indiaDay, maskIdentity, overview, personTag, refuseAudience, refuseSettingsChange, skillViews, toTurnView, type TurnRow,
} from '../../backend/lib/aiLayer/brain/console/view';
import type { TurnOutput } from '../../backend/lib/aiLayer/brain/loop/turn';
import { recordTurn } from '../../backend/lib/aiLayer/brain/server';
import { FakeDb, admin, type Row } from './brain-fake-db';
import { ORG, OTHER_ORG, OTHER_USER, USER } from './helpers';

process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-only-server-key';

// ── Rows ──────────────────────────────────────────────────────────────────────────────────────────────────────────

let n = 0;
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
function turn(over: Partial<TurnRow> & { organization_id?: string } = {}): TurnRow & Row {
    n++;
    return {
        id: uuid(n), organization_id: ORG, user_id: USER, channel: 'whatsapp', shadow: false, message_id: `wamid.${n}`,
        user_text: 'what happened to my AC complaint?', reply_text: 'TKT-101 is still open.', outcome: 'answer', reason: null, skill_id: 'tickets.list', handoff_to: null, lang: 'en',
        model: 'anthropic:claude-haiku-5-5', key_slot: 1, tokens_in: 7000, tokens_out: 60, cache_read: 6300, cost_usd: 0.0012, latency_ms: 1800, grounded: true, had_file: false, role_class: 'staff',
        model_calls: [{ seq: 1, model: 'anthropic:claude-haiku-5-5', keySlot: 1, tokensIn: 7000, tokensOut: 60, cacheRead: 6300, cacheWrite: 0, costUsd: 0.0012, ms: 900, stopReason: 'end_turn' }],
        tool_calls: [{ seq: 1, skillId: 'tickets.list', kind: 'read', args: { status: 'open' }, ok: true, resultChars: 80, ms: 20, error: null }], hops: [],
        created_at: '2026-11-04T06:30:00.000Z', ...over,
    };
}
const SECRET = 'k';
const view = (r: TurnRow, flags = flagTurns([r])) => toTurnView(r, { secret: SECRET, orgId: ORG, flags, detail: true });
const at = (minutes: number) => new Date(Date.parse('2026-11-04T06:30:00.000Z') + minutes * 60_000).toISOString();

describe('console: the person is never shown', () => {
    it('phone numbers, email addresses and ids are masked; ticket numbers, dates and times are kept', () => {
        const out = maskIdentity('Call me on +91 98765 43210 or ravi.k@example.com about TKT-101 on 2026-11-14 at 16:00, user 11111111-1111-4111-8111-111111111111')!;
        assert.doesNotMatch(out, /98765|43210|example\.com|11111111/);
        assert.match(out, /\[phone\]/); assert.match(out, /\[email\]/); assert.match(out, /\[id\]/);
        assert.match(out, /TKT-101 on 2026-11-14 at 16:00/);
        assert.equal(maskIdentity(null), null);
    });

    it('a person tag is the same within a day, and different the next day, in another organisation and under another key', () => {
        const a = personTag(SECRET, ORG, USER, '2026-11-04');
        assert.match(a, /^[A-Z0-9]{6}$/);
        assert.equal(personTag(SECRET, ORG, USER, '2026-11-04'), a);
        assert.notEqual(personTag(SECRET, ORG, USER, '2026-11-05'), a);
        assert.notEqual(personTag(SECRET, OTHER_ORG, USER, '2026-11-04'), a);
        assert.notEqual(personTag('other-key', ORG, USER, '2026-11-04'), a);
        assert.notEqual(personTag(SECRET, ORG, OTHER_USER, '2026-11-04'), a);
    });

    it('what the browser gets has no user id, no WhatsApp message id and no phone number', () => {
        const r = turn({ user_text: 'this is my number 9876543210, AC is leaking', tool_calls: [{ seq: 1, skillId: 'ticket.create', kind: 'write', args: { description: 'call 9876543210' }, ok: true, ms: 5 }] });
        const sent = JSON.stringify(view(r));
        assert.ok(!sent.includes(USER)); assert.ok(!sent.includes(String(r.message_id))); assert.ok(!sent.includes('9876543210'));
        assert.match(sent, /AC is leaking/);
    });

    it('an HR matter shows no words and can never be grouped with a conversation', () => {
        const hr = turn({ user_id: null, user_text: null, reply_text: null, reason: 'hr_matter', outcome: 'refuse', tool_calls: [] });
        const v = view(hr);
        assert.equal(v.userText, null); assert.equal(v.replyText, null);
        assert.ok(v.notes.includes('hr_hidden'));
        assert.notEqual(v.person, view(turn()).person);
    });

    it('words cleared after the retention period are marked as cleared, not as empty messages', () => {
        const v = view(turn({ user_text: null, reply_text: null }));
        assert.ok(v.notes.includes('text_cleared')); assert.ok(!v.notes.includes('hr_hidden'));
    });
});

describe('console: which turns are flagged for a human look', () => {
    const flagsOf = (rows: TurnRow[]) => flagTurns(rows);

    it('an error, an action that could not run, an unsupported fact and a hand-over to a person are flagged', () => {
        const rows = [turn({ outcome: 'error' }), turn({ outcome: 'not_executed', reason: 'write_failed', user_id: OTHER_USER }), turn({ grounded: false, user_id: null }), turn({ outcome: 'handoff', handoff_to: 'human', user_id: null })];
        const f = flagsOf(rows);
        assert.deepEqual(f.get(rows[0].id), ['gave_up']);
        assert.deepEqual(f.get(rows[1].id), ['not_done']);
        assert.deepEqual(f.get(rows[2].id), ['ungrounded']);
        assert.deepEqual(f.get(rows[3].id), ['handed_to_person']);
    });

    it('a practice-only skill and a repeated Yes are not mistakes', () => {
        const rows = [turn({ outcome: 'not_executed', reason: 'test_mode' }), turn({ outcome: 'not_executed', reason: 'already_done', user_id: OTHER_USER })];
        const f = flagsOf(rows);
        assert.deepEqual(f.get(rows[0].id), []); assert.deepEqual(f.get(rows[1].id), []);
    });

    it('"no, I meant…" within ten minutes flags the turn BEFORE it', () => {
        const first = turn({ created_at: at(0) }), next = turn({ created_at: at(3), user_text: 'no, I meant the lift ticket' });
        const f = flagsOf([next, first]);
        assert.deepEqual(f.get(first.id), ['correction']); assert.deepEqual(f.get(next.id), []);
    });

    it('a bare "no" to a confirmation card answers the card; it is not a correction', () => {
        const card = turn({ created_at: at(0), outcome: 'propose' }), no = turn({ created_at: at(1), user_text: 'no', outcome: 'cancelled' });
        assert.deepEqual(flagsOf([card, no]).get(card.id), []);
    });

    it('the same request again within two minutes flags the first one', () => {
        const first = turn({ created_at: at(0), user_text: 'book the board room tomorrow at 3' }), again = turn({ created_at: at(1), user_text: 'book board room tomorrow 3' });
        assert.deepEqual(flagsOf([first, again]).get(first.id), ['asked_again']);
    });

    it('two questions in a row flags the second', () => {
        const a = turn({ created_at: at(0), outcome: 'ask' }), b = turn({ created_at: at(1), outcome: 'ask', user_text: 'cabin 4' });
        assert.deepEqual(flagsOf([a, b]).get(b.id), ['question_loop']);
    });

    it('in shadow the person is reacting to the other bot, so a follow-up never flags the brain', () => {
        const first = turn({ created_at: at(0), shadow: true }), next = turn({ created_at: at(2), shadow: true, user_text: 'wrong, I meant the lift' });
        assert.deepEqual(flagsOf([first, next]).get(first.id), []);
    });

    it('a live turn and a shadow turn of the same person are separate tracks', () => {
        const live = turn({ created_at: at(0) }), shadow = turn({ created_at: at(1), shadow: true, user_text: 'no, I meant the lift ticket' });
        assert.deepEqual(flagsOf([live, shadow]).get(live.id), []);
    });
});

describe('console: lists and totals', () => {
    it('a conversation is one person on one India day on one track, newest first', () => {
        const rows = [turn({ created_at: at(0) }), turn({ created_at: at(5), outcome: 'error' }), turn({ created_at: at(6), user_id: OTHER_USER, role_class: 'client' }), turn({ created_at: at(7), shadow: true })];
        const flags = flagTurns(rows);
        const list = conversations(rows.map(r => toTurnView(r, { secret: SECRET, orgId: ORG, flags })));
        assert.equal(list.length, 3);
        const mine = list.find(c => c.turns === 2)!;
        assert.equal(mine.flagged, 1); assert.equal(mine.lastOutcome, 'error'); assert.equal(mine.role, 'staff'); assert.equal(mine.shadow, false);
        assert.equal(mine.preview, 'what happened to my AC complaint?');
        assert.ok(list[0].lastAt >= list[1].lastAt && list[1].lastAt >= list[2].lastAt);
    });

    it('a turn late at night in India belongs to the India day, not the UTC day', () => {
        assert.equal(indiaDay('2026-11-04T19:00:00.000Z'), '2026-11-05');
    });

    it('the overview adds up turns, people, cost, cache use, tool calls and outcomes', () => {
        const rows = [turn({ created_at: at(0) }), turn({ created_at: at(1), user_id: OTHER_USER, outcome: 'error', cost_usd: null, model: null, tool_calls: [], latency_ms: 9000 }), turn({ created_at: at(2), shadow: true, outcome: 'propose' })];
        const flags = flagTurns(rows);
        const o = overview(rows, rows.map(r => toTurnView(r, { secret: SECRET, orgId: ORG, flags })), 7, false);
        assert.equal(o.totals.turns, 3); assert.equal(o.totals.live, 2); assert.equal(o.totals.shadow, 1); assert.equal(o.totals.people, 2); assert.equal(o.totals.flagged, 1);
        assert.equal(o.totals.costUsd, 0.0024);
        assert.equal(o.totals.cacheHitRate, 0.9);
        assert.equal(o.totals.handledRate, 0.6667);
        assert.equal(o.totals.toolCallsPerTurn, 0.67);
        assert.equal(o.bucket, 'day'); assert.equal(o.series.length, 1); assert.equal(o.series[0].turns, 3);
        assert.deepEqual(o.skills, [{ skillId: 'tickets.list', calls: 2, failed: 0 }]);
        assert.equal(o.outcomes.find(x => x.outcome === 'error')!.count, 1);
        assert.equal(o.latestFlagged.length, 1);
        assert.equal(overview(rows, [], 1, false).bucket, 'hour');
    });

    it('skills show which kind of login gets them and the mode in force for this organisation', () => {
        const skills = skillViews(parseBrainSettings({ skillModes: { 'ticket.create': 'live', 'tickets.count': 'off' } }), [turn()]);
        const by = (id: string) => skills.find(s => s.id === id)!;
        assert.equal(skills.length, 23);   // 17 + the six task skills (owner 2026-11-15)
        assert.equal(by('ticket.create').mode, 'live'); assert.equal(by('room.book').mode, 'shadow'); assert.equal(by('tickets.count').mode, 'off');
        assert.deepEqual(by('ticket.create').roles, { staff: true, client: true, vendor: false });
        assert.deepEqual(by('tickets.list').roles, { staff: true, client: true, vendor: true });
        assert.deepEqual(by('knowledge.ask').roles, { staff: true, client: false, vendor: false });
        assert.equal(by('tickets.list').usage.calls, 1);
    });
});

describe('console: settings changes', () => {
    const s = (mode: string, create?: string) => parseBrainSettings({ mode, ...(create ? { skillModes: { 'ticket.create': create } } : {}) });

    it('an action skill cannot go from doing nothing straight to acting for real, by its own switch', () => {
        assert.match(refuseSettingsChange(s('live', 'off'), s('live', 'live'))!, /practice only first/);
        assert.equal(refuseSettingsChange(s('live', 'off'), s('live', 'shadow')), null);
        assert.equal(refuseSettingsChange(s('live', 'shadow'), s('live', 'live')), null);
        assert.equal(refuseSettingsChange(s('live'), s('live', 'live')), null); // the default for an action skill is practice
    });

    it('nor by the organisation switch: a skill saved as live while the brain was off does not go live with it', () => {
        assert.equal(refuseSettingsChange(s('off'), s('off', 'live')), null); // nothing acts while the brain is off
        assert.match(refuseSettingsChange(s('off', 'live'), s('live', 'live'))!, /"ticket\.create" would start acting for real/);
        assert.equal(refuseSettingsChange(s('off', 'live'), s('shadow', 'live')), null);
        assert.equal(refuseSettingsChange(s('shadow', 'live'), s('live', 'live')), null);
    });

    it('turning the brain on with the defaults is allowed: questions answer, actions practise, memory works', () => {
        assert.equal(refuseSettingsChange(s('off'), s('live')), null);
        assert.equal(refuseSettingsChange(s('off'), s('shadow')), null);
    });

    it('a skill name that does not exist, and a change to access per role, are refused', () => {
        assert.match(refuseSettingsChange(s('off'), parseBrainSettings({ skillModes: { 'tickets.delete': 'live' } }))!, /not a skill of the brain/);
        assert.match(refuseSettingsChange(s('off'), parseBrainSettings({ grid: { vendor: { tickets: 'questions_actions' } } }))!, /cannot be changed from the console yet/);
    });

    it('people outside the Tech team are in the pilot five at a time or not at all, so no message can be traced to one of them', () => {
        const others = [1, 2, 3, 4, 5].map(i => ({ id: uuid(9000 + i), isTech: false }));
        const members = [{ id: USER, isTech: true }, ...others];
        const pilot = (ids: string[], over: Record<string, unknown> = {}) => parseBrainSettings({ mode: 'shadow', pilotUserIds: ids, ...over });
        assert.equal(refuseAudience(pilot([USER]), members), null);                                        // the Tech team testing on itself
        assert.match(refuseAudience(pilot([USER, others[0].id]), members)!, /Only 1 person from outside the Tech team/);
        assert.match(refuseAudience(pilot(others.slice(0, 4).map(o => o.id)), members)!, /Only 4 people/);
        assert.equal(refuseAudience(pilot(others.map(o => o.id)), members), null);
        assert.match(refuseAudience(pilot(others.map(o => o.id), { blockedUserIds: [others[0].id] }), members)!, /Only 4 people/); // blocking narrows it too
        assert.equal(refuseAudience(pilot([others[0].id], { mode: 'off' }), members), null);              // nothing is recorded while off
        assert.equal(refuseAudience(parseBrainSettings({ mode: 'live', audience: 'everyone' }), members), null);
        assert.match(refuseAudience(parseBrainSettings({ mode: 'live', audience: 'everyone' }), members.slice(0, 3))!, /Only 2 people/);
    });

    it('the change log says what changed in plain words and counts people without listing them', () => {
        const lines = diffSettings(parseBrainSettings({}), parseBrainSettings({ mode: 'shadow', pilotUserIds: [USER, OTHER_USER], channels: { whatsapp: true, app_chat: false }, skillModes: { 'room.book': 'live' } }));
        assert.deepEqual(lines, ['Mode: off → practice only', 'Pilot people: 2 added (now 2)', 'WhatsApp: off → on', 'Skill room.book: practice only → live']);
        assert.ok(!lines.join(' ').includes(USER));
        assert.deepEqual(diffSettings(parseBrainSettings({}), parseBrainSettings({})), []);
    });
});

describe('console: cost per key and billing cycle', () => {
    it('without a saved date the cycle is the calendar month', () => {
        assert.deepEqual(cycleWindow(null, '2026-11-14'), { start: '2026-11-01', end: '2026-11-30', known: false });
    });
    it('a saved end date is rolled forward to the cycle that contains today', () => {
        assert.deepEqual(cycleWindow('2026-09-20', '2026-11-14'), { start: '2026-10-21', end: '2026-11-20', known: true });
        assert.deepEqual(cycleWindow('2026-11-14', '2026-11-14'), { start: '2026-10-15', end: '2026-11-14', known: true });
        assert.deepEqual(cycleWindow('2027-03-05', '2026-11-14'), { start: '2026-11-06', end: '2026-12-05', known: true });
    });
    it('spend is counted per key inside its own cycle, with a projection to the end of it', () => {
        const rows = [
            { created_at: '2026-11-10T06:00:00Z', key_slot: 1, cost_usd: 2, model: 'anthropic:claude-opus-5-5', skill_id: 'tickets.list' },
            { created_at: '2026-11-12T06:00:00Z', key_slot: 1, cost_usd: '1.5', model: 'anthropic:claude-opus-5-5', skill_id: null },
            { created_at: '2026-10-20T06:00:00Z', key_slot: 1, cost_usd: 9, model: 'anthropic:claude-opus-5-5', skill_id: null }, // last cycle
            { created_at: '2026-11-12T06:00:00Z', key_slot: 2, cost_usd: 4, model: 'anthropic:claude-haiku-5-5', skill_id: null },
            { created_at: '2026-11-12T06:00:00Z', key_slot: null, cost_usd: null, model: 'glm-5.3-flash', skill_id: null },
        ];
        const keys = [{ slot: 1, name: 'CLAUDE_API_KEY', set: true, resting: null }, { slot: 2, name: 'CLAUDE_API_KEY_2', set: false, resting: null }];
        const c = costView(rows, parseBrainSettings({}), keys, new Date('2026-11-14T06:00:00Z'));
        assert.equal(c.keys[0].spentUsd, 3.5); assert.equal(c.keys[0].turns, 2); assert.equal(c.keys[0].creditUsd, 100); assert.equal(c.keys[0].cycleKnown, false);
        assert.equal(c.keys[0].projectedUsd, 7.5); // 3.5 over 14 days of a 30-day month
        assert.equal(c.keys[1].spentUsd, 4); assert.equal(c.keys[1].set, false);
        assert.equal(c.last30.turns, 5); assert.equal(c.last30.turnsWithoutCost, 1); assert.equal(c.last30.costUsd, 16.5);
        assert.equal(c.byModel[0].model, 'anthropic:claude-opus-5-5');
    });
});

// ── With the (fake) database ──────────────────────────────────────────────────────────────────────────────────────

function world() {
    const db = new FakeDb();
    db.tables.ai_brain_settings = [{ organization_id: ORG, config: { mode: 'off' }, updated_at: '2026-11-14T05:00:00.000000+00:00' }];
    db.tables.ai_brain_settings_history = [];
    db.tables.ai_brain_eval_cases = [];
    db.tables.properties = [];
    db.tables.organization_memberships = [{ organization_id: ORG, user_id: USER, role: 'tech', is_active: true }, { organization_id: OTHER_ORG, user_id: OTHER_USER, role: 'tech', is_active: true }];
    db.tables.users = [{ id: USER, full_name: 'Test Tech' }];
    db.tables.ai_brain_turns = [];
    db.tables.whatsapp_inbound_ledger = [];
    return { db, a: admin(db) };
}
const BASED_ON = '2026-11-14T05:00:00.000000+00:00';

describe('console: saving settings', () => {
    it('a valid change is saved once, with a change-log row that keeps before and after', async () => {
        const { db, a } = world();
        const out = await saveSettings(a, ORG, USER, { settings: parseBrainSettings({ mode: 'shadow', pilotUserIds: [USER], channels: { whatsapp: true, app_chat: false } }), updatedAt: BASED_ON });
        assert.deepEqual(out, { ok: true });
        assert.equal((db.tables.ai_brain_settings[0].config as { mode: string }).mode, 'shadow');
        assert.equal(db.tables.ai_brain_settings[0].updated_by, USER);
        assert.equal(db.tables.ai_brain_settings_history.length, 1);
        assert.deepEqual(db.tables.ai_brain_settings_history[0].before, { mode: 'off' });
    });

    it('settings that do not pass the schema are refused and nothing is written', async () => {
        const { db, a } = world();
        const out = await saveSettings(a, ORG, USER, { settings: { mode: 'live', limits: { perUserPerHour: 99999 } }, updatedAt: BASED_ON });
        assert.equal(out.ok, false); assert.equal(!out.ok && out.status, 400);
        assert.equal(db.writes.length, 0);
    });

    it('a save based on a copy someone else has since changed is refused', async () => {
        const { db, a } = world();
        const out = await saveSettings(a, ORG, USER, { settings: parseBrainSettings({ mode: 'shadow' }), updatedAt: '2026-11-13T00:00:00.000000+00:00' });
        assert.equal(!out.ok && out.status, 409);
        assert.equal(db.writes.length, 0);
    });

    it('someone who is not a member of this organisation cannot be put in the pilot', async () => {
        const { db, a } = world();
        const out = await saveSettings(a, ORG, USER, { settings: parseBrainSettings({ mode: 'shadow', pilotUserIds: [OTHER_USER] }), updatedAt: BASED_ON });
        assert.equal(!out.ok && out.status, 400); assert.match(!out.ok ? out.error : '', /not active members/);
        assert.equal(db.writes.length, 0);
    });

    it('a write skill that is off cannot be saved as live', async () => {
        const { db, a } = world();
        db.tables.ai_brain_settings[0].config = { mode: 'live', skillModes: { 'room.book': 'off' } };
        const out = await saveSettings(a, ORG, USER, { settings: parseBrainSettings({ mode: 'live', skillModes: { 'room.book': 'live' } }), updatedAt: BASED_ON });
        assert.equal(!out.ok && out.status, 400);
        assert.equal(db.writes.length, 0);
    });

    it('one person from outside the Tech team cannot be made the whole pilot', async () => {
        const { db, a } = world();
        const outsider = uuid(9001);
        db.tables.organization_memberships.push({ organization_id: ORG, user_id: outsider, role: 'property_admin', is_active: true });
        const out = await saveSettings(a, ORG, USER, { settings: parseBrainSettings({ mode: 'shadow', pilotUserIds: [outsider], channels: { whatsapp: true, app_chat: false } }), updatedAt: BASED_ON });
        assert.equal(!out.ok && out.status, 400); assert.match(!out.ok ? out.error : '', /traced back to them/);
        assert.equal(db.writes.length, 0);
    });

    it('a save that loses the race leaves no change-log row behind', async () => {
        const { db, a } = world();
        db.lostRace.add('ai_brain_settings');
        const out = await saveSettings(a, ORG, USER, { settings: parseBrainSettings({ mode: 'shadow' }), updatedAt: BASED_ON });
        assert.equal(!out.ok && out.status, 409);
        assert.equal(db.tables.ai_brain_settings_history.length, 0);
        assert.equal((db.tables.ai_brain_settings[0].config as { mode: string }).mode, 'off');
    });

    it('if the change log cannot be written, the setting is not changed', async () => {
        const { db, a } = world();
        db.missingTables.add('ai_brain_settings_history');
        await assert.rejects(saveSettings(a, ORG, USER, { settings: parseBrainSettings({ mode: 'shadow' }), updatedAt: BASED_ON }), /change log/);
        assert.equal((db.tables.ai_brain_settings[0].config as { mode: string }).mode, 'off');
    });

    it('saving with nothing changed writes nothing', async () => {
        const { db, a } = world();
        assert.deepEqual(await saveSettings(a, ORG, USER, { settings: parseBrainSettings({ mode: 'off' }), updatedAt: BASED_ON }), { ok: true });
        assert.equal(db.writes.length, 0);
    });

    it('before the tables exist, saving says so instead of failing', async () => {
        const { db, a } = world();
        db.missingTables.add('ai_brain_settings');
        const out = await saveSettings(a, ORG, USER, { settings: parseBrainSettings({ mode: 'shadow' }), updatedAt: null });
        assert.equal(!out.ok && out.status, 503);
    });
});

describe('console: screens read only this organisation and never say who', () => {
    it('the overview, the conversation list and one conversation carry no user id; another organisation is never read', async () => {
        const { db, a } = world();
        const today = new Date();
        const iso = (m: number) => new Date(today.getTime() - m * 60_000).toISOString();
        db.tables.ai_brain_turns = [turn({ created_at: iso(30) }), turn({ created_at: iso(20), outcome: 'error' }), turn({ created_at: iso(10), user_id: OTHER_USER }), turn({ created_at: iso(5), organization_id: OTHER_ORG, user_text: 'SECRET OF ANOTHER ORG' })];
        const o = await overviewView(a, ORG, 7);
        assert.equal(o.totals.turns, 3);
        const list = await conversationsView(a, ORG, 7, false, false);
        const sent = JSON.stringify([o, list]);
        assert.ok(!sent.includes(USER)); assert.ok(!sent.includes(OTHER_USER)); assert.ok(!sent.includes('wamid')); assert.ok(!sent.includes('SECRET OF ANOTHER ORG'));
        const flagged = await conversationsView(a, ORG, 7, false, true);
        assert.equal(flagged.length, 1);

        const mine = list.find(c => c.turns === 2)!;
        const thread = await conversationView(a, ORG, mine.person, mine.day, false);
        assert.equal(thread!.length, 2);
        assert.ok(thread![0].at < thread![1].at);
        assert.ok(thread![0].toolCalls && thread![0].modelCalls);
        assert.equal(thread!.every(t => t.person === personTag(consoleSecret(), ORG, USER, mine.day)), true);
        assert.equal(await conversationView(a, ORG, 'not-a-tag', mine.day, false), null);
        assert.deepEqual(await conversationView(a, ORG, 'ZZZZZZ', mine.day, false), []);
    });

    it('before migration 3 (no role_class column) the screens still load, without the kind of login', async () => {
        const { db, a } = world();
        db.missingColumns.add('role_class');
        db.tables.ai_brain_turns = [turn({ created_at: new Date().toISOString() })];
        const o = await overviewView(a, ORG, 1);
        assert.equal(o.totals.turns, 1);
    });

    it('shadow shows which of today\'s bots answered, looked up on the server by a message id that is never sent', async () => {
        const { db, a } = world();
        const t = turn({ created_at: new Date().toISOString(), shadow: true, outcome: 'propose', message_id: 'wamid.shadow' });
        db.tables.ai_brain_turns = [t, turn({ created_at: new Date().toISOString(), shadow: true, message_id: 'wamid.other' })];
        db.tables.whatsapp_inbound_ledger = [{ message_id: 'wamid.shadow', route: 'smart_chat' }];
        const s = await shadowView(a, ORG, 7);
        assert.equal(s.totals.turns, 2); assert.equal(s.totals.wouldAct, 1); assert.equal(s.totals.unlabelled, 2);
        assert.equal(s.turns.find(x => x.id === t.id)!.answeredBy, 'Task assistant (smart chat)');
        assert.equal(s.turns.find(x => x.id !== t.id)!.answeredBy, null);
        assert.ok(!JSON.stringify(s).includes('wamid'));
    });

    it('memory shows counts only', async () => {
        const { db, a } = world();
        db.tables.ai_brain_memory = [
            { organization_id: ORG, user_id: USER, key: 'usual_location', label: 'Usual location', value: '3rd floor, cabin 304' },
            { organization_id: ORG, user_id: OTHER_USER, key: 'usual_location', label: 'Usual location', value: 'Reception' },
            { organization_id: OTHER_ORG, user_id: OTHER_USER, key: 'preferred_room', label: 'Preferred room', value: 'Board Room' },
        ];
        db.tables.ai_brain_episodes = [{ organization_id: ORG, skill_id: 'ticket.create', created_at: new Date().toISOString() }];
        const m = await memoryView(a, ORG, parseBrainSettings({}));
        assert.equal(m.people, 2); assert.deepEqual(m.facts, [{ key: 'usual_location', label: 'Usual location', count: 2 }]); assert.equal(m.episodes.total, 1);
        const sent = JSON.stringify(m);
        assert.ok(!sent.includes('cabin 304')); assert.ok(!sent.includes(USER));
    });

    it('the scorecard lists the test messages even before a real run', () => {
        const s = scorecardView();
        assert.ok(s.golden.length >= 50);
        assert.ok(s.golden.every(g => g.id && g.expect));
    });
});

describe('console: judging a turn (the learning loop)', () => {
    async function withTurn(over: Partial<TurnRow> & { organization_id?: string } = {}) {
        const w = world();
        const t = turn({ created_at: new Date().toISOString(), outcome: 'error', user_text: 'book the board room, call me on 9876543210', ...over });
        w.db.tables.ai_brain_turns = [t];
        return { ...w, t };
    }

    it('a flagged turn is in the queue until someone judges it', async () => {
        const { a, t } = await withTurn();
        const before = await reviewView(a, ORG, parseBrainSettings({}));
        assert.deepEqual(before.queue.map(q => q.id), [t.id]);
        assert.ok(before.queue[0].toolCalls);
        assert.deepEqual(await labelTurn(a, ORG, USER, { turnId: t.id, verdict: 'wrong', expectedOutcome: 'propose', expectedSkill: 'room.book', note: 'should offer the booking' }), { ok: true });
        const after = await reviewView(a, ORG, parseBrainSettings({}));
        assert.equal(after.queue.length, 0); assert.deepEqual(after.judged, { right: 0, wrong: 1 });
        assert.equal(after.cases[0].expectedSkill, 'room.book'); assert.equal(after.cases[0].gotOutcome, 'error'); assert.equal(after.cases[0].role, 'staff');
    });

    it('the test case keeps the masked message and the kind of login, never who sent it', async () => {
        const { db, a, t } = await withTurn();
        await labelTurn(a, ORG, USER, { turnId: t.id, verdict: 'wrong', expectedOutcome: 'propose', expectedSkill: 'room.book', note: null });
        const row = db.tables.ai_brain_eval_cases[0];
        assert.equal(row.message_text, 'book the board room, call me on [phone]');
        assert.equal(row.role_class, 'staff'); assert.equal(row.created_by, USER);
        assert.ok(!('user_id' in row)); assert.ok(!('message_id' in row));
    });

    it('"right" records what the brain did as the expected ending, whatever the browser sent', async () => {
        const { db, a, t } = await withTurn({ outcome: 'answer', skill_id: 'tickets.list' });
        await labelTurn(a, ORG, USER, { turnId: t.id, verdict: 'right', expectedOutcome: 'propose', expectedSkill: 'room.book' });
        assert.equal(db.tables.ai_brain_eval_cases[0].expected_outcome, 'answer'); assert.equal(db.tables.ai_brain_eval_cases[0].expected_skill, 'tickets.list');
    });

    it('judging the same turn again replaces the earlier judgement', async () => {
        const { db, a, t } = await withTurn();
        await labelTurn(a, ORG, USER, { turnId: t.id, verdict: 'wrong', expectedOutcome: 'ask', expectedSkill: null });
        await labelTurn(a, ORG, USER, { turnId: t.id, verdict: 'wrong', expectedOutcome: 'propose', expectedSkill: 'room.book' });
        assert.equal(db.tables.ai_brain_eval_cases.length, 1); assert.equal(db.tables.ai_brain_eval_cases[0].expected_outcome, 'propose');
    });

    it('"wrong" needs a real ending and a real skill', async () => {
        const { db, a, t } = await withTurn();
        assert.equal((await labelTurn(a, ORG, USER, { turnId: t.id, verdict: 'wrong' })).ok, false);
        assert.equal((await labelTurn(a, ORG, USER, { turnId: t.id, verdict: 'wrong', expectedOutcome: 'error' })).ok, false);
        assert.equal((await labelTurn(a, ORG, USER, { turnId: t.id, verdict: 'wrong', expectedOutcome: 'propose', expectedSkill: 'tickets.delete' })).ok, false);
        assert.equal((await labelTurn(a, ORG, USER, { turnId: t.id, verdict: 'maybe' })).ok, false);
        assert.equal(db.tables.ai_brain_eval_cases.length, 0);
    });

    it('a turn of another organisation cannot be judged from here', async () => {
        const { db, a, t } = await withTurn({ organization_id: OTHER_ORG });
        const out = await labelTurn(a, ORG, USER, { turnId: t.id, verdict: 'right' });
        assert.equal(!out.ok && out.status, 404);
        assert.equal(db.tables.ai_brain_eval_cases.length, 0);
    });

    it('an HR matter or a message whose words are gone cannot become a test case', async () => {
        const hr = await withTurn({ reason: 'hr_matter', user_text: null, user_id: null });
        assert.equal((await labelTurn(hr.a, ORG, USER, { turnId: hr.t.id, verdict: 'right' })).ok, false);
        const gone = await withTurn({ user_text: null });
        assert.equal((await labelTurn(gone.a, ORG, USER, { turnId: gone.t.id, verdict: 'right' })).ok, false);
    });

    it('before migration 3 judging says it is not available yet', async () => {
        const { db, a, t } = await withTurn();
        db.missingTables.add('ai_brain_eval_cases');
        const out = await labelTurn(a, ORG, USER, { turnId: t.id, verdict: 'right' });
        assert.equal(!out.ok && out.status, 503);
    });

    it('a test case can be switched off and on, only inside its own organisation', async () => {
        const { db, a, t } = await withTurn();
        await labelTurn(a, ORG, USER, { turnId: t.id, verdict: 'right' });
        const id = String(db.tables.ai_brain_eval_cases[0].id);
        db.tables.ai_brain_eval_cases[0].organization_id = ORG;
        assert.deepEqual(await setCaseActive(a, ORG, { caseId: id, active: false }), { ok: true });
        assert.equal(db.tables.ai_brain_eval_cases[0].active, false);
        const other = await setCaseActive(a, OTHER_ORG, { caseId: id, active: true });
        assert.equal(!other.ok && other.status, 404);
        assert.equal(db.tables.ai_brain_eval_cases[0].active, false);
    });
});

describe('turn record: the kind of login is kept, who it was is not shown', () => {
    const out = (reason: string | null = null) => ({
        reply: { text: 'TKT-101 is still open.' }, state: {}, outcome: 'answer', handoffTo: null, lang: 'en',
        trace: { outcome: 'answer', reason, skillId: 'tickets.list', modelCalls: [], toolCalls: [], hops: [], grounded: true, latencyMs: 900, costUsd: 0.001, tokensIn: 10, tokensOut: 5 },
    }) as unknown as TurnOutput;
    const rec = (o: TurnOutput) => ({ orgId: ORG, userId: USER, channel: 'whatsapp' as const, shadow: false, messageId: 'wamid.1', userText: 'status?', hadFile: false, out: o, roleClass: 'client' as const });

    it('a turn is recorded with staff / client / vendor', async () => {
        const { db, a } = world();
        await recordTurn(a, rec(out()));
        assert.equal(db.tables.ai_brain_turns[0].role_class, 'client');
    });

    it('before migration 3 the turn is still recorded, without the kind of login', async () => {
        const { db, a } = world();
        db.missingColumns.add('role_class');
        await recordTurn(a, rec(out()));
        assert.equal(db.tables.ai_brain_turns.length, 1);
        assert.ok(!('role_class' in db.tables.ai_brain_turns[0]));
        assert.equal(db.tables.ai_brain_turns[0].user_text, 'status?');
    });

    it('an HR matter is recorded without the person and without any words', async () => {
        const { db, a } = world();
        await recordTurn(a, rec(out('hr_matter')));
        const row = db.tables.ai_brain_turns[0];
        assert.equal(row.user_id, null); assert.equal(row.user_text, null); assert.equal(row.reply_text, null);
    });
});
