import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { evidenceType } from '@/backend/lib/pettyCash/evidence';
import { visionExtract } from '@/backend/lib/ocr/vision';
import { rasterizePdf, type RasterPage } from '@/backend/lib/ocr/rasterize';
import { detectDuplicateExpense } from '@/backend/lib/pettyCash/fraudDetection';
import sharp from 'sharp';

export interface PettyCashOcrData {
    amount: number | null;
    date: string | null;
    vendor: string | null;
    payment_mode: 'UPI' | 'Cash' | 'Bank Transfer' | 'Company Card' | 'Other' | null;
    payment_ref: string | null;
    status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'UNKNOWN';
    category_hint: string | null;
    confidence: number;
    summary: string;
    is_duplicate_ref?: boolean;
    duplicate_warning?: string;
    file_hash?: string;
}

const OCR_INSTRUCTION = `You are an expert financial auditor OCR AI parsing payment proofs, UPI receipts (Google Pay, PhonePe, Paytm, BHIM, CRED), bank transfer slips, and cash vouchers/bills in India.

Analyze this receipt/screenshot and extract the transaction details into a valid JSON object with the following fields:
{
  "amount": number | null,
  "date": "YYYY-MM-DD" | null,
  "vendor": string | null,
  "payment_mode": "UPI" | "Cash" | "Bank Transfer" | "Company Card" | "Other" | null,
  "payment_ref": string | null,
  "status": "SUCCESS" | "FAILED" | "PENDING" | "UNKNOWN",
  "category_hint": string | null,
  "confidence": number,
  "summary": string
}

CRITICAL RULES:
1. The amount is the most important field. Look for bold rupee values on UPI success screens (e.g. ₹150, ₹100.00). Do not confuse it with account balance.
2. For UPI apps (Google Pay, PhonePe, Paytm, BHIM, CRED), payment_mode MUST be "UPI".
3. Extract UPI reference ID, UTR (typically 12 digits), or transaction ID into payment_ref. Be extremely careful and precise with digit order.
4. Status must be "SUCCESS" only if explicitly marked Paid, Successful, or has a green tick. If Failed or Declined, mark "FAILED".
5. Format dates strictly as YYYY-MM-DD. If year is missing, assume current year 2026.
6. confidence is a score from 0 to 100 based on clarity and legibility.
7. Return ONLY the JSON object.`;

