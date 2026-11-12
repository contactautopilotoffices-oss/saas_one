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

        // Load the completion item (field photos + checked_at capture timestamp)
        const { data: completionItem, error: itemError } = await supabaseAdmin
            .from('sop_completion_items')
            .select('id, photo_url, photos, ai_photo_matches, checklist_item_id, checked_at, ai_cleanliness_score, ai_cleanliness_reason, ai_parameter_scores, ai_reference_used, ai_analyzed_at')
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
                pass: completionItem.ai_cleanliness_score >= 70,
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
                        const cadResponse = await fetch(template.cad_converted_image_url);
                        if (cadResponse.ok) {
                            const cadBuffer = Buffer.from(await cadResponse.arrayBuffer());
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
                    const res = await fetch(b.url);
                    if (res.ok) {
                        const buf = Buffer.from(await res.arrayBuffer());
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
                const res = await fetch(p.url);
                if (res.ok) {
                    const buf = Buffer.from(await res.arrayBuffer());
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
        const hasParameters = stepParams.length > 0;

        const isMulti = benchmarkItems.length > 1 || fieldPhotoItems.length > 1;
        let promptText = '';
        let imageContents: any[] = [];

        if (isMulti) {
            const bmDescriptions = benchmarkItems.map((b, idx) => `Benchmark #${idx + 1} ("${b.label}") -> Image ${idx + 1}`).join('\n');
            const fpDescriptions = fieldPhotoItems.map((p, idx) => `Field Photo #${idx + 1} -> Image ${benchmarkItems.length + idx + 1}`).join('\n');

            promptText = `You are an expert commercial facilities cleanliness, housekeeping, and compliance auditor.
Checklist Step: "${checklistItem.title}"
Scheduled Inspection: ${expectedDateStr} ${expectedSlotStr} (${shiftDescription})

CLEAN BENCHMARK STANDARDS (How each sub-area must look when cleaned):
${bmDescriptions}

STAFF FIELD PHOTOS SUBMITTED:
${fpDescriptions}

${hasParameters ? `CHECKPOINTS TO OBSERVE IF IN-FRAME:\n${stepParams.map(p => `- ${p.name || p.title}`).join('\n')}\n` : ''}
CORE AUDIT RULES:
1. CLASSIFY & MATCH PHOTOS TO BENCHMARKS:
   - For each Clean Benchmark Standard, inspect the Field Photos to see which Field Photo corresponds to that specific area (e.g. Washbasin matches Washbasin photo, Commode/Toilet matches Commode photo, Floor matches Floor photo).
   - ZOOM & FOV TOLERANCE: Clean benchmark standards are often captured in ultra-wide (0.5x) zoom to capture entire rooms, while staff field photos may be taken in standard 1x zoom or closer framing. NEVER penalize or fail a photo for zoom level, tighter framing, or focal length differences. If the visible area is clean, tidy, and matches the benchmark standard, score it high (85-95).
   - If a Clean Benchmark Standard has NO matching Field Photo taken by staff:
     * "status": "missing"
     * "matched_photo_url": null
     * "cleanliness_score": 0
     * "reason": "Missing required photo of the cleaned [Benchmark Name]."
   - If a Field Photo matches a Benchmark Standard:
     * "status": "matched"
     * "cleanliness_score": (0 to 100) based on direct visual comparison against that benchmark standard.
     * "reason": Concise 1-sentence note of visual cleanliness.

2. OVERALL CLEANLINESS & COMPLETION:
   - "overall_score" (0 to 100):
     * If all benchmarks have matching clean photos, award high score (80-95).
     * If any required benchmark photo is MISSING, overall score must be capped (max 60) and pass MUST be false.
     * STALE IMAGE VETO: Set pass: false ONLY if a photo is from a past date or is a photo taken of a screen. Photos taken on the scheduled inspection date [${allowedDates.join(', ')}] (via live camera or gallery) are valid and must be evaluated on cleanliness.
   - "pass": true ONLY if ALL benchmarks have a matched photo AND every matched area is clean (cleanliness_score >= 70) AND no stale images.

3. PARAMETERS AS ADVISORY (DO NOT PENALIZE UNSEEN ITEMS):
   - Some parameters (QR codes, light bulbs, switches, etc.) cannot be seen from every angle.
   - If not clearly assessable from the camera angles: "is_assessable": false, "status": "not_in_frame", "score": null.
   - "not_in_frame" parameters MUST NEVER reduce overall_score!

4. TIMESTAMP & WATERMARK:
   - Check field photos for any visible timestamp watermark. Photos taken on [${allowedDates.join(', ')}] are valid.

5. CONSTRUCTIVE EXPLANATION:
   - "overall_reason": Clear, friendly summary for on-site staff. If any photo is missing, explicitly state: "Missing photo for: [Benchmark Name]. Please tap '+ Add Photo' to capture it."

Respond ONLY with raw JSON:
{
  "overall_score": <number 0..100>,
  "overall_reason": "<friendly summary>",
  "pass": <boolean>,
  "is_stale_image": <boolean>,
  "timestamp_detected": "<string or null>",
  "parameters": [
    {
      "name": "<param name>",
      "is_assessable": <boolean>,
      "score": <number or null>,
      "status": "pass" | "needs_attention" | "fail" | "not_in_frame",
      "reason": "<observation>"
    }
  ],
  "matches": [
    {
      "benchmark_id": "<id>",
      "benchmark_label": "<label>",
      "matched_photo_url": "<url or null>",
      "status": "matched" | "missing",
      "cleanliness_score": <number 0..100>,
      "reason": "<observation>"
    }
  ]
}`;

            imageContents = [
                { type: 'text', text: promptText },
                ...benchmarkItems.map(bm => ({ type: 'image_url', image_url: { url: bm.base64 } })),
                ...fieldPhotoItems.map(fp => ({ type: 'image_url', image_url: { url: fp.base64 } })),
            ];
        } else {
            const primaryBenchmark = benchmarkItems[0];
            const primaryField = fieldPhotoItems[0];

            if (hasParameters) {
                const paramList = stepParams.map(p => `- ${p.name || p.title}`).join('\n');
                promptText = `You are an expert commercial facilities cleanliness, housekeeping, and compliance auditor.
Checklist Step: "${checklistItem.title}"
Scheduled Inspection: ${expectedDateStr} ${expectedSlotStr} (${shiftDescription})

Image 1 is the clean standard benchmark photo / CAD area (how the space must look when cleaned: completely cleared surfaces, tidy, ready for use).
Image 2 is the field photo taken after staff execution.

CORE AUDIT RULES:
1. OVERALL CLEANLINESS COMPARISON (SCENE vs. BENCHMARK):
   - "overall_score" (0 to 100) MUST evaluate the overall visual cleanliness, neatness, tidiness, and absence of clutter/trash by directly comparing Image 2 against the clean standard in Image 1.
   - ZOOM & FOV TOLERANCE: Image 1 (benchmark) may be captured in ultra-wide (0.5x) zoom, while Image 2 (field photo) may be in standard 1x zoom or closer crop. NEVER penalize or fail Image 2 for zoom differences, narrower framing, or focal length differences. If the visible space shown in Image 2 is clean, cleared, and tidy, award a high visual score (80-95).
   - If Image 2 is clean, cleared, and tidy matching Image 1, award a high visual score (80-95).
   - If the main space is visibly dirty, littered, or cluttered with left-behind items (e.g. laptops, bags, wires on table), score accordingly (25-50).
   - STALE IMAGE VETO: Set pass: false ONLY if a photo is from a past date or is a photo taken of a screen. Photos taken on scheduled inspection dates [${allowedDates.join(', ')}] (via live camera or gallery) are valid and must be evaluated on cleanliness.

2. PARAMETERS AS ADVISORY INSPECTION CHECKPOINTS (DO NOT PENALIZE UNSEEN ITEMS):
   - You are also given these specific checklist checkpoints to observe:
${paramList}
   - REAL-WORLD CAMERA REALITY: Some parameters (such as ceiling lights, QR code stickers, small badges, switches, or items outside this camera angle) CANNOT be verified in a single room photo.
   - If a parameter is NOT clearly visible or cannot be judged with certainty from this angle:
     * "is_assessable": false
     * "status": "not_in_frame"
     * "score": null
     * "reason": "Not clearly visible in this camera angle; manual check required."
     * CRITICAL: "not_in_frame" parameters MUST NEVER reduce or drag down the "overall_score"!
   - If a parameter IS clearly visible:
     * If clean/conforming: "status": "pass", "score": 85-100.
     * If slight attention needed: "status": "needs_attention", "score": 60-75.
     * If actively dirty/cluttered: "status": "fail", "score": 25-40.
     * "reason": Concise 1-sentence observation.

3. TIMESTAMP & ANTI-SPOOFING VERIFICATION:
   - Check Image 2 for any visible timestamp watermark.
   - Photos taken with in-app camera or uploaded from gallery on the scheduled inspection date [${allowedDates.join(', ')}] are completely VALID.
   - "timestamp_detected": The exact watermark string read from the image (or "none" if not visible).
   - "is_stale_image": Set to true ONLY if:
     * A visible watermark clearly displays an old/different date that does NOT match any shift dates: [${allowedDates.join(', ')}], OR
     * The image is visibly a photo taken of a computer screen / monitor (screen moiré, bezel).
   - Do NOT mark gallery photos taken on today's inspection date as stale.

4. HELPFUL REASONING:
   - "overall_reason": Write a friendly, constructive explanation for on-site staff.
     1) Explain plainly what was noticed in the visual comparison.
     2) If any issue was found, give a clear action step (e.g., 'Please clear the items from the tabletop and tap "Retake".').
     Do NOT output robotic codes or harsh jargon.

Respond ONLY with raw JSON:
{
  "overall_score": <number 0..100>,
  "overall_reason": "<1-2 sentence summary of overall cleanliness>",
  "pass": <boolean>,
  "is_stale_image": <boolean>,
  "timestamp_detected": "<string or null>",
  "parameters": [
    {
      "name": "<parameter name>",
      "is_assessable": <boolean>,
      "score": <number or null>,
      "status": "pass" | "needs_attention" | "fail" | "not_in_frame",
      "reason": "<1-sentence visual observation>"
    }
  ]
}`;
            } else {
                promptText = `You are an expert commercial facilities cleanliness, housekeeping, and compliance auditor.
Checklist Step: "${checklistItem.title}"
Scheduled Inspection: ${expectedDateStr} ${expectedSlotStr} (${shiftDescription})

Image 1 is the clean standard benchmark photo / CAD area (how the space must look when cleaned: completely cleared surfaces, tidy, ready for use).
Image 2 is the field photo taken after staff execution.

CORE AUDIT RULES:
1. OVERALL CLEANLINESS COMPARISON (SCENE vs. BENCHMARK):
   - "overall_score" (0 to 100) MUST evaluate visual cleanliness, neatness, tidiness, and absence of clutter/trash by directly comparing Image 2 against the clean standard in Image 1.
   - ZOOM & FOV TOLERANCE: Image 1 may be captured in 0.5x ultra-wide zoom, while Image 2 may be in 1x standard zoom or closer crop. NEVER penalize or fail for zoom or framing differences.
   - If Image 2 is clean, cleared, and tidy matching Image 1, award a high score (80-95).
   - If the main space is visibly dirty, littered, or cluttered with left-behind items (e.g. laptops, bags, wires on table), score accordingly (25-50).
   - STALE IMAGE VETO: Set pass: false ONLY if "is_stale_image" is truly an outdated photo from a past date or a photo of a screen. Valid photos taken on scheduled dates [${allowedDates.join(', ')}] must be evaluated on cleanliness.

2. TIMESTAMP & ANTI-SPOOFING VERIFICATION:
   - Check Image 2 for any visible timestamp watermark.
   - Photos taken with in-app camera or uploaded from gallery on the scheduled inspection date [${allowedDates.join(', ')}] are completely VALID.
   - "timestamp_detected": The exact watermark string read from the image (or "none" if not visible).
   - "is_stale_image": Set to true ONLY if:
     * A visible watermark clearly displays an old/different date that does NOT match any shift dates: [${allowedDates.join(', ')}], OR
     * The image is visibly a photo taken of a computer screen / monitor (screen moiré, bezel).
   - Do NOT mark gallery photos taken on today's inspection date as stale.

3. HELPFUL REASONING:
   - "overall_reason": Write a friendly, constructive explanation for on-site staff.
     1) Explain plainly what was noticed in the visual comparison.
     2) If any issue was found, give a clear action step (e.g., 'Please clear the items from the tabletop and tap "Retake".').
     Do NOT output robotic codes or harsh jargon.

Respond ONLY with raw JSON:
{
  "overall_score": <number 0..100>,
  "overall_reason": "<1-2 sentence summary of overall cleanliness>",
  "pass": <boolean>,
  "is_stale_image": <boolean>,
  "timestamp_detected": "<string or null>"
}`;
            }

            imageContents = [
                { type: 'text', text: promptText },
                { type: 'image_url', image_url: { url: primaryBenchmark.base64 } },
                { type: 'image_url', image_url: { url: primaryField.base64 } },
            ];
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

        // Process Benchmark-to-Field Photo Matches & Detect Missing Areas
        let photoMatches: any[] = [];
        if (Array.isArray(parsed?.matches) && parsed.matches.length > 0) {
            photoMatches = parsed.matches.map((m: any, idx: number) => {
                const matchedBm = benchmarkItems.find(b => b.id === m.benchmark_id || b.label.toLowerCase() === (m.benchmark_label || '').toLowerCase()) || benchmarkItems[idx];
                return {
                    benchmark_id: matchedBm?.id || m.benchmark_id || `ref_${idx + 1}`,
                    benchmark_label: matchedBm?.label || m.benchmark_label || `Standard ${idx + 1}`,
                    benchmark_url: matchedBm?.url || null,
                    matched_photo_url: m.matched_photo_url || (m.status === 'matched' ? fieldPhotoItems[idx]?.url : null),
                    status: m.status === 'missing' ? 'missing' : 'matched',
                    cleanliness_score: typeof m.cleanliness_score === 'number' ? m.cleanliness_score : (m.status === 'missing' ? 0 : rawScore),
                    reason: m.reason || (m.status === 'missing' ? `Missing photo for ${matchedBm?.label || 'standard'}` : 'Cleanliness verified'),
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

        if (hasMissingBenchmark) {
            const missingLabels = missingBenchmarks.map(m => m.benchmark_label).join(', ');
            rawScore = Math.min(rawScore, 60);
            if (!reasonVal.toLowerCase().includes('missing')) {
                reasonVal = `${reasonVal} (Missing required photos: ${missingLabels}).`.trim();
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
        // Pass requires: not stale, all benchmarks photographed (no missing areas), and score >= 70
        const pass = !isStale && !hasMissingBenchmark && (typeof parsed?.pass === 'boolean' ? parsed.pass : score >= 70);

        // Persist the score, detailed explanation, parameter scores, and photo matches
        const updatePayload: any = {
            ai_cleanliness_score: score,
            ai_cleanliness_reason: reason,
            ai_parameter_scores: parameterScores,
            ai_reference_used: referenceUsed,
            ai_photo_matches: photoMatches,
            ai_analyzed_at: new Date().toISOString(),
        };

        const { error: updateError } = await supabaseAdmin
            .from('sop_completion_items')
            .update(updatePayload)
            .eq('id', completionItemId);

        if (updateError) {
            // Fallback in case ai_photo_matches column is not yet migrated in db
            console.warn('[AI Score] Retrying update without ai_photo_matches:', updateError.message);
            delete updatePayload.ai_photo_matches;
            await supabaseAdmin.from('sop_completion_items').update(updatePayload).eq('id', completionItemId);
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
            matches: photoMatches,
            missingCount: missingBenchmarks.length,
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
