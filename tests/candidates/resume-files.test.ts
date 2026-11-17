/**
 * Resume files (phase 1) against the real migration in PGlite with a fake storage bucket: preparing uploads (links,
 * duplicates, rejects), confirming, listing with the date / laptop / name filters, the per-laptop summary, download
 * links, delete, the Excel, and the pure pieces the browser shares (which files are offered, the ZIP writer).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

import { daysSince, MAX_RESUME_BYTES, pickVerdict, sinceLastUpload, thisYearRange } from "../../backend/lib/candidates/resume-pick";
import {
  cleanDevice, confirmResumeUploads, deleteResumeFile, downloadName, listResumeFiles, NO_DEVICE, parseResumeQuery,
  prepareResumeUploads, resumeLink, resumeLinks, resumeManifest, resumeSummary, resumeWorkbook,
  type ResumeListQuery, type ResumeStorage,
} from "../../backend/lib/candidates/resumes";
import type { PreparedUpload } from "../../backend/lib/candidates/types";
import { crc32, uniqueZipName, ZipWriter } from "../../frontend/components/candidates/zip-store";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const OTHER_ORG = "00000000-0000-0000-0000-00000000000b";
const USER = "00000000-0000-0000-0000-000000000001";
const USER_INFO = { id: USER, email: "hr@example.com" };
const UPLOAD_BASE = "https://storage.test/upload/";

const sha = (seed: string) => createHash("sha256").update(seed).digest("hex");

/** The slice of a storage bucket the module uses, kept in memory: objects by path. */
function fakeStorage() {
  const objects = new Map<string, number>();
  const signed: { path: string; upsert: boolean | undefined }[] = [];
  const storage: ResumeStorage = {
    async createSignedUploadUrl(path, options) {
      signed.push({ path, upsert: options?.upsert });
      return { data: { signedUrl: `${UPLOAD_BASE}${path}`, token: "t", path }, error: null };
    },
    async createSignedUrl(path, _expiresIn, options) {
      if (!objects.has(path)) return { data: null, error: { message: "Object not found" } };
      return { data: { signedUrl: `https://storage.test/get/${path}?download=${encodeURIComponent(String(options?.download))}` }, error: null };
    },
    async createSignedUrls(paths) {
      return {
        data: paths.map((p) => (objects.has(p) ? { path: p, signedUrl: `https://storage.test/get/${p}`, error: null } : { path: null, signedUrl: "", error: "Object not found" })),
        error: null,
      };
    },
    async list(prefix, options) {
      const rows = [...objects]
        .filter(([p]) => p.startsWith(`${prefix}/`) && (!options?.search || p.includes(options.search)))
        .map(([p, size]) => ({ name: p.slice((prefix ?? "").length + 1), metadata: { size } }));
      return { data: rows, error: null };
    },
    async remove(paths) {
      for (const p of paths) objects.delete(p);
      return { data: [], error: null };
    },
    async download(path) {
      const size = objects.get(path);
      if (size === undefined) return { data: null, error: { message: "Object not found" } };
      return { data: new Blob([new Uint8Array(Math.min(size, 16))]), error: null };
    },
  };
  return { storage, objects, signed, put: (path: string, size: number) => objects.set(path, size) };
}

const pathOf = (p: PreparedUpload) => (p.signedUrl ?? "").slice(UPLOAD_BASE.length);
const q = (over: Partial<ResumeListQuery> = {}): ResumeListQuery => ({ from: null, to: null, q: "", device: null, candidateId: null, link: "", page: 1, pageSize: 50, ...over });

