import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import Groq from 'groq-sdk';
import sharp from 'sharp';
import crypto from 'crypto';
import { extractActualImageTimestamp, getAllowedInspectionDates } from '@/lib/sop/imageTimestampHelper';

/**
 * POST /api/properties/[propertyId]/sop/test-vision
 * AI Vision Testing Sandbox:
 * Allows uploading a clean reference benchmark photo and a test field photo
 * with configurable parameters to evaluate vision classification, scoring,
 * and timestamp detection in real-time.
 * RESTRICTED: Accessible exclusively to Org Super Admins (org_super_admin, master_admin, ops_super_admin).
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Enforce RBAC: Vision Lab is strictly restricted to Org Super Admins
        const [profileRes, orgRes, propRes] = await Promise.all([
            supabaseAdmin.from('users').select('is_master_admin').eq('id', user.id).maybeSingle(),
            supabaseAdmin.from('organization_memberships').select('role').eq('user_id', user.id).eq('is_active', true),
            supabaseAdmin.from('property_memberships').select('role').eq('user_id', user.id).eq('is_active', true),
        ]);

        const SUPER_ADMIN_ROLES = ['org_super_admin', 'master_admin', 'ops_super_admin'];
        const isMasterAdmin = Boolean(profileRes.data?.is_master_admin || user.user_metadata?.is_master_admin);
        const hasOrgSuperAdminRole = (orgRes.data || []).some(m => m.role && SUPER_ADMIN_ROLES.includes(m.role.toLowerCase()));
        const hasPropSuperAdminRole = (propRes.data || []).some(m => m.role && SUPER_ADMIN_ROLES.includes(m.role.toLowerCase()));

        if (!isMasterAdmin && !hasOrgSuperAdminRole && !hasPropSuperAdminRole) {
            return NextResponse.json(
                { error: 'Forbidden: Vision Lab is restricted to Org Super Admins only' },
                { status: 403 }
            );
        }

        const body = await request.json();
        const {
            referenceImage, // base64 string or URL
            fieldImage,     // base64 string or URL
            parameters = [],
            stepTitle = 'Visual Cleanliness Inspection',
            expectedDate,   // optional override e.g. "20/10/2026"
            fieldFileName,
            fieldFileLastModified,
        } = body;

        if (!referenceImage || !fieldImage) {
            return NextResponse.json(
                { error: 'Both referenceImage (clean standard) and fieldImage (test photo) are required' },
                { status: 400 }
            );
        }

        // Helper to load image buffer from base64 data URL or external URL
        const loadBuffer = async (src: string): Promise<Buffer> => {
            if (src.startsWith('data:')) {
                const base64Data = src.replace(/^data:image\/\w+;base64,/, '');
                return Buffer.from(base64Data, 'base64');
            }
            const res = await fetch(src);
            if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
            return Buffer.from(await res.arrayBuffer());
        };

        const [referenceBuffer, fieldBuffer] = await Promise.all([
            loadBuffer(referenceImage),
            loadBuffer(fieldImage),
        ]);

        // Normalize both images with sharp (640px width)
        const [fieldPng, referencePng] = await Promise.all([
            sharp(fieldBuffer).resize({ width: 640, withoutEnlargement: true }).png().toBuffer(),
            sharp(referenceBuffer).resize({ width: 640, withoutEnlargement: true }).png().toBuffer(),
        ]);

        const fieldBase64 = `data:image/png;base64,${fieldPng.toString('base64')}`;
        const referenceBase64 = `data:image/png;base64,${referencePng.toString('base64')}`;

        // SHA-256 benchmark duplicate check
        const refHash = crypto.createHash('sha256').update(referenceBuffer).digest('hex');
        const fieldHash = crypto.createHash('sha256').update(fieldBuffer).digest('hex');
        const isDuplicateOfBenchmark = refHash === fieldHash;

        // Determine expected inspection date (DD/MM/YYYY)
        let expectedDateStr = expectedDate;
        if (!expectedDateStr) {
            const today = new Date();
            const d = String(today.getDate()).padStart(2, '0');
            const m = String(today.getMonth() + 1).padStart(2, '0');
            const y = today.getFullYear();
            expectedDateStr = `${d}/${m}/${y}`;
        }

        // Resolve allowed dates including midnight / night-shift crossovers
        const { allowedDates, description: shiftDescription } = getAllowedInspectionDates({
            completionDate: expectedDateStr,
            title: stepTitle,
        });

        const stepParams: any[] = Array.isArray(parameters) ? parameters : [];
        const hasParameters = stepParams.length > 0;

        let promptText = '';
        if (hasParameters) {
            const paramList = stepParams.map(p => `- ${p.name || p.title || p}`).join('\n');
            promptText = `You are an expert commercial facilities cleanliness, housekeeping, and compliance auditor.
Checklist Step: "${stepTitle}"
Scheduled Inspection: ${expectedDateStr} (${shiftDescription})

Image 1 is the clean standard benchmark photo (how the space must look when cleaned: completely cleared surfaces, tidy, ready for use).
Image 2 is the field test photo to inspect.

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
   - STALE IMAGE VETO: If "is_stale_image" is true, the audit MUST FAIL IMMEDIATELY (score capped at 15-20, "pass": false).
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
   - "overall_reason": Write a friendly, constructive explanation for on-site staff.
     1) Explain plainly what was noticed (e.g., 'The table still has 2 laptops, a notebook, and charging cables left on it.').
     2) Give a clear action step (e.g., 'Please clear all devices and cables from the table surface and tap "Retake".').
     Do NOT output robotic codes or harsh jargon.

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
Checklist Step: "${stepTitle}"
Scheduled Inspection Date: ${expectedDateStr}

Image 1: Clean standard benchmark reference (completely cleared, tidy, spotless).
Image 2: Field test photo.

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
                            { role: 'system', content: 'You are an expert cleanliness auditor. Output raw JSON only with no markdown wrapping.' },
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
                    const errText = await engyRes.text().catch(() => '');
                    console.warn(`[Test Vision] engy.ai returned ${engyRes.status}:`, errText);
                }
            } catch (engyErr) {
                console.warn('[Test Vision] engy.ai request failed:', engyErr);
            }
        }

        if (!rawText) {
            const groqApiKey = process.env.GROQ_API_KEY || process.env.GROQ_LAYOUT_API_KEY;
            if (groqApiKey) {
                try {
                    const groq = new Groq({ apiKey: groqApiKey });
                    const visionModel = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';
                    const comp = await groq.chat.completions.create({
                        model: visionModel,
                        messages: [
                            { role: 'system', content: 'You are an expert cleanliness auditor. Output raw JSON only.' },
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
                    rawText = comp.choices[0]?.message?.content ?? '';
                    modelUsed = `${visionModel} (groq)`;
                } catch (groqErr: any) {
                    console.warn('[Test Vision] Groq fallback failed:', groqErr?.message || groqErr);
                }
            }
        }

        if (!rawText) {
            return NextResponse.json(
                { error: 'AI vision model timed out or unavailable. Please retry the test.' },
                { status: 503 }
            );
        }

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
                try { parsed = JSON.parse(match[0]); } catch { parsed = null; }
            }
        }

        let scoreVal: number | null = typeof parsed?.overall_score === 'number'
            ? parsed.overall_score
            : typeof parsed?.score === 'number'
            ? parsed.score
            : null;

        let reasonVal: string = parsed?.overall_reason || parsed?.reason || '';
        let parameterScores: any[] = Array.isArray(parsed?.parameters) ? parsed.parameters : [];

        if (scoreVal === null) {
            const scoreMatch = rawText.match(/"?(?:overall_)?score"?\s*:\s*(\d+)/i);
            if (scoreMatch) scoreVal = parseInt(scoreMatch[1], 10);
        }

        let rawScore = Math.max(0, Math.min(100, Math.round(scoreVal ?? 0)));

        // Extract actual image timestamp from metadata, filename, or EXIF
        const actualImageInfo = extractActualImageTimestamp({
            filename: fieldFileName,
            lastModified: fieldFileLastModified,
            buffer: fieldBuffer,
        });

        // Check if image has a verified live watermark
        const rawWatermark = parsed?.timestamp_detected;
        const hasVisibleWatermark = Boolean(
            rawWatermark &&
            rawWatermark !== 'missing' &&
            rawWatermark !== 'null' &&
            rawWatermark !== 'none'
        );

        // Watermark matches today or allowed shift boundary dates if it contains any allowed date
        const watermarkMatchesExpected = hasVisibleWatermark && typeof rawWatermark === 'string' && allowedDates.some(d => rawWatermark.includes(d));

        // Determine if it is a gallery upload vs verified live capture
        const isLiveVerified = hasVisibleWatermark && watermarkMatchesExpected && !parsed?.is_stale_image;

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
            } else if (hasVisibleWatermark) {
                detectedWatermark = `${rawWatermark} (Outdated)`;
                staleReasonMessage = `Old photo detected (Watermark timestamp shows "${rawWatermark}", but scheduled shift dates are "${allowedDates.join(' or ')}"). Please tap "Retake" to capture a fresh photo now.`;
            } else {
                detectedWatermark = 'Gallery Upload (No Live Watermark)';
                staleReasonMessage = 'Gallery upload detected with missing verification watermark. Audits require a live camera capture with verified timestamp watermark. Please tap "Retake" to capture a fresh photo now.';
            }
        }

        parameterScores.unshift({
            name: 'Timestamp & Anti-Spoofing',
            is_assessable: true,
            score: isStale ? 0 : 100,
            status: isStale ? 'fail' : 'pass',
            reason: isStale
                ? staleReasonMessage
                : (detectedWatermark
                    ? `Verified live capture with watermark timestamp (${detectedWatermark}).`
                    : `Verified capture matching inspection date (${expectedDateStr}).`),
        });

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

        return NextResponse.json({
            success: true,
            score,
            reason,
            pass,
            is_stale_image: isStale,
            timestamp_detected: detectedWatermark,
            parameters: parameterScores,
            modelUsed,
            expectedDateStr,
        });
    } catch (err: any) {
        console.error('[Test Vision] Error:', err);
        return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 });
    }
}
