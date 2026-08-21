import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import Groq from 'groq-sdk';
import sharp from 'sharp';

/**
 * POST /api/properties/[propertyId]/sop/completions/[completionId]/score-photo
 * AI cleanliness scoring: compares the uploaded step photo against the step's
 * reference (CAD area crop or manually uploaded clean reference photo).
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

        // Verify completion belongs to this property
        const { data: completion, error: completionError } = await supabaseAdmin
            .from('sop_completions')
            .select('id, template_id')
            .eq('id', completionId)
            .eq('property_id', propertyId)
            .maybeSingle();

        if (completionError || !completion) {
            return NextResponse.json({ error: 'Completion not found for this property' }, { status: 404 });
        }

        // Load the completion item (field photo)
        const { data: completionItem, error: itemError } = await supabaseAdmin
            .from('sop_completion_items')
            .select('id, photo_url, checklist_item_id')
            .eq('id', completionItemId)
            .eq('completion_id', completionId)
            .maybeSingle();

        if (itemError || !completionItem) {
            return NextResponse.json({ error: 'Completion item not found' }, { status: 404 });
        }

        if (!completionItem.photo_url) {
            return NextResponse.json({ error: 'No photo uploaded for this step yet' }, { status: 400 });
        }

        // Load the checklist item (reference config)
        const { data: checklistItem, error: checklistError } = await supabaseAdmin
            .from('sop_checklist_items')
            .select('id, title, reference_photo_url, reference_photo_source, cad_area_id')
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
            return NextResponse.json(
                { error: 'No reference image available for this step. Link a CAD area or upload a clean reference photo.' },
                { status: 400 }
            );
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

        // Normalize both images for the vision model (resized to 512px width for token efficiency)
        const [fieldPng, referencePng] = await Promise.all([
            sharp(fieldBuffer).resize({ width: 512, withoutEnlargement: true }).png().toBuffer(),
            sharp(referenceBuffer).resize({ width: 512, withoutEnlargement: true }).png().toBuffer(),
        ]);

        const fieldBase64 = `data:image/png;base64,${fieldPng.toString('base64')}`;
        const referenceBase64 = `data:image/png;base64,${referencePng.toString('base64')}`;

        const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_LAYOUT_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: 'AI scoring service not configured' }, { status: 503 });
        }
        const groq = new Groq({ apiKey });

        const isRealCleanPhoto = referenceUsed === 'uploaded';

        const promptText = isRealCleanPhoto
            ? `You are an expert facilities cleanliness auditor.
You are given two real photographs of the area/task "${checklistItem.title}":
- Image 1 is the CLEAN STANDARD REFERENCE: Benchmark photo.
- Image 2 is the UPLOADED COMPLETION PHOTO: Photo submitted by staff.

Task:
Compare Image 2 directly against Image 1.
Scoring:
- 90-100: Pristine / Spotless.
- 75-89: Good / Acceptable.
- 50-74: Needs Attention.
- 0-49: Poor / Fail.

Return ONLY a valid raw JSON object with NO markdown:
{
  "score": <integer 0..100>,
  "reason": "<1-2 sentence assessment>",
  "pass": <boolean>
}`
            : `You are an expert facilities cleanliness auditor.
- Image 1 is the 2D CAD floor plan area reference for "${checklistItem.title}".
- Image 2 is the UPLOADED COMPLETION PHOTO.

Evaluate the cleanliness observed in Image 2.
Return ONLY a valid raw JSON object:
{
  "score": <integer 0..100>,
  "reason": "<1-2 sentence assessment>",
  "pass": <boolean>
}`;

        // Groq active vision model: qwen/qwen3.6-27b
        const visionModel = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';

        const completion_ = await groq.chat.completions.create({
            model: visionModel,
            messages: [
                {
                    role: 'system',
                    content: 'You are an expert cleanliness auditor. You must respond with raw JSON only. Do not write explanations outside JSON.',
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: promptText,
                        },
                        {
                            type: 'image_url',
                            image_url: { url: referenceBase64 },
                        },
                        {
                            type: 'image_url',
                            image_url: { url: fieldBase64 },
                        },
                    ],
                },
            ],
            max_tokens: 2048,
            temperature: 0.1,
            response_format: { type: 'json_object' },
        });

        const rawText = completion_.choices[0]?.message?.content ?? '';

        // Robust extraction handling markdown fences, <think> blocks, and JSON objects
        const cleanText = rawText
            .replace(/<think>[\s\S]*?<\/think>/gi, '') // Complete think tags
            .replace(/<think>[\s\S]*/gi, '')           // Unfinished think tag (if truncated)
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();

        let result: { score?: number; reason?: string; pass?: boolean } | null = null;
        try {
            result = JSON.parse(cleanText);
        } catch {
            const match = cleanText.match(/\{[\s\S]*?\}/);
            if (match) {
                try {
                    result = JSON.parse(match[0]);
                } catch {
                    result = null;
                }
            }
        }

        // Fallback regex if strict JSON parse failed
        let scoreVal: number | null = typeof result?.score === 'number' ? result.score : null;
        let reasonVal: string = typeof result?.reason === 'string' ? result.reason : '';

        if (scoreVal === null) {
            const scoreMatch = rawText.match(/"?score"?\s*:\s*(\d+)/i);
            if (scoreMatch) {
                scoreVal = parseInt(scoreMatch[1], 10);
            }
        }
        if (!reasonVal) {
            const reasonMatch = rawText.match(/"?reason"?\s*:\s*"([^"]+)"/i);
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

        const score = Math.max(0, Math.min(100, Math.round(scoreVal)));
        const reason = reasonVal || 'Cleanliness evaluation completed.';
        const pass = score >= 70;

        // Persist the score
        const { error: updateError } = await supabaseAdmin
            .from('sop_completion_items')
            .update({
                ai_cleanliness_score: score,
                ai_cleanliness_reason: reason,
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
            referenceUsed,
        });
    } catch (err) {
        console.error('[AI Score] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