describe("resume files against the real schema", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let store: ReturnType<typeof fakeStorage>;
  const ids: Record<string, string> = {};

  const file = (index: number, name: string, seed: string, over: Record<string, unknown> = {}) => ({
    index, name, size: 120_000, sha256: sha(seed), modifiedAt: "2026-03-10T09:30:00.000Z", folder: "Downloads", ...over,
  });
  const prepare = (files: unknown[], device: string | null = "Roohi's laptop", org = ORG) =>
    prepareResumeUploads(client, store.storage, org, USER_INFO, { device, files });
  /** Pretends the browser sent the bytes, then confirms. */
  const finish = async (prepared: PreparedUpload[], org = ORG) => {
    const sent = prepared.filter((p) => p.outcome === "upload");
    for (const p of sent) store.put(pathOf(p), 120_000);
    return confirmResumeUploads(client, store.storage, org, sent.map((p) => p.id));
  };
  const names = async (query: ResumeListQuery) => (await listResumeFiles(client, ORG, query)).files.map((f) => f.fileName);

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1), ($2)", [ORG, OTHER_ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    store = fakeStorage();
  });
  after(async () => {
    await db.close();
  });

  it("prepare: a link per new file; rejects by type and size; a repeat inside the batch is a duplicate", async () => {
    const { files } = await prepare(
      [
        file(0, "Asha Resume.pdf", "asha"),
        file(1, "setup.exe", "exe"),
        file(2, "huge.pdf", "huge", { size: MAX_RESUME_BYTES + 1 }),
        file(3, "Asha Resume (1).pdf", "asha"),
        file(4, "Bilal CV.docx", "bilal", { folder: "Downloads\\2026" }),
      ],
      "  Roohi's   laptop ",
    );
    assert.deepEqual(files.map((f) => [f.index, f.outcome]), [[0, "upload"], [1, "rejected"], [2, "rejected"], [3, "duplicate"], [4, "upload"]]);
    assert.match(files[1].reason ?? "", /PDF or Word/);
    assert.match(files[2].reason ?? "", /15 MB/);
    assert.equal(files[0].contentType, "application/pdf");
    assert.ok(files[0].id && pathOf(files[0]) === `${ORG}/${files[0].id}.pdf`);
    assert.ok(pathOf(files[4]).endsWith(".docx"));
    assert.ok(store.signed.every((s) => s.upsert === true), "upload links allow a retry to overwrite");
    ids.asha = files[0].id as string;
    ids.bilal = files[4].id as string;

    const { rows } = await db.query<{ status: string; device_label: string; downloaded_at: Date; folder_path: string; uploaded_by_email: string }>(
      "select status, device_label, downloaded_at, folder_path, uploaded_by_email from public.candidate_resume_files where organization_id = $1 order by file_name",
      [ORG],
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.status), ["uploading", "uploading"]);
    assert.equal(rows[0].device_label, "Roohi's laptop");
    assert.equal(rows[0].downloaded_at.toISOString(), "2026-03-10T09:30:00.000Z");
    assert.equal(rows[1].folder_path, "Downloads/2026");
    assert.equal(rows[0].uploaded_by_email, "hr@example.com");
  });

  it("confirm: a file counts only once its bytes are in storage, with the stored size", async () => {
    const none = await confirmResumeUploads(client, store.storage, ORG, [ids.asha, ids.bilal]);
    assert.deepEqual(none, { ready: [], missing: [ids.asha, ids.bilal].sort((a, b) => (none.missing.indexOf(a) - none.missing.indexOf(b))) });
    assert.deepEqual(await names(q()), []);

    store.put(`${ORG}/${ids.asha}.pdf`, 123_456);
    const some = await confirmResumeUploads(client, store.storage, ORG, [ids.asha, ids.bilal]);
    assert.deepEqual(some, { ready: [ids.asha], missing: [ids.bilal] });
    const list = await listResumeFiles(client, ORG, q());
    assert.deepEqual(list.files.map((f) => [f.fileName, f.fileSize, f.deviceLabel]), [["Asha Resume.pdf", 123_456, "Roohi's laptop"]]);
    assert.equal(list.total, 1);

    // Confirming again is harmless; an unknown id is reported missing.
    const again = await confirmResumeUploads(client, store.storage, ORG, [ids.asha, "00000000-0000-0000-0000-00000000dead"]);
    assert.deepEqual(again, { ready: [ids.asha], missing: ["00000000-0000-0000-0000-00000000dead"] });
  });

  it("the same file again is a duplicate in this organisation only; an unfinished upload is reused on retry", async () => {
    const { files } = await prepare([file(0, "asha-from-sahil.pdf", "asha"), file(1, "Bilal CV.docx", "bilal")], "Sahil's laptop");
    assert.deepEqual(files.map((f) => [f.outcome, f.id]), [["duplicate", ids.asha], ["upload", ids.bilal]]);
    assert.equal((await db.query("select count(*)::int as n from public.candidate_resume_files")).rows.length, 1);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.candidate_resume_files where organization_id = $1", [ORG]);
    assert.equal(rows[0].n, 2, "no second row for the retried file");

    const other = await prepare([file(0, "asha.pdf", "asha")], "Roohi's laptop", OTHER_ORG);
    assert.equal(other.files[0].outcome, "upload");
    assert.notEqual(other.files[0].id, ids.asha);
    ids.otherAsha = other.files[0].id as string;
    await finish(other.files, OTHER_ORG);
    assert.deepEqual(await names(q()), ["Asha Resume.pdf"], "the other organisation's copy stays out of this list");
  });

  it("list: newest download first, with the date, laptop and name filters, per page", async () => {
    const more = await prepare(
      [
        file(0, "Farah report.pdf", "farah", { modifiedAt: "2025-12-31T18:00:00.000Z" }),
        file(1, "Hari.doc", "hari", { modifiedAt: "not a date" }),
      ],
      "Sahil's laptop",
    );
    await finish(more.files);
    // A file from before the laptop became required (owner 2026-11-11) has no name; the "Not named" filter still finds it.
    const g = await prepare([file(0, "Gauri CV.pdf", "gauri", { modifiedAt: "2026-06-01T05:00:00.000Z" })], "Some laptop");
    await finish(g.files);
    await db.query("update public.candidate_resume_files set device_label = null where id = $1", [g.files[0].id]);
    const retry = await prepare([file(0, "Bilal CV.docx", "bilal")], "Sahil's laptop");
    await finish(retry.files);

    assert.deepEqual(await names(q()), ["Gauri CV.pdf", "Asha Resume.pdf", "Bilal CV.docx", "Farah report.pdf", "Hari.doc"]);
    assert.deepEqual(await names(q({ from: "2026-01-01T00:00:00.000Z" })), ["Gauri CV.pdf", "Asha Resume.pdf", "Bilal CV.docx"]);
    assert.deepEqual(await names(q({ from: "2026-01-01T00:00:00.000Z", to: "2026-03-31T23:59:59.999Z" })), ["Asha Resume.pdf", "Bilal CV.docx"]);
    assert.deepEqual(await names(q({ device: "Sahil's laptop" })), ["Bilal CV.docx", "Farah report.pdf", "Hari.doc"]);
    assert.deepEqual(await names(q({ device: NO_DEVICE })), ["Gauri CV.pdf"]);
    assert.deepEqual(await names(q({ q: "REPORT" })), ["Farah report.pdf"]);
    assert.deepEqual(await names(q({ q: "%" })), [], "a wildcard in the search is a plain character");

    const page2 = await listResumeFiles(client, ORG, q({ page: 2, pageSize: 2 }));
    assert.deepEqual(page2.files.map((f) => f.fileName), ["Bilal CV.docx", "Farah report.pdf"]);
    assert.deepEqual([page2.total, page2.page, page2.pageSize], [5, 2, 2]);
    const hari = (await listResumeFiles(client, ORG, q({ q: "hari" }))).files[0];
    assert.equal(hari.downloadedAt, null);
    assert.equal(hari.fileType, "application/msword");
  });

  it("summary: files, bytes and dates per laptop, and in all", async () => {
    const s = await resumeSummary(client, ORG);
    assert.deepEqual(
      s.devices.map((d) => [d.label, d.count]),
      [["Roohi's laptop", 1], ["Sahil's laptop", 3], [null, 1]],
    );
    assert.equal(s.total, 5);
    assert.equal(s.totalBytes, 123_456 + 4 * 120_000);
    assert.equal(s.oldest, "2025-12-31T18:00:00.000Z");
    assert.equal(s.newest, "2026-06-01T05:00:00.000Z");
    assert.deepEqual(s.linked, 0, "nothing has been read yet");
    assert.ok(s.devices.every((d) => typeof d.lastUploadedAt === "string"), "each laptop knows when it last uploaded");
    assert.equal(s.textPending, 5);
    assert.deepEqual(await resumeSummary(client, "00000000-0000-0000-0000-00000000000c"), {
      total: 0, totalBytes: 0, devices: [], oldest: null, newest: null, linked: 0, unlinked: 0, textPending: 0, scanPending: 0, unreadable: 0, rejected: 0, other: 0, extractPending: 0,
    });
  });

  it("links: only files of this organisation that are ready; one link names the download", async () => {
    const pending = await prepare([file(0, "Pending.pdf", "pending")]);
    const { links } = await resumeLinks(client, store.storage, ORG, [ids.asha, pending.files[0].id, ids.otherAsha, ids.bilal]);
    assert.deepEqual(links.map((l) => l.id).sort(), [ids.asha, ids.bilal].sort());
    assert.ok(links.every((l) => l.url.startsWith("https://storage.test/get/")));

    const one = await resumeLink(client, store.storage, ORG, ids.asha);
    assert.equal(one.fileName, "Asha Resume.pdf");
    assert.match(one.url, /download=Asha%20Resume\.pdf$/);
    await assert.rejects(resumeLink(client, store.storage, ORG, ids.otherAsha), /no longer here/);
    await assert.rejects(resumeLink(client, store.storage, ORG, "nope"), /uuid/);
    await assert.rejects(resumeLinks(client, store.storage, ORG, []), /1 to 100/);
  });

  it("manifest and Excel come from the same filters", async () => {
    const m = await resumeManifest(client, ORG, q({ device: "Sahil's laptop" }));
    assert.deepEqual(m.files.map((f) => f.fileName), ["Bilal CV.docx", "Farah report.pdf", "Hari.doc"]);
    assert.equal(m.truncated, false);

    const { workbook, count } = await resumeWorkbook(client, ORG, q(), "https://portal.test/api/candidates/resumes");
    assert.equal(count, 5);
    const sheet = workbook.getWorksheet("Resume files");
    assert.ok(sheet);
    assert.equal(sheet.rowCount, 6);
    assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1), ["#", "File name", "Type", "Size (KB)", "Downloaded on", "Laptop", "Folder", "Uploaded by", "Uploaded on", "Candidate", "Matched by", "Text", "Open"]);
    const first = sheet.getRow(2);
    assert.equal(first.getCell(2).value, "Gauri CV.pdf");
    assert.equal(first.getCell(3).value, "PDF");
    assert.ok(first.getCell(5).value instanceof Date);
    assert.equal(first.getCell(12).value, "Reading soon");
    const link = first.getCell(13).value as { text: string; hyperlink: string };
    assert.equal(link.text, "Open resume");
    assert.match(link.hyperlink, new RegExp(`^https://portal.test/api/candidates/resumes/[0-9a-f-]{36}\\?orgId=${ORG}$`));
    const totals = workbook.getWorksheet("Summary");
    assert.ok(totals);
    assert.equal(totals.getRow(totals.rowCount).getCell(1).value, "All laptops");
    assert.equal(totals.getRow(totals.rowCount).getCell(2).value, 5);

    // Round trip through the file format the route sends.
    const buffer = await workbook.xlsx.writeBuffer();
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(buffer as never);
    assert.equal(read.getWorksheet("Resume files")?.rowCount, 6);
  });

  it("delete removes the stored file and its row", async () => {
    await deleteResumeFile(client, store.storage, ORG, ids.asha);
    assert.equal(store.objects.has(`${ORG}/${ids.asha}.pdf`), false);
    assert.deepEqual(await names(q({ q: "asha" })), []);
    await assert.rejects(deleteResumeFile(client, store.storage, ORG, ids.asha), /no longer here/);
    await assert.rejects(deleteResumeFile(client, store.storage, ORG, ids.otherAsha), /no longer here/, "another organisation's file cannot be deleted from here");
    assert.ok(store.objects.has(`${OTHER_ORG}/${ids.otherAsha}.pdf`));
  });

  it("rejects a bad prepare body", async () => {
    await assert.rejects(prepare([]), /files/);
    await assert.rejects(prepare([{ index: 0, name: "x.pdf", size: 1, sha256: "short" }]), /files/);
    // Owner 2026-11-11: an upload is always filed under a person (the route takes the name from the login).
    await assert.rejects(prepare([file(0, "No name.pdf", "noname")], null), /cannot be filed under a name/);
    await assert.rejects(prepare([file(0, "No name.pdf", "noname")], "   "), /cannot be filed under a name/);
  });

  // Owner 2026-11-12: several people upload at once. Two of them can prepare the same file in the same instant: both
  // find no row and both insert, and the unique index (organisation + content hash) refuses the second insert.
  it("two people preparing the same file in the same instant: the second batch still goes through, the file is stored once", async () => {
    let raced = false;
    // The second person's client: just before its insert lands, the first person's whole prepare runs.
    const racing = new Proxy(client, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (prop !== "from") return typeof value === "function" ? value.bind(target) : value;
        return (table: string) => {
          const query = target.from(table);
          if (table !== "candidate_resume_files" || raced) return query;
          return new Proxy(query, {
            get(q, p) {
              const v = Reflect.get(q, p);
              if (p !== "insert") return typeof v === "function" ? v.bind(q) : v;
              return (rows: unknown) => {
                raced = true;
                const first = prepareResumeUploads(client, store.storage, ORG, USER_INFO, { device: "First laptop", files: [file(0, "Chetan Rao.pdf", "chetan")] });
                return first.then(() => (q as unknown as { insert(r: unknown): PromiseLike<unknown> }).insert(rows));
              };
            },
          });
        };
      },
    }) as SupabaseClient;
    const second = await prepareResumeUploads(racing, store.storage, ORG, USER_INFO, {
      device: "Second laptop", files: [file(0, "Chetan_Rao_Naukri.pdf", "chetan"), file(1, "Divya Menon.pdf", "divya")],
    });
    assert.equal(raced, true, "the race was staged");
    assert.deepEqual(second.files.map((f) => f.outcome), ["upload", "upload"], "neither file of the second batch is lost");
    const { rows } = await db.query<{ id: string; sha256: string }>(
      "select id, sha256 from public.candidate_resume_files where organization_id = $1 and sha256 = any($2)", [ORG, [sha("chetan"), sha("divya")]],
    );
    assert.equal(rows.length, 2, "one row per file");
    assert.equal(second.files[0].id, rows.find((r) => r.sha256 === sha("chetan"))?.id, "the shared file goes to the row that already exists");
    // Both people finish; the file counts once.
    const done = await finish(second.files);
    assert.equal(done.ready.length, 2);
  });
});

