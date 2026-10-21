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

CORE AUDIT RULES:
1. OVERALL CLEANLINESS COMPARISON (SCENE vs. BENCHMARK):
   - "overall_score" (0 to 100) MUST evaluate the overall visual cleanliness, neatness, tidiness, and absence of clutter/trash by directly comparing Image 2 against the clean standard in Image 1.
   - ZOOM & FOV TOLERANCE: Image 1 (benchmark) may be captured in ultra-wide (0.5x) zoom, while Image 2 (field photo) may be in standard 1x zoom or closer crop. NEVER penalize or fail Image 2 for zoom differences, narrower framing, or focal length differences. If the visible space shown in Image 2 is clean, cleared, and tidy, award a high visual score (80-95).
   - If Image 2 is clean, cleared, and tidy matching Image 1, award a high visual score (80-95).
   - If the main space is visibly dirty, littered, or cluttered with left-behind items (e.g. laptops, bags, wires on table), score accordingly (25-50).
   - STALE IMAGE VETO: If "is_stale_image" is true (missing watermark, wrong date, or gallery re-upload), the audit MUST FAIL (overall_score capped at 15-20, pass: false).

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
   - Check the bottom-right corner of Image 2 for the stamped verification watermark (format: DD/MM/YYYY HH:mm:ss or LIVE AUDIT: DD/MM/YYYY HH:mm:ss).
   - "timestamp_detected": The exact watermark string read from the bottom-right corner (or "missing" if not visible).
   - "is_stale_image": Set to true if:
     * The watermark date does NOT match any of the allowed shift dates: [${allowedDates.join(', ')}], OR
     * The watermark timestamp is missing, cut off, or illegible, OR
     * The image appears to be an old photo, gallery re-upload, or a photo taken of a computer screen.

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
            staleReasonMessage = 'Duplicate benchmark reference photo uploaded · Live capture required';
        } else if (isLiveVerified) {
            isStale = false;
            detectedWatermark = rawWatermark;
        } else {
            // Gallery upload or outdated photo
            isStale = true;
            if (actualImageInfo?.timestampStr) {
                detectedWatermark = `${actualImageInfo.timestampStr} (Gallery Upload)`;
                staleReasonMessage = `Gallery upload (Taken: ${actualImageInfo.timestampStr}) · Live camera capture required`;
            } else if (hasVisibleWatermark) {
                detectedWatermark = `${rawWatermark} (Outdated)`;
                staleReasonMessage = `Outdated watermark (${rawWatermark}) · Scheduled: ${allowedDates.join(', ')}`;
            } else {
                detectedWatermark = 'Gallery Upload (No Live Watermark)';
                staleReasonMessage = 'Gallery upload without live watermark · Live camera capture required';
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

        if (isStale) {
            rawScore = Math.min(20, rawScore);
            reasonVal = staleReasonMessage;
        }

        const score = rawScore;
        const reason = reasonVal || 'Cleanliness evaluation completed.';
        // Pass is determined by overall visual cleanliness comparison (score >= 70) and valid live capture
        const pass = !isStale && (typeof parsed?.pass === 'boolean' ? parsed.pass : score >= 70);

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
