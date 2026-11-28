/**
 * The pipeline's stages (owner 2026-11-19: "make the stages customizable … add a configurations tab", one list for
 * every position, anyone in HR may change it; migration 20261119000001). Pure: shared by the server and the screens.
 *
 * A stage has a stable KEY (what candidate_position_members.stage holds, so a rename never moves anyone) and what HR
 * sets in Recruitment -> Configurations: its name, the board column (round) it sits under, its type, its colour,
 * whether moving someone there offers a WhatsApp update and the default text of that update, and whether a move there
 * needs a remark. The board shows one column per round, in the list's order, with each status as an area inside it;
 * "out of the flow" stages are a strip under the board.
 *
 * Until the migration is applied the app keeps the old ten stages (LEGACY_STAGES) and the list cannot be edited.
 */

/*
 * A stage's type: where it sits on the board and how the app treats it. Three choices (owner 2026-11-20, "go with
 * option 1"): "In progress" and "Selected" behaved the same on the board, so they are one type, "Active". Lists saved
 * before keep "selected" in the table (its check still allows it); toStageKind reads it as "progress".
 */
export const STAGE_KINDS = ["progress", "rejected", "out"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];
export const STAGE_KIND_LABELS: Record<StageKind, string> = {
  progress: "Active",
  rejected: "Rejected",
  out: "Out of the flow",
};
/** One line under the Type dropdown in Configurations: what the choice does on the Pipeline board. */
export const STAGE_KIND_HINTS: Record<StageKind, string> = {
  progress: "Active: the cards show in this round's column on the Pipeline board.",
  rejected: "Rejected: folds to a count in this round's column, is used by the Reject button, and is left out of the funnel.",
  out: "Out of the flow: not in a column; shown in the row under the board.",
};
/** A stored type, "selected" (the old fourth type) read as "progress"; anything unknown is null. */
export function toStageKind(value: unknown): StageKind | null {
  const v = String(value ?? "");
  if (v === "selected") return "progress";
  return (STAGE_KINDS as readonly string[]).includes(v) ? (v as StageKind) : null;
}

export const STAGE_TONES = ["amber", "green", "red", "blue", "violet", "teal", "grey"] as const;
export type StageTone = (typeof STAGE_TONES)[number];

/** A stage key: what a pipeline row stores. Lower-case letters, digits and "_". */
export type Stage = string;
export const STAGE_KEY = /^[a-z0-9_]{1,40}$/;

export interface StageDef {
  key: Stage;
  name: string;
  /** The board column (round) it sits under; null for an out-of-the-flow stage. */
  column: string | null;
  kind: StageKind;
  tone: StageTone;
  /** Moving someone here offers to send the candidate a WhatsApp update (a person always presses Send). */
  whatsapp: boolean;
  /** The update's default middle text (HR edits it before each send). */
  message: string | null;
  /** A move here needs a remark saying why. */
  needsRemark: boolean;
  /** Kept for history; not offered when moving people. People already in it still show. */
  hidden: boolean;
  /** Not on the saved list: people are in it from an older list (e.g. "Rejected"). Shown until they are moved. */
  unlisted?: boolean;
}

/** GET /api/candidates/stages. */
export interface StageList {
  stages: StageDef[];
  /** saved: the organisation's list · default: never saved, the built-in list · legacy: the migration is not applied. */
  source: "saved" | "default" | "legacy";
  /** Sent back with a save, so two people saving at once cannot overwrite each other. */
  version: string | null;
  /** People in each stage across every position (only when asked for). */
  counts?: Record<Stage, number>;
  /** The latest changes to the list, newest first (only when asked for). */
  changes?: { byName: string | null; at: string; summary: string }[];
}

export const STAGE_NAME_MAX = 60;
export const STAGE_COLUMN_MAX = 40;
/** WhatsApp refuses a template parameter much longer than this; it is the editable middle of the message. */
export const STAGE_MESSAGE_MAX = 400;
export const MAX_STAGES = 60;

const REJECT_TEXT = "After careful review, we will not be moving forward with your application for this role. We will keep your profile with us and reach out when a suitable role opens up. We wish you the very best.";

const s = (key: string, name: string, column: string | null, kind: StageKind, tone: StageTone, extra: Partial<StageDef> = {}): StageDef => ({
  key, name, column, kind, tone, whatsapp: false, message: null, needsRemark: false, hidden: false, ...extra,
});