export async function POST(request: NextRequest) {
    try {
        const access = await resolvePettyCashAccess(request, readOrgId(request));
        if (isPettyCashAccessError(access)) return access;

        const url = new URL(request.url);
        const form = await request.formData().catch(() => null);
        const file = form?.get('file');
        const requestId = (form?.get('request_id') as string) || url.searchParams.get('request_id') || url.searchParams.get('req_id') || null;

        if (!(file instanceof File) || !file.size) {
            return NextResponse.json({ error: 'Please select a valid image or PDF receipt' }, { status: 400 });
        }

        if (file.size > 15 * 1024 * 1024) {
            return NextResponse.json({ error: 'File size exceeds 15MB limit' }, { status: 400 });
        }

        const rawBytes = Buffer.from(await file.arrayBuffer());
        const fileHash = crypto.createHash('sha256').update(rawBytes).digest('hex');
        const type = evidenceType(rawBytes) || file.type;

        let pages: Array<Pick<RasterPage, 'buffer' | 'mime'>> = [];

        if (type === 'application/pdf') {
            const raster = await rasterizePdf(rawBytes, { maxPages: 1, maxEdge: 1600 });
            if (!raster.pages.length) {
                return NextResponse.json({ error: 'Unable to render PDF page for OCR analysis' }, { status: 422 });
            }
            pages = raster.pages.map(p => ({ buffer: p.buffer, mime: 'image/jpeg' as const }));
        } else if (['image/png', 'image/jpeg', 'image/webp'].includes(type)) {
            // Optimize image for vision extraction: cap dimensions to 1600px and compress to high quality JPEG
            try {
                const optimized = await sharp(rawBytes)
                    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 85 })
                    .toBuffer();
                pages = [{ buffer: optimized, mime: 'image/jpeg' as const }];
            } catch {
                pages = [{ buffer: rawBytes, mime: 'image/jpeg' as const }];
            }
        } else {
            return NextResponse.json({ error: 'Unsupported file type. Please upload a PNG, JPEG, WebP or PDF receipt.' }, { status: 400 });
        }

        const startTime = Date.now();
        const visionResult = await visionExtract({
            pages,
            instruction: OCR_INSTRUCTION,
            json: true,
            maxTokens: 1000,
        });
        const durationMs = Date.now() - startTime;

        if (!visionResult.ok) {
            return NextResponse.json({
                ok: false,
                error: visionResult.error || 'Vision extraction failed',
            }, { status: 502 });
        }

        const extracted = (visionResult.data || {}) as Partial<PettyCashOcrData>;

        // Parse amount cleanly if returned as string
        let parsedAmount: number | null = null;
        if (typeof extracted.amount === 'number' && Number.isFinite(extracted.amount)) {
            parsedAmount = Math.round(extracted.amount * 100) / 100;
        } else if (typeof extracted.amount === 'string') {
            const cleaned = Number(String(extracted.amount).replace(/[^0-9.]/g, ''));
            if (Number.isFinite(cleaned) && cleaned > 0) {
                parsedAmount = Math.round(cleaned * 100) / 100;
            }
        }

        const ocrData: PettyCashOcrData = {
            amount: parsedAmount,
            date: typeof extracted.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date) ? extracted.date : null,
            vendor: typeof extracted.vendor === 'string' ? extracted.vendor.slice(0, 150).trim() : null,
            payment_mode: extracted.payment_mode && ['UPI', 'Cash', 'Bank Transfer', 'Company Card', 'Other'].includes(extracted.payment_mode)
                ? extracted.payment_mode
                : null,
            payment_ref: typeof extracted.payment_ref === 'string' ? extracted.payment_ref.slice(0, 100).trim() : null,
            status: extracted.status && ['SUCCESS', 'FAILED', 'PENDING', 'UNKNOWN'].includes(extracted.status)
                ? extracted.status
                : 'UNKNOWN',
            category_hint: typeof extracted.category_hint === 'string' ? extracted.category_hint.slice(0, 50).trim() : null,
            confidence: typeof extracted.confidence === 'number' ? Math.min(100, Math.max(0, Math.round(extracted.confidence))) : 80,
            summary: typeof extracted.summary === 'string' ? extracted.summary.slice(0, 300).trim() : 'Receipt processed via Vision AI',
            file_hash: fileHash,
        };

        // Multi-layer fraud and duplicate prevention check
        const dupResult = await detectDuplicateExpense({
            organizationId: access.organizationId,
            paymentRef: ocrData.payment_ref,
            paymentMode: ocrData.payment_mode,
            amount: ocrData.amount,
            vendor: ocrData.vendor,
            expenseDate: ocrData.date,
            requestId,
            fileHash,
        });

        if (dupResult.isDuplicate) {
            ocrData.is_duplicate_ref = true;
            ocrData.duplicate_warning = dupResult.reason;
        }

        // Track Vision model usage per request in petty_cash_activity
        const usageData = visionResult.usage || { prompt: 0, completion: 0, total: 0 };
        const usageMetadata = {
            model: visionResult.model,
            provider: visionResult.provider,
            prompt_tokens: usageData.prompt,
            completion_tokens: usageData.completion,
            total_tokens: usageData.total,
            duration_ms: durationMs,
            file_name: file.name,
            file_size: file.size,
            file_hash: fileHash,
            extracted_amount: ocrData.amount,
            extracted_vendor: ocrData.vendor,
            extracted_ref: ocrData.payment_ref,
            confidence: ocrData.confidence,
            is_duplicate_ref: ocrData.is_duplicate_ref || false,
            duplicate_warning: ocrData.duplicate_warning || null,
        };

        if (requestId) {
            try {
                await supabaseAdmin.from('petty_cash_activity').insert({
                    request_id: requestId,
                    organization_id: access.organizationId,
                    actor_id: access.user.id,
                    action: 'vision_ocr_scan',
                    remark: `Vision AI (${visionResult.model}) scanned receipt '${file.name}' — ${usageData.total} tokens`,
                    metadata: usageMetadata,
                });
            } catch (e) {
                console.warn('Activity logging warning:', e);
            }
        }

        // Also record to feature_usage_logs for organization-level usage tracking
        try {
            await supabaseAdmin.from('feature_usage_logs').insert({
                organization_id: access.organizationId,
                user_id: access.user.id,
                feature_name: 'petty_cash_vision_ocr',
                action: 'scan',
                metadata: {
                    request_id: requestId,
                    ...usageMetadata,
                },
            });
        } catch (e) {
            console.warn('Feature usage log warning:', e);
        }

        return NextResponse.json({
            ok: true,
            data: ocrData,
            model: visionResult.model,
            provider: visionResult.provider,
            usage: usageData,
        });
    } catch (e) {
        return NextResponse.json({
            ok: false,
            error: e instanceof Error ? e.message : 'Internal OCR processing error',
        }, { status: 500 });
    }
}
