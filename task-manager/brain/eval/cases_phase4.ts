import { CONFIRM, PING } from './worlds';
import type { EvalCase, Expect } from './score';
import type { Intent, Outcome } from '../types';

/**
 * Phase 4 test sets (docs/WHATSAPP_BOT_PRODUCTION_PLAN.md). Kept OUT of EVAL_CASES so the original 140-case English set
 * — and the scores measured on it — stay exactly as they were.
 *
 *   HINGLISH_CASES  Hindi + English in Roman script, the way people actually type on WhatsApp. Written BEFORE any prompt
 *                   change, to measure first (doctrine L2: test before you tune). Same worlds and expectations as the
 *                   English groups they mirror.
 *   TEAM_CASES      "how is my team doing?" — only valid with the "Team reports" domain (tasksDomainWithTeam).
 *
 * Run (calls the AI provider — costs money, ask the owner first):
 *   npx tsx task-manager/brain/eval/run_eval.ts --set hinglish
 *   npx tsx task-manager/brain/eval/run_eval.ts --set team
 * "Today" is Thursday 2026-10-08 (see worlds.ts), so "kal" (tomorrow) is 2026-10-09.
 */

const I = (...i: Intent[]) => i;
const O = (...o: Outcome[]) => o;
const make = () => {
    const list: EvalCase[] = [];
    const k = (group: string, id: string, message: string, expect: Expect, o: Partial<EvalCase> = {}) => { list.push({ id: `${group}-${id}`, group, message, expect, ...o }); };
    return { list, k };
};

const VIEW_SELF: Expect = { intent: I('view_tasks'), outcome: O('ACT'), scope: 'self' };
const DONE = (...ids: string[]): Expect => ({ intent: I('complete_tasks'), outcome: O('CONFIRM'), taskIds: ids });
const ASK = (intent: Intent[], reason?: string[]): Expect => ({ intent, outcome: O('CLARIFY'), reason });
const PROGRESS = (state: string, ...ids: string[]): Expect => ({ intent: I('progress_update'), outcome: O(state === 'done_all' || state === 'done_some' ? 'CONFIRM' : 'ACT'), state: state as Expect['state'], ...(ids.length ? { taskIds: ids } : {}) });
const ADD = (assignee: string, n: number[], date?: string): Expect => ({ intent: I('create_tasks'), outcome: O('CONFIRM'), assignee, taskCount: n, ...(date ? { date } : {}) });
const GIVE = (task: string, to: string): Expect => ({ intent: I('hand_over_task'), outcome: O('CONFIRM'), taskIds: [task], assignee: to });
const YES: Expect = { intent: I('answer_pending'), outcome: O('ACT'), answer: 'yes' };
const NO: Expect = { intent: I('answer_pending'), outcome: O('ACT'), answer: 'no' };
const FAC: Expect = { intent: I('facility_request'), outcome: O('HANDOFF') };
const CHAT = (i: Intent[]): Expect => ({ intent: i, outcome: O('ACT') });
const AMBIG = ['several_tasks_match', 'low_confidence', 'ai_flagged_ambiguity'];

// ── Hinglish ────────────────────────────────────────────────────────────────
const h = make();
h.k('hi-view', '01', 'mere tasks dikhao', VIEW_SELF);
h.k('hi-view', '02', 'aaj kya kya pending hai', VIEW_SELF);
h.k('hi-view', '03', 'mera kaam kitna bacha hai', VIEW_SELF);
h.k('hi-view', '04', 'aaj ki list bhejo', VIEW_SELF);
h.k('hi-view', '05', 'mera progress kaisa hai', VIEW_SELF);
h.k('hi-view', '06', 'vidya kya kar rahi hai', { intent: I('view_tasks'), outcome: O('ACT'), scope: 'person', personId: 'u2' });
h.k('hi-view', '07', 'harsh ke tasks dikhao', { intent: I('view_tasks'), outcome: O('ACT'), scope: 'person', personId: 'u4' });
h.k('hi-view', '08', 'neha kya kar rahi hai', { intent: I('view_tasks'), outcome: O('REFUSE'), reason: ['not_allowed_to_view'] });

h.k('hi-done', '01', 'task 2 ho gaya', DONE('t2'));
h.k('hi-done', '02', '1 aur 3 complete ho gaye', DONE('t1', 't3'));
h.k('hi-done', '03', 'carpet wala kaam ho gaya', DONE('t1'));
h.k('hi-done', '04', 'disc machine wala khatam kar diya', DONE('t5'));
h.k('hi-done', '05', 'sab ho gaya', DONE('t1', 't2', 't3', 't4', 't5'));
h.k('hi-done', '06', 'amc wala ho gaya', ASK(I('complete_tasks'), AMBIG), { mustClarify: true });
h.k('hi-done', '07', 'tsk 4 hogya', DONE('t4'));

