/**
 * SATEJ — vendor discovery agent. Shared types.
 *
 * One requirement moves through:
 *   submitted → (needs_clarification) → structured → discovering → (awaiting_call_approval)
 *   → calling → calls_done → analyzing → ranked → notified
 *
 * Ported from the standalone procurement-agent package (Procurement_Agent_Plan.md).
 * The only shape changes are the tenant (`organizationId`), the origin the
 * requirement was raised from (`appOrigin`, used for links and the Bolna
 * webhook), and the WhatsApp outbox, which is gone: FMS sends WhatsApp through
 * AiSensy templates, which have no 24-hour window to queue around.
 */

export type RequirementStatus =
    | 'submitted' // form received, not yet structured
    | 'needs_clarification' // Satej asked the purchase team questions
    | 'structured' // brief ready, discovery not started
    | 'discovering' // searching the web for vendors
    | 'awaiting_call_approval' // SATEJ_AUTO_START_CALLS is off (the default)
    | 'calling' // Bolna batch created and scheduled
    | 'calls_done' // all calls finished (or timed out)
    | 'analyzing' // reading transcripts and scoring
    | 'ranked' // ranking ready, WhatsApp not sent yet
    | 'notified' // WhatsApp summary sent (or given up on — see error)
    | 'failed'
    | 'cancelled';

export type SpendType = 'capex' | 'opex';

export interface RequirementInput {
    title: string; // short name, e.g. "Gypsum false ceiling, Lower Parel"
    spendType: SpendType;
    itemDescription: string; // what exactly is needed, specs if known
    quantity: string; // free text so "1200" or "approx 40 units" both work
    unit: string; // sqft, nos, rmt, kg, month ...
    scope: string; // supply only / supply + install / service / AMC, in words
    locationCity: string;
    locationArea: string; // locality, e.g. "Andheri East"
    siteName?: string;
    timeline?: string; // e.g. "needed within 10 days"
    budgetHint?: string; // internal only, never spoken on calls
    notes?: string;
    vendorTarget?: number; // how many vendors to call
    requestedBy: string; // name of the team member
    requestedByUserId?: string; // users.id of whoever submitted the form
    notifyWhatsapp: string; // purchase team number that gets the summary
}

export type ScopeType = 'supply_only' | 'supply_and_install' | 'service' | 'amc' | 'works_contract';

export interface StructuredBrief {
    itemCategory: string; // e.g. "Gypsum false ceiling contractor"
    itemSummary: string; // one short spoken-friendly line for the call
    specs: string[];
    quantity: string;
    unit: string;
    quantityText: string; // "about 1,200 square feet"
    scopeType: ScopeType;
    locationCity: string;
    locationArea: string;
    locationText: string; // "Lower Parel, Mumbai"
    timelineDays: number | null;
    timelineText: string;
    vendorTypes: string[]; // e.g. ["false ceiling contractor", "gypsum board dealer"]
    searchQueries: string[];
    mustHave: string[];
    questions: string[]; // blocking questions only; empty when good to go
}

export type VendorStatus = 'found' | 'queued' | 'called' | 'not_reached' | 'excluded';

export interface Vendor {
    id: string;
    organizationId: string;
    requirementId: string;
    name: string;
    phone: string; // E.164, e.g. +919876543210
    phoneRaw: string;
    address: string;
    area: string;
    city: string;
    website: string;
    sells: string;
    webYearsInBusiness: number | null;
    relevance: number; // 0-10 from discovery
    sourceUrls: string[];
    status: VendorStatus;
    excludeReason?: string;
    createdAt: string;
}

export type GstStatus = 'yes' | 'no' | 'unknown';
export type MatchLevel = 'exact' | 'strong' | 'partial' | 'weak';

export interface CallAnalysis {
    reachedRightPerson: boolean;
    contactPerson: string;
    gstRegistered: GstStatus;
    gstin: string;
    yearsExperience: number | null;
    annualTurnoverText: string;
    annualTurnoverLakhs: number | null;
    hasWebsite: GstStatus;
    websiteUrl: string;
    hasCompanyProfile: GstStatus;
    turnaroundDays: number | null;
    turnaroundText: string;
    specialisations: string[];
    specialisationMatch: MatchLevel;
    clients: { name: string; sector: string }[];
    referencesOffered: boolean;
    testimonialsText: string;
    usps: string[];
    authenticityScore: number; // 0-10
    authenticityReasons: string[];
    redFlags: string[];
    summary: string;
    evidence: { field: string; quote: string }[];
}

export interface ScoreBreakdown {
    total: number; // 0-100
    qualification: 'qualified' | 'verify_gst' | 'disqualified' | 'not_reached';
    parts: { label: string; points: number; max: number; why: string }[];
}

/** Bolna execution statuses after which nothing more will happen to that call. */
export const FINAL_CALL_STATUSES = [
    'completed',
    'call-disconnected',
    'no-answer',
    'busy',
    'failed',
    'canceled',
    'stopped',
    'error',
    'balance-low',
] as const;

export interface CallRecord {
    id: string;
    organizationId: string;
    requirementId: string;
    vendorId: string | null;
    executionId: string;
    toNumber: string;
    status: string;
    durationSec: number | null;
    transcript: string;
    bolnaSummary: string;
    extracted: Record<string, unknown> | null;
    recordingUrl: string;
    retried: number;
    analysis?: CallAnalysis;
    score?: ScoreBreakdown;
    /** Failed analysis attempts. After 3 the call is ranked unanalysed rather than retried (and paid for) forever. */
    analysisAttempts?: number;
    analysisError?: string;
    createdAt: string;
    updatedAt: string;
}

export interface RankedVendor {
    rank: number;
    vendorId: string;
    vendorName: string;
    phone: string;
    area: string;
    score: ScoreBreakdown;
    summary: string;
    yearsExperience: number | null;
    clients: string[];
    specialisations: string[];
    usps: string[];
    turnaroundText: string;
    redFlags: string[];
    contactedAt: string;
}

export interface RequirementEvent {
    at: string;
    msg: string;
}

export interface Requirement {
    id: string;
    organizationId: string;
    code: string; // human code, e.g. REQ-260928-4821
    status: RequirementStatus;
    input: RequirementInput;
    /** Origin of the FMS the form was submitted from — links and the Bolna webhook are built on it. */
    appOrigin: string | null;
    brief?: StructuredBrief;
    clarifications: { question: string; answer: string }[];
    bolnaBatchId?: string;
    callsScheduledAt?: string;
    callsCompletedAt?: string;
    ranking?: RankedVendor[];
    notifiedAt?: string;
    notifyAttempts?: number;
    lastSyncAt?: string;
    round: number; // 1 for the first search; "Find more vendors" starts round 2 with wider queries
    error?: string;
    events: RequirementEvent[];
    createdAt: string;
    updatedAt: string;
}