describe("resume query and names", () => {
  it("reads the list query with safe bounds", () => {
    const p = parseResumeQuery(new URLSearchParams({ from: "2026-01-01", to: "garbage", q: "  cv ", device: " Roohi's laptop ", page: "0", pageSize: "9999" }));
    assert.deepEqual(p, { from: "2026-01-01T00:00:00.000Z", to: null, q: "cv", device: "Roohi's laptop", candidateId: null, link: "", page: 1, pageSize: 200 });
    assert.deepEqual(parseResumeQuery(new URLSearchParams()), { from: null, to: null, q: "", device: null, candidateId: null, link: "", page: 1, pageSize: 100 });
    const l = parseResumeQuery(new URLSearchParams({ candidateId: "00000000-0000-0000-0000-00000000000A", link: "unlinked" }));
    assert.equal(l.candidateId, "00000000-0000-0000-0000-00000000000a");
    assert.equal(l.link, "unlinked");
    assert.equal(parseResumeQuery(new URLSearchParams({ candidateId: "nope", link: "maybe" })).candidateId, null);
  });

  it("cleans the laptop name and the download name", () => {
    assert.equal(cleanDevice("  Roohi's \n laptop "), "Roohi's laptop");
    assert.equal(cleanDevice(""), null);
    assert.equal(cleanDevice(42), null);
    assert.equal(downloadName('a/b:c*"resume".pdf', "application/pdf"), "a b c resume.pdf");
    assert.equal(downloadName("noext", "application/pdf"), "noext.pdf");
    assert.equal(downloadName("   .docx", "x"), "resume.docx");
  });
});

