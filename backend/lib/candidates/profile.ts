/**
 * The profile text each record is searched by (keyword index + embedding). One record = one retrieval unit; never
 * split. It never contains email, phone or salary: contact details stay out of embeddings and prompts, and numbers
 * are filtered in SQL, not by similarity.
 */
import { formatMonths } from "./normalize";

export interface ProfileFields {
  role: string | null;
  currentDesignation: string | null;
  currentOrganization: string | null;
  location: string | null;
  totalExpMonths: number | null;
  relevantExpMonths: number | null;
  noticePeriodDays: number | null;
  candidateSource: string | null;
  remark: string | null;
  /** Phase 4 (owner 2026-11-11): read from the resume; absent before migration 20261111000002. */
  resumeSummary?: string | null;
  skills?: string[] | null;
}

export function buildSearchText(p: ProfileFields): string {
  const lines: [string, string | null][] = [
    ["Role sourced for", p.role],
    ["Current designation", p.currentDesignation],
    ["Current organisation", p.currentOrganization],
    ["Location", p.location],
    ["Total experience", formatMonths(p.totalExpMonths)],
    ["Relevant experience", formatMonths(p.relevantExpMonths)],
    ["Notice period", p.noticePeriodDays === null ? null : `${p.noticePeriodDays} days`],
    ["Source", p.candidateSource],
    ["Remark", p.remark],
    ["Summary", p.resumeSummary ?? null],
    ["Skills", p.skills?.length ? p.skills.join(", ") : null],
  ];
  return lines
    .filter((line): line is [string, string] => Boolean(line[1]))
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}
