import { z } from 'zod';

export const TaskIntentSchema = z.object({
    action: z.enum([
        'create_task',
        'list_tasks',
        'update_progress',
        'complete_task',
        'daily_report',
        'task_help',
        'query_department_progress',
        'query_employee_progress',
        'query_missing_reports',
        'ticket_or_maintenance',
        'unrelated'
    ]),
    task_ref: z.string().nullable().optional(),
    task_title: z.string().nullable().optional(),
    task_titles: z.array(z.string()).nullable().optional(),
    target_department: z.string().nullable().optional(),
    target_employee: z.string().nullable().optional(),
    progress_percentage: z.number().min(0).max(100).nullable().optional(),
    remark: z.string().nullable().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).nullable().optional(),
    summary: z.string().nullable().optional(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().optional()
});

export type TaskIntent = z.infer<typeof TaskIntentSchema>;

interface IntentContext {
    activeTasks?: Array<{ id: string; title: string; index?: number }>;
    isSuperuser?: boolean;
}

const SYSTEM_PROMPT = `You are an AI intent classifier for an internal Head Office Employee Task & Productivity System.
The system is used by corporate employees across company departments:
- Tech & IT (software development, bug fixes, deployments, cloud infrastructure, IT support)
- Operations & Procurement (vendor contracts, purchase orders, asset procurement, logistics)
- Business Development & Growth (client proposals, sales calls, lead followups, partnerships)
- Human Resources (recruitment, interviews, onboarding, offer letters, payroll)
- Accounts & Legal (invoicing, vendor payments, GST/tax filings, NDAs, contract reviews)
- Marketing & Design (campaigns, social posts, ads, graphics, UX/UI wireframes, content)
- Management & Infrastructure (strategic reviews, capacity planning, office setup)

CRITICAL PHILOSOPHY:
Employees talk to this assistant completely naturally. They DO NOT type rigid command syntax like "create task: <title>".
Instead, they will write natural sentences in 1st person, 3rd person, or short action notes.
Your job is to understand their intent, extract clean deliverable titles without conversational filler, and classify the action.

Available Actions:
1. "create_task": Employee communicates what they will be working on, are doing, or plan to do.
   - Examples of 1st-person:
     - "Today I will be working on project deployment" -> action: "create_task", task_title: "Project deployment"
     - "I'm fixing the auth bug and deploying staging" -> action: "create_task", task_titles: ["Fix auth bug", "Deploy staging"]
     - "Planning to review the vendor contract and draft the SLA" -> action: "create_task", task_title: "Review vendor contract and draft SLA"
     - "will prepare the GST return for September" -> action: "create_task", task_title: "Prepare GST return for September"
   - Examples of 3rd-person:
     - "today he will be working on project deployment" -> action: "create_task", task_title: "Project deployment"
     - "she will be interviewing candidates today" -> action: "create_task", task_title: "Interview candidates"
   - Examples of direct action notes:
     - "working on Figma wireframes" -> action: "create_task", task_title: "Figma wireframes"
     - "client pitch deck" -> action: "create_task", task_title: "Client pitch deck"
   - If multiple tasks are mentioned, extract each into "task_titles": ["Task 1", "Task 2"].
   - EXTRACTION RULE: Always strip conversational fluff like "today he will be working on", "today I will be working on", "I am going to", "planning to", etc. Keep only the clean deliverable.

2. "list_tasks": Employee asks what they have on their plate or asks to see their tasks.
   - Example: "what are my deliverables today?", "show my pending tasks", "what do I have?", "tasks", "my tasks", "show tasks"

3. "complete_task": Employee states that a deliverable is finished or done.
   - Example: "Finished the project deployment", "project deployment is done", "completed client NDA review", "wrapped up payroll", "done with #1"
   - If active tasks are provided in context, match conversational task references to the specific task ID in "task_ref" and title in "task_title".

4. "update_progress": Employee notes an update, delay, or roadblock on an ongoing task.
   - Example: "Halfway through deployment", "deployment is blocked because of AWS credentials", "waiting for client sign-off on NDA"
   - If blocked, set "remark" to the blocker explanation.

5. "daily_report": Employee shares an End-of-Day (EOD) work summary, daily recap, or list of completed activities.
   - Example: "Today I completed 3 interviews for backend developer, reviewed the design system PR, and planned sprint 14", "daily recap: closed 2 vendor agreements and cleared accounts reconciliation", "Wrapped up for the day: deployed v2 build and tested endpoints"

6. "task_help": Employee asks how to use the system or what it does.
   - Example: "help", "how do I use this?", "what can I do here?"

7. "query_department_progress": Leadership / Superuser queries progress of a specific department.
   - Example: "What did Tech work on today?", "Show Marketing progress", "Updates from Accounts department"
   - Extract the department in "target_department".

8. "query_employee_progress": Leadership / Superuser queries active deliverables or updates for a specific employee.
   - Example: "Show pending tasks for Rohan", "What is Priya working on?", "Status of Sahil's tasks"
   - Extract the person's name in "target_employee".

9. "query_missing_reports": Leadership / Superuser checks who has not submitted their daily EOD report.
   - Example: "Who hasn't submitted their daily report today?", "Missing EOD reports", "Who didn't send daily update?"

10. "ticket_or_maintenance": Facility / building maintenance issues (e.g. AC leak, broken door, plumbing, washroom cleaning, meeting room booking).
    - Example: "AC on 3rd floor is leaking water", "please book conference room B", "toilet flush broken", "clean cafeteria"

11. "unrelated": General greetings, pleasantries, or irrelevant messages.
    - Example: "hi", "good morning", "thanks", "ok", "who are you?"

CRITICAL INSTRUCTIONS:
1. Facility maintenance problems (leaks, HVAC failure, cleaning, room bookings) MUST ALWAYS be classified as "ticket_or_maintenance".
2. If active tasks are provided in context, match conversational task references to specific task titles or indices.
3. For "create_task", clean out conversational filler ("today he will be working on", "today I will be", etc.) so "task_title" is professional and concise.
4. Output strictly valid JSON matching this schema:
{
  "action": "create_task" | "list_tasks" | "update_progress" | "complete_task" | "daily_report" | "task_help" | "query_department_progress" | "query_employee_progress" | "query_missing_reports" | "ticket_or_maintenance" | "unrelated",
  "task_ref": string or null,
  "task_title": string or null,
  "task_titles": string[] or null,
  "target_department": string or null,
  "target_employee": string or null,
  "progress_percentage": number or null,
  "remark": string or null,
  "priority": "low" | "medium" | "high" | "urgent" | null,
  "summary": string or null,
  "confidence": number,
  "reasoning": string
}
`;

