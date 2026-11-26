/**
 * The one message log (owner 2026-11-24, product safety): every message to or from a candidate in one list, newest
 * first, from where each is kept today:
 *   candidate_outreach           : WhatsApp status updates and interview invites;
 *   recruitment_outreach_sends   : bulk and automatic outreach (WhatsApp and email);
 *   recruitment_mail_messages    : the recruitment mailbox, both ways;
 *   recruitment_screenings       : the screening questions;
 *   recruitment_message_log      : the rest the app sends (assignment, documents, letter of intent).
 * A table that is not there yet (its migration not run) is simply left out.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MessageEntry {
  id: string; at: string; channel: "whatsapp" | "email"; direction: "out" | "in"; what: string; to: string | null;
  status: string; error: string | null; by: string | null;
}

const KIND_WORDS: Record<string, string> = {
  shortlisted: "Shortlisted", not_shortlisted: "Not shortlisted", status_update: "Status update", interview: "Interview invite",
  assignment: "Assignment", documents_request: "Documents request", offer_letter: "Letter of intent",
};

export async function candidateMessages(client: SupabaseClient, orgId: string, candidateId: string): Promise<MessageEntry[]> {
  if (!UUID.test(candidateId)) return [];
  const [outreach, sends, mail, screenings, log] = await Promise.all([
    client.from("candidate_outreach").select("id, kind, campaign, phone, status, error, created_by_name, created_at").eq("organization_id", orgId).eq("candidate_id", candidateId).order("created_at", { ascending: false }).limit(100),
    client.from("recruitment_outreach_sends").select("id, channel, recipient, status, error, sent_at, attempted_at, created_at").eq("organization_id", orgId).eq("candidate_id", candidateId).in("status", ["sent", "failed", "unknown"]).limit(100),
    client.from("recruitment_mail_messages").select("id, direction, subject, sender, recipient, status, received_at").eq("organization_id", orgId).eq("candidate_id", candidateId).order("received_at", { ascending: false }).limit(100),
    client.from("recruitment_screenings").select("id, status, error, sent_at, sent_by_name, created_at").eq("organization_id", orgId).eq("candidate_id", candidateId).limit(50),
    client.from("recruitment_message_log").select("id, channel, kind, recipient, subject, status, error, sent_by_name, created_at").eq("organization_id", orgId).eq("candidate_id", candidateId).order("created_at", { ascending: false }).limit(100),
  ]);
  const out: MessageEntry[] = [];
  for (const r of (outreach.error ? [] : outreach.data ?? []) as { id: string; kind: string; campaign: string; phone: string; status: string; error: string | null; created_by_name: string | null; created_at: string }[]) {
    out.push({ id: `o-${r.id}`, at: r.created_at, channel: "whatsapp", direction: "out", what: KIND_WORDS[r.kind] ?? r.kind.replace(/_/g, " "), to: r.phone, status: r.status, error: r.error, by: r.created_by_name });
  }
  for (const r of (sends.error ? [] : sends.data ?? []) as { id: string; channel: "whatsapp" | "email"; recipient: string | null; status: string; error: string | null; sent_at: string | null; attempted_at: string | null; created_at: string }[]) {
    out.push({ id: `s-${r.id}`, at: r.sent_at ?? r.attempted_at ?? r.created_at, channel: r.channel, direction: "out", what: "Job opening (outreach)", to: r.recipient, status: r.status, error: r.error, by: null });
  }
  for (const r of (mail.error ? [] : mail.data ?? []) as { id: string; direction: string; subject: string | null; sender: string | null; recipient: string | null; status: string | null; received_at: string }[]) {
    const incoming = r.direction === "incoming";
    out.push({ id: `m-${r.id}`, at: r.received_at, channel: "email", direction: incoming ? "in" : "out", what: r.subject || "(no subject)", to: incoming ? r.sender : r.recipient, status: r.status ?? (incoming ? "received" : "sent"), error: null, by: null });
  }
  for (const r of (screenings.error ? [] : screenings.data ?? []) as { id: string; status: string; error: string | null; sent_at: string | null; sent_by_name: string | null; created_at: string }[]) {
    out.push({ id: `q-${r.id}`, at: r.sent_at ?? r.created_at, channel: "whatsapp", direction: "out", what: "Screening questions", to: null, status: r.status === "failed" ? "failed" : "sent", error: r.error, by: r.sent_by_name });
  }
  for (const r of (log.error ? [] : log.data ?? []) as { id: string; channel: "whatsapp" | "email"; kind: string; recipient: string | null; subject: string | null; status: string; error: string | null; sent_by_name: string | null; created_at: string }[]) {
    out.push({ id: `l-${r.id}`, at: r.created_at, channel: r.channel, direction: "out", what: r.subject || KIND_WORDS[r.kind] || r.kind.replace(/_/g, " "), to: r.recipient, status: r.status, error: r.error, by: r.sent_by_name });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300);
}
