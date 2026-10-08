import { GoogleGenerativeAI } from '@google/generative-ai';
import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskAssignment, Employee } from './types';

export type TaskNLIntent =
    | 'COMPLETE_ALL_TODAY_TASKS'
    | 'COMPLETE_TASKS'
    | 'QUERY_TASKS'
    | 'QUERY_STATUS'
    | 'SWITCH_SYSTEM'
    | 'HELP'
    | 'UNKNOWN';

export interface ParsedTaskIntent {
    intent: TaskNLIntent;
    task_numbers: number[];
    task_titles_mentioned: string[];
    system_target?: 'TASK_MANAGER' | 'FACILITY';
    confidence: number;
    raw_message: string;
    reasoning?: string;
}

export interface NLUpdateResult {
    success: boolean;
    intent: TaskNLIntent;
    taskNumbers: number[];
    completedTaskIds: string[];
    replyText: string;
    progress?: {
        total: number;
        completed: number;
        percent: number;
    };
}

export class TaskNaturalLanguageService {
    /**
     * Parses conversational employee messages into structured task intent.
     * Combines fast regex heuristics with Gemini/LLM extraction.
     */
    static async parseIntent(text: string, activeTasks: TaskAssignment[] = []): Promise<ParsedTaskIntent> {
        const clean = text.trim();
        const lower = clean.toLowerCase();

        // ── Fast Heuristics (Deterministic Zero-Latency) ─────────────────────
        if (/(?:completed|finished|done with|cleared)\s+(?:everything|all|all\s+my\s+tasks|all\s+work)/i.test(lower) ||
            /all\s+(?:my\s+)?(?:work|tasks?)\s+(?:is|are)\s+(?:done|completed|finished)/i.test(lower) ||
            /(?:wrapped\s+up|calling\s+it\s+a\s+day)/i.test(lower)) {
            return {
                intent: 'COMPLETE_ALL_TODAY_TASKS',
                task_numbers: activeTasks.map((_, i) => i + 1),
                task_titles_mentioned: [],
                confidence: 0.98,
                raw_message: clean,
                reasoning: 'Matches complete all tasks conversational phrase'
            };
        }

        // Fuzzy match against today's task titles in the user's list
        if (activeTasks.length > 0) {
            const matchedNumbers: number[] = [];
            const matchedTitles: string[] = [];

            activeTasks.forEach((task, idx) => {
                const words = task.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                const hasStrongMatch = words.some(w => lower.includes(w));
                if (hasStrongMatch && (lower.includes('done') || lower.includes('finished') || lower.includes('completed') || lower.includes('checked'))) {
                    matchedNumbers.push(idx + 1);
                    matchedTitles.push(task.title);
                }
            });

            if (matchedNumbers.length > 0) {
                return {
                    intent: 'COMPLETE_TASKS',
                    task_numbers: matchedNumbers,
                    task_titles_mentioned: matchedTitles,
                    confidence: 0.90,
                    raw_message: clean,
                    reasoning: `Fuzzy matched active task titles: ${matchedTitles.join(', ')}`
                };
            }
        }

        // ── LLM Extraction via Google Gemini ─────────────────────────────────
        const geminiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
        if (geminiKey) {
            try {
                const genAI = new GoogleGenerativeAI(geminiKey);
                const model = genAI.getGenerativeModel({
                    model: 'gemini-2.5-flash',
                    generationConfig: { responseMimeType: 'application/json' }
                });

                const taskListPrompt = activeTasks.map((t, i) => `${i + 1}. "${t.title}" (${t.status})`).join('\n');

                const prompt = `
You are an internal WhatsApp Employee Task intent parser.
Employee's active daily tasks:
${taskListPrompt || 'No tasks currently active'}

Incoming message from employee:
"${clean}"

Identify whether the employee is:
1. COMPLETE_ALL_TODAY_TASKS: saying they finished everything, all work is done.
2. COMPLETE_TASKS: stating they finished specific task(s). Map which task number(s) (1-indexed) they completed.
3. QUERY_TASKS: asking what tasks they have today.
4. QUERY_STATUS: asking about their progress or what's left.
5. SWITCH_SYSTEM: wants to use facility bot, book meeting room, or raise ticket.
6. HELP: asking how to use the system.
7. UNKNOWN: unrelated or unclear.

Return JSON in this format:
{
  "intent": "COMPLETE_ALL_TODAY_TASKS" | "COMPLETE_TASKS" | "QUERY_TASKS" | "QUERY_STATUS" | "SWITCH_SYSTEM" | "HELP" | "UNKNOWN",
  "task_numbers": [number],
  "task_titles_mentioned": ["string"],
  "confidence": number,
  "reasoning": "brief explanation"
}
`;
                const response = await model.generateContent(prompt);
                const resultText = response.response.text();
                const parsed = JSON.parse(resultText);

                return {
                    intent: parsed.intent || 'UNKNOWN',
                    task_numbers: Array.isArray(parsed.task_numbers) ? parsed.task_numbers : [],
                    task_titles_mentioned: Array.isArray(parsed.task_titles_mentioned) ? parsed.task_titles_mentioned : [],
                    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.85,
                    raw_message: clean,
                    reasoning: parsed.reasoning
                };
            } catch (llmErr) {
                console.warn('[TaskNaturalLanguageService] Gemini parsing error, falling back:', llmErr);
            }
        }

        return {
            intent: 'UNKNOWN',
            task_numbers: [],
            task_titles_mentioned: [],
            confidence: 0.3,
            raw_message: clean,
            reasoning: 'No intent matched'
        };
    }

