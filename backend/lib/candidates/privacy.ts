/**
 * Owner 2026-11-24 (product safety; migration 20261124000004):
 *   Saved searches : a recruiter's named sets of search filters, private to them.
 *   Removal        : "remove this person's data" on a request. Their name and contact details are wiped from the person
 *                    and every record of theirs, every open link of theirs is switched off, and they are marked so
 *                    nothing is ever sent to them again (blacklisted with the reason, removed_at). The history keeps
 *                    that it happened, without the details; the audit log keeps who did it. Resume files stay until
 *                    HR deletes the records permanently (Records → delete permanently), so a mistake can be undone.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAction, type Actor } from "./actions";
import { audit } from "./audit";
import { parseFilters } from "./filter-search";
import type { SearchFilters } from "./filters";
import { CandidateActionError } from "./records";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAVED = "recruitment_saved_searches";
export const PRIVACY_MIGRATION_MESSAGE = "This needs a database update first: run 20261124000004_recruitment_assignment_loi_audit.sql in Supabase.";
const missing = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && (["42P01", "42703", "PGRST205", "PGRST204"].includes(error?.code ?? "") || /recruitment_saved_searches|removed_at|does not exist|schema cache/i.test(error?.message ?? ""));

export interface SavedSearch { id: string; name: string; filters: SearchFilters; createdAt: string }

export async function listSavedSearches(client: SupabaseClient, orgId: string, userId: string): Promise<SavedSearch[]> {
  const { data, error } = await client.from(SAVED).select("id, name, filters, created_at").eq("organization_id", orgId).eq("user_id", userId).order("name").limit(100);
  if (error) return [];
  return ((data ?? []) as { id: string; name: string; filters: unknown; created_at: string }[]).flatMap((r) => {
    try { return [{ id: r.id, name: r.name, filters: parseFilters(r.filters), createdAt: r.created_at }]; } catch { return []; }
  });
}

/** Saves (or replaces, by name) one of this person's searches. */
export async function saveSearch(client: SupabaseClient, orgId: string, userId: string, name: unknown, filters: unknown): Promise<SavedSearch> {
  const n = typeof name === "string" ? name.trim().slice(0, 80) : "";
  if (!n) throw new CandidateActionError(400, "Give the search a name.");
  const f = parseFilters(filters);
  const { data, error } = await client.from(SAVED).upsert({ organization_id: orgId, user_id: userId, name: n, filters: f }, { onConflict: "organization_id,user_id,name" }).select("id, name, created_at").single();
  if (error) {
    if (missing(error)) throw new CandidateActionError(503, PRIVACY_MIGRATION_MESSAGE);
    throw new CandidateActionError(500, "The search could not be saved.");
  }
  const row = data as { id: string; name: string; created_at: string };
  return { id: row.id, name: row.name, filters: f, createdAt: row.created_at };
}

export async function deleteSavedSearch(client: SupabaseClient, orgId: string, userId: string, id: unknown): Promise<void> {
  if (typeof id !== "string" || !UUID.test(id)) throw new CandidateActionError(404, "Not found.");
  const { error } = await client.from(SAVED).delete().eq("organization_id", orgId).eq("user_id", userId).eq("id", id);
  if (error) throw new CandidateActionError(500, "The search could not be removed.");
}

const REMOVED_NAME = "Removed on request";

/** Wipes a person's details on their request (see the header). Returns how many records were cleaned. */
export async function removePersonData(client: SupabaseClient, orgId: string, by: Actor, candidateId: unknown, reasonInput: unknown): Promise<{ records: number }> {
  if (typeof candidateId !== "string" || !UUID.test(candidateId)) throw new CandidateActionError(404, "Candidate not found.");
  const reason = typeof reasonInput === "string" ? reasonInput.trim().slice(0, 500) : "";
  if (!reason) throw new CandidateActionError(400, "Say how the request came in (for example: email from the person on 24 Nov).");
  const { data: person, error } = await client.from("candidates").select("id, removed_at").eq("organization_id", orgId).eq("id", candidateId).maybeSingle();
  if (error) {
    if (missing(error)) throw new CandidateActionError(503, PRIVACY_MIGRATION_MESSAGE);
    throw new CandidateActionError(500, "Couldn't find the person.");
  }
  if (!person) throw new CandidateActionError(404, "Candidate not found.");
  if ((person as { removed_at: string | null }).removed_at) throw new CandidateActionError(409, "This person's data was already removed.");
  const now = new Date().toISOString();

  // The person: the name and every detail that identifies or reaches them; never contacted again.
  const { error: personError } = await client.from("candidates").update({
    full_name: REMOVED_NAME, email: null, email_key: null, phone: null, phone_key: null, current_organization: null, current_designation: null, location: null,
    removed_at: now, blacklisted_at: now, blacklisted_by: by.id ?? null, blacklist_reason: "asked_not_to_contact", blacklist_remark: `Data removed on request: ${reason}`.slice(0, 500), updated_at: now,
  }).eq("organization_id", orgId).eq("id", candidateId);
  if (personError) throw new CandidateActionError(500, "The person could not be marked removed. Nothing was removed; try again.");
  // Every record of theirs: the search text (built from the profile) and the remark go too.
  const { data: apps } = await client.from("candidate_applications").update({ search_text: "", embedding: null, embedding_model: null, remark: null, updated_at: now })
    .eq("organization_id", orgId).eq("candidate_id", candidateId).select("id");
  await client.from("recruitment_application_links").update({ disabled_at: now }).eq("organization_id", orgId).eq("candidate_id", candidateId).is("disabled_at", null);
  await client.from("recruitment_assignments").update({ status: "cancelled" }).eq("organization_id", orgId).eq("candidate_id", candidateId).eq("status", "sent");

  await recordAction(client, orgId, by, { candidateId, applicationId: null, positionId: null, action: "remark", toValue: "Personal data removed on the person's request", meta: { kind: "data_removed" } });
  await audit(client, orgId, by, { action: "removal", entityType: "candidate", entityId: candidateId, detail: reason, after: { records: (apps ?? []).length } });
  return { records: (apps ?? []).length };
}
