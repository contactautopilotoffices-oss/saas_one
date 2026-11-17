/**
 * Ticket Classifier Resolver
 *
 * Owner 2026-11-15: "i want everything to go to the llm model ... and it must be configurable from the brain".
 * 1. The AI sorts every ticket (aiClassifier.ts): category from the real category list, team, priority, risk, reason.
 *    The model is the "Sorting new tickets" job in Brain → AI models; backups are tried in order.
 * 2. Only when every model fails do the old keyword rules (classifyTicketEnhanced) decide, so no ticket is stuck.
 * 3. Log to database (ticket_classification_logs), naming the model that answered.
 * The keyword scores and the confidence zone are still worked out, but only for that fallback and for the log.
 */

import { classifyTicketEnhanced, classifyTicket, EnhancedClassificationResult, SkillGroup } from './classifyTicket';
import { analyzeConfidence, ConfidenceAnalysis, ClassificationZone } from './confidence';
import { classifyWithAi, classifyManyWithAi, loadCategoryOptions, loadCorrections, type AiDeps, type AiVerdict, type CategoryOption, type Correction } from './aiClassifier';
import { createClient } from '@supabase/supabase-js';
import { emitWebhook } from './webhooks';

export type DecisionSource = 'rule' | 'llm' | 'human';

export interface ResolvedClassification {
    // Final result
    issue_code: string | null;
    skill_group: SkillGroup;
    confidence: 'high' | 'low';

    // Decision metadata
    zone: ClassificationZone;
    decisionSource: DecisionSource;
    llmUsed: boolean;
    llmEnhanced: boolean; // True if LLM was used AND its result was accepted

    // For frontend display
    enhancedClassification: boolean;
    secondary_category_code?: string | null;
    risk_flag?: string | null;
    llm_reasoning?: string | null;
    priority?: string | null;
    /**
     * Owner 2026-11-15: the AI's own rating of how sure it is, 0–100, saved as the ticket's confidence_score and shown as
     * "72% (Medium)". Not set when the keyword rules sorted the ticket (the caller then keeps its old value).
     */
    confidenceScore?: number;

    // Original rule result (for logging)
    ruleResult: EnhancedClassificationResult;
    confidenceAnalysis: ConfidenceAnalysis;

    // LLM details (if used)
    llmResult?: {
        /** The model that answered (catalog id, e.g. 'anthropic:claude-haiku-5-5'). */
        model?: string;
        selectedBucket: string;
        secondaryBucket?: string | null;
        priority?: string;
        riskFlag?: string | null;
        reason: string;
        latencyMs: number;
        usage?: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
        };
    };
}

export interface ClassificationLogEntry {
    ticket_id: string;
    rule_top_bucket: string;
    rule_scores: Record<string, number>;
    rule_margin: number;
    entropy: number;
    llm_used: boolean;
    llm_bucket?: string;
    llm_secondary_bucket?: string | null;
    llm_risk_flag?: string | null;
    llm_reason?: string;
    llm_latency_ms?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    final_bucket: string;
    decision_source: DecisionSource;
    zone: ClassificationZone;
}

export interface ResolveOptions {
    /** The ticket's property: the AI then chooses from that property's categories plus the shared ones. */
    propertyId?: string | null;
    /** The ticket's organisation: the AI is shown that organisation's past corrections (Brain → Review → Tickets). */
    organizationId?: string | null;
    /** For tests: the model transport, the model list, the category list and the corrections. */
    deps?: AiDeps;
    categories?: CategoryOption[];
    corrections?: Correction[];
}

const TITLE_PRIORITY: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };

/**
 * Main resolver function. The second argument used to be the category's priority as a hint for the model; that is no
 * longer needed (the model sees every category's usual priority), so a string there is accepted and ignored.
 */
export async function resolveClassification(ticketText: string, options?: string | ResolveOptions): Promise<ResolvedClassification> {
    const opts: ResolveOptions = typeof options === 'object' && options ? options : {};

    // The keyword rules: only the fallback now, and the scores for the log.
    const ruleResult = classifyTicketEnhanced(ticketText);
    const confidenceAnalysis = analyzeConfidence(ruleResult, ticketText);

    // Default response (rule-based)
    const finalResult: ResolvedClassification = {
        issue_code: ruleResult.issue_code,
        skill_group: ruleResult.skill_group,
        confidence: ruleResult.confidence,
        zone: confidenceAnalysis.zone,
        decisionSource: 'rule',
        llmUsed: false,
        llmEnhanced: false,
        enhancedClassification: false,
        ruleResult,
        confidenceAnalysis,
    };

    // The AI sorts every ticket. Any failure (no key, every model down, only bad answers) leaves the rules' answer.
    try {
        const [categories, corrections] = await Promise.all([
            opts.categories ?? loadCategoryOptions(opts.propertyId),
            opts.corrections ?? loadCorrections(opts.organizationId),
        ]);
        const sorted = await classifyWithAi(ticketText, categories, opts.deps, corrections);
        applyVerdict(finalResult, sorted.verdict);
        finalResult.llmResult = {
            model: sorted.model,
            selectedBucket: sorted.verdict.team,
            secondaryBucket: null,
            priority: TITLE_PRIORITY[sorted.verdict.priority],
            riskFlag: sorted.verdict.risk,
            reason: sorted.verdict.reason,
            latencyMs: sorted.latencyMs,
            usage: { prompt_tokens: sorted.tokensIn, completion_tokens: sorted.tokensOut, total_tokens: sorted.tokensIn + sorted.tokensOut },
        };
        if (sorted.failures.length) console.warn(`[Resolver] ticket sorted by ${sorted.model} after ${sorted.failures.length} model(s) failed`);
        emitWebhook('llm.invoked', 'pending', {
            ticket_id: 'pending',
            source: 'resolver',
            model: sorted.model,
            latency_ms: sorted.latencyMs,
            result: sorted.verdict,
        });
    } catch (err) {
        console.warn('[Resolver] AI sorting failed; the keyword rules decide this ticket:', err instanceof Error ? err.message.slice(0, 500) : err);
    }

    return finalResult;
}