    /**
     * Safely executes natural language task updates.
     * The backend strictly validates database updates; the LLM NEVER modifies the DB directly.
     */
    static async applyNaturalLanguageUpdate(params: {
        phone: string;
        text: string;
        date?: string;
    }): Promise<NLUpdateResult> {
        const targetDate = params.date || new Date().toISOString().slice(0, 10);

        const employee = await TaskDatabaseService.getEmployeeByPhone(params.phone);
        if (!employee) {
            return {
                success: false,
                intent: 'UNKNOWN',
                taskNumbers: [],
                completedTaskIds: [],
                replyText: 'Sorry, this phone number is not registered for employee task management.'
            };
        }

        const tasks = await TaskDatabaseService.getDailyAssignments({
            employeeId: employee.id,
            date: targetDate
        });

        const parsed = await this.parseIntent(params.text, tasks);

        // ── Intent 1: Complete All Tasks ──────────────────────────────────────
        if (parsed.intent === 'COMPLETE_ALL_TODAY_TASKS') {
            const pendingTasks = tasks.filter(t => t.status !== 'completed');
            for (const t of pendingTasks) {
                await TaskDatabaseService.updateAssignmentStatus({
                    assignmentId: t.id,
                    status: 'completed'
                });
            }

            await TaskDatabaseService.logAudit({
                eventType: 'ai_task_update',
                actorId: employee.id,
                targetEmployeeId: employee.id,
                details: {
                    intent: 'COMPLETE_ALL_TODAY_TASKS',
                    rawText: params.text,
                    taskCount: tasks.length
                }
            });

            const reply = `🎉 Understood! All your tasks for today have been marked as completed (${tasks.length}/${tasks.length} - 100%). Have a great evening!`;
            return {
                success: true,
                intent: 'COMPLETE_ALL_TODAY_TASKS',
                taskNumbers: tasks.map((_, i) => i + 1),
                completedTaskIds: pendingTasks.map(t => t.id),
                replyText: reply,
                progress: { total: tasks.length, completed: tasks.length, percent: 100 }
            };
        }

        // ── Intent 2: Complete Specific Tasks ─────────────────────────────────
        if (parsed.intent === 'COMPLETE_TASKS' && parsed.task_numbers.length > 0) {
            const updatedIds: string[] = [];
            const completedTitles: string[] = [];

            for (const num of parsed.task_numbers) {
                const idx = num - 1;
                if (idx >= 0 && idx < tasks.length) {
                    const task = tasks[idx];
                    if (task.status !== 'completed') {
                        await TaskDatabaseService.updateAssignmentStatus({
                            assignmentId: task.id,
                            status: 'completed'
                        });
                        updatedIds.push(task.id);
                        completedTitles.push(task.title);
                    }
                }
            }

            const currentCompleted = tasks.filter(t => updatedIds.includes(t.id) || t.status === 'completed').length;
            const pct = tasks.length > 0 ? Math.round((currentCompleted / tasks.length) * 100) : 100;

            await TaskDatabaseService.logAudit({
                eventType: 'ai_task_update',
                actorId: employee.id,
                targetEmployeeId: employee.id,
                details: {
                    intent: 'COMPLETE_TASKS',
                    rawText: params.text,
                    taskNumbers: parsed.task_numbers,
                    completedTitles
                }
            });

            const titleSummary = completedTitles.length > 0 ? ` ("${completedTitles.join('", "')}")` : '';
            const reply = `✅ Understood! Marked ${parsed.task_numbers.map(n => `#${n}`).join(', ')}${titleSummary} as completed.\n\nProgress: ${currentCompleted}/${tasks.length} (${pct}%)`;

            return {
                success: true,
                intent: 'COMPLETE_TASKS',
                taskNumbers: parsed.task_numbers,
                completedTaskIds: updatedIds,
                replyText: reply,
                progress: { total: tasks.length, completed: currentCompleted, percent: pct }
            };
        }

        // Fallback for unrecognized intent
        return {
            success: false,
            intent: parsed.intent,
            taskNumbers: [],
            completedTaskIds: [],
            replyText: `I didn't quite catch that. You can reply "tasks" to see your list, or "done 1" / "done all" to update your progress.`
        };
    }
}
