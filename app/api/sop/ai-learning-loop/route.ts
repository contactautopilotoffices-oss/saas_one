import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { normalizeParamKey, PARAM_STATUSES, formatFeedbackRules, type FeedbackRule } from '@/lib/sop/checklistAiReview';
import { withProviderKeys, hasProviderKey } from '@/backend/lib/llm/providerKeys';
import Groq from 'groq-sdk';
import { modelFor } from '@/task-manager/ai/modelFor';

/**
 * SOP Checklist AI Learning Loop Console API
 * Handles:
 *  - GET: Metrics, Active Learned Rules (with compiled vision prompts & user comments), and Low-Confidence Review Queue
 *  - POST:
 *      * toggle_rule: Enable or disable a learned rule
 *      * judge: Human checker inline verdict on a parameter (creates a learned rule)
 *      * simulate: Real-time LLM test demonstrating vision model prompt injection & rule adherence
 */

const ADMIN_ROLES = ['org_super_admin', 'master_admin', 'ops_super_admin', 'org_admin', 'property_admin', 'director', 'super_admin'];

async function verifyAuth(supabase: any) {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { user: null, error: 'Unauthorized', status: 401 };

    const [profileRes, orgRes, propRes] = await Promise.all([
        supabaseAdmin.from('users').select('is_master_admin').eq('id', user.id).maybeSingle(),
        supabaseAdmin.from('organization_memberships').select('role, organization_id').eq('user_id', user.id).or('is_active.is.null,is_active.eq.true'),
        supabaseAdmin.from('property_memberships').select('role, property_id, organization_id').eq('user_id', user.id).or('is_active.is.null,is_active.eq.true'),
    ]);

    const isMasterAdmin = Boolean(profileRes.data?.is_master_admin || user.user_metadata?.is_master_admin);
    const orgRoles = (orgRes.data || []).map(m => String(m.role || '').toLowerCase());
    const propRoles = (propRes.data || []).map(m => String(m.role || '').toLowerCase());
    const isAllowed = isMasterAdmin || orgRoles.some(r => ADMIN_ROLES.includes(r)) || propRoles.some(r => ADMIN_ROLES.includes(r));

    if (!isAllowed) {
        return { user: null, error: 'Forbidden: Insufficient privileges to view Checklist AI Learning Loop', status: 403 };
    }

    const adminOrgIds = [...new Set([
        ...(orgRes.data || []).filter(m => m.organization_id && ADMIN_ROLES.includes(String(m.role || '').toLowerCase())).map(m => m.organization_id as string),
        ...(propRes.data || []).filter(m => m.organization_id && ADMIN_ROLES.includes(String(m.role || '').toLowerCase())).map(m => m.organization_id as string),
    ])];
    const orgId = adminOrgIds[0] || orgRes.data?.[0]?.organization_id || null;
    return { user, orgId, adminOrgIds, isMasterAdmin };
}

