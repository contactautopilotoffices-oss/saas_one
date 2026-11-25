/**
 * Owner 2026-11-24 (product safety, migration 20261124000004): the recruitment audit log, the message log and "last
 * contacted". All three are best effort: a missing table (migration not run yet) or a write problem is logged and never
 * fails the action it records.
 *
 *   audit   : who exported candidates, changed a CTC or an offer's breakup, merged or removed a person's data.
 *             Append-only in the database (a trigger refuses UPDATE and DELETE).
 *   message : every candidate email or WhatsApp the app sends that no other table keeps, for the one message log.
 *   contact : candidates.last_contacted_at, for the "last contacted" search filter.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "./actions";

export type AuditAction = "export" | "ctc_edit" | "offer_edit" | "breakup_edit" | "merge" | "removal" | "delete" | "hard_delete" | "document_view" | "assignment_view";

export async function audit(
  client: SupabaseClient, orgId: string, by: Actor | null,
  e: { action: AuditAction; entityType: string; entityId?: string | null; before?: unknown; after?: unknown; detail?: string | null },
): Promise<void> {
  try {
    const { error } = await client.from("recruitment_audit_log").insert({
      organization_id: orgId, user_id: by?.id ?? null, user_name: by?.name ?? null, entity_type: e.entityType, entity_id: e.entityId ?? null,
      action: e.action, before_value: e.before ?? null, after_value: e.after ?? null, detail: e.detail?.slice(0, 1000) ?? null,
    });
    if (error) console.error("[candidates] audit log write failed", error.message);
  } catch (err) {
    console.error("[candidates] audit log write failed", err);
  }
}

export async function logMessage(
  client: SupabaseClient, orgId: string,
  m: { candidateId: string | null; channel: "email" | "whatsapp"; kind: string; recipient?: string | null; subject?: string | null; ok: boolean; error?: string | null; by?: string | null },
): Promise<void> {
  try {
    const { error } = await client.from("recruitment_message_log").insert({
      organization_id: orgId, candidate_id: m.candidateId, channel: m.channel, kind: m.kind.slice(0, 60), recipient: m.recipient?.slice(0, 200) ?? null,
      subject: m.subject?.slice(0, 300) ?? null, status: m.ok ? "sent" : "failed", error: m.error?.slice(0, 300) ?? null, sent_by_name: m.by ?? null,
    });
    if (error) console.error("[candidates] message log write failed", error.message);
    if (m.ok && m.candidateId) await markContacted(client, orgId, m.candidateId);
  } catch (err) {
    console.error("[candidates] message log write failed", err);
  }
}

export async function markContacted(client: SupabaseClient, orgId: string, candidateId: string, at = new Date()): Promise<void> {
  try {
    await client.from("candidates").update({ last_contacted_at: at.toISOString() }).eq("organization_id", orgId).eq("id", candidateId);
  } catch {
    // the column comes with 20261124000004; until then there is nothing to keep
  }
}

export interface AuditEntry { id: string; at: string; user: string | null; action: string; entityType: string; entityId: string | null; detail: string | null; before: unknown; after: unknown }

export async function listAudit(client: SupabaseClient, orgId: string, opts: { page?: number; action?: string | null } = {}): Promise<{ entries: AuditEntry[]; total: number }> {
  const size = 50;
  const page = Math.max(1, opts.page ?? 1);
  let q = client.from("recruitment_audit_log").select("id, created_at, user_name, action, entity_type, entity_id, detail, before_value, after_value", { count: "exact" }).eq("organization_id", orgId);
  if (opts.action) q = q.eq("action", opts.action);
  const { data, error, count } = await q.order("created_at", { ascending: false }).range((page - 1) * size, page * size - 1);
  if (error) return { entries: [], total: 0 };
  return {
    total: count ?? 0,
    entries: ((data ?? []) as { id: string; created_at: string; user_name: string | null; action: string; entity_type: string; entity_id: string | null; detail: string | null; before_value: unknown; after_value: unknown }[])
      .map((r) => ({ id: r.id, at: r.created_at, user: r.user_name, action: r.action, entityType: r.entity_type, entityId: r.entity_id, detail: r.detail, before: r.before_value, after: r.after_value })),
  };
}
