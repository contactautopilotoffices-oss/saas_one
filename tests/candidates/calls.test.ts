/**
 * Calls (owner 2026-11-16, plan P3 + P7; migration 20261116000001): a recording or a pasted transcript on a candidate,
 * the pipeline that transcribes and reads it (with fakes for the two services), the facts applied one click at a
 * time, and the history. Against the real migrations in PGlite.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { looksLikeScreening, parseCandidateScreening } from "../../backend/lib/callInsights/contexts/candidateScreening";
import { runCallAnalysis, type PipelineDeps } from "../../backend/lib/callInsights/pipeline";
import { stampedTranscript } from "../../backend/lib/callInsights/transcribe";
import { listActions, resetHistoryCheck } from "../../backend/lib/candidates/actions";
import { applyCallFacts, confirmCall, deleteCall, getCall, listCalls, prepareCall, retryCall, type CallStorage } from "../../backend/lib/candidates/calls";
import { createPosition } from "../../backend/lib/candidates/positions";
import { createRecord, getRecord } from "../../backend/lib/candidates/records";
import type { CallInsights } from "../../backend/lib/candidates/types";

import { CALLS_MIGRATION, freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const ME = { id: USER, name: "Shwetha" };

/** The bucket, in memory. */
function fakeStorage() {
  const objects = new Map<string, Buffer>();
  const storage: CallStorage = {
    async createSignedUploadUrl(path) { return { data: { signedUrl: `https://storage.test/upload/${path}`, token: "t", path }, error: null }; },
    async createSignedUrl(path) { return objects.has(path) ? { data: { signedUrl: `https://storage.test/${path}` }, error: null } : { data: null, error: { message: "Object not found" } }; },
    async list(prefix = "", options) {
      const rows = [...objects.entries()]
        .filter(([p]) => p.startsWith(`${prefix}/`) && (!options?.search || p.includes(options.search)))
        .map(([p, bytes]) => ({ name: p.slice(prefix.length + 1), metadata: { size: bytes.length } }));
      return { data: rows, error: null };
    },
    async remove(paths) { for (const p of paths) objects.delete(p); return { data: null, error: null }; },
    async download(path) { const b = objects.get(path); return b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: "Object not found" } }; },
  };
  return { objects, storage };
}

/** A quiet run recorder: the job runs, nothing is written. */
const quietRun: NonNullable<PipelineDeps["withRun"]> = async (_opts, fn) => {
  const handle = { id: null, seq: 0, async end() {}, async ok() {}, async fail() {} };
  const report = await fn(async () => handle);
  return report.result ?? null;
};

const SAMPLE: CallInsights = {
  overallSentiment: "positive",
  sentimentConfidence: "high",
  interestLevel: "high",
  summary: "Keen on the role; wants more than the band.",
  suggestedNextStep: "Shortlist for round 1",
  timeline: [{ sentiment: "neutral", note: "Intro", startSeconds: 0, endSeconds: 60, share: 2 }, { sentiment: "positive", note: "Keen", startSeconds: 60, endSeconds: 300, share: 6 }],
  concerns: [{ topic: "salary", note: "Wants 95k", quote: "ninety-five at least", at: 310 }],
  redFlags: [],
  facts: {
    currentInhand: { value: 75000, quote: "seventy-five in hand", at: 262 },
    expectedInhand: { value: null, quote: null, at: null },
    noticePeriodDays: { value: 30, quote: "one month notice", at: 135 },
    location: { value: "Noida", quote: "Noida is fine", at: 65 },
    reasonForChange: { value: "Growth", quote: "growth matters more", at: 362 },
  },
  language: "Hindi + English",
};

