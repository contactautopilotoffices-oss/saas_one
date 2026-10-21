import type { EvalCase, Expect } from './score';

/**
 * Owner 2026-10-21 (step 6): REAL chats that went wrong, so the nightly tuning (BotLearningHousekeeping.allCases) and
 * run_eval.ts --set real learn from them. Kept apart from the original sets so their old scores stay comparable.
 * Names are mapped onto the fake "default" world (worlds.ts): the sender is Priyanka (u1); Sailee is NOT one of the people,
 * exactly like Sanil's real team, so "Sailee" must stay in the title instead of being read as a person.
 *
 *   Sher  2026-10-21  "add task follow up regarding Checklist"  -> was asked "your list or someone?" and then "is that right?"
 *   Sanil 2026-10-21  "Task. / Add Sailee rest FNF"             -> "couldn't find anyone named Sailee"
 */
const ADD_SELF = (...words: string[]): Expect => ({ intent: ['create_tasks'], outcome: ['CONFIRM', 'ACT'], assignee: 'u1', taskCount: [1], titleIncludes: words });
const ADD_FOR = (who: string, ...words: string[]): Expect => ({ intent: ['create_tasks'], outcome: ['CONFIRM', 'ACT'], assignee: who, taskCount: [1], titleIncludes: words });
const c = (id: string, message: string, expect: Expect, o: Partial<EvalCase> = {}): EvalCase => ({ id: `real-${id}`, group: 'real', message, expect, ...o });

export const REAL_CASES: EvalCase[] = [
    // Sher: a task with no person named goes on the sender's own list.
    c('sher-01', 'add task follow up regarding Checklist', ADD_SELF('follow up', 'checklist')),
    c('sher-02', 'add task follow up regarding checklist', ADD_SELF('checklist')),
    c('sher-03', 'Add task: follow up regarding Checklist', ADD_SELF('checklist')),
    // Sanil: "Sailee" is part of the task, not a person on the team.
    c('sanil-01', 'Task.\n\nAdd Sailee rest FNF', ADD_SELF('sailee', 'fnf')),
    c('sanil-02', 'Add Sailee rest FNF', ADD_SELF('sailee', 'fnf')),
    c('sanil-03', 'task - Sailee rest FNF', ADD_SELF('sailee', 'fnf')),
    // Follow-ups that only work with conversation memory + the rewrite step.
    c('follow-01', 'same for lohit', ADD_FOR('u3', 'quotation'), { conversation: ['Person: give vidya a task to chase the quotation', 'Assistant: Added for Vidya: Chase the quotation.'] }),
    c('follow-02', 'also add one for harsh', ADD_FOR('u4', 'invoice'), { conversation: ['Person: ask suraj to send the invoice', 'Assistant: Added for Suraj: Send the invoice.'] }),
];
