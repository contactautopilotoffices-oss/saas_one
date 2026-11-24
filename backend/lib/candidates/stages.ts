/**
 * The organisation's pipeline stages (owner 2026-11-19; migration 20261119000001). Server-only: loading the list
 * (the saved one, else the built-in one, else, before the migration, the old ten), and saving HR's changes from
 * Recruitment -> Configurations. The rules a list must keep are in stage-list.ts (pure, shared with the screens).
 *
 * Saving: a stage keeps its key for life, so renaming, re-colouring or moving it to another column never moves a
 * person. A stage with people in it (in any position) cannot be deleted: HR moves them first, or hides it. Every save
 * that changes something is one row in recruitment_stage_changes (who, when, what), insert-only.
 *
 * Access is the caller's job (requireCandidateAccess: everyone who may use Recruitment, owner 2026-11-19 "everyone").
 */
import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "./actions";
import { CandidateActionError } from "./records";
import {
  DEFAULT_STAGES, describeChanges, LEGACY_STAGES, parseStageList, StageListError, toStageKind, unlistedStage,
  type Stage, type StageDef, type StageList, type StageTone,
} from "./stage-list";

const TABLE = "recruitment_stages";
const CHANGES = "recruitment_stage_changes";
const COLUMNS = "id, key, name, column_name, kind, tone, whatsapp, message, needs_remark, sort_order, hidden, deleted_at, updated_at";
export const STAGES_MIGRATION_MESSAGE = "Editing the stages needs a database update first: run 20261119000001_recruitment_stages.sql in Supabase.";

const missingRelation = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && (["42P01", "42703", "PGRST205", "PGRST204"].includes(error?.code ?? "") || /does not exist|schema cache/i.test(error?.message ?? ""));

function fail(what: string, error: { code?: string; message?: string }): never {
  console.error(`[candidates] stages: ${what}`, error);
  throw new CandidateActionError(500, `Couldn't ${what}. Please try again.`);
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? new Date(v).toISOString() : "");

interface StageRow {
  id: string;
  key: string;
  name: string;
  column_name: string | null;
  kind: string; // "selected" in lists saved before the types were merged
  tone: StageTone;
  whatsapp: boolean;
  message: string | null;
  needs_remark: boolean;
  sort_order: number;
  hidden: boolean;
  deleted_at: string | Date | null;
  updated_at: string | Date;
}

function toStage(row: StageRow): StageDef {
  return {
    key: row.key,
    name: row.name,
    column: row.kind === "out" ? null : row.column_name,
    // A list saved before the types were merged may still hold "selected": it is read as "progress" (Active).
    kind: toStageKind(row.kind) ?? "progress",
    tone: row.tone,
    whatsapp: Boolean(row.whatsapp),
    message: row.message ?? null,
    needsRemark: Boolean(row.needs_remark),
    hidden: Boolean(row.hidden),
  };
}

/** Every row the organisation has (deleted ones too: their keys are never reused). Null before the migration. */
async function loadRows(client: SupabaseClient, orgId: string): Promise<StageRow[] | null> {
  const { data, error } = await client.from(TABLE).select(COLUMNS).eq("organization_id", orgId).order("sort_order").limit(500);
  if (error) {
    if (missingRelation(error)) return null;
    fail("load the stages", error);
  }
  return (data ?? []) as unknown as StageRow[];
}

function versionOf(rows: StageRow[]): string | null {
  let latest = "";
  for (const row of rows) { const at = iso(row.updated_at); if (at > latest) latest = at; }
  return latest || null;
}

/** People in each listed stage across every position, and the stages people are in that are not on the list. */
async function countPeople(client: SupabaseClient, orgId: string, stages: readonly StageDef[]): Promise<{ counts: Record<Stage, number>; unlisted: Stage[] }> {
  const members = () => client.from("candidate_position_members").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("deleted_at", null);
  const results = await Promise.all(stages.map(async (stage) => {
    const { count, error } = await members().eq("stage", stage.key);
    if (error) fail("count the people in each stage", error);
    return [stage.key, count ?? 0] as const;
  }));
  const counts: Record<Stage, number> = Object.fromEntries(results);
  let others = client.from("candidate_position_members").select("stage").eq("organization_id", orgId).is("deleted_at", null);
  if (stages.length) others = others.not("stage", "in", `(${stages.map((x) => x.key).join(",")})`);
  const { data, error } = await others.limit(1000);
  if (error) fail("count the people in each stage", error);
  const unlisted: Stage[] = [];
  for (const row of (data ?? []) as { stage: string }[]) {
    if (!(row.stage in counts)) { counts[row.stage] = 0; unlisted.push(row.stage); }
    counts[row.stage] += 1;
  }
  // The count above stops at 1,000 rows; an exact count for each stage found.
  await Promise.all(unlisted.map(async (key) => {
    const { count } = await members().eq("stage", key);
    if (typeof count === "number") counts[key] = count;
  }));
  return { counts, unlisted };
}

/**
 * The list the app uses now. `detail` adds the people in each stage (and the stages people are in that are no longer
 * on the list, e.g. "Rejected" from the old list) and the latest changes: for Configurations.
 */