describe("calls: upload, pipeline, facts, history", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let storage: CallStorage;
  let objects: Map<string, Buffer>;
  let asha: { id: string; candidateId: string };
  let positionId: string;
  let audioId: string;
  const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    ({ storage, objects } = fakeStorage());
    const { record } = await createRecord(client, ORG, USER, { fullName: "Asha", email: "asha@example.com", role: "AM Operations", location: "Noida", currentInhand: 72000, expectedInhand: 90000, noticePeriodDays: 30 });
    asha = { id: record.id, candidateId: record.candidateId };
    const position = await createPosition(client, ORG, ME, { title: "AM Operations", location: "Noida", jdText: "Runs soft services for a 2 lakh sq ft campus." });
    positionId = position.id;
  });
  beforeEach(() => resetHistoryCheck());
  after(async () => {
    await db.close();
  });

  it("is safe to re-run, and only knows its own statuses", async () => {
    await db.exec(CALLS_MIGRATION);
    await assert.rejects(
      q("insert into public.call_analyses (organization_id, candidate_id, input_kind, status) values ($1, $2, 'audio', 'maybe')", [ORG, asha.candidateId]),
      /status_check/,
    );
    await assert.rejects(q("insert into public.call_analyses (organization_id, input_kind) values ($1, 'audio')", [ORG]), /candidate_subject/);
  });

  it("refuses a recording of the wrong type, over the limit, or without the consent tick", async () => {
    const base = { applicationId: asha.id, consent: true };
    await assert.rejects(prepareCall(client, storage, ORG, ME, { ...base, file: { name: "call.txt", size: 10 } }), /mp3, m4a/);
    await assert.rejects(prepareCall(client, storage, ORG, ME, { ...base, file: { name: "call.m4a", size: 26 * 1024 * 1024 } }), /larger than 25 MB/);
    await assert.rejects(prepareCall(client, storage, ORG, ME, { applicationId: asha.id, consent: false, file: { name: "call.m4a", size: 10 } }), /told the call is recorded/);
    await assert.rejects(prepareCall(client, storage, ORG, ME, { applicationId: asha.id }), /recording or paste/);
    await assert.rejects(prepareCall(client, storage, ORG, ME, { ...base, positionId: "00000000-0000-0000-0000-0000000000ff", file: { name: "call.m4a", size: 10 } }), /position no longer exists/);
    assert.equal((await q<{ n: number }>("select count(*)::int as n from public.call_analyses")).at(0)?.n, 0);
  });

  it("prepares a recording upload, confirms it once the bytes are there, and logs the call", async () => {
    const prepared = await prepareCall(client, storage, ORG, ME, { applicationId: asha.id, positionId, calledOn: "2026-11-16", consent: true, file: { name: "Prakash call.m4a", size: 1234 } });
    audioId = prepared.call.id;
    assert.equal(prepared.call.status, "uploading");
    assert.equal(prepared.call.positionTitle, "AM Operations");
    assert.equal(prepared.call.consentConfirmed, true);
    assert.equal(prepared.upload?.contentType, "audio/mp4");
    assert.match(prepared.upload?.signedUrl ?? "", new RegExp(`${ORG}/${audioId}\\.m4a$`));

    // The bytes have not arrived: the row stays at uploading, and nothing is in the history yet.
    await assert.rejects(confirmCall(client, storage, ORG, ME, audioId), /did not arrive/);
    assert.equal((await listActions(client, ORG, asha.candidateId)).length, 0);

    objects.set(`${ORG}/${audioId}.m4a`, Buffer.alloc(2048));
    const confirmed = await confirmCall(client, storage, ORG, ME, audioId);
    assert.equal(confirmed.status, "uploaded");
    assert.equal(confirmed.fileSize, 2048);
    // Confirming again is harmless.
    assert.equal((await confirmCall(client, storage, ORG, ME, audioId)).status, "uploaded");

    const [logged] = await listActions(client, ORG, asha.candidateId);
    assert.equal(logged.action, "call_logged");
    assert.equal(logged.toValue, "Recording · Prakash call.m4a");
    assert.equal(logged.positionId, positionId);
    assert.deepEqual([logged.meta.callId, logged.meta.calledOn, logged.meta.position], [audioId, "2026-11-16", "AM Operations"]);
    assert.deepEqual((await listCalls(client, ORG, asha.candidateId)).map((c) => c.id), [audioId]);
  });

  it("saves a pasted transcript ready to be read", async () => {
    await assert.rejects(prepareCall(client, storage, ORG, ME, { applicationId: asha.id, transcript: "Hello" }), /whole transcript/);
    const prepared = await prepareCall(client, storage, ORG, ME, { applicationId: asha.id, transcript: "Hello Asha, Shwetha here.\r\nHaan ji, bolo.\nNoida is fine for me.\nOne month notice." });
    assert.equal(prepared.upload, null);
    assert.equal(prepared.call.status, "uploaded");
    assert.equal(prepared.call.inputKind, "transcript");
    const full = await getCall(client, ORG, prepared.call.id);
    assert.equal(full.transcriptText, "Hello Asha, Shwetha here.\nHaan ji, bolo.\nNoida is fine for me.\nOne month notice.");
    const [logged] = await listActions(client, ORG, asha.candidateId);
    assert.deepEqual([logged.action, logged.toValue], ["call_logged", "Transcript pasted"]);
    await deleteCall(client, storage, ORG, prepared.call.id);
  });

  it("transcribes, reads and saves; claims a call only once; keeps the transcript on a re-run", async () => {
    let transcribed = 0;
    const contexts: Parameters<NonNullable<PipelineDeps["analyse"]>>[0][] = [];
    const deps: PipelineDeps = {
      withRun: quietRun,
      transcribe: async (file) => {
        transcribed += 1;
        assert.equal(file.mimeType, "audio/mp4");
        assert.equal(file.bytes.length, 2048);
        return { ok: true, segments: [{ start: 0, end: 5, text: "Hello Asha" }, { start: 5, end: 9, text: "Haan ji, Noida is fine" }], text: "Hello Asha Haan ji, Noida is fine", model: "whisper-large-v3", durationSeconds: 9 };
      },
      analyse: async (ctx) => { contexts.push(ctx); return { result: SAMPLE, model: "anthropic:claude-opus-5-5", usage: { input: 2100, output: 410 } }; },
    };

    const outcome = await runCallAnalysis(client, storage, ORG, audioId, deps);
    assert.deepEqual(outcome, { status: "done" });
    const call = await getCall(client, ORG, audioId);
    assert.equal(call.status, "done");
    assert.equal(call.durationSeconds, 9);
    assert.equal(call.language, "Hindi + English");
    assert.deepEqual(call.segments?.map((s) => s.text), ["Hello Asha", "Haan ji, Noida is fine"]);
    assert.equal(call.result?.overallSentiment, "positive");
    assert.equal(call.result?.facts.currentInhand.value, 75000);
    assert.deepEqual([call.model, call.tokensIn, call.tokensOut, call.attempts], ["anthropic:claude-opus-5-5", 2100, 410, 1]);

    // What the model was told: the record's values, the position's JD, and the stamped transcript.
    assert.equal(contexts.length, 1);
    assert.deepEqual(contexts[0].candidate, { name: "Asha", designation: null, organization: null, location: "Noida", currentInhand: 72000, expectedInhand: 90000, noticePeriodDays: 30 });
    assert.equal(contexts[0].position?.title, "AM Operations");
    assert.match(contexts[0].position?.jdText ?? "", /soft services/);
    assert.equal(contexts[0].transcript, "[0:00] Hello Asha\n[0:05] Haan ji, Noida is fine");

    // Done is done: a second run does nothing.
    assert.deepEqual(await runCallAnalysis(client, storage, ORG, audioId, deps), { status: "skipped", why: "the call is done" });

    // Read again: the transcript is kept, so the recording is not transcribed twice.
    const again = await retryCall(client, ORG, audioId);
    assert.equal(again.status, "uploaded");
    assert.deepEqual(await runCallAnalysis(client, storage, ORG, audioId, deps), { status: "done" });
    assert.equal(transcribed, 1);
    assert.equal(contexts.length, 2);
    assert.equal((await getCall(client, ORG, audioId)).attempts, 2);
  });

  it("records a failed read with a reason, shows a cut-off run as failed after ten minutes, and lets both be retried", async () => {
    const failing: PipelineDeps = { withRun: quietRun, analyse: async () => { throw new Error("no model answered"); } };
    await retryCall(client, ORG, audioId);
    const outcome = await runCallAnalysis(client, storage, ORG, audioId, failing);
    assert.equal(outcome.status, "failed");
    const failed = await getCall(client, ORG, audioId);
    assert.equal(failed.status, "failed");
    assert.match(failed.error ?? "", /could not be read: no model answered/);
    // The earlier result is still there to read while a retry runs.
    assert.equal(failed.result?.overallSentiment, "positive");

    // A run that died mid-way: the row sits at analysing. Fresh, it is left alone; after ten minutes it reads as failed.
    await q("update public.call_analyses set status = 'analysing', updated_at = now() where id = $1", [audioId]);
    assert.deepEqual(await runCallAnalysis(client, storage, ORG, audioId, failing), { status: "skipped", why: "another run is working on it" });
    await assert.rejects(retryCall(client, ORG, audioId), /still being read/);
    assert.equal((await listCalls(client, ORG, asha.candidateId))[0].status, "analysing");
    await q("update public.call_analyses set updated_at = now() - interval '20 minutes' where id = $1", [audioId]);
    const stale = (await listCalls(client, ORG, asha.candidateId))[0];
    assert.equal(stale.status, "failed");
    assert.match(stale.error ?? "", /cut off/);

    // Retried: it claims the stale row and finishes.
    await retryCall(client, ORG, audioId);
    const ok: PipelineDeps = { withRun: quietRun, analyse: async () => ({ result: SAMPLE, model: "anthropic:claude-sonnet-5-5", usage: null }) };
    assert.deepEqual(await runCallAnalysis(client, storage, ORG, audioId, ok), { status: "done" });
    const done = await getCall(client, ORG, audioId);
    assert.deepEqual([done.status, done.error, done.model, done.tokensIn], ["done", null, "anthropic:claude-sonnet-5-5", null]);
  });

  it("applies facts to the record one click at a time, keeps the reason as a remark, and never applies one twice", async () => {
    await assert.rejects(applyCallFacts(client, ORG, ME, audioId, { keys: ["expectedInhand"] }), /not said on the call/);
    await assert.rejects(applyCallFacts(client, ORG, ME, audioId, { keys: ["salary"] }), /which facts/);

    const { call, record } = await applyCallFacts(client, ORG, ME, audioId, { keys: ["currentInhand", "noticePeriodDays"] });
    assert.deepEqual([record?.currentInhand, record?.noticePeriodDays, record?.expectedInhand], [75000, 30, 90000]);
    assert.deepEqual(call.appliedFacts.map((a) => [a.key, a.byName]), [["currentInhand", "Shwetha"], ["noticePeriodDays", "Shwetha"]]);

    const reason = await applyCallFacts(client, ORG, ME, audioId, { keys: ["reasonForChange"] });
    assert.equal(reason.record, null);
    assert.equal(reason.call.appliedFacts.length, 3);
    await assert.rejects(applyCallFacts(client, ORG, ME, audioId, { keys: ["currentInhand"] }), /Already applied/);
    assert.equal((await getRecord(client, ORG, asha.id)).currentInhand, 75000);

    const history = await listActions(client, ORG, asha.candidateId);
    assert.deepEqual(history.slice(0, 2).map((a) => [a.action, a.remark ?? a.meta.fields, a.meta.source]), [
      ["remark", "Reason for change, from the call on 2026-11-16: Growth", "call"],
      ["field_edit", ["currentInhand", "noticePeriodDays"], "call"],
    ]);
    assert.equal(history[1].meta.callId, audioId);
  });

  it("reads a sloppy model answer without inventing anything", () => {
    assert.equal(looksLikeScreening("Sure, here is the JSON"), false);
    assert.equal(looksLikeScreening(JSON.stringify({ overall_sentiment: "positive", facts: {} })), true);
    const parsed = parseCandidateScreening(JSON.stringify({
      overall_sentiment: "ecstatic",
      interest_level: "high",
      summary: "Fine.",
      sentiment_timeline: "none",
      concerns: [{ topic: "money", note: "Wants more", quote: "", at_seconds: 10 }, { topic: "shift", note: "Night shift", quote: "night mein nahi", at_seconds: -5 }],
      facts: { current_inhand: { value: 50, quote: "fifty", at_seconds: 1 }, location: { value: "Noida", quote: "Noida", at_seconds: null } },
    }));
    assert.equal(parsed.overallSentiment, "neutral");
    assert.equal(parsed.sentimentConfidence, "low");
    assert.deepEqual(parsed.timeline, []);
    // No quote, no concern; a bad time is dropped, the concern kept.
    assert.deepEqual(parsed.concerns, [{ topic: "shift", note: "Night shift", quote: "night mein nahi", at: null }]);
    // 50 rupees a month is not a salary: not said.
    assert.equal(parsed.facts.currentInhand.value, null);
    assert.deepEqual(parsed.facts.location, { value: "Noida", quote: "Noida", at: null });
    assert.deepEqual(parsed.facts.reasonForChange, { value: null, quote: null, at: null });
    assert.throws(() => parseCandidateScreening("not json"));
  });

  it("stamps a transcript only when its segments carry times, and cuts a long one", () => {
    assert.equal(stampedTranscript([{ start: 0, end: 4, text: "Hi" }, { start: 65, end: 70, text: "Bye" }], null, 1000), "[0:00] Hi\n[1:05] Bye");
    assert.equal(stampedTranscript(null, "line one\r\n\r\nline two", 1000), "line one\nline two");
    assert.match(stampedTranscript(null, "x".repeat(50), 10), /^x{10}\n\[cut/);
  });

  it("deletes a call: the row is gone from the list and the bytes from the bucket", async () => {
    assert.ok(objects.has(`${ORG}/${audioId}.m4a`));
    await deleteCall(client, storage, ORG, audioId);
    assert.deepEqual(await listCalls(client, ORG, asha.candidateId), []);
    assert.equal(objects.has(`${ORG}/${audioId}.m4a`), false);
    await assert.rejects(getCall(client, ORG, audioId), /no longer exists/);
  });
});
