import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import Groq from 'groq-sdk';
import sharp from 'sharp';
import crypto from 'crypto';
import { extractActualImageTimestamp, getAllowedInspectionDates } from '@/lib/sop/imageTimestampHelper';

/**
 * POST /api/properties/[propertyId]/sop/completions/[completionId]/score-photo
 * AI cleanliness scoring: evaluates the uploaded step photo against the step's
 * reference benchmark and inspects each configured parameter individually.
 * Primary Model: Qwen 3.8 27B Vision via engy.ai (with fallback to Groq Qwen 3.6 27B)
 * Body: { completionItemId }
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string; completionId: string }> }
) {
    const { propertyId, completionId } = await params;
    const supabase = await createClient();

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { completionItemId } = body;

        if (!completionItemId) {
            return NextResponse.json({ error: 'completionItemId is required' }, { status: 400 });
        }

        // Verify completion belongs to this property (include date/slot for freshness verification)
        let compQuery = supabaseAdmin
            .from('sop_completions')
            .select('id, template_id, completion_date, slot_time, created_at')
            .eq('id', completionId);

        if (propertyId && propertyId !== 'all' && propertyId !== 'undefined' && propertyId !== 'null') {
            compQuery = compQuery.eq('property_id', propertyId);
        }

        const { data: completion, error: completionError } = await compQuery.maybeSingle();

        if (completionError || !completion) {
            return NextResponse.json({ error: 'Completion not found for this property' }, { status: 404 });
        }

        // Check if property is in basic mode or has AI scoring disabled
        const { data: propSettings } = await supabaseAdmin
            .from('checklist_property_settings')
            .select('checklist_mode, ai_scoring_enabled')
            .eq('property_id', propertyId)
            .maybeSingle();

        let isBasicMode = false;
        let aiScoringDisabled = false;

        if (propSettings) {
            isBasicMode = propSettings.checklist_mode === 'basic';
            aiScoringDisabled = propSettings.ai_scoring_enabled === false;
        } else {
            const { data: prop } = await supabaseAdmin
                .from('properties')
                .select('checklist_mode')
                .eq('id', propertyId)
                .maybeSingle();
            isBasicMode = !prop || prop.checklist_mode === 'basic';
        }

        if (isBasicMode || aiScoringDisabled) {
            return NextResponse.json({
                success: true,
                skipped: true,
                reason: isBasicMode ? 'AI scoring is disabled for this property in basic mode' : 'AI scoring is disabled',
            });
        }

        // Load the completion item (field photo + checked_at capture timestamp)
        const { data: completionItem, error: itemError } = await supabaseAdmin
            .from('sop_completion_items')
            .select('id, photo_url, checklist_item_id, checked_at, ai_cleanliness_score, ai_cleanliness_reason, ai_parameter_scores, ai_reference_used, ai_analyzed_at')
            .eq('id', completionItemId)
            .eq('completion_id', completionId)
            .maybeSingle();

        if (itemError || !completionItem) {
            return NextResponse.json({ error: 'Completion item not found' }, { status: 404 });
        }

        if (!completionItem.photo_url) {
            return NextResponse.json({ error: 'No photo uploaded for this step yet' }, { status: 400 });
        }

        // Idempotency Guard: Completed/submitted checklist steps are evaluated one time only.
        // Whichever user opens the checklist, reuse the saved score, reason, and parameters.
        if (
            completionItem.ai_cleanliness_score !== null &&
            completionItem.ai_cleanliness_score !== undefined &&
            !body.force
        ) {
            return NextResponse.json({
                success: true,
                already_evaluated: true,
                score: completionItem.ai_cleanliness_score,
                reason: completionItem.ai_cleanliness_reason || 'Cleanliness evaluation completed.',
                pass: completionItem.ai_cleanliness_score >= 70,
                parameters: completionItem.ai_parameter_scores || [],
                parameterScores: completionItem.ai_parameter_scores || [],
                referenceUsed: completionItem.ai_reference_used,
            });
        }

        // Load the checklist item (reference config & sub-parameters)
        const { data: checklistItem, error: checklistError } = await supabaseAdmin
            .from('sop_checklist_items')
            .select('id, title, reference_photo_url, reference_photo_source, cad_area_id, parameters')
            .eq('id', completionItem.checklist_item_id)
            .maybeSingle();

        if (checklistError || !checklistItem) {
            return NextResponse.json({ error: 'Checklist item not found' }, { status: 404 });
        }

        // Determine the reference image (Clean reference photo has highest priority over CAD 2D floor plan crop)
        let referenceBuffer: Buffer | null = null;
        let referenceUsed: 'cad' | 'uploaded' | null = null;

        if (checklistItem.reference_photo_url) {
            try {
                const refResponse = await fetch(checklistItem.reference_photo_url);
                if (refResponse.ok) {
                    referenceBuffer = Buffer.from(await refResponse.arrayBuffer());
                    referenceUsed = 'uploaded';
                }
            } catch (refErr) {
                console.error('[AI Score] Reference photo fetch failed:', refErr);
            }
        }

        if (!referenceBuffer && checklistItem.cad_area_id) {
            // Fallback to CAD area crop if no clean photo uploaded
            const { data: template } = await supabaseAdmin
                .from('sop_templates')
                .select('cad_converted_image_url, cad_areas')
                .eq('id', completion.template_id)
                .maybeSingle();

            if (template?.cad_converted_image_url && Array.isArray(template.cad_areas)) {
                const area = (template.cad_areas as any[]).find((a: any) => a.id === checklistItem.cad_area_id);
                if (area?.coordinates) {
                    try {
                        const cadResponse = await fetch(template.cad_converted_image_url);
                        if (cadResponse.ok) {
                            const cadBuffer = Buffer.from(await cadResponse.arrayBuffer());
                            const meta = await sharp(cadBuffer).metadata();
                            const imgW = meta.width || 0;
                            const imgH = meta.height || 0;

                            // Clamp crop region to image bounds
                            const left = Math.max(0, Math.min(Math.round(area.coordinates.x), imgW - 1));
                            const top = Math.max(0, Math.min(Math.round(area.coordinates.y), imgH - 1));
                            const width = Math.max(1, Math.min(Math.round(area.coordinates.width), imgW - left));
                            const height = Math.max(1, Math.min(Math.round(area.coordinates.height), imgH - top));

                            referenceBuffer = await sharp(cadBuffer)
                                .extract({ left, top, width, height })
                                .png()
                                .toBuffer();
                            referenceUsed = 'cad';
                        }
                    } catch (cropErr) {
                        console.error('[AI Score] CAD crop failed:', cropErr);
                    }
                }
            }
        }

        if (!referenceBuffer || !referenceUsed) {
            return NextResponse.json({
                success: true,
                skipped: true,
                reason: 'No clean reference photo or CAD area configured for this step',
            });
        }

        // Fetch the field photo
        let fieldBuffer: Buffer;
        try {
            const fieldResponse = await fetch(completionItem.photo_url);
            if (!fieldResponse.ok) throw new Error(`Photo fetch failed: ${fieldResponse.status}`);
            fieldBuffer = Buffer.from(await fieldResponse.arrayBuffer());
        } catch (photoErr: any) {
            return NextResponse.json(
                { error: `Could not load the uploaded photo: ${photoErr.message}` },
                { status: 500 }
            );
        }

        // Normalize both images for vision models (resized to 640px width for optimal balance of detail & latency)
        const [fieldPng, referencePng] = await Promise.all([
            sharp(fieldBuffer).resize({ width: 640, withoutEnlargement: true }).png().toBuffer(),
            sharp(referenceBuffer).resize({ width: 640, withoutEnlargement: true }).png().toBuffer(),
        ]);

        const fieldBase64 = `data:image/png;base64,${fieldPng.toString('base64')}`;
        const referenceBase64 = `data:image/png;base64,${referencePng.toString('base64')}`;

        // Anti-Cheating Check: Detect if user directly re-uploaded the template's clean benchmark reference photo
        const refHash = crypto.createHash('sha256').update(referenceBuffer).digest('hex');
        const fieldHash = crypto.createHash('sha256').update(fieldBuffer).digest('hex');
        const isDuplicateOfBenchmark = refHash === fieldHash;

        // Compute expected inspection date & shift window for watermark verification (DD/MM/YYYY)
        const completionDateVal = completion.completion_date || (completion.created_at ? completion.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10));
        const [cYear, cMonth, cDay] = completionDateVal.split('-');
        const expectedDateStr = (cDay && cMonth && cYear) ? `${cDay}/${cMonth}/${cYear}` : new Date().toLocaleDateString('en-GB');
        const expectedSlotStr = completion.slot_time ? `(Slot Time: ${completion.slot_time})` : '';

        // Resolve allowed dates including midnight / night-shift crossovers (e.g. SS Plaza night shifts)
        const { allowedDates, isNightShift, description: shiftDescription } = getAllowedInspectionDates({
            completionDate: completionDateVal,
            slotTime: completion.slot_time,
            title: checklistItem.title,
        });

        // Programmatic Stale Image Detection: Check photo capture timestamp age
        let isProgrammaticallyStale = false;
        let programmaticStaleReason = '';
        if (completionItem.checked_at) {
            const photoCapturedAt = new Date(completionItem.checked_at);
            const pad = (n: number) => String(n).padStart(2, '0');
            const photoDateStr = `${pad(photoCapturedAt.getDate())}/${pad(photoCapturedAt.getMonth() + 1)}/${photoCapturedAt.getFullYear()}`;
            const ageHours = (Date.now() - photoCapturedAt.getTime()) / (1000 * 60 * 60);

            // For midnight / night-shift checklists, photo date can be any of the allowed shift dates
            const isDateAllowed = allowedDates.includes(photoDateStr);

            if (!isDateAllowed && ageHours > 4) {
                isProgrammaticallyStale = true;
                programmaticStaleReason = `Photo metadata date (${photoDateStr}) does not match shift inspection dates (${allowedDates.join(' or ')}).`;
            } else if (ageHours > 36) {
                isProgrammaticallyStale = true;
                programmaticStaleReason = `Photo was captured ${Math.round(ageHours)} hours ago. Live on-site capture is required.`;
            }
        }

        // Prepare parameter inspection criteria if parameters exist on the step
        const stepParams: any[] = Array.isArray(checklistItem.parameters) ? checklistItem.parameters : [];
        const hasParameters = stepParams.length > 0;

        let promptText = '';
        if (hasParameters) {
            const paramList = stepParams.map(p => `- ${p.name || p.title}`).join('\n');
            promptText = `You are an expert commercial facilities cleanliness, housekeeping, and compliance auditor.
Checklist Step: "${checklistItem.title}"
Scheduled Inspection: ${expectedDateStr} ${expectedSlotStr} (${shiftDescription})

Image 1 is the clean standard benchmark photo / CAD area (how the space must look when cleaned: completely cleared surfaces, tidy, ready for use).
Image 2 is the field photo taken after staff execution.

Inspect Image 2 against the clean standard in Image 1 for EACH of the following configured parameters:
${paramList}

CRITICAL FACILITY AUDIT & TIMESTAMP VERIFICATION RULES:
1. TIMESTAMP & ANTI-SPOOFING VERIFICATION:
   - Check the bottom-right corner of Image 2 for the stamped verification watermark (format: DD/MM/YYYY HH:mm:ss or LIVE AUDIT: DD/MM/YYYY HH:mm:ss).
   - "timestamp_detected": The exact watermark string read from the bottom-right corner (or "missing" if not visible).
   - "is_stale_image": Set to true if:
     * The watermark date does NOT match any of the allowed shift dates: [${allowedDates.join(', ')}], OR
     * The watermark timestamp is missing, cut off, or illegible, OR
     * The image appears to be an old photo, gallery re-upload, or a photo taken of a computer screen.
   - STALE IMAGE VETO: If "is_stale_image" is true, the audit MUST FAIL IMMEDIATELY (score capped at 15-20, "pass": false). State in "overall_reason" that an outdated or unverified photo was uploaded.
2. CLUTTER / UN-CLEARED SURFACES IS AN IMMEDIATE AUDIT FAILURE:
   In commercial office, conference, and meeting room cleaning, leaving surfaces un-cleared with laptops, notebooks, chargers, cables, bags, papers, bottles, or personal clutter when Image 1 is completely empty and cleared is a direct operational failure.
   DO NOT award passing scores (>=70) to a surface just because "the tabletop underneath has no dirt". If items, cables, or clutter are left behind, that parameter MUST score in the 15-35 range (FAIL).
3. For EACH parameter:
   - "is_assessable": true if visible in the camera view, false if hidden behind walls or out of frame.
   - If visible, score 0 to 100:
     * 90-100: Pristine / Spotless (completely cleared, spotless, perfectly matches Image 1).
     * 70-89: Acceptable (cleared of clutter, minor misalignment or faint dust).
     * 40-69: Needs Attention (minor debris/fingerprints, slight dusting needed).
     * 0-39: Poor / Critical Fail (cluttered with left-behind laptops/cables/items, dirty, or un-serviced).
   - "status": "pass" (>=70), "needs_attention" (40-69), or "fail" (<40).
   - "reason": A concise, clear 1-sentence visual observation explaining what you see.
4. FAIL VETO & HELPFUL EXPLANATION:
   - If ANY visible parameter has status "fail" (score < 40) OR if "is_stale_image" is true, the overall area CANNOT pass! Cap "overall_score" at maximum 20-35, and set "pass": false.
   - You must NOT hide an un-cleared messy table or stale photo by simply averaging it with clean chairs.
   - "overall_reason": Write a friendly, constructive explanation for on-site staff.
     1) Explain plainly what was noticed (e.g., 'The table still has 2 laptops, a notebook, and charging cables left on it.').
     2) Give a clear action step (e.g., 'Please clear all devices and cables from the table surface and tap "Retake".').
     Do NOT output robotic codes or harsh jargon. Explain like a supportive supervisor.

Respond ONLY with raw JSON:
{
  "overall_score": <number 0..100>,
  "overall_reason": "<1-2 sentence summary>",
  "pass": <boolean>,
  "is_stale_image": <boolean>,
  "timestamp_detected": "<string or null>",
  "parameters": [
    {
      "name": "<parameter name>",
      "is_assessable": true,
      "score": <number>,
      "status": "pass" | "needs_attention" | "fail",
      "reason": "<1-sentence visual reason>"
    }
  ]
}`;
        } else {
            promptText = `You are an expert commercial facilities cleanliness, housekeeping, and compliance auditor.
Checklist Step: "${checklistItem.title}"
Scheduled Inspection Date: ${expectedDateStr} ${expectedSlotStr}

Image 1: Clean standard benchmark reference (completely cleared, tidy, spotless).
Image 2: Field completion photo submitted by staff.

Compare Image 2 directly against Image 1.
CRITICAL RULES:
1. TIMESTAMP & ANTI-SPOOFING VERIFICATION:
   - Inspect the bottom-right corner of Image 2 for the stamped verification watermark (format: DD/MM/YYYY HH:mm:ss or LIVE AUDIT: DD/MM/YYYY HH:mm:ss).
   - "timestamp_detected": The exact watermark string read from the bottom-right corner (or "missing" if not visible).
   - "is_stale_image": Set to true if watermark date does NOT match any of the valid shift dates: [${allowedDates.join(', ')}], or if timestamp is missing/tampered.
   - If "is_stale_image" is true, score MUST be capped at 15-20, "pass": false.
2. CLEANLINESS:
   - Leaving tables/desks un-cleared with laptops, cables, papers, or clutter when Image 1 is cleared is an immediate FAILURE (score 20-35, pass: false).
   - 90-100: Pristine / Spotless (cleared, spotless, matches benchmark).
   - 70-89: Good / Acceptable (cleared, minor misalignment).
   - 40-69: Needs Attention (minor fingerprints or dust).
   - 0-39: Poor / Fail (cluttered, dirty, or uncleaned).
3. HELPFUL REASON:
   - "reason": Explain plainly what is seen and give an actionable fix (e.g. 'Tabletop still has electronics on it. Please clear the table and tap Retake.').

Return ONLY valid raw JSON:
{
  "score": <integer 0..100>,
  "reason": "<1-2 sentence detailed visual assessment explaining clutter, timestamp, and how to fix>",
  "pass": <boolean>,
  "is_stale_image": <boolean>,
  "timestamp_detected": "<string or null>"
}`;
        }

        // Try engy.ai first (OpenAI-compatible endpoint with Qwen 3.8 27B Vision), then fallback to Groq
        const engyKey = process.env.engy || process.env.COUNCIL_API_KEY;
        const engyBaseUrl = process.env.COUNCIL_BASE_URL || 'https://api.engy.ai/v1';

        let rawText = '';
        let modelUsed = '';

        if (engyKey) {
            try {
                const engyRes = await fetch(`${engyBaseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${engyKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: 'qwen3.8-27b',
                        messages: [
                            {
                                role: 'system',
                                content: 'You are an expert cleanliness auditor. Output raw JSON only with no markdown wrapping.',
                            },
                            {
                                role: 'user',
                                content: [
                                    { type: 'text', text: promptText },
                                    { type: 'image_url', image_url: { url: referenceBase64 } },
                                    { type: 'image_url', image_url: { url: fieldBase64 } },
                                ],
                            },
                        ],
                        max_tokens: 4096,
                        temperature: 0.1,
                        response_format: { type: 'json_object' },
                    }),
                });

                if (engyRes.ok) {
                    const engyData = await engyRes.json();
                    const choiceMsg = engyData.choices?.[0]?.message;
                    rawText = (choiceMsg?.content || '').trim();
                    if (!rawText && choiceMsg?.reasoning_content) {
                        const jsonMatch = choiceMsg.reasoning_content.match(/\{[\s\S]*"overall_score"[\s\S]*\}/)
                            || choiceMsg.reasoning_content.match(/\{[\s\S]*"score"[\s\S]*\}/);
                        if (jsonMatch) rawText = jsonMatch[0];
                    }
                    if (rawText) {
                        modelUsed = 'qwen3.8-27b (engy.ai)';
                    }
                } else {
                    console.warn('[AI Score] engy.ai returned status:', engyRes.status, await engyRes.text().catch(() => ''));
                }
            } catch (engyErr) {
                console.warn('[AI Score] engy.ai request failed, attempting Groq fallback:', engyErr);
            }
        }

        // Groq Fallback
        if (!rawText) {
            const groqApiKey = process.env.GROQ_API_KEY || process.env.GROQ_LAYOUT_API_KEY;
            if (groqApiKey) {
                try {
                    const groq = new Groq({ apiKey: groqApiKey });
                    const visionModel = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';
                    const completion_ = await groq.chat.completions.create({
                        model: visionModel,
                        messages: [
                            {
                                role: 'system',
                                content: 'You are an expert cleanliness auditor. Output raw JSON only.',
                            },
                            {
                                role: 'user',
                                content: [
                                    { type: 'text', text: promptText },
                                    { type: 'image_url', image_url: { url: referenceBase64 } },
                                    { type: 'image_url', image_url: { url: fieldBase64 } },
                                ],
                            },
                        ],
                        max_tokens: 2048,
                        temperature: 0.1,
                        response_format: { type: 'json_object' },
                    });
                    rawText = completion_.choices[0]?.message?.content ?? '';
                    modelUsed = `${visionModel} (groq)`;
                } catch (groqErr: any) {
                    console.warn('[AI Score] Groq fallback failed:', groqErr?.message || groqErr);
                }
            }
        }

        if (!rawText) {
            return NextResponse.json({ error: 'AI vision scoring service unavailable' }, { status: 503 });
        }

        // Robust JSON extraction
        const cleanText = rawText
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<think>[\s\S]*/gi, '')
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();

        let parsed: any = null;
        try {
            parsed = JSON.parse(cleanText);
        } catch {
            const match = cleanText.match(/\{[\s\S]*?\}/);
            if (match) {
                try {
                    parsed = JSON.parse(match[0]);
                } catch {
                    parsed = null;
                }
            }
        }

        let scoreVal: number | null = typeof parsed?.overall_score === 'number'
            ? parsed.overall_score
            : typeof parsed?.score === 'number'
            ? parsed.score
            : null;

        let reasonVal: string = parsed?.overall_reason || parsed?.reason || '';
        let parameterScores: any[] = Array.isArray(parsed?.parameters) ? parsed.parameters : [];

        // Fallback regex for score if needed
        if (scoreVal === null) {
            const scoreMatch = rawText.match(/"?(?:overall_)?score"?\s*:\s*(\d+)/i);
            if (scoreMatch) {
                scoreVal = parseInt(scoreMatch[1], 10);
            }
        }

        if (!reasonVal) {
            const reasonMatch = rawText.match(/"?(?:overall_)?reason"?\s*:\s*"([^"]+)"/i);
            if (reasonMatch) {
                reasonVal = reasonMatch[1];
            }
        }

        if (scoreVal === null || isNaN(scoreVal)) {
            console.error('[AI Score] Unreadable response from model:', rawText);
            return NextResponse.json(
                { error: 'AI returned an unreadable response', raw: rawText.slice(0, 500) },
                { status: 502 }
            );
        }

        let rawScore = Math.max(0, Math.min(100, Math.round(scoreVal)));

        // Timestamp & Anti-Spoofing Evaluation: Extract actual image timestamp from filename, checked_at, or EXIF
        const filenameFromUrl = decodeURIComponent((completionItem.photo_url || '').split('/').pop() || '');
        const actualImageInfo = extractActualImageTimestamp({
            filename: filenameFromUrl,
            lastModified: completionItem.checked_at,
            buffer: fieldBuffer,
        });

        const rawWatermark = parsed?.timestamp_detected;
        const hasVisibleWatermark = Boolean(
            rawWatermark &&
            rawWatermark !== 'missing' &&
            rawWatermark !== 'null' &&
            rawWatermark !== 'none'
        );

        const watermarkMatchesExpected = hasVisibleWatermark && typeof rawWatermark === 'string' && allowedDates.some(d => rawWatermark.includes(d));
        const isLiveVerified = hasVisibleWatermark && watermarkMatchesExpected && !parsed?.is_stale_image && !isProgrammaticallyStale;

        let detectedWatermark: string | null = null;
        let isStale = false;
        let staleReasonMessage = '';

        if (isDuplicateOfBenchmark) {
            isStale = true;
            detectedWatermark = 'Duplicate Benchmark Reference';
            staleReasonMessage = 'Sample benchmark photo re-uploaded. Audits must show your actual on-site work. Please tap "Retake" to snap a live photo of the cleaned space.';
        } else if (isLiveVerified) {
            isStale = false;
            detectedWatermark = rawWatermark;
        } else {
            // Gallery upload or outdated photo
            isStale = true;
            if (actualImageInfo?.timestampStr) {
                detectedWatermark = `${actualImageInfo.timestampStr} (Gallery Upload)`;
                staleReasonMessage = `Old photo / Gallery upload detected (Actual image timestamp: "${actualImageInfo.timestampStr}", uploaded from gallery). Audits require a live camera capture with verified watermark. Please tap "Retake" to capture a fresh live photo.`;
            } else if (isProgrammaticallyStale) {
                detectedWatermark = 'Outdated Capture Metadata';
                staleReasonMessage = `Old photo detected (${programmaticStaleReason}). Audits require live verification — please tap "Retake" to snap a fresh photo now.`;
            } else if (hasVisibleWatermark) {
                detectedWatermark = `${rawWatermark} (Outdated)`;
                staleReasonMessage = `Old photo detected (Watermark timestamp shows "${rawWatermark}", but scheduled shift dates are "${allowedDates.join(' or ')}"). Please tap "Retake" to capture a fresh photo now.`;
            } else {
                detectedWatermark = 'Gallery Upload (No Live Watermark)';
                staleReasonMessage = 'Gallery upload detected with missing verification watermark. Audits require a live camera capture with verified timestamp watermark. Please tap "Retake" to capture a fresh photo now.';
            }
        }

        // Inject Timestamp & Anti-Spoofing parameter into breakdown
        const timestampParamScore = isStale ? 0 : 100;
        const timestampParamStatus = isStale ? 'fail' : 'pass';
        const timestampParamReason = isStale
            ? staleReasonMessage
            : (detectedWatermark
                ? `Verified live capture with watermark timestamp (${detectedWatermark}).`
                : `Verified capture matching inspection date (${expectedDateStr}).`);

        parameterScores.unshift({
            name: 'Timestamp & Anti-Spoofing',
            is_assessable: true,
            score: timestampParamScore,
            status: timestampParamStatus,
            reason: timestampParamReason,
        });

        // Programmatic Fail Veto Guard: If ANY visible parameter has status === 'fail' or score < 40,
        // or if image is stale/tampered, the overall score CANNOT pass (capped at max 20-35, pass = false).
        const hasFailedParameter = parameterScores.some(
            (p: any) => p.is_assessable !== false && (p.status === 'fail' || (typeof p.score === 'number' && p.score < 40))
        );

        if (isStale) {
            rawScore = Math.min(20, rawScore);
            reasonVal = staleReasonMessage;
        } else if (hasFailedParameter && rawScore >= 50) {
            rawScore = Math.min(35, rawScore);
        }

        const score = rawScore;
        const reason = reasonVal || 'Cleanliness evaluation completed.';
        const pass = (hasFailedParameter || isStale) ? false : (typeof parsed?.pass === 'boolean' ? parsed.pass : score >= 70);

        // Persist the score, detailed explanation, and parameter scores
        const { error: updateError } = await supabaseAdmin
            .from('sop_completion_items')
            .update({
                ai_cleanliness_score: score,
                ai_cleanliness_reason: reason,
                ai_parameter_scores: parameterScores,
                ai_reference_used: referenceUsed,
                ai_analyzed_at: new Date().toISOString(),
            })
            .eq('id', completionItemId);

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            score,
            reason,
            pass,
            is_stale_image: isStale,
            timestamp_detected: detectedWatermark,
            parameters: parameterScores,
            parameterScores,
            referenceUsed,
            modelUsed,
        });
    } catch (err) {
        console.error('[AI Score] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
