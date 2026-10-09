/**
 * WhatsApp Employee Task Manager — Core Type Definitions (Phase 1)
 * Defined per specifications in Project_plan.md, integrated directly with employee_profiles
 */

export type EmployeeRole = 'employee' | 'reporting_manager' | 'superuser';

export type TaskType = 'fixed' | 'assigned';

export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export type ContextSystem = 'TASK_MANAGER' | 'FACILITY';

export interface Department {
    id: string;
    name: string;
    code?: string | null;
    is_active: boolean;
    created_at: string;
}

export interface EmployeeProfile {
    id: string;
    user_id: string;
    first_name: string;
    last_name: string;
    phone: string;
    email?: string | null;
    department: string | null;
    department_id: string | null;
    task_role: EmployeeRole;
    designation: string | null;
    reporting_manager_id: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    department_ref?: Department | null;
    user?: {
        id: string;
        full_name: string;
        phone: string;
        is_master_admin?: boolean;
    } | null;
}

// Convenient alias for employee representation across Task Manager
export interface Employee {
    id: string; // user_id
    profile_id?: string;
    name: string;
    phone_number: string;
    department_id: string | null;
    department_name: string | null;
    role: EmployeeRole;
    reporting_manager_id: string | null;
    active: boolean;
    created_at: string;
    updated_at?: string;
}

export interface TaskTemplate {
    id: string;
    title: string;
    description: string | null;
    department_id: string | null;
    created_by: string | null;
    task_type: TaskType;
    is_active: boolean;
    /** Personal fixed task: only ever created for this person. Null/absent = the original department-wide fixed task. */
    owner_id?: string | null;
    /** Days a fixed task comes back (0 = Sunday ... 6 = Saturday). Default Monday to Saturday. */
    days_of_week?: number[];
    created_at: string;
    updated_at: string;
    department?: Department | null;
}

export interface TaskAssignment {
    id: string;
    task_template_id: string | null;
    title: string;
    description: string | null;
    employee_id: string; // references users(id)
    assigned_date: string; // YYYY-MM-DD
    status: TaskStatus;
    assigned_by: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
    employee?: Employee | null;
    template?: TaskTemplate | null;
}

export interface ConversationContext {
    id: string;
    phone_number: string;
    system: ContextSystem;
    context_type: string;
    context_data: Record<string, any>;
    expires_at: string;
    created_at: string;
    updated_at: string;
}

export interface TaskAuditLog {
    id: string;
    event_type: string;
    actor_id: string | null;
    target_employee_id: string | null;
    task_id: string | null;
    details: Record<string, any>;
    created_at: string;
}

export interface ProgressSummary {
    total: number;
    completed: number;
    in_progress: number;
    pending: number;
    percentage: number;
}

export type NotificationRuleType =
    | 'morning_digest'       // 09:00 AM: Tasks for today + optional yesterday carry-forward
    | 'pending_reminder'     // 14:00 PM: Midday reminder for unfinished tasks
    | 'overdue_alert'        // Escalation for tasks past due date
    | 'eod_summary';         // 18:30 PM: Daily completion recap & outstanding items

export interface NotificationTaskFilters {
    includeTodayFixed: boolean;
    includeTodayAssigned: boolean;
    includeYesterdayPending: boolean;
    lookbackDays?: number;       // e.g. 1 = yesterday only, 3 = last 3 days
    onlyPending?: boolean;       // Ignore completed tasks
}

export interface NotificationConditions {
    skipIfZeroTasks: boolean;   // Don't message if 0 tasks match
    requirePendingOnly?: boolean;// Don't message if user already completed all tasks
}

export interface NotificationRecipients {
    target: 'whitelist' | 'tech_all' | 'specific_employees' | 'department';
    employeeIds?: string[];
    notifyReportingManager?: boolean;
}

export interface NotificationCustomTemplate {
    headerGreeting?: string;       // Custom greeting or header, e.g. "Good morning {{firstName}}! 📋"
    customMessage?: string;        // Optional announcement or note to prepend
    footerInstruction?: string;    // Custom quick-action notes
    includeQuickReplies?: boolean; // Whether to append "done 1", "done all", "tasks" instructions
}

export interface NotificationRule {
    id: string;                     // e.g. "rule_morning_digest"
    name: string;                   // "Morning Task Kickoff"
    enabled: boolean;               // Master toggle for this specific rule
    targetTimeIST: string;          // "09:00", "14:30", "18:30"
    daysOfWeek: number[];           // [1, 2, 3, 4, 5, 6] (1=Mon ... 6=Sat, 0=Sun)
    ruleType: NotificationRuleType;
    departmentId?: string | null;   // Phase 5: Optional Department-scope (null/'all' = company-wide or default)
    ownerUserId?: string | null;    // Personal rule: it only ever reaches this one person (a superuser's own notifications)
    taskFilters: NotificationTaskFilters;
    conditions: NotificationConditions;
    recipients: NotificationRecipients;
    customTemplate?: NotificationCustomTemplate;
    lastRunDate?: string | null;    // "2026-10-05"
    lastRunSummary?: string | null; // Summary string of last run
    lastManualSendAt?: string | null; // ISO time of the last "Send now" (cooldown against double sends)
}


export interface WhatsAppKillSwitches {
    globalHalt: boolean;                  // Master emergency switch: true = STOP ALL WHATSAPP MESSAGES
    haltReason?: string | null;           // Optional reason e.g. "Maintenance or Emergency Stop"
    haltedAt?: string | null;             // ISO timestamp when halt was engaged
    haltedBy?: string | null;             // Name or email of who engaged halt
    departmentHalt?: Record<string, boolean>; // departmentId -> boolean (true = paused)
    messageTypeHalt?: {
        morning_digest?: boolean;         // Pause Morning Task Digests
        pending_reminder?: boolean;       // Pause Midday Progress Reminders
        eod_summary?: boolean;            // Pause Evening Wrap-up Summaries
        overdue_alert?: boolean;          // Pause Overdue Alerts
        manager_kickoff?: boolean;        // Pause Manager Onboarding Kickoffs
        employee_kickoff?: boolean;       // Pause Employee Onboarding Kickoffs
    };
}

export interface TestingConfig {
    enabled: boolean;
    manager?: { name: string; phone: string };
    notifyManager?: boolean;
    employees?: Array<{ name: string; phone: string }>;
    cronTiming?: string; // IST time string, e.g. "09:00" (legacy fallback)
    cronEnabled?: boolean; // Automation master toggle
    cronLastRunDate?: string | null; // YYYY-MM-DD (legacy fallback)
    cronLastRunSummary?: string | null; // Last run stats (legacy fallback)
    rules?: NotificationRule[]; // Multi-rule notification engine
    killSwitches?: WhatsAppKillSwitches; // Phase 2: Multi-level WhatsApp kill switches
    nlGatewayEnabled?: boolean; // Step 4: natural-language front door (OFF unless explicitly switched on)
    whatsappPretendMode?: boolean; // Step 1: when not explicitly false, NO Task Manager WhatsApp message is sent (saved to history only)
}