/**
 * Resolve provider and keys in precedence order
 */
function resolveLLMConfig(): { baseUrl: string; apiKey: string; model: string } | null {
    // 1. Council custom endpoint
    if (process.env.COUNCIL_API_KEY && process.env.COUNCIL_BASE_URL) {
        return {
            baseUrl: process.env.COUNCIL_BASE_URL.replace(/\/$/, ''),
            apiKey: process.env.COUNCIL_API_KEY,
            model: process.env.COUNCIL_MODEL || 'glm-5.3-flash'
        };
    }

    // 2. Groq
    if (process.env.GROQ_API_KEY) {
        return {
            baseUrl: 'https://api.groq.com/openai/v1',
            apiKey: process.env.GROQ_API_KEY,
            model: 'llama-3.3-70b-versatile'
        };
    }

    // 3. OpenAI
    if (process.env.OPENAI_API_KEY) {
        return {
            baseUrl: 'https://api.openai.com/v1',
            apiKey: process.env.OPENAI_API_KEY,
            model: 'gpt-4o-mini'
        };
    }

    return null;
}

/**
 * Fallback rule-based classifier when LLM is unavailable or offline
 */
function fallbackRuleClassifier(text: string): TaskIntent {
    const raw = text.trim();
    const lower = raw.toLowerCase();

    // 1. Facility maintenance check
    const maintenanceKeywords = [
        'leak', 'water', 'pipe', 'plumbing', 'tap', 'washroom', 'flush', 'toilet',
        'ac breakdown', 'ac not cooling', 'cooling', 'hvac', 'chiller', 'air conditioning',
        'spark', 'power outage', 'electricity', 'wire', 'switchboard',
        'book room', 'meeting room', 'conference room', 'boardroom', 'reserve room',
        'clean', 'dustbin', 'housekeeping', 'pest', 'janitor', 'smell',
        'door lock', 'carpenter', 'chair broken', 'table', 'lift stuck', 'elevator'
    ];

    if (maintenanceKeywords.some(kw => lower.includes(kw)) && !lower.includes('task') && !lower.includes('daily report')) {
        return {
            action: 'ticket_or_maintenance',
            task_ref: null,
            task_title: null,
            task_titles: null,
            target_department: null,
            target_employee: null,
            progress_percentage: null,
            remark: null,
            priority: 'high',
            summary: raw,
            confidence: 0.85,
            reasoning: 'Matched maintenance keyword in fallback classifier'
        };
    }

    // 2. Superuser queries: missing reports
    if (lower.includes('who has not submitted') || lower.includes("who hasn't submitted") || lower.includes('missing daily report') || lower.includes('missing eod')) {
        return {
            action: 'query_missing_reports',
            task_ref: null,
            task_title: null,
            task_titles: null,
            target_department: null,
            target_employee: null,
            progress_percentage: null,
            remark: null,
            priority: null,
            summary: null,
            confidence: 0.9,
            reasoning: 'Missing reports query match'
        };
    }

    // 3. Superuser queries: department progress
    const depts = [
        'tech', 'it', 'operations', 'procurement', 'hr', 'human resources',
        'accounts', 'legal', 'design', 'marketing', 'bd', 'growth', 'business development', 'infrastructure'
    ];
    for (const d of depts) {
        if ((lower.includes(d) && (lower.includes('work on') || lower.includes('progress') || lower.includes('updates') || lower.includes('status'))) || lower.startsWith(`show ${d}`)) {
            return {
                action: 'query_department_progress',
                task_ref: null,
                task_title: null,
                task_titles: null,
                target_department: d,
                target_employee: null,
                progress_percentage: null,
                remark: null,
                priority: null,
                summary: null,
                confidence: 0.85,
                reasoning: 'Department progress query match'
            };
        }
    }

    // 4. Superuser queries: employee progress
    const empMatch = lower.match(/(?:pending tasks for|progress of|status of|what is|tasks for)\s+([a-zA-Z\s]+?)(?:\s+working on|\s+today|\?|$)/i);
    if (empMatch && empMatch[1].trim()) {
        return {
            action: 'query_employee_progress',
            task_ref: null,
            task_title: null,
            task_titles: null,
            target_department: null,
            target_employee: empMatch[1].trim(),
            progress_percentage: null,
            remark: null,
            priority: null,
            summary: null,
            confidence: 0.85,
            reasoning: 'Employee progress query match'
        };
    }

    // 5. Help command
    if (/^(task help|tasks help|help task|task menu|help)$/i.test(lower)) {
        return {
            action: 'task_help',
            task_ref: null,
            task_title: null,
            task_titles: null,
            target_department: null,
            target_employee: null,
            progress_percentage: null,
            remark: null,
            priority: null,
            summary: null,
            confidence: 0.95,
            reasoning: 'Direct help command'
        };
    }

    // 6. List tasks
    if (/^(tasks|my tasks|list tasks|show tasks|pending tasks|completed tasks|my deliverables)$/i.test(lower) || lower.includes('pending tasks') || lower.includes('what are my tasks')) {
        return {
            action: 'list_tasks',
            task_ref: null,
            task_title: null,
            task_titles: null,
            target_department: null,
            target_employee: null,
            progress_percentage: null,
            remark: null,
            priority: null,
            summary: null,
            confidence: 0.9,
            reasoning: 'List tasks keyword match'
        };
    }

    // 7. Daily report
    if (lower.startsWith('daily report') || lower.startsWith('eod') || lower.includes('today i completed') || lower.startsWith('daily recap') || lower.startsWith('wrapped up for the day')) {
        return {
            action: 'daily_report',
            task_ref: null,
            task_title: null,
            task_titles: null,
            target_department: null,
            target_employee: null,
            progress_percentage: null,
            remark: null,
            priority: null,
            summary: raw,
            confidence: 0.85,
            reasoning: 'Daily report pattern match'
        };
    }

    // 8. Natural Task Creation (Conversational 1st or 3rd person)
    // Matches e.g. "today he will be working on project deployment", "today I am working on ...", "working on ...", "planning to ..."
    const naturalCreate = raw.match(/^(?:today\s+)?(?:i|he|she|we)?\s*(?:will\s+be\s+working\s+on|am\s+working\s+on|is\s+working\s+on|will\s+work\s+on|working\s+on|planning\s+to\s+work\s+on|planning\s+to|focusing\s+on)\s+(.+)/i);
    if (naturalCreate && naturalCreate[1].trim()) {
        const rawTitle = naturalCreate[1].trim();
        return {
            action: 'create_task',
            task_ref: null,
            task_title: rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1),
            task_titles: null,
            target_department: null,
            target_employee: null,
            progress_percentage: null,
            remark: null,
            priority: 'medium',
            summary: null,
            confidence: 0.88,
            reasoning: 'Natural conversation task creation match'
        };
    }

    // Direct create commands
    const directCreate = raw.match(/^(?:create task|add task|new task)[:\s]+(.+)/i);
    if (directCreate && directCreate[1].trim()) {
        return {
            action: 'create_task',
            task_ref: null,
            task_title: directCreate[1].trim(),
            task_titles: null,
            target_department: null,
            target_employee: null,
            progress_percentage: null,
            remark: null,
            priority: 'medium',
            summary: null,
            confidence: 0.95,
            reasoning: 'Direct create task match'
        };
    }

    // 9. Complete task (Natural or command)
    const doneMatch = lower.match(/^(?:done with|completed|finished|wrapped up)\s+(?:#?(\d+)|(?:the\s+)?([a-z0-9\s\-]+))/i) ||
                      lower.match(/^([a-z0-9\s\-]+?)\s+(?:is done|is completed|is finished)$/i);
    if (doneMatch) {
        return {
            action: 'complete_task',
            task_ref: doneMatch[1] && /^\d+$/.test(doneMatch[1]) ? doneMatch[1] : null,
            task_title: doneMatch[2]?.trim() || doneMatch[1]?.trim() || null,
            task_titles: null,
            target_department: null,
            target_employee: null,
            progress_percentage: 100,
            remark: raw,
            priority: null,
            summary: null,
            confidence: 0.85,
            reasoning: 'Completion pattern match'
        };
    }

    // 10. Update progress / Blocked
    const blockedMatch = lower.match(/^(?:blocked|stuck)(?:\s+(?:on|with))?\s*(.*)/i);
    if (blockedMatch) {
        return {
            action: 'update_progress',
            task_ref: null,
            task_title: null,
            task_titles: null,
            target_department: null,
            target_employee: null,
            progress_percentage: null,
            remark: raw,
            priority: 'high',
            summary: null,
            confidence: 0.85,
            reasoning: 'Blocked pattern match'
        };
    }

    const progressMatch = lower.match(/(?:progress|update)?.*?(\d+)%\s*(?:complete|done)?/i);
    if (progressMatch) {
        let ref: string | null = null;
        let title: string | null = null;
        const refMatch = raw.match(/#(\d+)/);
        if (refMatch) {
            ref = refMatch[1];
        } else {
            const titleMatch = raw.match(/^(?:the\s+)?(.*?)(?:\s+is|\s+at|\s*:)?\s*\d+%/i);
            if (titleMatch && titleMatch[1].trim()) {
                title = titleMatch[1].trim();
            }
        }

        return {
            action: 'update_progress',
            task_ref: ref,
            task_title: title,
            task_titles: null,
            target_department: null,
            target_employee: null,
            progress_percentage: parseInt(progressMatch[1], 10),
            remark: raw,
            priority: null,
            summary: null,
            confidence: 0.85,
            reasoning: 'Percentage pattern match'
        };
    }

    return {
        action: 'unrelated',
        task_ref: null,
        task_title: null,
        task_titles: null,
        target_department: null,
        target_employee: null,
        progress_percentage: null,
        remark: null,
        priority: null,
        summary: null,
        confidence: 0.5,
        reasoning: 'Unrecognized in fallback classifier'
    };
}

/**
 * Detect task intent from natural language message
 */
export async function detectTaskIntent(
    messageText: string,
    context?: IntentContext
): Promise<TaskIntent> {
    const config = resolveLLMConfig();
    if (!config) {
        console.warn('[IntentDetector] No LLM provider configured; using rule-based fallback');
        return fallbackRuleClassifier(messageText);
    }

    let userPrompt = `Message: "${messageText}"`;
    if (context?.activeTasks && context.activeTasks.length > 0) {
        const taskListStr = context.activeTasks
            .map((t, idx) => `#${t.index || idx + 1}: "${t.title}" (ID: ${t.id})`)
            .join('\n');
        userPrompt += `\n\nActive Tasks for this employee:\n${taskListStr}`;
    }
    if (context?.isSuperuser) {
        userPrompt += `\nNote: Sender is a verified superuser / leadership member.`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
        const response = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: config.model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' }
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            const errText = await response.text();
            console.warn(`[IntentDetector] LLM request failed (${response.status}):`, errText.slice(0, 200));
            return fallbackRuleClassifier(messageText);
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) {
            console.warn('[IntentDetector] Empty completion from LLM');
            return fallbackRuleClassifier(messageText);
        }

        const parsed = JSON.parse(content);
        const validated = TaskIntentSchema.safeParse(parsed);
        if (!validated.success) {
            console.warn('[IntentDetector] Schema validation warning:', validated.error);
            return fallbackRuleClassifier(messageText);
        }

        return validated.data;
    } catch (err) {
        console.warn('[IntentDetector] Error calling LLM:', err instanceof Error ? err.message : err);
        return fallbackRuleClassifier(messageText);
    } finally {
        clearTimeout(timeoutId);
    }
}