/**
 * The built-in list (owner 2026-11-19): the statuses of the HR team's standard tracker, plus Sourced, Offer and
 * Joined ("keep sourced, offer, joined"), and On hold / Not responding from the earlier list.
 */
export const DEFAULT_STAGES: readonly StageDef[] = [
  s("sourced", "Sourced", "Sourced", "progress", "blue"),
  s("screening_pending", "Screening Pending", "Screening", "progress", "amber"),
  s("screening_reject", "Screening Reject", "Screening", "rejected", "red", { whatsapp: true, message: REJECT_TEXT }),
  s("l1_pending", "L1 Pending", "L1 · Hiring Manager", "progress", "amber", {
    whatsapp: true, message: "You have been shortlisted for the first interview round. Our recruiter will call you shortly to fix the date and time.",
  }),
  s("l1_select", "L1 Select", "L1 · Hiring Manager", "progress", "green"),
  s("l1_reject", "L1 Reject", "L1 · Hiring Manager", "rejected", "red", { whatsapp: true, message: REJECT_TEXT }),
  s("l2_pending", "L2/Assignment Pending", "L2 · Assignment / HOD", "progress", "amber", {
    whatsapp: true, message: "You have cleared the first round. The next step is an assignment or a second round, and our recruiter will share the details shortly.",
  }),
  s("l2_reject", "L2/Assignment Reject", "L2 · Assignment / HOD", "rejected", "red", { whatsapp: true, message: REJECT_TEXT }),
  s("l3_pending", "L3 Pending", "L3 · Senior Mgmt / HOD", "progress", "amber", {
    whatsapp: true, message: "You have been selected for the next interview round with our senior management. Our recruiter will share the date and time shortly.",
  }),
  s("director_pending", "Director Round Pending", "Director", "progress", "amber", {
    whatsapp: true, message: "You have been selected for the Director round. Our recruiter will share the date and time shortly.",
  }),
  s("final_select", "Final round select", "Final", "progress", "green"),
  s("final_reject", "Final round reject", "Final", "rejected", "red", { whatsapp: true, message: REJECT_TEXT }),
  s("salary_pending", "Salary discussion pending", "Salary discussion", "progress", "teal"),
  s("offer", "Offer", "Offer", "progress", "violet"),
  s("joined", "Joined", "Joined", "progress", "green"),
  s("feedback_pending", "L1/L2/L3 Feedback Pending", null, "out", "amber"),
  s("backout", "Backout", null, "out", "grey"),
  s("already_sourced", "Already Sourced", null, "out", "grey"),
  s("on_hold", "On hold", null, "out", "amber"),
  s("not_responding", "Not responding", null, "out", "grey"),
];

/** The list before migration 20261119000001 (owner 2026-11-15), which the database still enforces until then. */
export const LEGACY_STAGES: readonly StageDef[] = [
  s("sourced", "Sourced", "Sourced", "progress", "blue"),
  s("screening", "Screening", "Screening", "progress", "amber"),
  s("shortlisted", "Shortlisted", "Shortlisted", "progress", "green"),
  s("interview", "Interview", "Interview", "progress", "amber"),
  s("offer", "Offer", "Offer", "progress", "violet"),
  s("joined", "Joined", "Joined", "progress", "green"),
  s("on_hold", "On hold", null, "out", "amber"),
  s("not_responding", "Not responding", null, "out", "grey"),
  s("rejected", "Rejected", null, "out", "red"),
  s("others", "Others", null, "out", "grey", { needsRemark: true }),
];

/** A stage that is no longer on the list but still has people in it (from an older list). */
export function unlistedStage(key: Stage): StageDef {
  const old = LEGACY_STAGES.find((x) => x.key === key) ?? DEFAULT_STAGES.find((x) => x.key === key);
  const name = old?.name ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return s(key, name, null, "out", old?.kind === "out" ? old.tone : key === "rejected" ? "red" : "grey", { needsRemark: old?.needsRemark ?? false, unlisted: true });
}

export function findStage(stages: readonly StageDef[], key: Stage): StageDef | undefined {
  return stages.find((x) => x.key === key);
}

/** The name to show for a key, also for one that is no longer on the list. */
export function stageName(stages: readonly StageDef[], key: Stage): string {
  return findStage(stages, key)?.name ?? unlistedStage(key).name;
}

