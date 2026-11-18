/**
 * The JD library (owner 2026-11-17; migration 20261117000002): a JD per role, every saved text kept as a numbered
 * version that is never edited, copies, soft deletes, and the version each position was opened from. Against the
 * real migrations in PGlite.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createJd, deleteJd, duplicateJd, getJd, jdLinksFor, linkPositionJd, listJds, updateJd } from "../../backend/lib/candidates/jd-library";
import { createPosition, getPosition, listPositions } from "../../backend/lib/candidates/positions";

import { freshDb, JD_LIBRARY_MIGRATION } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const ME = { id: USER, name: "Shwetha" };
const JD_V1 = "Senior Technical Executive. Maintain MEP systems, HVAC and BMS across the site. 5 to 8 years in facilities.";
const JD_V2 = `${JD_V1} Must hold an electrical supervisor licence.`;

describe("the JD library", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let jdId: string;
  const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
  });
  after(async () => {
    await db.close();
  });

  it("is safe to re-run", async () => {
    await db.exec(JD_LIBRARY_MIGRATION);
  });

  it("saves a JD as version 1 and refuses an empty or untitled one", async () => {
    await assert.rejects(createJd(client, ORG, ME, { title: "", content: JD_V1 }), /title/);
    await assert.rejects(createJd(client, ORG, ME, { title: "Sr TE", content: "too short" }), /whole job description/);
    const jd = await createJd(client, ORG, ME, { title: "Sr Technical Executive", department: "Facilities", content: JD_V1, fileName: "Sr_TE.pdf" });
    jdId = jd.id;
    assert.deepEqual([jd.currentVersion, jd.versions.length, jd.versions[0].version, jd.versions[0].byName, jd.versions[0].fileName], [1, 1, 1, "Shwetha", "Sr_TE.pdf"]);
    assert.match(jd.preview, /^Senior Technical Executive/);
    assert.deepEqual((await listJds(client, ORG)).map((j) => [j.title, j.currentVersion, j.positions]), [["Sr Technical Executive", 1, 0]]);
  });

  it("adds a version only when the text changes, and keeps every earlier one", async () => {
    const renamed = await updateJd(client, ORG, ME, jdId, { title: "Senior Technical Executive", content: JD_V1 });
    assert.deepEqual([renamed.title, renamed.currentVersion, renamed.versions.length], ["Senior Technical Executive", 1, 1], "same text: no new version");
    const edited = await updateJd(client, ORG, ME, jdId, { content: JD_V2, note: "Licence added" });
    assert.deepEqual(edited.versions.map((v) => [v.version, v.note]), [[2, "Licence added"], [1, null]]);
    assert.equal(edited.currentVersion, 2);
    assert.equal(edited.versions[1].content, JD_V1, "version 1 is unchanged");
    // A saved version is history: the database refuses to edit or delete it.
    await assert.rejects(q("update public.candidate_jd_versions set content = 'x' where jd_id = $1", [jdId]), /insert-only/);
    await assert.rejects(q("delete from public.candidate_jd_versions where jd_id = $1", [jdId]), /insert-only/);
  });

  it("copies a JD's current text as a new JD for a similar role", async () => {
    const copy = await duplicateJd(client, ORG, ME, jdId, "Technical Executive");
    assert.deepEqual([copy.title, copy.currentVersion, copy.versions[0].content, copy.versions[0].note], ["Technical Executive", 1, JD_V2, "Copied from Senior Technical Executive v2"]);
    assert.equal((await duplicateJd(client, ORG, ME, jdId)).title, "Senior Technical Executive (copy)");
    assert.deepEqual((await listJds(client, ORG, "technical executive (")).map((j) => j.title), ["Senior Technical Executive (copy)"]);
  });

  it("records which version a position was opened from, and keeps it after the JD changes", async () => {
    const position = await createPosition(client, ORG, ME, { title: "Sr TE · Bengaluru", jdText: JD_V2 });
    const link = await linkPositionJd(client, ORG, ME, { id: position.id, title: position.title, department: null, jdText: JD_V2, jdFileName: null }, { jdId, version: 2 });
    assert.deepEqual(link, { jd: { id: jdId, title: "Senior Technical Executive", version: 2, currentVersion: 2 }, notice: null });
    await updateJd(client, ORG, ME, jdId, { content: `${JD_V2} Night shifts on rotation.` });
    assert.deepEqual((await getPosition(client, ORG, position.id)).jd, { id: jdId, title: "Senior Technical Executive", version: 2, currentVersion: 3 });
    const jd = await getJd(client, ORG, jdId);
    assert.deepEqual(jd.usedBy.map((u) => [u.title, u.version]), [["Sr TE · Bengaluru", 2]]);
    assert.ok(jd.lastUsedAt);
    assert.equal((await listJds(client, ORG)).find((j) => j.id === jdId)?.positions, 1);
    // A version that does not exist is not recorded.
    assert.match((await linkPositionJd(client, ORG, ME, { id: position.id, title: position.title, department: null, jdText: null, jdFileName: null }, { jdId, version: 9 })).notice ?? "", /no version 9/);
  });

  it("saves a pasted JD to the library from a position, as a new JD or the next version", async () => {
    const pasted = "Assistant Manager, Business Development. Coworking and managed office sales in Noida. 5 to 7 years.";
    const position = await createPosition(client, ORG, ME, { title: "AM Business Development", department: "Sales", jdText: pasted });
    const fresh = await linkPositionJd(client, ORG, ME, { id: position.id, title: position.title, department: "Sales", jdText: pasted, jdFileName: null }, { save: true });
    assert.deepEqual([fresh.jd?.title, fresh.jd?.version], ["AM Business Development", 1]);
    const again = await linkPositionJd(client, ORG, ME, { id: position.id, title: position.title, department: "Sales", jdText: `${pasted} Hybrid.`, jdFileName: null }, { jdId: fresh.jd!.id, save: true });
    assert.equal(again.jd?.version, 2);
    // One link per position: the later one replaced the first.
    assert.equal((await q<{ n: number }>("select count(*)::int as n from public.candidate_jd_uses where position_id = $1", [position.id]))[0].n, 1);
    assert.equal((await listPositions(client, ORG, "all")).find((p) => p.id === position.id)?.jd?.version, 2);
    // Nothing asked: nothing done.
    assert.deepEqual(await linkPositionJd(client, ORG, ME, { id: position.id, title: position.title, department: null, jdText: pasted, jdFileName: null }, undefined), { jd: null, notice: null });
    assert.equal((await getPosition(client, ORG, position.id)).jd?.version, 2);
    // "Unlink" on an edit removes the link; the JD stays in the library.
    await linkPositionJd(client, ORG, ME, { id: position.id, title: position.title, department: null, jdText: pasted, jdFileName: null }, { jdId: null });
    assert.equal((await getPosition(client, ORG, position.id)).jd, null);
    assert.ok(await getJd(client, ORG, fresh.jd!.id));
  });

  it("takes a JD out of the library without touching its versions or positions", async () => {
    await deleteJd(client, ORG, jdId);
    assert.equal((await listJds(client, ORG)).some((j) => j.id === jdId), false);
    await assert.rejects(getJd(client, ORG, jdId), /no longer in the library/);
    assert.equal((await q<{ n: number }>("select count(*)::int as n from public.candidate_jd_versions where jd_id = $1", [jdId]))[0].n, 3);
    assert.equal((await jdLinksFor(client, ORG, [(await listPositions(client, ORG, "all")).find((p) => p.title === "Sr TE · Bengaluru")!.id])).size, 1);
  });
});