describe("which files are offered as resumes", () => {
  const range = { from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 11, 31) };
  const f = (name: string, over: Partial<{ size: number; lastModified: number }> = {}) => ({ name, size: 200_000, lastModified: Date.UTC(2026, 5, 1), ...over });

  it("ticks PDF and Word files downloaded in the range that are not named like other documents", () => {
    assert.equal(pickVerdict(f("Asha Resume.pdf"), range), "ok");
    assert.equal(pickVerdict(f("Bilal_CV.DOCX"), range), "ok");
    assert.equal(pickVerdict(f("Chitra.doc"), range), "ok");
    assert.equal(pickVerdict(f("photo.jpg"), range), "type");
    assert.equal(pickVerdict(f("big.pdf", { size: MAX_RESUME_BYTES + 1 }), range), "size");
    assert.equal(pickVerdict(f("empty.pdf", { size: 0 }), range), "size");
    assert.equal(pickVerdict(f("old.pdf", { lastModified: Date.UTC(2025, 11, 31) }), range), "date");
    assert.equal(pickVerdict(f("Invoice_1023.pdf"), range), "name");
    assert.equal(pickVerdict(f("623c607b64039647485013_GET_JD_Digital_Foundation.pdf"), range), "name", "a portal's random code and JD");
    assert.equal(pickVerdict(f("Offer Vineet.pdf"), range), "name");
    assert.equal(pickVerdict(f("aadhaar card.pdf"), range), "name");
    assert.equal(pickVerdict(f("Salary Slip Oct.pdf"), range), "name");
    assert.equal(pickVerdict(f("Billing Manager Resume.pdf"), range), "ok", "a word inside another word does not count");
  });

  it("this year's range runs from 1 January to the end of today", () => {
    const r = thisYearRange(new Date(2026, 10, 7, 15, 30));
    assert.equal(new Date(r.from).getTime(), new Date(2026, 0, 1).getTime());
    assert.equal(new Date(r.to).getTime(), new Date(2026, 10, 7, 23, 59, 59, 999).getTime());
  });

  it("the next upload starts a day before the newest download already uploaded; a first run takes the year", () => {
    const now = new Date(2026, 10, 10, 9, 0);
    const since = sinceLastUpload("2026-11-08T06:30:00.000Z", now);
    assert.equal(since.from, new Date("2026-11-07T06:30:00.000Z").getTime());
    assert.equal(since.to, thisYearRange(now).to);
    assert.deepEqual(sinceLastUpload(null, now), thisYearRange(now));
    assert.deepEqual(sinceLastUpload("garbage", now), thisYearRange(now));
    assert.equal(daysSince("2026-11-01T12:00:00.000Z", new Date("2026-11-10T09:00:00.000Z")), 8);
    assert.equal(daysSince(null), 0);
  });
});