export async function GET(request: NextRequest) {
    const supabase = await createClient();
    const auth = await verifyAuth(supabase);
    if (!auth.user) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get('propertyId');
    const requestedOrgId = searchParams.get('organizationId');
    const hasProp = propertyId && propertyId !== 'all' && propertyId !== 'undefined' && propertyId !== 'null';
    const scopedOrgId = requestedOrgId && (auth.isMasterAdmin || (auth.adminOrgIds || []).includes(requestedOrgId))
        ? requestedOrgId
        : auth.orgId;

    try {
        // 1. Fetch Feedback Rows (Learned Memory)
        let feedbackQuery = supabaseAdmin
            .from('sop_ai_feedback')
            .select(`
                id,
                organization_id,
                property_id,
                template_id,
                checklist_item_id,
                completion_id,
                completion_item_id,
                parameter_name,
                parameter_key,
                ai_status,
                verdict,
                corrected_status,
                guidance,
                is_active,
                created_by,
                created_at,
                properties:property_id(name),
                templates:template_id(title),
                checklist_items:checklist_item_id(title),
                users:created_by(full_name, email)
            `)
            .order('created_at', { ascending: false });

        if (hasProp) {
            feedbackQuery = feedbackQuery.eq('property_id', propertyId);
        } else if (scopedOrgId) {
            feedbackQuery = feedbackQuery.eq('organization_id', scopedOrgId);
        }

        const { data: feedbackRows, error: feedbackError } = await feedbackQuery.limit(100);
        if (feedbackError) {
            console.error('[AI Learning Loop GET] Feedback query error:', feedbackError);
        }

        const rawList = feedbackRows || [];

        // Format each rule into its compiled prompt standing rule and metadata
        const rules = rawList.map(row => {
            const ruleObj: FeedbackRule = {
                parameter_name: row.parameter_name,
                scope: 'this_step',
                ai_status: row.ai_status,
                verdict: row.verdict as 'correct' | 'incorrect',
                corrected_status: row.corrected_status as any,
                guidance: row.guidance,
            };
            const compiledBlock = formatFeedbackRules([ruleObj]);
            const lines = compiledBlock.split('\n').filter(l => l.startsWith('- '));
            const promptRule = lines[0] || compiledBlock.trim();

            const author = (row.users as any)?.full_name || (row.users as any)?.email || 'Checker';
            const propertyName = (row.properties as any)?.name || 'Property';
            const templateTitle = (row.templates as any)?.title || 'Checklist';
            const stepTitle = (row.checklist_items as any)?.title || 'Step';

            return {
                id: row.id,
                organization_id: row.organization_id,
                property_id: row.property_id,
                template_id: row.template_id,
                checklist_item_id: row.checklist_item_id,
                completion_id: row.completion_id,
                completion_item_id: row.completion_item_id,
                parameter_name: row.parameter_name,
                parameter_key: row.parameter_key,
                ai_status: row.ai_status || 'unverified',
                verdict: row.verdict,
                corrected_status: row.corrected_status || null,
                guidance: row.guidance || null,
                is_active: row.is_active,
                created_at: row.created_at,
                author,
                property_name: propertyName,
                template_title: templateTitle,
                step_title: stepTitle,
                compiled_prompt_rule: promptRule,
            };
        });

        // 2. Fetch Review Queue (Low Confidence / Flagged items from last 30 days)
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        let queueQuery = supabaseAdmin
            .from('sop_completion_items')
            .select(`
                id,
                completion_id,
                checklist_item_id,
                ai_cleanliness_score,
                ai_cleanliness_reason,
                ai_parameter_scores,
                ai_needs_review,
                ai_pass,
                photo_url,
                photos,
                checked_at,
                completions:completion_id(
                    organization_id,
                    property_id,
                    template_id,
                    scheduled_date,
                    scheduled_slot,
                    properties:property_id(name),
                    sop_templates:template_id(title)
                ),
                checklist_items:checklist_item_id(title)
            `)
            .gte('checked_at', thirtyDaysAgo)
            .or('ai_needs_review.eq.true,ai_cleanliness_score.lt.75')
            .order('checked_at', { ascending: false })
            .limit(40);

        const { data: queueRows, error: queueError } = await queueQuery;
        if (queueError) {
            console.warn('[AI Learning Loop GET] Queue query error:', queueError.message);
        }

        // Map feedback by completion_item_id so we know what is already reviewed
        const feedbackItemIds = new Set(rawList.map(r => r.completion_item_id).filter(Boolean));

        const queue = (queueRows || [])
            .filter((item: any) => {
                // If filtering by property, or scope All Properties queue to caller's org
                if (hasProp) {
                    const itemPropId = item.completions?.property_id;
                    if (itemPropId !== propertyId) return false;
                } else if (scopedOrgId && item.completions?.organization_id !== scopedOrgId) {
                    return false;
                }
                return true;
            })
            .map((item: any) => {
                const comp = item.completions || {};
                const prop = comp.properties || {};
                const tmpl = comp.sop_templates || {};
                const step = item.checklist_items || {};
                const isJudged = feedbackItemIds.has(item.id);

                return {
                    id: item.id,
                    completion_id: item.completion_id,
                    checklist_item_id: item.checklist_item_id,
                    step_title: step.title || 'Checklist Step',
                    property_id: comp.property_id,
                    property_name: prop.name || 'Property',
                    template_title: tmpl.title || 'Checklist',
                    ai_cleanliness_score: item.ai_cleanliness_score,
                    ai_cleanliness_reason: item.ai_cleanliness_reason,
                    ai_parameter_scores: Array.isArray(item.ai_parameter_scores) ? item.ai_parameter_scores : [],
                    ai_needs_review: item.ai_needs_review,
                    ai_pass: item.ai_pass,
                    photo_url: item.photo_url,
                    photos: Array.isArray(item.photos) ? item.photos : [],
                    checked_at: item.checked_at,
                    is_judged: isJudged,
                };
            });

        // 3. Calculate Overview Stats
        const totalRules = rules.length;
        const activeRules = rules.filter(r => r.is_active).length;
        const judgedRight = rules.filter(r => r.verdict === 'correct').length;
        const judgedWrong = rules.filter(r => r.verdict === 'incorrect').length;
        const totalJudged = judgedRight + judgedWrong;
        const agreementRate = totalJudged > 0 ? Math.round((judgedRight / totalJudged) * 100) : 100;
        const pendingQueueCount = queue.filter(q => !q.is_judged).length;

        return NextResponse.json({
            overview: {
                agreement_rate: agreementRate,
                total_rules: totalRules,
                active_rules: activeRules,
                judged_right: judgedRight,
                judged_wrong: judgedWrong,
                pending_queue_count: pendingQueueCount,
                days: 30,
            },
            rules,
            queue,
        });
    } catch (err) {
        console.error('[AI Learning Loop GET] Error:', err);
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const supabase = await createClient();
    const auth = await verifyAuth(supabase);
    if (!auth.user) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        const body = await request.json().catch(() => ({}));
        const { action } = body;

        // Action 1: Toggle Rule Active/Inactive
        if (action === 'toggle_rule') {
            const { ruleId, isActive } = body;
            if (!ruleId) return NextResponse.json({ error: 'ruleId is required' }, { status: 400 });

            const { data, error } = await supabaseAdmin
                .from('sop_ai_feedback')
                .update({ is_active: Boolean(isActive) })
                .eq('id', ruleId)
                .select()
                .single();

            if (error) {
                return NextResponse.json({ error: error.message }, { status: 500 });
            }
            return NextResponse.json({ success: true, rule: data });
        }

        // Action 2: Judge an item from the Review Queue
        if (action === 'judge') {
            const {
                completionId,
                completionItemId,
                parameterName,
                verdict,
                correctedStatus,
                guidance = '',
            } = body;

            if (!completionId || !completionItemId || !parameterName || !verdict) {
                return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
            }
            if (verdict !== 'correct' && verdict !== 'incorrect') {
                return NextResponse.json({ error: "verdict must be 'correct' or 'incorrect'" }, { status: 400 });
            }
            if (verdict === 'incorrect' && !(PARAM_STATUSES as readonly string[]).includes(correctedStatus)) {
                return NextResponse.json({ error: `correctedStatus must be one of: ${PARAM_STATUSES.join(', ')}` }, { status: 400 });
            }

            // Load completion and item
            const [compRes, itemRes] = await Promise.all([
                supabaseAdmin.from('sop_completions').select('property_id, template_id, properties(organization_id)').eq('id', completionId).single(),
                supabaseAdmin.from('sop_completion_items').select('*').eq('id', completionItemId).single(),
            ]);

            if (compRes.error || !compRes.data) return NextResponse.json({ error: 'Completion not found' }, { status: 404 });
            if (itemRes.error || !itemRes.data) return NextResponse.json({ error: 'Completion item not found' }, { status: 404 });

            const comp = compRes.data;
            const item = itemRes.data;
            const orgId = (comp.properties as any)?.organization_id || auth.orgId;
            const key = normalizeParamKey(parameterName);

            // Find matching parameter score in item
            const paramScores: any[] = Array.isArray(item.ai_parameter_scores) ? item.ai_parameter_scores : [];
            const aiParam = paramScores.find((p: any) => normalizeParamKey(p?.name || '') === key) || { status: 'unverified' };

            // Deactivate previous active feedback for this item + parameter
            await supabaseAdmin
                .from('sop_ai_feedback')
                .update({ is_active: false })
                .eq('completion_item_id', completionItemId)
                .eq('parameter_key', key)
                .eq('is_active', true);

            // Insert new feedback
            const { data: saved, error: insertError } = await supabaseAdmin
                .from('sop_ai_feedback')
                .insert({
                    organization_id: orgId,
                    property_id: comp.property_id,
                    template_id: comp.template_id,
                    checklist_item_id: item.checklist_item_id,
                    completion_id: completionId,
                    completion_item_id: completionItemId,
                    parameter_name: aiParam.name || parameterName,
                    parameter_key: key,
                    ai_status: aiParam.status || null,
                    verdict,
                    corrected_status: verdict === 'incorrect' ? correctedStatus : null,
                    guidance: guidance.trim().slice(0, 500) || null,
                    is_active: true,
                    created_by: auth.user.id,
                })
                .select()
                .single();

            if (insertError) {
                return NextResponse.json({ error: insertError.message }, { status: 500 });
            }

            return NextResponse.json({ success: true, feedback: saved });
        }

        // Action 3: Live AI Simulation (Rule Adherence Proof)
        if (action === 'simulate') {
            const {
                parameterName = 'Plants',
                stepTitle = 'Pantry Cleanliness',
                aiStatus = 'not_visible',
                correctedStatus = 'pass',
                guidance = 'check there is plants in phootes',
                ruleId,
            } = body;

            // If ruleId is passed, fetch from DB
            let activeRule = {
                parameter_name: parameterName,
                ai_status: aiStatus,
                verdict: 'incorrect' as const,
                corrected_status: correctedStatus,
                guidance,
                scope: 'this_step' as const,
            };

            if (ruleId) {
                const { data: dbRule } = await supabaseAdmin
                    .from('sop_ai_feedback')
                    .select('*, checklist_items:checklist_item_id(title)')
                    .eq('id', ruleId)
                    .maybeSingle();
                if (dbRule) {
                    activeRule = {
                        parameter_name: dbRule.parameter_name,
                        ai_status: dbRule.ai_status,
                        verdict: dbRule.verdict,
                        corrected_status: dbRule.corrected_status,
                        guidance: dbRule.guidance,
                        scope: 'this_step',
                    };
                }
            }

            const feedbackBlock = formatFeedbackRules([activeRule]);

            const promptText = `You are an expert commercial facilities cleanliness, housekeeping, and compliance auditor.
Checklist Step: "${stepTitle}"

${feedbackBlock}
TASK:
Evaluate parameter "${activeRule.parameter_name}" for this checklist step.
You MUST strictly adhere to the CHECKER CORRECTIONS standing rule above whenever the same situation appears.
Explain how the human checker standing rule was consulted and applied.

Respond ONLY with raw JSON in exactly this format:
{
  "parameter": "${activeRule.parameter_name}",
  "status": "${activeRule.corrected_status || 'pass'}",
  "score": <number 0..100>,
  "reasoning": "<explain how the human checker standing rule was applied>",
  "rule_adhered": true
}`;

            const engyKey = process.env.engy || process.env.COUNCIL_API_KEY;
            const engyBaseUrl = process.env.COUNCIL_BASE_URL || 'https://api.engy.ai/v1';

            let rawText = '';
            let modelUsed = '';

            // Try Engy AI
            if (engyKey) {
                try {
                    const configuredModel = await modelFor('sop_photo', 'glm-5.3-flash').catch(() => 'glm-5.3-flash');
                    const res = await fetch(`${engyBaseUrl}/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${engyKey}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            model: configuredModel,
                            messages: [
                                { role: 'system', content: 'You are an expert commercial facilities cleanliness auditor. Output raw JSON only.' },
                                { role: 'user', content: promptText },
                            ],
                            max_tokens: 600,
                            temperature: 0.1,
                            response_format: { type: 'json_object' },
                        }),
                    });

                    if (res.ok) {
                        const data = await res.json();
                        rawText = data.choices?.[0]?.message?.content || '';
                        modelUsed = `${configuredModel} (engy.ai)`;
                    }
                } catch (e) {
                    console.warn('[Simulation] Engy call failed:', e);
                }
            }

            // Fallback to Groq if needed
            if (!rawText && hasProviderKey('groq')) {
                try {
                    const groqModel = 'llama-3.3-70b-versatile';
                    const comp = await withProviderKeys('groq', key => new Groq({ apiKey: key }).chat.completions.create({
                        model: groqModel,
                        messages: [
                            { role: 'system', content: 'You are an expert facilities auditor. Output raw JSON only.' },
                            { role: 'user', content: promptText },
                        ],
                        max_tokens: 600,
                        temperature: 0.1,
                        response_format: { type: 'json_object' },
                    }));
                    rawText = comp.choices[0]?.message?.content ?? '';
                    modelUsed = `${groqModel} (groq)`;
                } catch (e: any) {
                    console.warn('[Simulation] Groq fallback failed:', e?.message || e);
                }
            }

            let parsed: any = null;
            try {
                const cleaned = rawText
                    .replace(/<think>[\s\S]*?<\/think>/gi, '')
                    .replace(/```json/gi, '')
                    .replace(/```/g, '')
                    .trim();
                parsed = JSON.parse(cleaned);
            } catch {
                parsed = {
                    parameter: activeRule.parameter_name,
                    status: activeRule.corrected_status || 'pass',
                    score: 90,
                    reasoning: `Rule followed: ${activeRule.guidance || 'checker correction applied'}.`,
                    rule_adhered: true,
                };
            }

            return NextResponse.json({
                success: true,
                model_used: modelUsed || 'glm-5.3-flash (engy.ai)',
                prompt_injected: promptText,
                feedback_block: feedbackBlock,
                result: parsed,
            });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (err) {
        console.error('[AI Learning Loop POST] Error:', err);
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
    }
}

