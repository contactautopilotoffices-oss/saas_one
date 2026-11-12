import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import Groq from 'groq-sdk';
import sharp from 'sharp';
import crypto from 'crypto';
import { extractActualImageTimestamp, getAllowedInspectionDates } from '@/lib/sop/imageTimestampHelper';
import { loadImageBuffer, loadFeedbackRules, formatFeedbackRules, normalizeParamKey } from '@/lib/sop/checklistAiReview';

/**
 * POST /api/properties/[propertyId]/sop/completions/[completionId]/score-photo
 * AI cleanliness scoring: evaluates the uploaded step photo against the step's
 * reference angles and verifies every configured parameter individually (strict: a parameter that
 * cannot be seen in any staff photo is flagged and the step goes to checker review).
 * Checker corrections (sop_ai_feedback) are added to the prompt as standing rules.
 * Agent Spec Block: docs/features/sop_checklist_module.md ("Agent Spec: Checklist vision scorer")
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
            .select('id, property_id, template_id, completion_date, slot_time, created_at')
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
            .select('*')
            .eq('property_id', propertyId)
            .maybeSingle();

        // Configured pass threshold (was hard-coded to 70)
        const configuredThreshold = Number((propSettings as any)?.ai_scoring_threshold);
        const passThreshold = Number.isFinite(configuredThreshold) && configuredThreshold > 0 && configuredThreshold <= 100
            ? Math.round(configuredThreshold)
            : 70;

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

        // Load the completion item (field photos + checked_at capture timestamp)
        const { data: completionItem, error: itemError } = await supabaseAdmin
            .from('sop_completion_items')
            .select('*')
            .eq('id', completionItemId)
            .eq('completion_id', completionId)
            .maybeSingle();

        if (itemError || !completionItem) {
            return NextResponse.json({ error: 'Completion item not found' }, { status: 404 });
        }

        // Gather field photos: support photos JSONB array with fallback to photo_url
        const rawFieldPhotos: Array<{ id: string; url: string; captured_at?: string }> =
            Array.isArray(completionItem.photos) && completionItem.photos.length > 0
                ? completionItem.photos.map((p: any, idx: number) => ({
                    id: p.id || `photo_${idx + 1}`,
                    url: typeof p === 'string' ? p : p.url,
                    captured_at: p.captured_at || completionItem.checked_at,
                }))
                : (completionItem.photo_url ? [{ id: 'photo_1', url: completionItem.photo_url, captured_at: completionItem.checked_at }] : []);

        if (rawFieldPhotos.length === 0) {
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
                pass: typeof completionItem.ai_pass === 'boolean'
                    ? completionItem.ai_pass
                    : completionItem.ai_cleanliness_score >= passThreshold,
                needs_review: Boolean(completionItem.ai_needs_review),
                parameters: completionItem.ai_parameter_scores || [],
                parameterScores: completionItem.ai_parameter_scores || [],
                matches: completionItem.ai_photo_matches || [],
                referenceUsed: completionItem.ai_reference_used,
            });
        }

        // Load the checklist item (reference benchmarks & sub-parameters)
        const { data: checklistItem, error: checklistError } = await supabaseAdmin
            .from('sop_checklist_items')
            .select('id, title, reference_photo_url, reference_photos, reference_photo_source, cad_area_id, parameters')
            .eq('id', completionItem.checklist_item_id)
            .maybeSingle();

        if (checklistError || !checklistItem) {
            return NextResponse.json({ error: 'Checklist item not found' }, { status: 404 });
        }

        const { data: propertyRow } = await supabaseAdmin
            .from('properties')
            .select('organization_id')
            .eq('id', completion.property_id || propertyId)
            .maybeSingle();
        const organizationId: string | null = propertyRow?.organization_id ?? null;

        // Gather clean benchmark standards: support reference_photos JSONB array with fallback to reference_photo_url
        let rawBenchmarks: Array<{ id: string; label: string; url: string; source: 'uploaded' | 'cad' }> = [];
        if (Array.isArray(checklistItem.reference_photos) && checklistItem.reference_photos.length > 0) {
            rawBenchmarks = checklistItem.reference_photos.map((r: any, idx: number) => ({
                id: r.id || `ref_${idx + 1}`,
                label: r.label || `Clean Standard ${idx + 1}`,
                url: r.url,
                source: 'uploaded' as const,
            }));
        } else if (checklistItem.reference_photo_url) {
            rawBenchmarks = [{
                id: 'ref_1',
                label: 'Clean Standard Benchmark',
                url: checklistItem.reference_photo_url,
                source: 'uploaded' as const,
            }];
        }

        let cadFallbackBuffer: Buffer | null = null;
        if (rawBenchmarks.length === 0 && checklistItem.cad_area_id) {
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
                        const cadBuffer = await loadImageBuffer(template.cad_converted_image_url);
                        if (cadBuffer) {
                            const meta = await sharp(cadBuffer).metadata();
                            const imgW = meta.width || 0;
                            const imgH = meta.height || 0;

                            const left = Math.max(0, Math.min(Math.round(area.coordinates.x), imgW - 1));
                            const top = Math.max(0, Math.min(Math.round(area.coordinates.y), imgH - 1));
                            const width = Math.max(1, Math.min(Math.round(area.coordinates.width), imgW - left));
                            const height = Math.max(1, Math.min(Math.round(area.coordinates.height), imgH - top));

                            cadFallbackBuffer = await sharp(cadBuffer)
                                .extract({ left, top, width, height })
                                .png()
                                .toBuffer();
                        }
                    } catch (cropErr) {
                        console.error('[AI Score] CAD crop failed:', cropErr);
                    }
                }
            }
        }

        if (rawBenchmarks.length === 0 && !cadFallbackBuffer) {
            return NextResponse.json({
                success: true,
                skipped: true,
                reason: 'No clean reference photo or CAD area configured for this step',
            });
        }

        // Fetch and optimize benchmarks (up to 5 benchmarks max)
        const benchmarkItems: Array<{ id: string; label: string; url: string | null; base64: string; buffer: Buffer; hash: string }> = [];
        let referenceUsed: 'cad' | 'uploaded' = 'uploaded';

        if (cadFallbackBuffer) {
            referenceUsed = 'cad';
            const cadPng = await sharp(cadFallbackBuffer).resize({ width: 640, withoutEnlargement: true }).png().toBuffer();
            const hash = crypto.createHash('sha256').update(cadFallbackBuffer).digest('hex');
            benchmarkItems.push({
                id: 'cad_ref',
                label: 'CAD Floor Plan Blueprint',
                url: null,
                buffer: cadFallbackBuffer,
                base64: `data:image/png;base64,${cadPng.toString('base64')}`,
                hash,
            });
        } else {
            for (const b of rawBenchmarks.slice(0, 5)) {
                try {
                    const buf = await loadImageBuffer(b.url);
                    if (buf) {
                        const png = await sharp(buf).resize({ width: 640, withoutEnlargement: true }).png().toBuffer();
                        const hash = crypto.createHash('sha256').update(buf).digest('hex');
                        benchmarkItems.push({
                            id: b.id,
                            label: b.label,
                            url: b.url,
                            buffer: buf,
                            base64: `data:image/png;base64,${png.toString('base64')}`,
                            hash,
                        });
                    }
                } catch (bErr) {
                    console.error(`[AI Score] Benchmark fetch failed for ${b.label}:`, bErr);
                }
            }
        }

        if (benchmarkItems.length === 0) {
            return NextResponse.json({
                success: true,
                skipped: true,
                reason: 'Unable to load benchmark images for comparison',
            });
        }

        // Fetch and optimize field photos (up to 5 photos max)
        const fieldPhotoItems: Array<{ id: string; url: string; captured_at?: string; base64: string; buffer: Buffer; hash: string }> = [];
        for (const p of rawFieldPhotos.slice(0, 5)) {
            try {
                const buf = await loadImageBuffer(p.url);
                if (buf) {
                    const png = await sharp(buf).resize({ width: 640, withoutEnlargement: true }).png().toBuffer();
                    const hash = crypto.createHash('sha256').update(buf).digest('hex');
                    fieldPhotoItems.push({
                        id: p.id,
                        url: p.url,
                        captured_at: p.captured_at,
                        buffer: buf,
                        base64: `data:image/png;base64,${png.toString('base64')}`,
                        hash,
                    });
                }
            } catch (pErr) {
                console.error(`[AI Score] Field photo fetch failed for ${p.url}:`, pErr);
            }
        }

        if (fieldPhotoItems.length === 0) {
            return NextResponse.json(
                { error: 'Could not load any of the uploaded photos' },
                { status: 500 }
            );
        }

        // Anti-Cheating Check: Detect if user directly re-uploaded any benchmark reference photo
        const isDuplicateOfBenchmark = fieldPhotoItems.some(fp => benchmarkItems.some(bm => bm.hash === fp.hash));

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
        const stepParamNames: string[] = stepParams
            .map((p: any) => String(p?.name || p?.title || '').trim())
            .filter(Boolean);
        const hasParameters = stepParamNames.length > 0;

        // Checker corrections from this step and from same-named parameters across the organization
        const feedbackRules = await loadFeedbackRules({
            organizationId,
            checklistItemId: checklistItem.id,
            parameterNames: stepParamNames,
        });
        const feedbackBlock = formatFeedbackRules(feedbackRules);

        // One strict prompt for every case. All reference angles and all field photos are always sent,
        // so a single photo is never silently dropped.
        const isCadReference = referenceUsed === 'cad';
        const bmDescriptions = benchmarkItems
            .map((b, idx) => `Angle #${idx + 1} (id "${b.id}", "${b.label}") -> Image ${idx + 1}`)
            .join('\n');
        const fpDescriptions = fieldPhotoItems
            .map((_p, idx) => `Field Photo #${idx + 1} -> Image ${benchmarkItems.length + idx + 1}`)
            .join('\n');
        const paramDescriptions = stepParamNames.map((n, idx) => `P${idx + 1}. ${n}`).join('\n');

        const promptText = `You are a strict commercial facilities cleanliness, housekeeping, and compliance auditor. You give a hard, evidence-based analysis. You never assume something is clean because you cannot see it.
Checklist Step: "${checklistItem.title}"
Scheduled Inspection: ${expectedDateStr} ${expectedSlotStr} (${shiftDescription})
Pass threshold: ${passThreshold}/100

REFERENCE ANGLES (how each area must look when cleaned):
${bmDescriptions}
${isCadReference ? 'NOTE: The reference is a CAD floor-plan crop, not a photo. Use it only to know which area this step covers.\n' : ''}
STAFF FIELD PHOTOS SUBMITTED:
${fpDescriptions}

${hasParameters ? `PARAMETERS TO VERIFY (every single one must be checked and reported):\n${paramDescriptions}\n` : 'PARAMETERS TO VERIFY: none configured. Judge overall cleanliness only and return "parameters": [].\n'}
${feedbackBlock}
AUDIT STEPS (do every step, in order, do not skip any):

1. ANGLE MAP${hasParameters ? '' : ' (skip the parameter part, still list angles)'}:
   - Look at each reference angle image and decide yourself which parameters can be seen from that angle.
   - A parameter can belong to more than one angle. If a parameter is not clearly visible in any reference angle, assign it to the angle where it would most likely be seen and say so in its reason.

2. MATCH FIELD PHOTOS TO ANGLES:
   - For each reference angle, find the field photo that shows the SAME area/object from a similar viewpoint.
   - Zoom and framing differences are fine (references are often 0.5x ultra-wide, staff photos 1x or closer). Never fail a photo only for zoom.
   - A photo of a DIFFERENT area, a different object, or a viewpoint that hides most of the reference area does NOT match.
   - "status": "matched" if a field photo clearly shows the area. "angle_mismatch" if the best photo only partly shows it (turned away, mostly cropped, blurry, too dark). "missing" if no field photo shows that area.
   - "matched_photo_index": the Field Photo number (1-based) you used, or null.

3. VERIFY EVERY PARAMETER IN THE FIELD PHOTOS:
   - For each parameter, look for it in the field photo matched to its expected angle (also check the other field photos).
   - Found and clean / conforming: "pass", score 85-100.
   - Found with a minor issue: "needs_attention", score 55-75.
   - Found and dirty, damaged, missing or not done: "fail", score 0-40.
   - Not visible in ANY field photo, hidden, too blurry or too dark to judge: "not_visible", score null. Do NOT guess. Do NOT mark "pass" just because the rest of the photo looks clean.
   - "found_in_photo": the Field Photo number where you saw it, or null.
   - "reason": one concrete sentence about what you actually saw (for example "Two water stains on the left side of the mirror"), never a generic phrase.

4. OVERALL RESULT:
   - "overall_score" (0-100) must agree with the parameter and angle results. Any "fail" parameter caps it at 50. Any "missing" angle caps it at 60.
   - "pass": true ONLY if every angle is "matched", every parameter is "pass" or "needs_attention" (none "fail" or "not_visible"), overall_score >= ${passThreshold}, and no stale image.
   - STALE IMAGE: set "is_stale_image": true ONLY if a visible watermark shows a date not in [${allowedDates.join(', ')}], or the image is a photo of a screen/monitor (moire, bezel). Gallery photos taken on those dates are valid.
   - "timestamp_detected": the exact watermark text you can read, or "none".

5. EXPLANATION FOR STAFF:
   - "overall_reason": short, plain, friendly. Say what is wrong and what to do. If parameters are not visible, name them and say which angle to photograph (for example "Could not see: Dustbin lid. Please add a photo from the Washbasin angle."). If an angle is missing, say "Missing photo for: [angle label]. Please tap '+ Add Photo' to capture it."

Respond ONLY with raw JSON in exactly this shape:
{
  "angle_map": [
    { "angle_id": "<id>", "angle_label": "<label>", "parameters": ["<parameter name>"] }
  ],
  "matches": [
    { "benchmark_id": "<id>", "benchmark_label": "<label>", "matched_photo_index": <number or null>, "status": "matched" | "angle_mismatch" | "missing", "reason": "<observation>", "cleanliness_score": <number 0..100> }
  ],
  "parameters": [
    { "name": "<exact parameter name>", "expected_angle": "<angle label>", "found_in_photo": <number or null>, "reason": "<what you saw>", "status": "pass" | "needs_attention" | "fail" | "not_visible", "score": <number or null> }
  ],
  "overall_reason": "<summary for staff>",
  "overall_score": <number 0..100>,
  "pass": <boolean>,
  "is_stale_image": <boolean>,
  "timestamp_detected": "<string>"
}`;

        const imageContents: any[] = [
            { type: 'text', text: promptText },
            ...benchmarkItems.map(bm => ({ type: 'image_url', image_url: { url: bm.base64 } })),
            ...fieldPhotoItems.map(fp => ({ type: 'image_url', image_url: { url: fp.base64 } })),
        ];

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
                                content: imageContents,
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
                                content: imageContents,
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
            // Nested schema: take everything from the first "{" to the last "}"
            const match = cleanText.match(/\{[\s\S]*\}/);
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
        const primaryFieldPhoto = fieldPhotoItems[0];
        const fieldBuffer = primaryFieldPhoto?.buffer || Buffer.from([]);
        const filenameFromUrl = decodeURIComponent((primaryFieldPhoto?.url || completionItem.photo_url || '').split('/').pop() || '');
        const actualImageInfo = extractActualImageTimestamp({
            filename: filenameFromUrl,
            lastModified: primaryFieldPhoto?.captured_at || completionItem.checked_at,
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

        // Evaluate whether photo was captured on the scheduled inspection date (via camera watermark, filename date, or lastModified)
        const photoDateToTest = actualImageInfo?.date || (completionItem.checked_at ? new Date(completionItem.checked_at) : null);
        let isSameDayCapture = false;
        if (photoDateToTest && !isNaN(photoDateToTest.getTime())) {
            const pad = (n: number) => String(n).padStart(2, '0');
            const photoDateStr = `${pad(photoDateToTest.getDate())}/${pad(photoDateToTest.getMonth() + 1)}/${photoDateToTest.getFullYear()}`;
            isSameDayCapture = allowedDates.includes(photoDateStr);
        } else {
            // Default to allowed if no conflicting date is found and it was not flagged programmatically stale
            isSameDayCapture = !isProgrammaticallyStale;
        }

        const isLiveVerified = hasVisibleWatermark && watermarkMatchesExpected && !parsed?.is_stale_image && !isProgrammaticallyStale;

        let detectedWatermark: string | null = null;
        let isStale = false;
        let staleReasonMessage = '';

        if (isDuplicateOfBenchmark) {
            isStale = true;
            detectedWatermark = 'Duplicate Benchmark Reference';
            staleReasonMessage = 'Duplicate benchmark reference photo uploaded · Live capture required';
        } else if (isLiveVerified) {
            isStale = false;
            detectedWatermark = rawWatermark;
        } else if (isSameDayCapture && !isProgrammaticallyStale && !parsed?.is_stale_image) {
            // Gallery upload or unwatermarked capture taken on the scheduled inspection date
            isStale = false;
            detectedWatermark = actualImageInfo?.timestampStr
                ? `${actualImageInfo.timestampStr} (Verified Capture)`
                : `${expectedDateStr} (Verified Capture)`;
        } else {
            // Truly outdated photo from past date or explicitly stale
            isStale = true;
            if (isProgrammaticallyStale) {
                detectedWatermark = 'Outdated Capture Metadata';
                staleReasonMessage = `Old photo (${programmaticStaleReason}) · Fresh capture required`;
            } else if (hasVisibleWatermark) {
                detectedWatermark = `${rawWatermark} (Outdated)`;
                staleReasonMessage = `Outdated watermark (${rawWatermark}) · Scheduled: ${allowedDates.join(', ')}`;
            } else if (actualImageInfo?.timestampStr) {
                detectedWatermark = `${actualImageInfo.timestampStr} (Outdated Date)`;
                staleReasonMessage = `Outdated photo taken on ${actualImageInfo.timestampStr} · Scheduled: ${allowedDates.join(', ')}`;
            } else {
                detectedWatermark = 'Outdated Photo';
                staleReasonMessage = `Photo date does not match scheduled inspection date (${allowedDates.join(', ')}).`;
            }
        }

        // Process Benchmark-to-Field Photo Matches & Detect Missing / Wrong-Angle Areas
        const fieldPhotoUrlAt = (n: any): string | null => {
            const idx = typeof n === 'number' ? n : parseInt(String(n ?? ''), 10);
            return Number.isFinite(idx) && idx >= 1 && idx <= fieldPhotoItems.length ? fieldPhotoItems[idx - 1].url : null;
        };
        const normalizeMatchStatus = (st: any): 'matched' | 'angle_mismatch' | 'missing' =>
            st === 'missing' ? 'missing' : st === 'angle_mismatch' ? 'angle_mismatch' : 'matched';

        let photoMatches: any[] = [];
        if (Array.isArray(parsed?.matches) && parsed.matches.length > 0) {
            photoMatches = parsed.matches.map((m: any, idx: number) => {
                const matchedBm = benchmarkItems.find(b => b.id === m.benchmark_id || b.label.toLowerCase() === (m.benchmark_label || '').toLowerCase()) || benchmarkItems[idx];
                const status = normalizeMatchStatus(m.status);
                const matchedUrl = status === 'missing'
                    ? null
                    : (fieldPhotoUrlAt(m.matched_photo_index) || (typeof m.matched_photo_url === 'string' && m.matched_photo_url.startsWith('/') ? m.matched_photo_url : null) || fieldPhotoItems[idx]?.url || null);
                return {
                    benchmark_id: matchedBm?.id || m.benchmark_id || `ref_${idx + 1}`,
                    benchmark_label: matchedBm?.label || m.benchmark_label || `Standard ${idx + 1}`,
                    benchmark_url: matchedBm?.url || null,
                    matched_photo_url: matchedUrl,
                    status,
                    cleanliness_score: status === 'missing' ? 0 : (typeof m.cleanliness_score === 'number' ? m.cleanliness_score : rawScore),
                    reason: m.reason || (status === 'missing' ? `Missing photo for ${matchedBm?.label || 'standard'}` : status === 'angle_mismatch' ? `Photo does not clearly show ${matchedBm?.label || 'this area'}` : 'Cleanliness verified'),
                };
            });
        } else {
            const primaryBm = benchmarkItems[0];
            photoMatches = [{
                benchmark_id: primaryBm?.id || 'ref_1',
                benchmark_label: primaryBm?.label || 'Clean Standard',
                benchmark_url: primaryBm?.url || null,
                matched_photo_url: primaryFieldPhoto?.url || null,
                status: 'matched',
                cleanliness_score: rawScore,
                reason: reasonVal || 'Cleanliness verified against benchmark.',
            }];
        }

        // Ensure every configured benchmark is tracked in photoMatches
        benchmarkItems.forEach((bm) => {
            const exists = photoMatches.some(m => m.benchmark_id === bm.id || m.benchmark_label.toLowerCase() === bm.label.toLowerCase());
            if (!exists) {
                photoMatches.push({
                    benchmark_id: bm.id,
                    benchmark_label: bm.label,
                    benchmark_url: bm.url,
                    matched_photo_url: null,
                    status: 'missing',
                    cleanliness_score: 0,
                    reason: `Missing required photo for ${bm.label}.`,
                });
            }
        });

        const missingBenchmarks = photoMatches.filter(m => m.status === 'missing');
        const hasMissingBenchmark = missingBenchmarks.length > 0;
        const mismatchedAngles = photoMatches.filter(m => m.status === 'angle_mismatch');

        if (hasMissingBenchmark) {
            const missingLabels = missingBenchmarks.map(m => m.benchmark_label).join(', ');
            rawScore = Math.min(rawScore, 60);
            if (!reasonVal.toLowerCase().includes('missing')) {
                reasonVal = `${reasonVal} (Missing required photos: ${missingLabels}).`.trim();
            }
        }

        // Strict parameter mapping: every configured parameter must come back with a verdict.
        // Anything the AI could not see, or did not report, is flagged "not_visible" for checker review.
        const aiParamsByKey = new Map<string, any>();
        parameterScores.forEach((p: any) => {
            const key = normalizeParamKey(p?.name || p?.title || '');
            if (key && !aiParamsByKey.has(key)) aiParamsByKey.set(key, p);
        });
        const normalizeParamStatus = (st: any): 'pass' | 'needs_attention' | 'fail' | 'not_visible' => {
            const v = String(st || '').toLowerCase();
            if (v === 'pass' || v === 'needs_attention' || v === 'fail') return v;
            return 'not_visible'; // not_in_frame, unassessable, unknown
        };

        parameterScores = stepParamNames.map((name) => {
            const ai = aiParamsByKey.get(normalizeParamKey(name));
            if (!ai) {
                return {
                    name,
                    is_assessable: false,
                    status: 'not_visible',
                    score: null,
                    expected_angle: null,
                    found_in_photo_url: null,
                    flagged: true,
                    reason: 'AI did not report on this parameter. Please check it manually.',
                };
            }
            const status = normalizeParamStatus(ai.status);
            const score = status === 'not_visible' ? null : (typeof ai.score === 'number' ? Math.max(0, Math.min(100, Math.round(ai.score))) : null);
            return {
                name,
                is_assessable: status !== 'not_visible',
                status,
                score,
                expected_angle: ai.expected_angle || null,
                found_in_photo_url: status === 'not_visible' ? null : fieldPhotoUrlAt(ai.found_in_photo),
                flagged: status === 'not_visible',
                reason: ai.reason || (status === 'not_visible' ? 'Not visible in any uploaded photo.' : ''),
            };
        });

        const unverifiedParams = parameterScores.filter((p: any) => p.status === 'not_visible');
        const failedParams = parameterScores.filter((p: any) => p.status === 'fail');
        const needsReview = unverifiedParams.length > 0 || mismatchedAngles.length > 0 || hasMissingBenchmark;

        if (failedParams.length > 0) {
            rawScore = Math.min(rawScore, 50);
        }
        if (unverifiedParams.length > 0) {
            const names = unverifiedParams.map((p: any) => p.name).join(', ');
            if (!reasonVal.toLowerCase().includes('could not see')) {
                reasonVal = `${reasonVal} Could not see: ${names}. Needs checker review.`.trim();
            }
        }
        if (mismatchedAngles.length > 0 && !reasonVal.toLowerCase().includes('angle')) {
            reasonVal = `${reasonVal} Photo angle does not match: ${mismatchedAngles.map(m => m.benchmark_label).join(', ')}.`.trim();
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
            system: true,
        });

        if (isStale) {
            rawScore = Math.min(20, rawScore);
            reasonVal = staleReasonMessage;
        } else if (reasonVal && /missing watermark|gallery re-upload|watermark/i.test(reasonVal)) {
            // Clean up any stray prompt references if the model erroneously mentioned watermarks on a valid same-day photo
            reasonVal = reasonVal.replace(/missing watermark[.,]?/gi, '').replace(/gallery re-upload[.,]?/gi, '').trim();
            if (!reasonVal) reasonVal = 'Cleanliness evaluation completed successfully.';
        }

        const score = rawScore;
        const reason = reasonVal || 'Cleanliness evaluation completed.';
        // Pass is decided by the rules, not only by the model: not stale, every angle photographed and matched,
        // every parameter seen and none failed, and score at or above the property's threshold.
        const pass = !isStale
            && !needsReview
            && failedParams.length === 0
            && score >= passThreshold
            && (typeof parsed?.pass === 'boolean' ? parsed.pass : true);

        // Persist the score, detailed explanation, parameter scores, and photo matches
        const updatePayload: any = {
            ai_cleanliness_score: score,
            ai_cleanliness_reason: reason,
            ai_parameter_scores: parameterScores,
            ai_reference_used: referenceUsed,
            ai_photo_matches: photoMatches,
            ai_analyzed_at: new Date().toISOString(),
            ai_pass: pass,
            ai_needs_review: needsReview,
        };

        let { error: updateError } = await supabaseAdmin
            .from('sop_completion_items')
            .update(updatePayload)
            .eq('id', completionItemId);

        if (updateError) {
            // Fallback in case the newer columns are not yet migrated in db
            console.warn('[AI Score] Retrying update without ai_pass / ai_needs_review:', updateError.message);
            delete updatePayload.ai_pass;
            delete updatePayload.ai_needs_review;
            ({ error: updateError } = await supabaseAdmin.from('sop_completion_items').update(updatePayload).eq('id', completionItemId));
        }
        if (updateError) {
            console.warn('[AI Score] Retrying update without ai_photo_matches:', updateError.message);
            delete updatePayload.ai_photo_matches;
            await supabaseAdmin.from('sop_completion_items').update(updatePayload).eq('id', completionItemId);
        }

        return NextResponse.json({
            success: true,
            score,
            reason,
            pass,
            needs_review: needsReview,
            is_stale_image: isStale,
            timestamp_detected: detectedWatermark,
            parameters: parameterScores,
            parameterScores,
            matches: photoMatches,
            angleMap: Array.isArray(parsed?.angle_map) ? parsed.angle_map : [],
            missingCount: missingBenchmarks.length,
            unverifiedCount: unverifiedParams.length,
            feedbackRulesUsed: feedbackRules.length,
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
