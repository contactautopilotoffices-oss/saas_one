import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { loadImageBuffer } from '@/lib/sop/checklistAiReview';
import Groq from 'groq-sdk';
import sharp from 'sharp';
import { modelFor } from '@/task-manager/ai/modelFor';
import { withProviderKeys } from '@/backend/lib/llm/providerKeys';

export const maxDuration = 60;

/**
 * On-demand visual defect localization.
 * Takes an image and a specific parameter defect description,
 * asks the vision model to return exact 0-1000 normalized bounding boxes ([ymin, xmin, ymax, xmax]),
 * and returns them for visual overlay on the image.
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

        const body = await request.json().catch(() => ({}));
        const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
        const parameterName = typeof body.parameterName === 'string' ? body.parameterName.trim() : '';
        const defectDescription = typeof body.defectDescription === 'string' ? body.defectDescription.trim() : '';

        if (!imageUrl) {
            return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 });
        }
        if (!parameterName && !defectDescription) {
            return NextResponse.json({ error: 'parameterName or defectDescription is required' }, { status: 400 });
        }

        // Load image buffer (handles /api/storage proxy as well as public URLs)
        const imageBuf = await loadImageBuffer(imageUrl);
        if (!imageBuf) {
            return NextResponse.json({ error: 'Failed to download image' }, { status: 400 });
        }

        // Optimize image to max 640px for rapid spatial detection
        const resizedBuf = await sharp(imageBuf)
            .resize({ width: 640, withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
        const base64Data = `data:image/jpeg;base64,${resizedBuf.toString('base64')}`;

        const engyKey = process.env.engy || process.env.COUNCIL_API_KEY;
        const engyBaseUrl = process.env.COUNCIL_BASE_URL || 'https://api.engy.ai/v1';

        const promptText = `You are an expert facilities auditor and visual object detector.
Analyze this photo and locate any visual defects, compliance violations, dirt, damage, or issues related to:
Parameter: "${parameterName}"
Issue/Reason: "${defectDescription || parameterName}"

Instructions:
1. Locate the exact area(s) showing the defect or the parameter needing attention.
2. Return bounding boxes as normalized coordinates from 0 to 1000: [ymin, xmin, ymax, xmax].
   - ymin = top (0-1000)
   - xmin = left (0-1000)
   - ymax = bottom (0-1000)
   - xmax = right (0-1000)
3. If the defect is found, set "found": true and list each bounding box with a concise label (max 4 words).
4. If the item or defect is not present or cannot be clearly located in this photo, return "found": false and "boxes": [].

Respond ONLY with raw JSON:
{
  "found": true,
  "boxes": [
    {
      "box_2d": [ymin, xmin, ymax, xmax],
      "label": "short label"
    }
  ]
}`;

        let rawText = '';
        let modelUsed = '';

        if (engyKey) {
            const configuredModel = await modelFor('sop_photo', 'glm-5.3-flash').catch(() => 'glm-5.3-flash');
            const modelsToTry = Array.from(new Set([process.env.ENGY_VISION_MODEL, configuredModel, 'glm-5.3-flash', 'kimi-k3.1-pro'].filter(Boolean) as string[]));

            for (const modelName of modelsToTry) {
                if (rawText) break;
                try {
                    const engyRes = await fetch(`${engyBaseUrl}/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${engyKey}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            model: modelName,
                            messages: [
                                {
                                    role: 'system',
                                    content: 'You are an expert visual object detector. Output raw JSON only with normalized bounding boxes.',
                                },
                                {
                                    role: 'user',
                                    content: [
                                        { type: 'text', text: promptText },
                                        { type: 'image_url', image_url: { url: base64Data } },
                                    ],
                                },
                            ],
                            max_tokens: 1500,
                            temperature: 0.1,
                            response_format: { type: 'json_object' },
                        }),
                        signal: AbortSignal.timeout(20000),
                    });

                    if (engyRes.ok) {
                        const data = await engyRes.json();
                        const choiceMsg = data.choices?.[0]?.message;
                        rawText = (choiceMsg?.content || '').trim();
                        if (!rawText && choiceMsg?.reasoning_content) {
                            const jsonMatch = choiceMsg.reasoning_content.match(/\{[\s\S]*"boxes"[\s\S]*\}/)
                                || choiceMsg.reasoning_content.match(/\{[\s\S]*"found"[\s\S]*\}/);
                            if (jsonMatch) rawText = jsonMatch[0];
                        }
                        if (rawText) {
                            modelUsed = `${modelName} (engy.ai)`;
                            break;
                        }
                    }
                } catch (err) {
                    console.warn(`[Locate Defect] Model ${modelName} failed:`, err);
                }
            }
        }

        // Groq fallback if Engy did not produce a result
        if (!rawText) {
            try {
                await withProviderKeys('groq', async (key) => {
                    const completion = await new Groq({ apiKey: key }).chat.completions.create({
                        model: 'llama-3.2-11b-vision-preview',
                        messages: [
                            { role: 'system', content: 'You are an expert visual defect detector. Return raw JSON only.' },
                            {
                                role: 'user',
                                content: [
                                    { type: 'text', text: promptText },
                                    { type: 'image_url', image_url: { url: base64Data } },
                                ],
                            },
                        ],
                        max_tokens: 1000,
                        temperature: 0.1,
                        response_format: { type: 'json_object' },
                    }, { signal: AbortSignal.timeout(10000) });
                    rawText = completion.choices[0]?.message?.content ?? '';
                    modelUsed = 'llama-3.2-11b-vision-preview (groq)';
                });
            } catch (groqErr) {
                console.warn('[Locate Defect] Groq fallback failed:', groqErr);
            }
        }

        if (!rawText) {
            return NextResponse.json({
                found: false,
                boxes: [],
                message: 'No response from vision model',
            });
        }

        // Parse JSON response
        let parsed: any;
        try {
            parsed = JSON.parse(rawText);
        } catch {
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try { parsed = JSON.parse(jsonMatch[0]); } catch {}
            }
        }

        if (!parsed || typeof parsed !== 'object') {
            return NextResponse.json({ found: false, boxes: [], raw: rawText });
        }

        // Validate and clamp bounding boxes
        const validBoxes = (Array.isArray(parsed.boxes) ? parsed.boxes : [])
            .map((b: any) => {
                const box = b.box_2d || b.box || b.bbox;
                if (!Array.isArray(box) || box.length !== 4) return null;
                const [ymin, xmin, ymax, xmax] = box.map(Number);
                if (isNaN(ymin) || isNaN(xmin) || isNaN(ymax) || isNaN(xmax)) return null;

                // Normalize 0-1 float to 0-1000 if model returned decimals
                const scale = (ymin <= 1 && ymax <= 1 && xmin <= 1 && xmax <= 1) ? 1000 : 1;
                const clamped = [
                    Math.max(0, Math.min(1000, Math.round(ymin * scale))),
                    Math.max(0, Math.min(1000, Math.round(xmin * scale))),
                    Math.max(0, Math.min(1000, Math.round(ymax * scale))),
                    Math.max(0, Math.min(1000, Math.round(xmax * scale))),
                ] as [number, number, number, number];

                return {
                    box_2d: clamped,
                    label: String(b.label || parameterName).slice(0, 50),
                };
            })
            .filter(Boolean);

        return NextResponse.json({
            found: validBoxes.length > 0 || Boolean(parsed.found),
            boxes: validBoxes,
            model_used: modelUsed,
        });
    } catch (err: any) {
        console.error('[Locate Defect] Error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}

