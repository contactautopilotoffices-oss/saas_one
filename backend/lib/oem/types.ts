/** Org Efficiency Meter — shared types. */

export type OemLevel = 'agent' | 'employee' | 'department' | 'tech' | 'org';
export type OemCadence = 'weekly' | 'monthly' | 'quarterly';
export type OemProofType = 'system' | 'artifact' | 'claim';

export const OEM_LEVELS: OemLevel[] = ['agent', 'employee', 'department', 'tech', 'org'];

export const OEM_LEVEL_LABELS: Record<OemLevel, string> = {
    agent: 'Agent Level',
    employee: 'Employee Level',
    department: 'Department Level',
    tech: 'Tech Level',
    org: 'Organization Level',
};

export interface OemGoal {
    id: string;
    organization_id: string;
    parent_goal_id: string | null;
    level: OemLevel;
    title: string;
    description: string | null;
    owner_uid: string | null;
    department: string | null;
    agent_key: string | null;
    cadence: OemCadence;
    metric_key: string;
    metric_source: Record<string, unknown>;
    direction: 'up' | 'down';
    unit: string | null;
    baseline_value: number | null;
    target_value: number;
    expected_rate: number | null;
    guardrails: Array<{ metric_key: string; must_not: 'rise_above' | 'fall_below'; threshold: number }>;
    starts_on: string;
    ends_on: string | null;
    status: 'draft' | 'active' | 'achieved' | 'missed' | 'archived';
}

export interface OemGoalProgress {
    goal_id: string;
    organization_id: string;
    level: OemLevel;
    title: string;
    owner_uid: string | null;
    department: string | null;
    agent_key: string | null;
    cadence: OemCadence;
    metric_key: string;
    direction: 'up' | 'down';
    unit: string | null;
    baseline_value: number | null;
    target_value: number;
    expected_rate: number | null;
    status: string;
    current_value: number | null;
    planned_value: number | null;
    last_measured_on: string | null;
    progress_pct: number | null;
    actual_rate: number | null;
    data_in_chain: boolean | null;
}

export interface OemBundleTable {
    name: string;
    access: 'read' | 'write';
    columns?: string[];
    purpose?: string;
}

export interface OemBundle {
    tables: OemBundleTable[];
    notes?: string;
}

export interface OemAgent {
    id: string;
    organization_id: string;
    agent_key: string;
    display_name: string;
    department: string | null;
    role_description: string | null;
    status: 'draft' | 'shadow' | 'live' | 'paused' | 'retired';
    system_prompt: string | null;
    system_prompt_version: number;
    config: Record<string, unknown>;
}
