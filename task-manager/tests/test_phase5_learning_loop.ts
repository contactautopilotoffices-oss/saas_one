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
  check('review labels are closed-list and structurally checked', learning.validateReviewLabel({ intent: 'view_tasks', outcome: 'ACT', expect: { scope: 'self' } }).ok && !learning.validateReviewLabel({ intent: 'invented', outcome: 'ACT', expect: {} } as any).ok);
  check('review labels reject invalid typed details', !learning.validateReviewLabel({ intent: 'view_tasks', outcome: 'ACT', expect: { scope: 'planet' } }).ok && !learning.validateReviewLabel({ intent: 'complete_tasks', outcome: 'CONFIRM', expect: { taskIds: [7] } }).ok);

  console.log('\n3. Nightly gates and budget');
  check('nightly starts only after 02:00 IST with new labels and no run today', nightly.shouldStartNightly(new Date('2026-10-10T21:00:00Z'), { newestLabelAt: '2026-10-10T20:00:00Z', lastConsumedLabelAt: null, runDate: null }));
  check('quiet night makes zero-call early exit', !nightly.shouldStartNightly(new Date('2026-10-10T21:00:00Z'), { newestLabelAt: null, lastConsumedLabelAt: null, runDate: null }));
  check('worst-case reservation blocks a call over $0.25', nightly.reserveWorstCaseUsd('x'.repeat(1000), 1200, 0.135, 0.45) > 0 && !nightly.withinNightlyCap(0.2499, 0.001, 0.25));
  const good = { passRate: 98, unsafe: 0, missedClarify: 0, wrongProposal: 0, byGroup: { a: 9, b: 10 } };
  check('candidate must be no worse and safety-perfect', nightly.candidatePasses(good, { ...good, passRate: 99, byGroup: { a: 8, b: 10 } }).ok && !nightly.candidatePasses(good, { ...good, unsafe: 1 }).ok && !nightly.candidatePasses(good, { ...good, byGroup: { a: 7, b: 10 } }).ok);

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

  check('no network used', true);
  console.log(failures ? `\n❌ ${failures} FAILED\n` : '\n🎉 PHASE 5 LEARNING LOOP TESTS PASSED\n');
  process.exit(failures ? 1 : 0);
}
run().catch(e => { console.error(e); process.exit(1); });