describe("store-only ZIP writer", () => {
  const le32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
  const le16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);

  it("computes CRC-32", () => {
    assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
    assert.equal(crc32(new Uint8Array(0)), 0);
  });

  it("writes entries, a central directory and the end record", async () => {
    const chunks: Uint8Array[] = [];
    const zip = new ZipWriter((c) => { chunks.push(c); });
    const a = new TextEncoder().encode("hello");
    const b = new TextEncoder().encode("résumé");
    await zip.add("a.txt", a, new Date(2026, 2, 10, 9, 30));
    await zip.add("Résumé ✓.pdf", b, new Date(1970, 0, 1));
    await zip.finish();
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    assert.equal(zip.entries, 2);
    assert.equal(zip.bytes, out.length);

    assert.equal(le32(out, 0), 0x04034b50);
    assert.equal(le16(out, 8), 0, "stored, not compressed");
    assert.equal(le32(out, 14), crc32(a));
    assert.equal(le32(out, 18), a.length);
    assert.equal(le16(out, 26), 5);
    const second = 30 + 5 + a.length;
    assert.equal(le32(out, second), 0x04034b50);
    assert.equal(le16(out, second + 12), (1980 - 1980) << 9 | (1 << 5) | 1, "dates before 1980 are clamped");

    const end = out.length - 22;
    assert.equal(le32(out, end), 0x06054b50);
    assert.equal(le16(out, end + 10), 2);
    const cdOffset = le32(out, end + 16);
    const cdSize = le32(out, end + 12);
    assert.equal(cdOffset, second + 30 + new TextEncoder().encode("Résumé ✓.pdf").length + b.length);
    assert.equal(cdOffset + cdSize, end);
    assert.equal(le32(out, cdOffset), 0x02014b50);
    assert.equal(le16(out, cdOffset + 8), 0x0800, "names are UTF-8");
    assert.equal(le32(out, cdOffset + 42), 0, "first entry starts at 0");
  });

  it("gives repeated names a number and drops path separators", () => {
    const used = new Set<string>();
    assert.equal(uniqueZipName("a.pdf", used), "a.pdf");
    assert.equal(uniqueZipName("A.PDF", used), "A (2).PDF");
    assert.equal(uniqueZipName("a.pdf", used), "a (3).pdf");
    assert.equal(uniqueZipName("sub/dir\\b", used), "sub_dir_b");
    assert.equal(uniqueZipName("  ", used), "file");
  });
});
