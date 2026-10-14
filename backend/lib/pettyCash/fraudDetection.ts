import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export function normalizeRef(ref: string | null | undefined): string {
    if (!ref) return '';
    // Strip non-alphanumeric, uppercase
    return ref.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export function damerauLevenshtein(a: string, b: string): number {
    const al = a.length;
    const bl = b.length;
    if (!al) return bl;
    if (!bl) return al;

    const matrix: number[][] = Array.from({ length: al + 1 }, () => Array(bl + 1).fill(0));

    for (let i = 0; i <= al; i++) matrix[i][0] = i;
    for (let j = 0; j <= bl; j++) matrix[0][j] = j;

    for (let i = 1; i <= al; i++) {
        for (let j = 1; j <= bl; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1, // deletion
                matrix[i][j - 1] + 1, // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );

            // Transposition check
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
            }
        }
    }

    return matrix[al][bl];
}

export interface DuplicateCheckInput {
    organizationId: string;
    paymentRef?: string | null;
    paymentMode?: string | null;
    amount?: number | null;
    vendor?: string | null;
    expenseDate?: string | null;
    requestId?: string | null;
    fileHash?: string | null;
    excludeExpenseId?: string | null;
}

export interface DuplicateCheckResult {
    isDuplicate: boolean;
    reason?: string;
    matchedRef?: string;
    matchedExpenseId?: string;
    matchedRequestNo?: string;
    matchedAmount?: number;
    matchedDate?: string;
}

/**
 * Multi-layer fraud and duplicate prevention:
 * 1. Exact & Near-match UTR / payment reference (catches transposed digits e.g. 428910289418 vs 428910284918)
 * 2. Identical transaction heuristic (same amount, vendor & date in the same request or organization)
 * 3. Exact file hash matching for receipt proofs
 */
