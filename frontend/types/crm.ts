// ===========================================
// CRM Module TypeScript Types
// ===========================================

export type LeadStatus =
    | 'New Lead'
    | 'Contacted'
    | 'Meeting Scheduled'
    | 'Site Visit Scheduled'
    | 'Proposal Shared'
    | 'Negotiation'
    | 'Won'
    | 'Lost'
    | 'Dropped'
    | 'On Hold';

export type LeadPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

export type ActivityType =
    | 'created'
    | 'updated'
    | 'call'
    | 'meeting'
    | 'site_visit'
    | 'proposal_sent'
    | 'followup_scheduled'
    | 'status_changed'
    | 'assigned'
    | 'note_added'
    | 'email_sent'
    | 'archived'
    | 'restored';

export type EventType = 'call' | 'meeting' | 'site_visit' | 'followup';

export type EventStatus = 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';

// ===========================================
// Database Entities
// ===========================================

export interface CRMTerritory {
    id: string;
    user_id: string;
    city: string;
    is_active: boolean;
    created_at: string;
}

export interface CRMTarget {
    id: string;
    user_id: string;
    month: number;
    year: number;
    target_value: number;
    target_leads: number;
    target_closures: number;
    created_at: string;
}

export interface CRMMetaLead {
    id: string;
    meta_lead_id: string;
    payload: Record<string, any>;
    campaign_id?: string;
    campaign_name?: string;
    adset_id?: string;
    adset_name?: string;
    ad_id?: string;
    ad_name?: string;
    form_id?: string;
    form_name?: string;
    status: 'pending' | 'processed' | 'failed' | 'duplicate';
    processed_lead_id?: string;
    error_message?: string;
    created_at: string;
    processed_at?: string;
}

// Lead Status
export interface LeadStatusConfig {
    id: string;
    name: string;
    color: string;
    sort_order: number;
    is_active: boolean;
    is_default?: boolean;
    is_won?: boolean;
    is_lost?: boolean;
    is_terminal?: boolean;
    icon?: string | null;
    organization_id?: string | null;
    created_at?: string;
    updated_at?: string;
}

// Lead Source
export interface LeadSource {
    id: string;
    name: string;
    is_active: boolean;
    created_at: string;
}

// ===========================================
// Saved / Custom Views ("subsheet" tabs over the leads table)
// ===========================================

export type ViewPeriodPreset =
    | 'this_week' | 'last_week'
    | 'this_month' | 'last_month'
    | 'last_30' | 'this_quarter';

export interface SavedViewPeriod {
    mode: 'any' | 'rolling' | 'fixed';
    preset?: ViewPeriodPreset;           // used when mode === 'rolling'
    date_from?: string;                  // YYYY-MM-DD, used when mode === 'fixed'
    date_to?: string;                    // YYYY-MM-DD, used when mode === 'fixed'
    date_field?: 'created_at' | 'next_followup_date' | 'last_contacted';
}

// The persisted filter bundle. Mirrors the params the leads list already sends.
export interface SavedViewFilters {
    scope?: 'mine' | 'all';
    search?: string;
    status?: string[];                   // status UUIDs
    lead_source?: string[];              // source UUIDs
    city?: string[];
    campaign?: string[];
    seats_range?: string;                // 'lt25' | '25to50' | '50to100' | 'gt100'
    period?: SavedViewPeriod;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
}