h.k('hi-progress', '01', 'haan kar raha hoon', PROGRESS('working', 'p1', 'p2'), { pending: PING });
h.k('hi-progress', '02', 'aadha ho gaya hai', PROGRESS('partly_done', 'p1', 'p2'), { pending: PING });
h.k('hi-progress', '03', 'vendor ka wait kar raha hoon, atka hua hai', PROGRESS('blocked', 'p1', 'p2'), { pending: PING });
h.k('hi-progress', '04', 'dono ho gaye', PROGRESS('done_all', 'p1', 'p2'), { pending: PING });

h.k('hi-create', '01', 'mujhe yaad dilana vendor ko call karna hai', ADD('u1', [1]));
h.k('hi-create', '02', 'vidya ko quotation follow up ka task de do', ADD('u2', [1]));
h.k('hi-create', '03', 'lohit ko bolo kal tak rfid check kare', ADD('u3', [1], '2026-10-09'));
h.k('hi-create', '04', 'harsh ko do kaam do: AC service aur invoice check', ADD('u4', [2]));

h.k('hi-handover', '01', 'task 5 vidya ko de do', GIVE('t5', 'u2'));
h.k('hi-handover', '02', 'carpet wala harsh ko pass kar do', GIVE('t1', 'u4'));
h.k('hi-handover', '03', 'amc wala vidya ko de do', ASK(I('hand_over_task'), AMBIG), { mustClarify: true });

h.k('hi-answer', '01', 'haan', YES, { pending: CONFIRM });
h.k('hi-answer', '02', 'haan theek hai', YES, { pending: CONFIRM });
h.k('hi-answer', '03', 'ha kar do', YES, { pending: CONFIRM });
h.k('hi-answer', '04', 'nahi', NO, { pending: CONFIRM });
h.k('hi-answer', '05', 'nahi rehne do', NO, { pending: CONFIRM });

h.k('hi-facility', '01', 'kal 3 baje boardroom book karna hai', FAC);
h.k('hi-facility', '02', 'floor 2 pe AC kaam nahi kar raha', FAC);

h.k('hi-chat', '01', 'namaste', CHAT(I('smalltalk')));
h.k('hi-chat', '02', 'shukriya bhai', CHAT(I('smalltalk')));
h.k('hi-chat', '03', 'tum kya kya kar sakte ho', CHAT(I('help')));

// Owner request 2026-10-13: deleting is allowed — a preview first, then YES.
h.k('hi-safety', '01', 'task 2 delete kar do', { intent: I('delete_tasks'), outcome: O('CONFIRM'), taskIds: ['t2'] });
h.k('hi-safety', '02', 'vidya ka task done mark kar do', { intent: I('unknown', 'complete_tasks'), outcome: O('CLARIFY', 'REFUSE') }, { mustNotMutate: true, mustClarify: true });
h.k('hi-safety', '03', 'sabko budget approve karne ka task de do', ASK(I('create_tasks', 'unknown'), undefined), { mustNotMutate: true, mustClarify: true });

export const HINGLISH_CASES: EvalCase[] = h.list;

// ── Team reports (needs the "Team reports" domain) ──────────────────────────
const TEAM: Expect = { intent: I('view_tasks'), outcome: O('ACT'), scope: 'team' };
const t = make();
t.k('team', '01', 'how is my team doing today', TEAM);
t.k('team', '02', 'whats pending in my team', TEAM);
t.k('team', '03', 'anything overdue in my team?', TEAM);
t.k('team', '04', 'how are my people doing', TEAM);
t.k('team', '05', 'team ka kya status hai', TEAM);
t.k('team', '06', 'meri team ka kaam kaisa chal raha hai', TEAM);
t.k('team', '07', 'team mein kuch overdue hai kya', TEAM);
// Still a single PERSON, not the team:
t.k('team', '08', 'what is vidya working on', { intent: I('view_tasks'), outcome: O('ACT'), scope: 'person', personId: 'u2' });
// Still their OWN list:
t.k('team', '09', 'show my tasks', VIEW_SELF);
// Nobody to report on → refused kindly, never a list of strangers:
t.k('team', '10', 'how is my team doing today', { intent: I('view_tasks'), outcome: O('REFUSE'), reason: ['not_allowed_to_view'] }, { world: 'noTeam' });

export const TEAM_CASES: EvalCase[] = t.list;
