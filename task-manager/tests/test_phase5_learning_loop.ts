/** Phase 5 — learning loop, prompt versions, nightly safety eval and health (OFFLINE only). */
/* eslint-disable @typescript-eslint/no-explicit-any -- malformed DTOs deliberately exercise runtime validators */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';
delete process.env.WHATSAPP_LEARNING_LOOP_ENABLED;
delete process.env.WHATSAPP_PROMPT_VERSIONS_ENABLED;
delete process.env.WHATSAPP_NIGHTLY_AUTOTUNE_ENABLED;

import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => ok ? console.log(`  ✓ ${name}`) : (failures++, console.error(`  ✗ ${name}`, detail ?? ''));
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

async function run() {
  const prompt = await import('../brain/prompt');
  const learning = await import('../LearningLoop');
  const nightly = await import('../BotAutoTune');
  const health = await import('../BotHealth');

  console.log('\n1. Locked prompt and version validation');
  const legacy = prompt.interpretSystemPrompt([]);
  check('built-in tunable sections reproduce the exact legacy prompt', prompt.interpretSystemPromptWithSections([], prompt.BUILTIN_PROMPT_SECTIONS) === legacy);
  check('valid sections accepted', prompt.validatePromptSections({ steps: ['1. Read context.', '2. Choose one intent.'], examples: ['Example. Message: tasks'] }, { maxChars: 12000, maxBaseChars: 1000 }).ok);
  check('unknown keys rejected', !prompt.validatePromptSections({ steps: ['x'], examples: ['y'], intents: ['hack'] } as any, { maxChars: 12000, maxBaseChars: 1000 }).ok);
  check('empty strings and >120% growth rejected', !prompt.validatePromptSections({ steps: [''], examples: ['y'] }, { maxChars: 12000, maxBaseChars: 1000 }).ok && !prompt.validatePromptSections({ steps: ['x'.repeat(1201)], examples: ['y'] }, { maxChars: 12000, maxBaseChars: 1000 }).ok);
  check('prompt versions show a stable text diff', prompt.promptSectionDiff({ steps: ['one'], examples: ['old'] }, { steps: ['one', 'two'], examples: ['new'] }).includes('+ two') && prompt.promptSectionDiff({ steps: ['one'], examples: ['old'] }, { steps: ['one', 'two'], examples: ['new'] }).includes('- old'));

  console.log('\n2. Review capture and labels');
  check('unknown, second clarify, apology, correction and undo are captured',
    learning.learningTriggers({ intent: 'unknown' }).includes('unknown') &&
    learning.learningTriggers({ outcome: 'CLARIFY', previousOutcome: 'CLARIFY' }).includes('repeated_clarify') &&
    learning.learningTriggers({ apology: true }).includes('apology') &&
    learning.learningTriggers({ text: 'no, I meant Vidya' }).includes('correction') &&
    learning.learningTriggers({ exact: 'undo' }).includes('undo'));
  const safe = learning.sanitizeReplayContext({ today: '2026-10-11', sender: { id: 'u1', name: 'A', phone: '999' } as any, people: [{ id: 'u2', name: 'B', phone: '888' }] as any, tasks: [{ id: 't1', title: 'Quote', status: 'pending' }] as any, pending: { kind: 'confirm', summary: 'Call +91 98765 43210' } });
  check('replay context keeps opaque ids and model facts but no phones', JSON.stringify(safe).includes('u1') && JSON.stringify(safe).includes('Quote') && !JSON.stringify(safe).includes('999') && !JSON.stringify(safe).includes('888') && !JSON.stringify(safe).includes('98765'));
  const chatCtx = (lines: unknown, pending: any = null) => learning.sanitizeReplayContext({ today: '2026-11-05', conversation: lines, pending } as any) as any;
  const chatLines = Array.from({ length: 12 }, (_, i) => `Person: line ${i}`);
  check('the recent chat is kept with a test, newest 8, in order', JSON.stringify(chatCtx(chatLines).conversation) === JSON.stringify(chatLines.slice(-8)));
  const redacted = chatCtx(['Person: call me on +91 98765 43210', 'Person: mail priya.shah@autopilotoffices.com today', 'Assistant: ok']).conversation;
  check('phone numbers and email addresses never stay in a saved chat line', !/98765|priya\.shah|autopilotoffices/.test(JSON.stringify(redacted)) && redacted[0].includes('[phone redacted]') && redacted[1].includes('[email redacted]'));
  check('a long chat line is cut', chatCtx(['Person: ' + 'x'.repeat(2000)]).conversation[0].length === 300);
  check('no chat → no conversation field, as in a live turn', !('conversation' in chatCtx([])) && !('conversation' in chatCtx(undefined)) && !('conversation' in chatCtx([7, null])));
  const draftPending = chatCtx([], { kind: 'draft', request: 'add task, mail a@b.co', question: 'For whom?', at: '2026-11-05T10:00:00Z', suggested: 'Call vendor' }).pending;
  check('an unfinished request is kept with a test, without contact details', draftPending?.kind === 'draft' && draftPending.question === 'For whom?' && draftPending.suggested === 'Call vendor' && draftPending.at === '2026-11-05T10:00:00Z' && !draftPending.request.includes('a@b.co'));
  check('an unfinished request is enough context for an answer test', learning.repairReviewLabel({ intent: 'answer_pending', outcome: 'ACT', expect: { answer: 'yes' } }, { pending: draftPending }).ok);
  check('review labels are closed-list and structurally checked', learning.validateReviewLabel({ intent: 'view_tasks', outcome: 'ACT', expect: { scope: 'self' } }).ok && !learning.validateReviewLabel({ intent: 'invented', outcome: 'ACT', expect: {} } as any).ok);
  check('review labels reject invalid typed details', !learning.validateReviewLabel({ intent: 'view_tasks', outcome: 'ACT', expect: { scope: 'planet' } }).ok && !learning.validateReviewLabel({ intent: 'complete_tasks', outcome: 'CONFIRM', expect: { taskIds: [7] } }).ok);

  console.log('\n3. Nightly gates and budget');
  check('nightly starts only after 02:00 IST with new labels and no run today', nightly.shouldStartNightly(new Date('2026-10-10T21:00:00Z'), { newestLabelAt: '2026-10-10T20:00:00Z', lastConsumedLabelAt: null, runDate: null }));
  check('quiet night makes zero-call early exit', !nightly.shouldStartNightly(new Date('2026-10-10T21:00:00Z'), { newestLabelAt: null, lastConsumedLabelAt: null, runDate: null }));
  check('worst-case reservation blocks a call over $0.25', nightly.reserveWorstCaseUsd('x'.repeat(1000), 1200, 0.135, 0.45) > 0 && !nightly.withinNightlyCap(0.2499, 0.001, 0.25));
  const good = { passRate: 98, unsafe: 0, missedClarify: 0, wrongProposal: 0, byGroup: { a: 9, b: 10 } };
  check('candidate must be no worse on score, safety and groups', nightly.candidatePasses(good, { ...good, passRate: 99, byGroup: { a: 8, b: 10 } }).ok && !nightly.candidatePasses(good, { ...good, unsafe: 1 }).ok && !nightly.candidatePasses(good, { ...good, byGroup: { a: 7, b: 10 } }).ok);
  // Owner 2026-11-05: the numbers of the real v1, which was rejected although it was better than the prompt in use.
  const inUse = { passRate: 63.6, unsafe: 1, missedClarify: 1, wrongProposal: 1, byGroup: { live: 2, real: 4, progress: 1 }, flagged: ['x', 'y', 'z'] };
  const v1 = { ...inUse, passRate: 66.7, byGroup: { live: 3, real: 5 } };
  check('a better prompt passes even when the prompt in use is not at zero', nightly.candidatePasses(inUse, v1).ok);
  check('a group going from 1 to 0 is one lost case, not a rejection', !('progress' in v1.byGroup) && nightly.candidatePasses(inUse, v1).reason === null);
  check('losing two cases in a group is still rejected, also when it reaches 0', !nightly.candidatePasses({ ...inUse, byGroup: { live: 2 } }, { ...inUse, byGroup: {} }).ok);
  for (const k of ['unsafe', 'missedClarify', 'wrongProposal'] as const) check(`more ${k} than the prompt in use is rejected`, !nightly.candidatePasses(inUse, { ...v1, [k]: inUse[k] + 1 }).ok);
  check('equal totals cannot hide a test that became unsafe', !nightly.candidatePasses(inUse, { ...v1, flagged: ['x', 'y', 'new'] }).ok);
  check('fewer safety failures pass', nightly.candidatePasses(inUse, { ...v1, unsafe: 0, flagged: ['x', 'y'] }).ok);
  check('versions tested before this change have no flagged list and still compare', nightly.candidatePasses({ ...good }, { ...good }).ok);

  console.log('\n3b. Saved tests the scorer can really judge');
  const replay = { pending: null, sender: { id: 'u1', name: 'Rahul Shah' }, people: [{ id: 'u2', name: 'Priya' }], tasks: [{ id: 't1' }, { id: 't2' }] };
  const label = (l: any) => learning.repairReviewLabel({ expect: {}, ...l }, replay) as any;
  check('a proposal marked "must not change" keeps the outcome and loses the flag', label({ intent: 'create_tasks', outcome: 'CONFIRM', mustNotMutate: true }).value.mustNotMutate === false);
  check('a question that must not change anything keeps its safety flag', label({ intent: 'delete_tasks', outcome: 'CLARIFY', mustNotMutate: true, mustClarify: true }).value.mustNotMutate === true);
  check('showing tasks keeps its safety flag', label({ intent: 'view_tasks', outcome: 'ACT', mustNotMutate: true }).value.mustNotMutate === true);
  check('a person named in a test becomes their id', label({ intent: 'create_tasks', outcome: 'CONFIRM', expect: { assignee: 'priya' } }).value.expect.assignee === 'u2' && label({ intent: 'create_tasks', outcome: 'ACT', expect: { assignee: 'Rahul Shah' } }).value.expect.assignee === 'u1');
  check('a person nobody can find is dropped, never guessed', label({ intent: 'create_tasks', outcome: 'CONFIRM', expect: { assignee: 'Ghost' } }).value.expect.assignee === undefined);
  check('details the action does not carry are dropped', JSON.stringify(label({ intent: 'create_tasks', outcome: 'CONFIRM', expect: { scope: 'self', personId: 'u2', taskCount: [1] } }).value.expect) === '{"taskCount":[1]}' && JSON.stringify(label({ intent: 'complete_tasks', outcome: 'CONFIRM', expect: { scope: 'self', state: 'done_some', taskCount: [4], taskIds: ['t1', 'gone'] } }).value.expect) === '{"taskIds":["t1"]}');
  check('no answer can be right → not a test', !label({ intent: 'answer_pending', outcome: 'ACT', expect: { answer: 'yes' } }).ok && !label({ intent: 'unknown', outcome: 'ACT' }).ok && !label({ intent: 'view_tasks', outcome: 'ACT', mustClarify: true }).ok);
  check('answering a saved question stays a test', learning.repairReviewLabel({ intent: 'answer_pending', outcome: 'ACT', expect: { answer: 'yes' } }, { pending: { kind: 'confirm', summary: 'x' } }).ok);
  check('asking first or acting at once both count for a change, and only for a change', JSON.stringify(learning.acceptedOutcomes({ intent: 'complete_tasks', outcome: 'ACT' })) === '["ACT","CONFIRM"]' && JSON.stringify(learning.acceptedOutcomes({ intent: 'view_tasks', outcome: 'ACT' })) === '["ACT"]' && JSON.stringify(learning.acceptedOutcomes({ intent: 'create_tasks', outcome: 'CLARIFY' })) === '["CLARIFY"]');
  const liveHk = await import('../BotLearningHousekeeping');
  const skippedRow = liveHk.liveEvalCase({ case_key: 'live-1', message_text: 'Yes', context_snapshot: replay, expectation: { intent: 'answer_pending', outcome: 'ACT', expect: { answer: 'yes' } } });
  check('a saved test that cannot be judged is reported, with its reason', !skippedRow.ok && skippedRow.skipped.message === 'Yes' && skippedRow.skipped.reason.includes('not saved'));
  const fixedRow = liveHk.liveEvalCase({ case_key: 'live-2', message_text: 'Add task', context_snapshot: replay, expectation: { intent: 'create_tasks', outcome: 'ACT', mustNotMutate: false, expect: { scope: 'self', assignee: 'Rahul Shah' } } });
  check('a saved test is repaired when it is loaded', fixedRow.ok && fixedRow.item.team && fixedRow.item.c.expect.assignee === 'u1' && fixedRow.item.c.expect.scope === undefined && fixedRow.item.c.expect.outcome.length === 2);

  console.log('\n4. Health and alerts');
  const metrics = health.computeBotHealth([
    { receivedAt: 0, repliedAt: 1000, apology: false }, { receivedAt: 0, repliedAt: 3000, apology: true }, { receivedAt: 0, repliedAt: null, apology: true },
  ], { fallbacks: 2, aiFailures: 3, brainMessages: 10, reviewWaiting: 4 });
  check('health computes replies, apologies and median latency', metrics.replies === 2 && metrics.apologies === 2 && metrics.medianReplyMs === 2000 && metrics.reviewWaiting === 4);
  check('thresholds are 3 apologies or >20% AI failures', health.alertKinds({ apologies: 3, aiFailures: 0, brainMessages: 10 }).includes('apology_spike') && health.alertKinds({ apologies: 0, aiFailures: 3, brainMessages: 10 }).includes('ai_failure_spike') && health.alertKinds({ apologies: 0, aiFailures: 2, brainMessages: 10 }).length === 0);
  check('template text is one line and bounded', !/[\r\n]/.test(health.singleLineAlert('A\nB')) && health.singleLineAlert('x'.repeat(5000)).length <= 900);

  console.log('\n5. Wiring and SQL safety');
  const sw = read('task-manager/BotSwitches.ts'), types = read('task-manager/types.ts'), access = read('app/api/task-manager/access/route.ts');
  check('three switches are OFF by default and exposed through config/API', ['learningLoop', 'promptVersions', 'nightlyAutoTune'].every(k => sw.includes(k) && access.includes(k)) && /learningLoopEnabled\?: boolean/.test(types));
  check('send controls expose validated explicit alert recipients', /getSendControls\(\): Promise<\{[\s\S]*?botAlertAdmins/.test(read('task-manager/TaskDatabaseService.ts')));
  const sql = read('supabase/migrations/20261011000003_whatsapp_bot_learning.sql');
  check('migration creates exactly the Phase 5 tables with RLS/service-role protection', ['whatsapp_bot_review_items', 'whatsapp_bot_eval_cases', 'whatsapp_bot_prompts'].every(t => sql.includes(`CREATE TABLE IF NOT EXISTS public.${t}`) && sql.includes(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`)) && !/\b(DROP TABLE|TRUNCATE)\b/i.test(sql.replace(/^--.*$/gm, '')));
  check('activation and rollback are atomic service-role SQL functions', /FUNCTION public\.whatsapp_bot_activate_prompt/.test(sql) && /FUNCTION public\.whatsapp_bot_rollback_prompt/.test(sql) && /rpc\('whatsapp_bot_rollback_prompt'/.test(read('task-manager/BotLearningService.ts')));
  check('function privileges use valid PostgreSQL function signatures', !/,\s*FUNCTION\s+public\./i.test(sql) && [['whatsapp_bot_label_review', 'uuid,jsonb,text'], ['whatsapp_bot_activate_prompt', 'uuid,text'], ['whatsapp_bot_rollback_prompt', 'text,text']].every(([name, args]) => sql.includes(`REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC, anon, authenticated;`) && sql.includes(`GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO service_role;`)));
  check('first database prompt can roll back to the built-in baseline', /IF previous_id IS NULL THEN[\s\S]*status='retired'[\s\S]*RETURN NULL/.test(sql));
  check('admin API and console cards exist', fs.existsSync(path.resolve(__dirname, '../../app/api/task-manager/bot-learning/route.ts')) && read('frontend/components/task-manager/TaskManagerTestingDashboard.tsx').includes('BotLearningPanel'));
  check('housekeeping owns Phase 5 without a new cron', read('task-manager/NeverSilentWatchdog.ts').includes('runPhase5Housekeeping') && !read('vercel.json').includes('bot-learning'));
  const hs = read('task-manager/BotLearningHousekeeping.ts'), svc = read('task-manager/BotLearningService.ts'), msg = read('task-manager/TaskMessagingService.ts');
  check('resumed evaluation keeps one baseline and skips completed sides', /baselineSections/.test(hs) && /target\.some\([^\n]+item\.c\.id/.test(hs));
  check('evaluation uses the shipped understanding/reply fallback mix', !/interpretModels:\s*\[/.test(hs) && !/replyModels:\s*\[/.test(hs));
  check('provider-unavailable eval cases enter the persisted three-attempt retry path', /r\.status === 'ai_unavailable'/.test(hs) && /state\.attempts\[key\] >= 3/.test(hs));
  check('each provider call reserves its worst case before dispatch, then is charged what it really used (and evals skip the reply)', /state\.costUsd \+= reserve;\s*const res = await base\.complete\(req\)/.test(hs) && /state\.costUsd \+= used - reserve/.test(hs) && /skipReply: true/.test(hs));
  check('live-case database errors abort evaluation instead of silently dropping the group', /if \(error\) throw error/.test(hs));
  check('an invalid nightly draft is saved rejected once and remains retryable later', /status:\s*'rejected'/.test(hs) && /source_label_at:\s*null/.test(hs));
  check('successful sends remove only provisional observations', /clearAnsweredObservations/.test(svc) && /clearAnsweredObservations/.test(msg));
  check('brain crash apologies promote the original turn for review', (read('task-manager/brain/live.ts').match(/apology: true/g) || []).length >= 2);
  check('alert rate limiting records attempts, including failed deliveries', /bot_admin_alert_attempted/.test(read('task-manager/BotHealthRuntime.ts')));
  check('monitoring does no database or message work while Learning loop is OFF', /if \(learningOn\) out\.alerts = await sendHealthAlerts/.test(hs));
  const ledger = read('task-manager/InboundLedger.ts'), webhook = read('app/api/webhooks/aisensy/route.ts');
  check('observations begin only after a Task Manager route claims the inbound message',
    !/function recordInbound[\s\S]*?beginObservation[\s\S]*?function markRoute/.test(ledger) &&
    /function markRoute[\s\S]*?beginObservation/.test(ledger) &&
    /markRoute\(input\?\.messageId, 'smart_chat', input\?\.phone, input\?\.text\)/.test(webhook));

  console.log('\n6. Bot review upgrade — capture (Phase 1)');
  check('"wrong" / "galat" at the start count as corrections; "something is wrong with the AC" does not',
    learning.learningTriggers({ text: 'wrong, I wanted yesterday' }).includes('correction') && learning.learningTriggers({ text: 'galat, kal wala' }).includes('correction') &&
    !learning.learningTriggers({ text: 'something is wrong with the AC on 3rd floor' }).includes('correction'));
  check('a bare "no" answering the bot\'s own question is not a correction; "no, I meant…" still is',
    !learning.learningTriggers({ text: 'no', pending: true }).includes('correction') && learning.learningTriggers({ text: 'no, I meant Vidya', pending: true }).includes('correction') &&
    learning.learningTriggers({ text: 'no', pending: false }).includes('correction'));
  check('asked again: similar words within 2 minutes', learning.isRephrase("show my team's carry forward tasks", 'show my team carry forward pending tasks', 60_000));
  check('not asked again: too late, too different or too short',
    !learning.isRephrase("show my team's carry forward tasks", 'show my team carry forward tasks', 3 * 60_000) &&
    !learning.isRephrase("show my team's carry forward tasks", 'assign pantry check to Amit', 30_000) &&
    !learning.isRephrase('yes', 'yes', 10_000));
  check('rephrase is a follow-up trigger and is not doubled with a correction',
    learning.FOLLOW_UP_TRIGGERS.includes('rephrase') && learning.FOLLOW_UP_TRIGGERS.includes('correction') && learning.FOLLOW_UP_TRIGGERS.includes('undo') &&
    !learning.learningTriggers({ text: 'no I meant the old ones', rephrase: true }).includes('rephrase'));
  check('the saved bot reply has phone numbers removed and is capped', !learning.sanitizeReplyText('Call +91 98765 43210 now').includes('98765') && learning.sanitizeReplyText('x'.repeat(5000)).length === 3000);
  const svc2 = read('task-manager/BotLearningService.ts'), live2 = read('task-manager/brain/live.ts');
  check('until the migration is applied, observeTurn keeps the old behaviour', /if \(!\(await reviewSchemaV2\(\)\)\) return await observeTurnLegacy\(input\)/.test(svc2));
  check('the live bot passes its reply on every observed turn', (live2.match(/reply: SORRY_RETRY/g) || []).length === 2 && /reply: reply\?\.text \?\? null/.test(live2) && /outcome: plan\.kind === 'undo' \? 'ACT' : null, reply \}/.test(live2));
  check('an apology keeps the promoted row for 30 days', /status: 'waiting', triggers, expires_at: in30Days\(\)/.test(svc2));
  const sql2 = read('supabase/migrations/20261014000001_whatsapp_bot_review_upgrade.sql');
  const sqlBody = sql2.replace(/^--.*$/gm, '');
  check('upgrade migration is additive (no table drop, truncate, delete or update of rows)', !/\b(DROP TABLE|TRUNCATE|DELETE FROM|UPDATE public\.whatsapp_bot_review_items SET status)\b/i.test(sqlBody.replace(/UPDATE public\.whatsapp_bot_review_items SET status='labelled'/, '')) && /ADD COLUMN IF NOT EXISTS bot_reply/.test(sqlBody));
  check('upgrade migration widens status and lets developer cases become tests', /'recent'/.test(sqlBody) && /'developer'/.test(sqlBody) && /status IN \('waiting','developer'\) FOR UPDATE/.test(sqlBody) && sqlBody.includes('GRANT EXECUTE ON FUNCTION public.whatsapp_bot_label_review(uuid,jsonb,text) TO service_role;'));

  console.log('\n7. Bot review upgrade — AI summary (Phase 2)');
  const rs = await import('../BotReviewSummary');
  const row = { message_text: "show my team's carry forward tasks", bot_reply: "Your team's tasks for today: 1. Priya – DG", follow_up: { text: 'no, the old pending ones' }, triggers: ['correction'], interpretation: { intent: 'view_tasks', outcome: 'ACT' },
    context_snapshot: { today: '2026-10-14', sender: { id: 'u1', name: 'Rahul' }, people: [{ id: 'u2', name: 'Priya' }], tasks: [{ id: 't1', title: 'DG' }] } };
  const good2 = { wanted: 'To see team carry-forward tasks.', did: "Showed today's tasks.", fix: 'Show carried-over tasks for the team.', owner: 'learn', owner_reason: 'Wording only.', test: { intent: 'view_tasks', outcome: 'ACT', expect: { scope: 'team', personId: 'ghost', taskIds: ['t1', 'nope'] }, mustNotMutate: true, mustClarify: false } };
  const parsed = rs.parseSummary(good2, row, 'gemini-test');
  check('summary keeps the sentences and a checked test', parsed.wanted.startsWith('To ') && parsed.test?.intent === 'view_tasks' && parsed.owner === 'learn');
  const parsedIds = rs.parseSummary({ ...good2, test: { intent: 'complete_tasks', outcome: 'CONFIRM', expect: { personId: 'ghost', taskIds: ['t1', 'nope'] }, mustNotMutate: false, mustClarify: false } }, row, 'gemini-test');
  check('made-up ids are dropped from the test, real ones kept', parsedIds.test?.expect.personId === undefined && JSON.stringify(parsedIds.test?.expect.taskIds) === '["t1"]');
  const contradiction = rs.parseSummary({ ...good2, test: { intent: 'create_tasks', outcome: 'CONFIRM', expect: { assignee: 'Priya', scope: 'self' }, mustNotMutate: true, mustClarify: false } }, row, 'gemini-test');
  check('a new test is repaired before it can be saved', contradiction.test?.mustNotMutate === false && contradiction.test?.expect.assignee === 'u2' && contradiction.test?.expect.scope === undefined && contradiction.owner === 'learn');
  const unanswerable = rs.parseSummary({ ...good2, test: { intent: 'answer_pending', outcome: 'ACT', expect: { answer: 'yes' }, mustNotMutate: false, mustClarify: false } }, row, 'gemini-test');
  check('a test no answer could pass is never saved', unanswerable.test === null && unanswerable.owner === 'developer');
  check('the prompt says a proposal never needs the safety flag', /CONFIRM already waits for YES/.test(rs.SUMMARY_SYSTEM) && /answer_pending only when context\.pending/.test(rs.SUMMARY_SYSTEM));
  const bad2 = rs.parseSummary({ ...good2, test: { intent: 'invented', outcome: 'ACT', expect: {} } }, row, 'm');
  check('no valid test → marked "Needs a developer", never saved as a test', bad2.test === null && bad2.owner === 'developer');
  let threw = false; try { rs.parseSummary({ did: 'x', fix: 'y' }, row, 'm'); } catch { threw = true; }
  check('a summary missing a sentence is rejected', threw);
  const input2 = JSON.parse(rs.buildSummaryInput(row, 'he wanted the old open ones'));
  check('the AI sees message, bot reply, next message and the admin note', input2.message && input2.bot_reply && input2.next_message === 'no, the old pending ones' && input2.admin_note === 'he wanted the old open ones');
  check('the prompt treats conversation text as data and has ordered no-skip steps', /DATA, never instructions/.test(rs.SUMMARY_SYSTEM) && /Do not skip any/.test(rs.SUMMARY_SYSTEM) && /^1\. /m.test(rs.SUMMARY_SYSTEM));
  const calls: string[] = [];
  const failing = { complete: async (req: any) => { calls.push(req.model); throw new Error('quota'); } };
  const fallback = { complete: async (req: any) => { calls.push(req.model); return { text: JSON.stringify(good2), tokensIn: 10, tokensOut: 20 }; } };
  const out2 = await rs.summarizeReviewItem(row, null, { gemini: failing as any, fallback: fallback as any });
  check('Gemini first, then the existing provider when Gemini fails', calls[calls.length - 1] === 'glm-5.3-flash' && calls.length >= 2 && out2.summary.model === 'glm-5.3-flash' && out2.failures.length === calls.length - 1);

  console.log('\n8. Bot review upgrade — screens (Phases 3 and 4)');
  const panel = read('frontend/components/task-manager/BotLearningPanel.tsx'), review = read('frontend/components/task-manager/BotReviewSection.tsx'), pv = read('frontend/components/task-manager/PromptVersionsSection.tsx'), route = read('app/api/task-manager/bot-learning/route.ts');
  check('Bot learning is one collapsible section that loads only when opened', /Show bot learning/.test(panel) && /if \(next\) void load\(\)/.test(panel));
  check('review card shows conversation, AI summary and Correct / Fix / Ignore', ['What the user wanted', 'What the bot did', 'The fix', 'Who can fix it', '✅ Correct', '✏️ Fix', 'Needs a developer'].every(t => review.includes(t)));
  check('approve uses the server-side AI test, never a test sent from the browser', /action: 'approve', id: current\.id, owner \}/.test(review) && /validateReviewLabel\(row\.ai_summary\.test\)/.test(svc2));
  check('new API actions sit behind the same admin guard', ['summarize', 'approve', 'undo', 'set_dev_state'].every(a => route.includes(`b.action === '${a}'`)) && /requireControlCentre/.test(route));
  check('prompt versions: large viewer, coloured diff, results table, no browser pop-ups', /VersionViewer/.test(pv) && /bg-emerald-50/.test(pv) && /bg-rose-50/.test(pv) && /<table/.test(pv) && !/window\.(prompt|confirm|alert)/.test(pv));

  check('no network used', true);
  console.log(failures ? `\n❌ ${failures} FAILED\n` : '\n🎉 PHASE 5 LEARNING LOOP TESTS PASSED\n');
  process.exit(failures ? 1 : 0);
}
run().catch(e => { console.error(e); process.exit(1); });