/** The board's columns, in the list's order (a column appears where its first stage is). Out-of-the-flow stages are not in them. */
export function boardColumns(stages: readonly StageDef[], showHidden: (stage: StageDef) => boolean = () => false): { name: string; stages: StageDef[] }[] {
  const columns: { name: string; stages: StageDef[] }[] = [];
  for (const stage of stages) {
    if (stage.kind === "out" || (stage.hidden && !showHidden(stage))) continue;
    const name = stage.column?.trim() || stage.name;
    let column = columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!column) columns.push((column = { name, stages: [] }));
    column.stages.push(stage);
  }
  return columns;
}

/** The out-of-the-flow stages (the strip under the board). */
export function sideStages(stages: readonly StageDef[], showHidden: (stage: StageDef) => boolean = () => false): StageDef[] {
  return stages.filter((x) => x.kind === "out" && (!x.hidden || showHidden(x)));
}

/** Where new people start: the first visible stage of the flow. */
export function firstStage(stages: readonly StageDef[]): StageDef {
  return boardColumns(stages)[0]?.stages[0] ?? stages.find((x) => !x.hidden) ?? DEFAULT_STAGES[0];
}

/** The column a stage sits in (its index on the board), or -1 when out of the flow / hidden. */
export function columnIndexOf(stages: readonly StageDef[], key: Stage): number {
  return boardColumns(stages, (x) => x.key === key).findIndex((c) => c.stages.some((x) => x.key === key));
}

/**
 * Owner 2026-11-21 (spec: "reason required to reject"; "changing a stage always asks for a reason when moving backwards
 * or exiting"). The reasons are a fixed list HR edits in Configurations, so the reports can count them.
 */
export const DEFAULT_REJECTION_REASONS = [
  "Not suitable", "Salary mismatch", "Notice period too long", "Location", "Candidate withdrew", "No response", "Failed interview", "Other",
] as const;

/** Why a move needs a reason: to a Rejected stage ("reject"), or back to an earlier round ("back"); else null. */
export function reasonNeeded(stages: readonly StageDef[], from: Stage, to: Stage): "reject" | "back" | null {
  if (from === to) return null;
  const target = findStage(stages, to);
  if (!target) return null;
  if (target.kind === "rejected") return "reject";
  const a = columnIndexOf(stages, from);
  const b = columnIndexOf(stages, to);
  return a >= 0 && b >= 0 && b < a ? "back" : null;
}

/** "Salary mismatch — asked 40k, band 30k": the reason with an optional note, as the remark. */
export const withReason = (reason: string, note: string) => (note.trim() ? `${reason} — ${note.trim()}` : reason);

/** "Next round": the first stage of the next column. */
export function nextRoundStage(stages: readonly StageDef[], key: Stage): StageDef | null {
  const columns = boardColumns(stages);
  const at = columnIndexOf(stages, key);
  if (at < 0) return null;
  return columns[at + 1]?.stages[0] ?? null;
}

/** "Reject" at this round: the rejected stage of the same column, else the first rejected stage. */
export function rejectStageFor(stages: readonly StageDef[], key: Stage): StageDef | null {
  const columns = boardColumns(stages);
  const at = columnIndexOf(stages, key);
  const here = at >= 0 ? columns[at].stages.find((x) => x.kind === "rejected") : undefined;
  return here ?? stages.find((x) => x.kind === "rejected" && !x.hidden) ?? null;
}

/** The stages people can be moved to, grouped as the board shows them (for dropdowns). */
export function stageGroups(stages: readonly StageDef[]): { label: string; stages: StageDef[] }[] {
  return [
    ...boardColumns(stages).map((c) => ({ label: c.name, stages: c.stages })),
    { label: "Out of the flow", stages: sideStages(stages) },
  ].filter((g) => g.stages.length);
}

