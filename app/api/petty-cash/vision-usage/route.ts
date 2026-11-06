import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';

export async function GET(request: NextRequest) {
    const access = await resolvePettyCashAccess(request, readOrgId(request));
    if (isPettyCashAccessError(access)) return access;

    // Only internal roles (especially Org Super Admin, Ops Super Admin, Accounts) can audit AI usage
    if (!access.isAdmin && !access.canDisburse && !access.canManageRouting) {
        return NextResponse.json({ error: 'Forbidden: Vision AI usage audit requires admin access' }, { status: 403 });
    }

    try {
        const { data: activities, error } = await supabaseAdmin
            .from('petty_cash_activity')
            .select('id, request_id, actor_id, created_at, remark, metadata, actor:users(full_name, email), request:petty_cash_requests(request_no, amount_requested, status, requester:users!petty_cash_requests_requester_id_fkey(full_name))')
            .eq('organization_id', access.organizationId)
            .eq('action', 'vision_ocr_scan')
            .order('created_at', { ascending: false });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const scans = activities || [];

        let totalTokens = 0;
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        const modelCounts: Record<string, { count: number; tokens: number }> = {};
        const requestMap = new Map<string, {
            requestId: string;
            requestNo: string;
            requesterName: string;
            status: string;
            amountRequested: number;
            scanCount: number;
            totalTokens: number;
            promptTokens: number;
            completionTokens: number;
            latestScanAt: string;
            models: string[];
            scans: Array<{
                id: string;
                createdAt: string;
                actorName: string;
                fileName?: string;
                tokens: number;
                model: string;
                confidence?: number;
                extractedAmount?: number | null;
            }>;
        }>();

        for (const scan of scans) {
            const meta = (scan.metadata || {}) as Record<string, any>;
            const tokens = Number(meta.total_tokens || meta.tokens || 0);
            const prompt = Number(meta.prompt_tokens || 0);
            const completion = Number(meta.completion_tokens || 0);
            const model = String(meta.model || 'qwen3.8-27b');

            totalTokens += tokens;
            totalPromptTokens += prompt;
            totalCompletionTokens += completion;

            if (!modelCounts[model]) modelCounts[model] = { count: 0, tokens: 0 };
            modelCounts[model].count += 1;
            modelCounts[model].tokens += tokens;

            const reqId = scan.request_id || 'unlinked';
            const reqData = scan.request as any;
            const requestNo = reqData?.request_no || 'Manual Scan';
            const requesterName = reqData?.requester?.full_name || (scan.actor as any)?.full_name || 'Staff';
            const status = reqData?.status || 'unknown';
            const amountRequested = Number(reqData?.amount_requested || 0);

            if (!requestMap.has(reqId)) {
                requestMap.set(reqId, {
                    requestId: reqId,
                    requestNo,
                    requesterName,
                    status,
                    amountRequested,
                    scanCount: 0,
                    totalTokens: 0,
                    promptTokens: 0,
                    completionTokens: 0,
                    latestScanAt: scan.created_at,
                    models: [],
                    scans: [],
                });
            }

            const reqEntry = requestMap.get(reqId)!;
            reqEntry.scanCount += 1;
            reqEntry.totalTokens += tokens;
            reqEntry.promptTokens += prompt;
            reqEntry.completionTokens += completion;
            if (!reqEntry.models.includes(model)) reqEntry.models.push(model);

            reqEntry.scans.push({
                id: scan.id,
                createdAt: scan.created_at,
                actorName: (scan.actor as any)?.full_name || 'System',
                fileName: meta.file_name,
                tokens,
                model,
                confidence: meta.confidence,
                extractedAmount: meta.extracted_amount,
            });
        }

        // Token pricing estimation: ₹0.04 per 1,000 tokens (typical Qwen / multimodal tier)
        const estimatedCostInr = Math.round((totalTokens / 1000) * 0.04 * 100) / 100;

        return NextResponse.json({
            ok: true,
            summary: {
                total_scans: scans.length,
                total_tokens: totalTokens,
                prompt_tokens: totalPromptTokens,
                completion_tokens: totalCompletionTokens,
                estimated_cost_inr: estimatedCostInr,
                model_breakdown: modelCounts,
            },
            per_request: Array.from(requestMap.values()),
            recent_scans: scans.slice(0, 50).map(s => {
                const meta = (s.metadata || {}) as Record<string, any>;
                return {
                    id: s.id,
                    requestId: s.request_id,
                    requestNo: (s.request as any)?.request_no || 'Unlinked',
                    actorName: (s.actor as any)?.full_name || 'System',
                    createdAt: s.created_at,
                    model: meta.model || 'qwen3.8-27b',
                    tokens: meta.total_tokens || 0,
                    fileName: meta.file_name,
                    confidence: meta.confidence,
                    extractedAmount: meta.extracted_amount,
                };
            }),
        });
    } catch (e) {
        return NextResponse.json({
            ok: false,
            error: e instanceof Error ? e.message : 'Failed to fetch vision usage metrics',
        }, { status: 500 });
    }
}