export interface CRMSavedView {
    id: string;
    organization_id: string;
    created_by: string;
    name: string;
    icon?: string | null;
    color?: string | null;
    filters: SavedViewFilters;
    sort_order: number;
    is_default: boolean;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

// ===========================================
// Enhanced Lead Data (Parsed from Excel/Import)
// ===========================================

export interface ParsedRequirement {
    seats?: number;
    seats_type?: 'open_workspace' | 'cabin' | 'meeting_room' | 'private_office';
    budget_min?: number;
    budget_max?: number;
    budget_per_seat?: boolean;
    timeline?: string;
    location_preference?: string;
    amenities?: string[];
}

export interface LeadJourneyStep {
    date: string;
    status: string;
    activity_type: string;
    description: string;
}

export interface LeadBriefingData {
    lead_id: string;
    company_name: string;
    full_name: string;
    recent_activity: string;
    suggested_pitch_points: string[];
    urgency_signals: string[];
    next_action: string;
    days_since_last_contact: number;
}

// ===========================================
// Campaign Analytics
// ===========================================

export interface CampaignMetrics {
    campaign_id: string;
    campaign_name: string;
    source: string;
    territory: string;
    total_leads: number;
    hot_leads: number;
    warm_leads: number;
    cold_leads: number;
    lost_leads: number;
    conversion_rate: number;
    avg_response_time_hours?: number;
    total_pipeline_value?: number;
}

export interface RepPerformance {
    user_id: string;
    user_name: string;
    total_assigned: number;
    hot_leads: number;
    conversion_rate: number;
    avg_deal_value?: number;
    avg_response_time_hours?: number;
    activities_this_week: number;
    activities_this_month: number;
}

// ===========================================
// Funnel & Drop-off Analytics
// ===========================================

export interface FunnelStage {
    status: string;
    count: number;
    percentage: number;
    avg_days_in_stage: number;
    drop_off_rate: number;
}

export interface DropOffAlert {
    lead_id: string;
    lead_name: string;
    company_name: string;
    days_inactive: number;
    last_status: string;
    assigned_to: string;
    recommended_action: string;
}

// ===========================================
// Import Types
// ===========================================

export interface ImportColumnMapping {
    excelColumn: string;
    crmField: string;
}

export interface ImportResult {
    total_rows: number;
    success_count: number;
    error_count: number;
    skipped_duplicates: number;
    errors: Array<{
        row: number;
        field: string;
        message: string;
    }>;
    imported_leads: string[];
}

export interface DuplicateCheckResult {
    total_checked: number;
    duplicate_count: number;
    duplicate_indices: number[];
}

// Property Mapping
export interface CRMPropertyMapping {
    id: string;
    property_id: string;
    crm_property_name: string;
    is_active: boolean;
    created_at: string;
}

// ===========================================
// Core CRM Entities
// ===========================================

export interface CRMLead {
    id: string;
    created_at: string;
    created_by: string;
    assigned_to?: string;
    company_name?: string;
    contact_person?: string;
    contact_number?: string;
    secondary_contact_number?: string;
    email?: string;
    location?: string;
    requirement?: string;
    seats?: number;
    property_interest?: string;
    lead_source?: string;
    deal_value: number;
    status: string;
    priority: LeadPriority;
    next_followup_date?: string;
    followup_notes?: string;
    last_contacted?: string;
    move_in_timeline?: string;
    remarks?: string;
    meta_lead_id?: string;
    meta_campaign_id?: string;
    meta_adset_id?: string;
    meta_ad_id?: string;
    meta_form_name?: string;
    is_archived: boolean;
    updated_at: string;
    closed_at?: string | null;
    organization_id?: string | null;
    city?: string | null;
    campaign?: string | null;
    cohort?: string | null;
    // Joined data
    status_info?: LeadStatusConfig;
    source_info?: LeadSource;
    assigned_user?: CRMUser;
    creator?: CRMUser;
    property_info?: {
        id: string;
        name: string;
    };
}

export interface CRMActivity {
    id: string;
    lead_id: string;
    user_id: string;
    activity_type: ActivityType;
    description?: string;
    metadata: Record<string, any>;
    created_at: string;
    // Joined data
    user_info?: {
        id: string;
        full_name: string;
        email: string;
    };
}

export interface CRMEvent {
    id: string;
    lead_id?: string;
    user_id: string;
    title: string;
    description?: string;
    start_datetime: string;
    end_datetime?: string;
    event_type: EventType;
    status: EventStatus;
    created_at: string;
    updated_at: string;
    // Joined data
    lead_info?: {
        id: string;
        company_name: string;
        contact_person: string;
    };
}

export interface CRMNote {
    id: string;
    lead_id: string;
    user_id: string;
    note: string;
    created_at: string;
    // Joined data
    user_info?: {
        id: string;
        full_name: string;
        email: string;
    };
}

// ===========================================
// User Types
// ===========================================

export interface CRMUser {
    id: string;
    full_name: string;
    email: string;
    phone?: string;
    avatar_url?: string;
}

// ===========================================
// API Request/Response Types
// ===========================================

// Lead Filters
export interface LeadFilters {
    search?: string;
    status?: string[];
    priority?: LeadPriority[];
    assigned_to?: string[];
    property_interest?: string[];
    lead_source?: string[];
    date_from?: string;
    date_to?: string;
    is_archived?: boolean;
    page?: number;
    page_size?: number;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
}

// Lead Create/Update
export interface CreateLeadInput {
    company_name?: string;
    contact_person?: string;
    contact_number?: string;
    secondary_contact_number?: string;
    email?: string;
    location?: string;
    requirement?: string;
    seats?: number | null;
    move_in_timeline?: string | null;
    property_interest?: string;
    lead_source?: string;
    deal_value?: number;
    status?: string;
    priority?: LeadPriority;
    next_followup_date?: string;
    followup_notes?: string;
    remarks?: string;
    assigned_to?: string;
}

export interface UpdateLeadInput extends Partial<CreateLeadInput> {
    is_archived?: boolean;
}

// Activity Create
export interface CreateActivityInput {
    lead_id: string;
    activity_type: ActivityType;
    description?: string;
    metadata?: Record<string, any>;
}

// Event Create/Update
export interface CreateEventInput {
    lead_id?: string;
    title: string;
    description?: string;
    start_datetime: string;
    end_datetime?: string;
    event_type: EventType;
}

export interface UpdateEventInput extends Partial<CreateEventInput> {
    status?: EventStatus;
}

// Note Create
export interface CreateNoteInput {
    lead_id: string;
    note: string;
}

// ===========================================
// Dashboard Types
// ===========================================

export interface CRMDashboardStats {
    assigned_leads: number;
    open_followups: number;
    meetings_today: number;
    proposals_pending: number;
    won_this_month: number;
    pipeline_value: number;
    target_achievement_percent: number;
    average_closure_time_days: number;
}

export interface CRMPerformanceStats {
    leads_contacted: number;
    calls_completed: number;
    meetings_conducted: number;
    site_visits: number;
    proposals_sent: number;
    closures: number;
    win_ratio: number;
    pipeline_value: number;
    revenue_closed: number;
    target_achievement: number;
}

export interface CRMAdminStats extends CRMPerformanceStats {
    property_wise_leads: {
        property_id: string;
        property_name: string;
        count: number;
        value: number;
    }[];
    lead_source_analytics: {
        source_id: string;
        source_name: string;
        count: number;
    }[];
    user_performance: {
        user_id: string;
        user_name: string;
        leads: number;
        meetings: number;
        closures: number;
        value: number;
    }[];
    territory_performance: {
        city: string;
        leads: number;
        value: number;
    }[];
}

// ===========================================
// Import Types
// ===========================================

export interface CSVImportResult {
    total_rows: number;
    success_count: number;
    error_count: number;
    errors: {
        row: number;
        field: string;
        message: string;
    }[];
    imported_leads: string[];
}

// ===========================================
// AI Insights Types
// ===========================================

export interface AILeadSummary {
    lead_id: string;
    last_interaction: string;
    current_status: string;
    pending_actions: string[];
    probability_of_closure: number;
}

export interface AITeamQuery {
    query: string;
    results: any;
}

// ===========================================
// Timeline Types
// ===========================================

export interface TimelineItem {
    id: string;
    type: 'activity' | 'note' | 'event' | 'status_change';
    timestamp: string;
    title: string;
    description?: string;
    icon: string;
    user?: {
        id: string;
        full_name: string;
    };
    metadata?: Record<string, any>;
}

// ===========================================
// Calendar Types
// ===========================================

export interface CalendarEvent {
    id: string;
    title: string;
    start: Date;
    end?: Date;
    type: EventType;
    status: EventStatus;
    lead_id?: string;
    lead_name?: string;
    color?: string;
}

// ===========================================
// AI Call Coach Types
// ===========================================

export type CallStatus = 'uploaded' | 'transcribing' | 'scoring' | 'completed' | 'failed';

export type CoachingLayerKey = 'opening' | 'rapport' | 'requirements' | 'core' | 'closing';

export const COACHING_LAYER_KEYS: CoachingLayerKey[] = [
    'opening',
    'rapport',
    'requirements',
    'core',
    'closing',
];

export const COACHING_LAYER_LABELS: Record<CoachingLayerKey, string> = {
    opening: 'Opening',
    rapport: 'Rapport',
    requirements: 'Requirement Discovery',
    core: 'Core Conversation',
    closing: 'Closing',
};

export interface TranscriptSegment {
    speaker: 'rep' | 'client' | 'unknown';
    start: number;
    end: number;
    text: string;
}

export interface LayerScore {
    score: number;            // 0..10
    evidence: string;         // quoted phrase
    tip: string;              // one action
}

export interface CoachingReport {
    layers: Record<CoachingLayerKey, LayerScore>;
    overall_score: number;
    rep_talk_ratio: number;
    avg_rep_talk_seconds: number;
    did_right: string[];
    missed: string[];
    could_improve: string[];
    next_call_focus: string;
    summary: string;
}

export interface CrmCallSummary {
    id: string;
    status: CallStatus;
    uploaded_at: string;
    analyzed_at: string | null;
    duration_seconds: number | null;
    overall_score: number | null;
    rep_talk_ratio: number | null;
    summary: string | null;
    error_message?: string | null;
}

export interface CrmCallDetail extends CrmCallSummary {
    lead_id: string;
    bd_rep_id: string;
    rep?: { id: string; full_name: string; email: string } | null;
    file_size_bytes: number | null;
    mime_type: string | null;
    transcript: TranscriptSegment[] | null;
    coaching: CoachingReport | null;
    lead_company_name: string | null;
    lead_contact_person: string | null;
    playback_url: string | null;
}

export interface RepCallPoint {
    callId: string;
    uploadedAt: string;
    leadCompanyName: string | null;
    overallScore: number;
    repTalkRatio: number;
    avgRepTalkSeconds: number;
    layers: Record<CoachingLayerKey, number>;
}

export interface RepTrend {
    bdRepId: string;
    bdRepName: string;
    callCount: number;
    avgOverallScore: number;
    avgRepTalkRatio: number;
    avgLayers: Record<CoachingLayerKey, number>;
    recentDelta: number | null;
    direction: 'improving' | 'flat' | 'declining' | 'insufficient_data';
    history: RepCallPoint[];
    weakestLayer: CoachingLayerKey | null;
}

export interface CoachingOverview {
    orgId: string;
    windowSize: number;
    totals: { callsAnalyzed: number; avgOrgScore: number };
    reps: RepTrend[];
}

// ===========================================
// Reports Types
// ===========================================

export interface ReportFilters {
    date_from?: string;
    date_to?: string;
    user_id?: string;
    territory?: string;
    property_id?: string;
    source_id?: string;
    status_id?: string;
}

export interface ReportData {
    type: 'user' | 'territory' | 'property' | 'source' | 'status' | 'revenue' | 'monthly_funnel' | 'quarterly_funnel';
    data: any;
    generated_at: string;
}

// ===========================================
// Decision-Maker Impact Report Types
// ===========================================

export interface ImpactReportKpis {
    leads_received: number;
    leads_connected: number;
    active_pipeline_value: number;
    won_revenue: number;
    lost_revenue: number;
    win_rate: number;
    avg_deal_size: number;
    avg_time_to_close_days: number | null;
    total_spend: number;
    cpl: number;
    cpa: number;
    roi: number;
    stale_pipeline: { count: number; value: number; days: number };
}

export interface ImpactReportMonthly {
    key: string;
    label: string;
    leads: number;
    connected: number;
    meetings: number;
    won: number;
    lost: number;
    revenue: number;
    lostRevenue: number;
    topSource: string;
    spend: number;
}

export interface ImpactReportCampaign {
    id: string;
    name: string;
    leads: number;
    connected: number;
    won: number;
    revenue: number;
    spend: number;
    roi: number | null;
    cpl: number | null;
    cpa: number | null;
}

export interface ImpactReportRep {
    id: string;
    name: string;
    leads: number;
    connected: number;
    won: number;
    lost: number;
    pipeline: number;
    revenue: number;
    win_rate: number;
    avg_days_to_close: number | null;
    closeTimes: number[];
}

export interface ImpactReportStatusBucket {
    id: string;
    name: string;
    color: string;
    count: number;
    value: number;
    isWon: boolean;
    isLost: boolean;
}

export interface ImpactReportSource {
    id: string | null;
    name: string;
    count: number;
    value: number;
    won: number;
    wonValue: number;
}

export interface ImpactReportLostReason {
    reason: string;
    count: number;
    value: number;
}

export interface ImpactReportPayload {
    period: { from: string; to: string; label: string; group_by: 'month' | 'week' };
    kpis: ImpactReportKpis;
    sparklines: { leads: number[]; won: number[]; lost: number[]; revenue: number[]; connected: number[] };
    monthly_trend: ImpactReportMonthly[];
    status_distribution: ImpactReportStatusBucket[];
    source_breakdown: ImpactReportSource[];
    campaign_breakdown: ImpactReportCampaign[];
    rep_performance: ImpactReportRep[];
    lost_reasons: ImpactReportLostReason[];
    insights: {
        top_campaign: ImpactReportCampaign | null;
        underperformer: ImpactReportRep | null;
    };
    filters: {
        campaigns: Array<{ id: string; name: string; channel: string | null; budget_total: number | null; budget_period: string | null; start_date: string | null; end_date: string | null }>;
        properties: Array<{ id: string; name: string }>;
    };
    target_win_rate: number;
    generated_at: string;
}
