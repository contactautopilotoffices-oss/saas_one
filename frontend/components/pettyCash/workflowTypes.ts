import type { WalletTotals } from '@/backend/lib/pettyCash/wallet';
import type { PettyCashRequest } from '@/frontend/lib/pettyCash/roles';
export type { PettyCashRequest };
export interface Property { id: string; name: string; code?: string }
export interface Upload { upload_id: string; file_name: string; file_type: string }
export interface Route { property_id: string; kind: 'allocator' | 'approver'; user_id: string; user: { id: string; full_name: string; email: string } }
export interface Context {
    counts?: Partial<Record<'mine'|'expenses'|'allocations'|'approvals'|'assigned'|'disbursements'|'reconciliation'|'all',number>> | null; counts_error?: string | null;
    organization_id: string; user_id: string; properties: Property[]; configuration_properties: Property[]; routes: Route[];
    caps: { isAdmin: boolean; canManageRouting: boolean; canAllocate: boolean; canApprove: boolean; canDisburse: boolean };
    wallet: { balance: number; received: number; spent: number; returned: number; can_request: boolean; blocker: string | null };
}
export interface ExpenseBill { id: string; file_name: string; file_type?: string | null; superseded_by?: string | null }
export interface Expense { request?: { id?: string; request_no: string } | null; property?: { id: string; name: string } | null; documents?: ExpenseBill[]; id: string; request_id: string; amount: number; description: string; category: string; vendor: string; expense_date: string; payment_mode: string; payment_ref?: string; review_status: string; review_remarks?: string }
export interface Document { id: string; request_id: string; expense_id?: string; superseded_by?: string; stage: string; file_name: string; review_status?: string; amount?: number; review_remarks?: string }
export interface Detail { request: PettyCashRequest; documents: Document[]; expenses: Expense[]; balance: number; wallet?: WalletTotals; activity: { id: string; action: string; remark?: string; created_at: string; actor?: { full_name: string }; metadata?: { after?: { allocated_amount?: number; approved_amount?: number; paid_amount?: number } } }[]; reconciliation?: { unaccounted: number; bills_pending_review: number; bills_rejected: number } }
export async function pcFetch<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not complete petty cash action');
    return data as T;
}
export const pcJson = (body: object, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const pettyCashToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export function pettyCashDate(value?: string | null): string {
    if (!value) return '—';
    const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}