export async function detectDuplicateExpense(
    input: DuplicateCheckInput
): Promise<DuplicateCheckResult> {
    const { organizationId, paymentRef, paymentMode, amount, vendor, expenseDate, requestId, fileHash, excludeExpenseId } = input;

    // 1. Check duplicate receipt file hash if supplied
    if (fileHash) {
        // Check ONLY against ACTUALLY SAVED EXPENSES (action = 'expense_recorded').
        // Preliminary OCR scans must NEVER be treated as claimed expenses!
        const { data: actMatches } = await supabaseAdmin
            .from('petty_cash_activity')
            .select('request_id, metadata, request:petty_cash_requests(request_no)')
            .eq('organization_id', organizationId)
            .eq('action', 'expense_recorded')
            .limit(100);

        if (actMatches && actMatches.length > 0) {
            const hashMatch = actMatches.find(a => {
                const meta = (a.metadata || {}) as any;
                const hashes: string[] = Array.isArray(meta.file_hashes) ? meta.file_hashes : [];
                if (meta.file_hash) hashes.push(meta.file_hash);
                return hashes.includes(fileHash);
            });
            if (hashMatch) {
                const reqNo = (hashMatch.request as any)?.request_no || 'another request';
                return {
                    isDuplicate: true,
                    reason: `This exact receipt image was already claimed and saved in request ${reqNo}. Re-uploading duplicate receipts is prevented.`,
                    matchedRequestNo: reqNo,
                };
            }
        }
    }

    // Fetch existing active expenses for this organization (excluding rejected)
    const { data: existingExpenses, error } = await supabaseAdmin
        .from('petty_cash_expenses')
        .select('id, request_id, expense_date, amount, vendor, payment_mode, payment_ref, request:petty_cash_requests(request_no)')
        .eq('organization_id', organizationId)
        .neq('review_status', 'rejected')
        .order('created_at', { ascending: false })
        .limit(300);

    if (error || !existingExpenses || existingExpenses.length === 0) {
        return { isDuplicate: false };
    }

    const filtered = excludeExpenseId
        ? existingExpenses.filter(e => e.id !== excludeExpenseId)
        : existingExpenses;

    const normInputRef = normalizeRef(paymentRef);
    const isNonCash = paymentMode !== 'Cash';

    // 2. Check UTR / Payment Reference Duplicate (Exact & Near Match)
    if (normInputRef && normInputRef.length >= 4 && isNonCash) {
        for (const exp of filtered) {
            const expNormRef = normalizeRef(exp.payment_ref);
            if (!expNormRef || expNormRef.length < 4) continue;

            const reqNo = (exp.request as any)?.request_no || 'another request';

            // Exact match
            if (normInputRef === expNormRef) {
                return {
                    isDuplicate: true,
                    reason: `Duplicate payment reference: UTR '${paymentRef}' was already claimed on ${exp.expense_date} (${reqNo}) for ₹${exp.amount}.`,
                    matchedRef: exp.payment_ref,
                    matchedExpenseId: exp.id,
                    matchedRequestNo: reqNo,
                    matchedAmount: exp.amount,
                    matchedDate: exp.expense_date,
                };
            }

            // Near-match / Transposed digits check for 8+ digit UTRs (e.g. UPI 12-digit numbers)
            if (normInputRef.length >= 8 && expNormRef.length >= 8) {
                // If length is within 1 char difference
                if (Math.abs(normInputRef.length - expNormRef.length) <= 1) {
                    const dist = damerauLevenshtein(normInputRef, expNormRef);
                    // Damerau distance <= 1 means 1 transposed pair (e.g. 94 <-> 49) or 1 typo digit
                    // Distance <= 2 on 12-digit strings is also high-probability OCR typo
                    if (dist <= 1 || (normInputRef.length >= 10 && dist <= 2)) {
                        return {
                            isDuplicate: true,
                            reason: `Suspicious duplicate reference: '${paymentRef}' is nearly identical (typo/transposed digits) to already claimed UTR '${exp.payment_ref}' (${reqNo}, ₹${exp.amount} on ${exp.expense_date}).`,
                            matchedRef: exp.payment_ref,
                            matchedExpenseId: exp.id,
                            matchedRequestNo: reqNo,
                            matchedAmount: exp.amount,
                            matchedDate: exp.expense_date,
                        };
                    }
                }
            }
        }
    }

    // 3. Check Identical Transaction Heuristic
    // (Same amount, same expense date, and matching/empty vendor in the same request or organization)
    if (amount != null && amount > 0 && expenseDate) {
        const normVendor = (vendor || '').toLowerCase().trim();

        for (const exp of filtered) {
            const expNormVendor = (exp.vendor || '').toLowerCase().trim();
            const sameReq = requestId && exp.request_id === requestId;
            const sameDate = exp.expense_date === expenseDate;
            const sameAmount = Number(exp.amount) === Number(amount);

            if (sameAmount && sameDate) {
                const reqNo = (exp.request as any)?.request_no || 'another request';

                // If in the same request and same vendor or either has similar vendor
                const vendorMatch =
                    !normVendor ||
                    !expNormVendor ||
                    normVendor === expNormVendor ||
                    normVendor.includes(expNormVendor) ||
                    expNormVendor.includes(normVendor);

                if (sameReq && vendorMatch) {
                    return {
                        isDuplicate: true,
                        reason: `Duplicate transaction detected: An identical expense of ₹${amount} for '${exp.vendor || 'Vendor'}' on ${expenseDate} is already logged in this request (${reqNo}).`,
                        matchedRef: exp.payment_ref,
                        matchedExpenseId: exp.id,
                        matchedRequestNo: reqNo,
                        matchedAmount: exp.amount,
                        matchedDate: exp.expense_date,
                    };
                }

                // If across different requests in the same org and vendor matches closely
                if (!sameReq && normVendor && expNormVendor && normVendor === expNormVendor) {
                    return {
                        isDuplicate: true,
                        reason: `Duplicate transaction alert: Identical ₹${amount} payment to '${exp.vendor}' on ${expenseDate} was already claimed in ${reqNo}.`,
                        matchedRef: exp.payment_ref,
                        matchedExpenseId: exp.id,
                        matchedRequestNo: reqNo,
                        matchedAmount: exp.amount,
                        matchedDate: exp.expense_date,
                    };
                }
            }
        }
    }

    return { isDuplicate: false };
}