export async function loadStages(client: SupabaseClient, orgId: string, options: { detail?: boolean } = {}): Promise<StageList> {
  const rows = await loadRows(client, orgId);
  const live = (rows ?? []).filter((r) => !r.deleted_at);
  const list: StageList = rows === null
    ? { stages: LEGACY_STAGES.map((x) => ({ ...x })), source: "legacy", version: null }
    : live.length
      ? { stages: live.map(toStage), source: "saved", version: versionOf(rows) }
      : { stages: DEFAULT_STAGES.map((x) => ({ ...x })), source: "default", version: versionOf(rows) };
  if (!options.detail) return list;

  const { counts, unlisted } = await countPeople(client, orgId, list.stages);
  list.stages.push(...unlisted.map(unlistedStage));
  list.counts = counts;
  list.changes = [];
  if (rows !== null) {
    const { data, error } = await client.from(CHANGES).select("changed_by_name, summary, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(10);
    if (error && !missingRelation(error)) fail("load the changes to the stages", error);
    list.changes = ((data ?? []) as { changed_by_name: string | null; summary: string; created_at: string | Date }[]).map((r) => ({ byName: r.changed_by_name, at: iso(r.created_at), summary: r.summary }));
  }
  return list;
}

/** A key for a new stage: from its name, with a random ending so it is never one used before. */
function newKey(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "stage";
  for (;;) {
    const key = `${base}_${randomBytes(3).toString("hex")}`;
    if (!taken.has(key)) { taken.add(key); return key; }
  }
}

/**
 * Saves HR's list: { stages: [...in order], version }. `version` is what loadStages returned; if someone saved in
 * between, nothing is saved and HR is asked to reload. Returns the list as now saved (with counts and changes).
 */
export async function saveStages(client: SupabaseClient, orgId: string, by: Actor, input: { stages?: unknown; version?: unknown }): Promise<StageList> {
  let wanted: ReturnType<typeof parseStageList>;
  try {
    wanted = parseStageList(input.stages);
  } catch (error) {
    if (error instanceof StageListError) throw new CandidateActionError(400, error.message);
    throw error;
  }
  const rows = await loadRows(client, orgId);
  if (rows === null) throw new CandidateActionError(409, STAGES_MIGRATION_MESSAGE);
  const current = await loadStages(client, orgId, { detail: true });
  const version = typeof input.version === "string" && input.version ? input.version : null;
  if (version !== current.version) throw new CandidateActionError(409, "Someone else changed the stages a moment ago. Reload to see their changes, then make yours again.");

  const currentKeys = new Set(current.stages.map((x) => x.key));
  for (const stage of wanted) {
    if (stage.key !== null && !currentKeys.has(stage.key)) throw new CandidateActionError(400, `"${stage.name}" is no longer on the list. Reload and try again.`);
  }
  const keptKeys = new Set(wanted.map((x) => x.key).filter((k): k is string => k !== null));
  const blocked = current.stages.filter((x) => !keptKeys.has(x.key) && (current.counts?.[x.key] ?? 0) > 0);
  if (blocked.length) {
    const names = blocked.map((x) => `${x.name} (${current.counts?.[x.key]} ${current.counts?.[x.key] === 1 ? "person" : "people"})`).join(", ");
    throw new CandidateActionError(409, `People are still in ${names}. Move them to another stage first, or hide the stage instead of deleting it.`);
  }

  const taken = new Set(rows.map((r) => r.key));
  const after: StageDef[] = wanted.map((x) => ({ ...x, key: x.key ?? newKey(x.name, taken) }));
  const summary = describeChanges(current.stages, after) || (current.source === "default" ? "Saved the built-in list" : "");
  if (!summary) return current;

  const now = new Date().toISOString();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const [i, stage] of after.entries()) {
    const values = {
      name: stage.name, column_name: stage.column, kind: stage.kind, tone: stage.tone, whatsapp: stage.whatsapp, message: stage.message,
      needs_remark: stage.needsRemark, hidden: stage.hidden, sort_order: (i + 1) * 10, deleted_at: null, updated_at: now, updated_by: by.id,
    };
    const existing = byKey.get(stage.key);
    const { error } = existing
      ? await client.from(TABLE).update(values).eq("organization_id", orgId).eq("id", existing.id)
      : await client.from(TABLE).insert({ ...values, organization_id: orgId, key: stage.key, created_at: now });
    if (error) fail("save the stages", error);
  }
  const gone = rows.filter((r) => !r.deleted_at && !after.some((x) => x.key === r.key));
  if (gone.length) {
    const { error } = await client.from(TABLE).update({ deleted_at: now, updated_at: now, updated_by: by.id }).eq("organization_id", orgId).in("id", gone.map((r) => r.id));
    if (error) fail("save the stages", error);
  }
  const strip = (list: readonly StageDef[]) => list.map(({ unlisted: _u, ...x }) => { void _u; return x; });
  const { error: logError } = await client.from(CHANGES).insert({
    organization_id: orgId, changed_by: by.id, changed_by_name: by.name, summary: summary.slice(0, 2000),
    before: strip(current.stages), after: strip(after), created_at: now,
  });
  if (logError) fail("record the change to the stages", logError);
  return loadStages(client, orgId, { detail: true });
}