/** Writes an AI verdict onto a resolution (shared by single tickets and bulk import). */
function applyVerdict(r: ResolvedClassification, v: AiVerdict): void {
    r.issue_code = v.code;
    r.skill_group = v.team;
    r.confidence = v.vague ? 'low' : 'high';
    r.decisionSource = 'llm';
    r.llmUsed = true;
    r.llmEnhanced = true;
    r.enhancedClassification = true;
    r.secondary_category_code = null;
    r.risk_flag = v.risk;
    r.llm_reasoning = v.reason;
    r.priority = TITLE_PRIORITY[v.priority];
    r.confidenceScore = v.confidence;
}

/** One bulk-import row, sorted. `priority` is the AI's (lowercase), null when the keyword rules decided. */
export interface ImportSorting {
    issue_code: string | null;
    skill_group: SkillGroup;
    confidence: 'high' | 'low';
    priority: string | null;
    risk_flag: string | null;
    reasoning: string | null;
    /** The AI's own 0–100 rating; null when the keyword rules sorted the row. */
    confidenceScore: number | null;
    source: DecisionSource;
}

/**
 * Bulk import (Snags upload): the AI sorts the rows several at a time; a row it gave no usable answer for is sorted by
 * the keyword rules, as every row was before. Never throws.
 */
export async function resolveImportRows(texts: readonly string[], options: ResolveOptions = {}): Promise<ImportSorting[]> {
    let categories: CategoryOption[] = [];
    let corrections: Correction[] = [];
    try {
        [categories, corrections] = await Promise.all([
            options.categories ?? loadCategoryOptions(options.propertyId),
            options.corrections ?? loadCorrections(options.organizationId),
        ]);
    } catch (err) {
        console.warn('[Resolver] category list unavailable for bulk import:', err instanceof Error ? err.message : err);
    }
    const ai = await classifyManyWithAi(texts, categories, options.deps, corrections);
    return texts.map((text, i) => {
        const hit = ai[i];
        if (hit) {
            const v = hit.verdict;
            return { issue_code: v.code, skill_group: v.team, confidence: v.vague ? 'low' : 'high', priority: v.priority, risk_flag: v.risk, reasoning: v.reason, confidenceScore: v.confidence, source: 'llm' as const };
        }
        const rules = classifyTicket(text);
        return { issue_code: rules.issue_code, skill_group: rules.skill_group, confidence: rules.confidence, priority: null, risk_flag: null, reasoning: null, confidenceScore: null, source: 'rule' as const };
    });
}

/**
 * Log classification decision to database
 */
export async function logClassification(
    ticketId: string,
    resolution: ResolvedClassification
): Promise<void> {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.warn('[Resolver] Cannot log: missing Supabase config');
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const logEntry: ClassificationLogEntry = {
        ticket_id: ticketId,
        rule_top_bucket: resolution.ruleResult.skill_group,
        rule_scores: resolution.ruleResult.scores,
        rule_margin: resolution.ruleResult.margin,
        entropy: resolution.confidenceAnalysis.entropy,
        llm_used: resolution.llmUsed,
        llm_bucket: resolution.llmResult?.selectedBucket,
        llm_secondary_bucket: resolution.llmResult?.secondaryBucket,
        llm_risk_flag: resolution.llmResult?.riskFlag,
        // The table has no model column (no migration for this): the model that answered is named after the reason.
        llm_reason: resolution.llmResult ? `${resolution.llmResult.reason}${resolution.llmResult.model ? ` [${resolution.llmResult.model}]` : ''}` : undefined,
        llm_latency_ms: resolution.llmResult?.latencyMs,
        prompt_tokens: resolution.llmResult?.usage?.prompt_tokens,
        completion_tokens: resolution.llmResult?.usage?.completion_tokens,
        total_tokens: resolution.llmResult?.usage?.total_tokens,
        final_bucket: resolution.skill_group,
        decision_source: resolution.decisionSource,
        zone: resolution.zone,
    };

    const { error } = await supabase
        .from('ticket_classification_logs')
        .insert(logEntry);

    if (error) {
        console.error('[Resolver] Failed to log classification:', error);
    }

    // Emit final categorized webhook
    emitWebhook('ticket.categorized', ticketId, {
        final_category: resolution.skill_group,
        secondary_category: resolution.secondary_category_code,
        priority: resolution.priority || (resolution.ruleResult.confidence === 'high' ? 'Medium' : 'Low'),
        risk_flag: resolution.risk_flag,
        decision_source: resolution.decisionSource,
        reasoning: resolution.llm_reasoning
    });
}

/**
 * Combined resolve and log function for convenience
 */
export async function resolveAndLogClassification(
    ticketText: string,
    ticketId: string
): Promise<ResolvedClassification> {
    const resolution = await resolveClassification(ticketText);

    // Log asynchronously - don't block on this
    logClassification(ticketId, resolution).catch(err => {
        console.error('[Resolver] Logging error:', err);
    });

    return resolution;
}