/** What WhatsApp accepts in a template parameter: one line, no tabs, no long runs of spaces. */
export function oneLine(text: unknown): string {
  return String(text ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/** One row of a save (PUT /api/candidates/stages). `key` is absent for a new stage. */
export interface StageInput {
  key?: string | null;
  name: string;
  column?: string | null;
  kind: StageKind;
  tone: StageTone;
  whatsapp?: boolean;
  message?: string | null;
  needsRemark?: boolean;
  hidden?: boolean;
}

export class StageListError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Checks a list HR is saving and tidies it. Throws StageListError with a sentence HR can act on. */
export function parseStageList(input: unknown): (Omit<StageDef, "key" | "unlisted"> & { key: string | null })[] {
  if (!Array.isArray(input) || !input.length) throw new StageListError("The list needs at least one stage.");
  if (input.length > MAX_STAGES) throw new StageListError(`Up to ${MAX_STAGES} stages.`);
  const seenNames = new Set<string>();
  const seenKeys = new Set<string>();
  const out = input.map((raw, i) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const name = String(row.name ?? "").replace(/\s+/g, " ").trim();
    if (!name) throw new StageListError(`Stage ${i + 1} has no name.`);
    if (name.length > STAGE_NAME_MAX) throw new StageListError(`"${name.slice(0, 30)}…" is longer than ${STAGE_NAME_MAX} characters.`);
    if (seenNames.has(name.toLowerCase())) throw new StageListError(`Two stages are called "${name}". Give each a different name.`);
    seenNames.add(name.toLowerCase());
    const key = row.key === undefined || row.key === null || row.key === "" ? null : String(row.key);
    if (key !== null) {
      if (!STAGE_KEY.test(key)) throw new StageListError(`"${name}" has an unknown key.`);
      if (seenKeys.has(key)) throw new StageListError(`"${name}" is in the list twice.`);
      seenKeys.add(key);
    }
    const kind = toStageKind(row.kind);
    if (!kind) throw new StageListError(`Choose a type for "${name}".`);
    const tone = String(row.tone ?? "") as StageTone;
    if (!STAGE_TONES.includes(tone)) throw new StageListError(`Choose a colour for "${name}".`);
    const column = kind === "out" ? null : String(row.column ?? "").replace(/\s+/g, " ").trim() || name;
    if (column && column.length > STAGE_COLUMN_MAX) throw new StageListError(`The column of "${name}" is longer than ${STAGE_COLUMN_MAX} characters.`);
    const text = oneLine(row.message);
    if (text.length > STAGE_MESSAGE_MAX) throw new StageListError(`The WhatsApp text of "${name}" is longer than ${STAGE_MESSAGE_MAX} characters.`);
    const message = text || null;
    return { key, name, column, kind, tone, whatsapp: row.whatsapp === true, message, needsRemark: row.needsRemark === true, hidden: row.hidden === true };
  });
  if (!out.some((x) => x.kind !== "out" && !x.hidden)) throw new StageListError("Keep at least one stage on the board (not hidden, not out of the flow).");
  return out;
}

/** "Added L4 Pending · renamed Backout → Back out · hid On hold": what a save changed, for the history. */
export function describeChanges(before: readonly StageDef[], after: readonly StageDef[]): string {
  const parts: string[] = [];
  const byKey = new Map(before.map((x) => [x.key, x]));
  const kept = new Set(after.map((x) => x.key));
  for (const x of after) {
    const old = byKey.get(x.key);
    if (!old) { parts.push(`added ${x.name}`); continue; }
    if (old.name !== x.name) parts.push(`renamed ${old.name} → ${x.name}`);
    if (!old.hidden && x.hidden) parts.push(`hid ${x.name}`);
    if (old.hidden && !x.hidden) parts.push(`showed ${x.name}`);
    const edits: string[] = [];
    if ((old.column ?? "") !== (x.column ?? "")) edits.push("column");
    if (old.kind !== x.kind) edits.push("type");
    if (old.tone !== x.tone) edits.push("colour");
    if (old.whatsapp !== x.whatsapp) edits.push(x.whatsapp ? "WhatsApp on" : "WhatsApp off");
    if ((old.message ?? "") !== (x.message ?? "")) edits.push("WhatsApp text");
    if (old.needsRemark !== x.needsRemark) edits.push(x.needsRemark ? "remark needed" : "remark optional");
    if (edits.length) parts.push(`${x.name}: ${edits.join(", ")}`);
  }
  for (const x of before) if (!kept.has(x.key)) parts.push(`deleted ${x.name}`);
  const order = (list: readonly StageDef[]) => list.filter((x) => kept.has(x.key) && byKey.has(x.key)).map((x) => x.key).join(",");
  if (order(before) !== order(after)) parts.push("changed the order");
  const text = parts.join(" · ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

export function isSelectionStage(stage: StageDef): boolean {
  return stage.kind === "progress" && (stage.key === "offer" || stage.key === "shortlisted" || /(?:^|_)select(?:ed)?(?:_|$)/i.test(stage.key));
}
