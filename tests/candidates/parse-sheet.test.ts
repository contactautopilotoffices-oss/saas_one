import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as XLSX from "xlsx";

import { cleanRow, fieldForHeader, needsReview, parseSheet, SheetError } from "../../backend/lib/candidates/parse-sheet";
import { buildSearchText } from "../../backend/lib/candidates/profile";
import { groupPeople, recordKey } from "../../backend/lib/candidates/import";

// The owner's sample rows, verbatim (headers include the double spaces of the original sheet).
const HEADERS = [
  "Sr No.", "Sourcing Date", "Candidate   Source", "Candidate Name", "Email ID", "Phone Number", "Current   Organization",
  "Location", "Current   Designation", "Role", "Total Exp(In)", "Relevant Exp", "Notice Period   (In Days)", "Current In Hand",
  "Expected Inhand", "Remark",
];
const ROWS = [
  [1, "30-06-2026", "Pratyarth Services", "Amit Babu", "er.babu.amit@gmail.com", 7534855802, "MEP Engineer at   Cushman & Wakefield",
    "Noida", "MEP Engineer", "BMS Operator", "4 Yrs", "4 Yrs", "15 Days", "35K", "37K", "Rejected cause budget   issue"],
  [2, "30-06-2026", "Pratyarth Services", "Chiter Sain Singh", "chitersainsingh53@gmail.com", 9599358284, "BuildMyInfra",
    "Noida", "BMS Operator", "BMS Operator", "5 Yrs", "5 Yrs", "30 Days", "25k", "30k", "Not resposnding"],
  [3, "30-06-2026", "Pratyarth Services", "Vignesh Pandit Bhoir", "vbhoir868@@gmail.com", 9604560296, "Lodha Group",
    "Thane", "Building   Supervisor", "Housekeeping   Supervisor", "3 Yrs", "3 Yrs", "15 Days", "25K", "28K", "Not responding"],
];

function xlsxFile(aoa: unknown[][]): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), "Sheet1");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

describe("fieldForHeader", () => {
  it("maps every sample header", () => {
    assert.deepEqual(HEADERS.map(fieldForHeader), [
      null, "sourcingDate", "candidateSource", "fullName", "email", "phone", "currentOrganization", "location",
      "currentDesignation", "role", "totalExp", "relevantExp", "notice", "currentInhand", "expectedInhand", "remark",
    ]);
  });
  it("maps common variants", () => {
    assert.equal(fieldForHeader("Total Experience"), "totalExp");
    assert.equal(fieldForHeader("Mobile No."), "phone");
    assert.equal(fieldForHeader("Current CTC"), "currentInhand");
    assert.equal(fieldForHeader("Expected Salary"), "expectedInhand");
    assert.equal(fieldForHeader("Position"), "role");
    assert.equal(fieldForHeader("Company"), "currentOrganization");
  });
});

describe("parseSheet", () => {
  it("cleans the owner's sample rows", () => {
    const parsed = parseSheet(xlsxFile([HEADERS, ...ROWS]), "Candidates.xlsx");
    assert.equal(parsed.rows.length, 3);
    const [amit, chiter, vignesh] = parsed.rows;

    assert.equal(amit.rowNumber, 2);
    assert.deepEqual(
      { ...amit.clean, status: amit.clean?.status },
      {
        fullName: "Amit Babu",
        email: "er.babu.amit@gmail.com",
        emailKey: "er.babu.amit@gmail.com",
        phone: "7534855802",
        phoneKey: "7534855802",
        currentOrganization: "Cushman & Wakefield",
        currentDesignation: "MEP Engineer",
        location: "Noida",
        totalExpMonths: 48,
        role: "BMS Operator",
        candidateSource: "Pratyarth Services",
        sourcingDate: "2026-06-30",
        relevantExpMonths: 48,
        noticePeriodDays: 15,
        currentInhand: 35000,
        expectedInhand: 37000,
        remark: "Rejected cause budget issue",
        status: "rejected",
      },
    );
    assert.ok(amit.issues.some((issue) => /split/.test(issue)));
    assert.equal(amit.raw["Candidate Name"], "Amit Babu");

    assert.equal(chiter.clean?.status, "not_responding");
    assert.equal(chiter.clean?.expectedInhand, 30000);
    assert.equal(chiter.issues.length, 0);

    // "vbhoir868@@gmail.com" has one obvious repair: fixed automatically, not flagged.
    assert.equal(vignesh.clean?.emailKey, "vbhoir868@gmail.com");
    assert.equal(vignesh.clean?.role, "Housekeeping Supervisor");
    assert.ok(vignesh.issues.some((issue) => issue.startsWith("Fixed: ") && /corrected/.test(issue)));
    assert.equal(needsReview(vignesh.issues), false);
    assert.equal(needsReview(amit.issues), false, "the organisation split is an automatic fix");
  });

  it("finds a header below title rows, skips blank rows, and skips rows with no name", () => {
    const parsed = parseSheet(
      xlsxFile([["Candidate tracker June"], [], HEADERS, ROWS[0], [], [null, null, null, "", "x@y.com"], ROWS[1]]),
      "June.xlsx",
    );
    assert.equal(parsed.rows.length, 3);
    assert.equal(parsed.rows[0].rowNumber, 4);
    assert.equal(parsed.rows[1].clean, null);
    assert.match(parsed.rows[1].issues[0], /No candidate name/);
  });

  it("reads CSV without turning day-first dates around", () => {
    const csv = [HEADERS.join(","), ROWS[1].map((v) => `"${v}"`).join(",")].join("\n");
    const parsed = parseSheet(new TextEncoder().encode(csv), "list.csv");
    assert.equal(parsed.rows[0].clean?.sourcingDate, "2026-06-30");
    assert.equal(parsed.rows[0].clean?.phoneKey, "9599358284");
  });

  it("rejects a sheet without a recognisable header", () => {
    assert.throws(() => parseSheet(xlsxFile([["a", "b"], [1, 2]]), "x.xlsx"), SheetError);
  });
});

describe("cleanRow: real-sheet cases (owner 2026-11-03: too many rows were flagged)", () => {
  const row = (over: Record<string, unknown>) =>
    cleanRow({ fullName: "A", sourcingDate: "30-06-2026", currentInhand: "30K", remark: "Not responding", ...over });

  it("keeps word answers in the remark, unflagged, and takes the status from the remark as written", () => {
    const r = row({ expectedInhand: "Negotiable", notice: "NP ( Negotiable )" });
    assert.equal(r.clean?.expectedInhand, null);
    assert.equal(r.clean?.noticePeriodDays, null);
    assert.equal(r.clean?.remark, "Not responding | Notice period: NP ( Negotiable ) | Expected in-hand: Negotiable");
    assert.equal(r.clean?.status, "not_responding");
    assert.equal(needsReview(r.issues), false);
  });

  it("reads a hike over the current in-hand, and keeps it in the remark when there is no current", () => {
    const r = row({ currentInhand: "58000", expectedInhand: "25% Hike" });
    assert.equal(r.clean?.expectedInhand, 72500);
    assert.equal(needsReview(r.issues), false);
    const none = row({ currentInhand: null, expectedInhand: "30%-40% Hike" });
    assert.equal(none.clean?.expectedInhand, null);
    assert.match(none.clean?.remark ?? "", /Expected in-hand: 30%-40% Hike/);
  });

  it("counts a last working day from the sourcing date", () => {
    assert.equal(row({ notice: "21st july - lwd" }).clean?.noticePeriodDays, 21);
    assert.equal(row({ notice: 46233 }).clean?.noticePeriodDays, 30); // Excel date 2026-07-30
  });

  it("uses the first of two phone numbers and keeps the other in the remark", () => {
    const r = row({ phone: "8879181132/ 9321680850" });
    assert.equal(r.clean?.phoneKey, "8879181132");
    assert.match(r.clean?.remark ?? "", /Other phone: 9321680850/);
    assert.equal(needsReview(r.issues), false);
  });

  it("still flags what needs a person: a yes/no experience, relevant over total", () => {
    assert.equal(needsReview(row({ relevantExp: "yes" }).issues), true);
    assert.equal(needsReview(row({ totalExp: "3 Yrs", relevantExp: "8 Yrs" }).issues), true);
  });
});

describe("de-duplication helpers", () => {
  const row = (emailKey: string | null, phoneKey: string | null) => ({ clean: { emailKey, phoneKey } as never });
  it("groups rows by email or phone", () => {
    assert.deepEqual(groupPeople([row("a@x.com", null), row(null, "9999999999"), row("a@x.com", "9999999999"), row(null, null)]), [0, 1, 0, 2]);
  });
  it("recordKey ignores role case and spacing at the ends", () => {
    assert.equal(recordKey("c1", " BMS Operator "), recordKey("c1", "bms operator"));
    assert.notEqual(recordKey("c1", "BMS Operator"), recordKey("c1", "Supervisor"));
  });
});

describe("buildSearchText", () => {
  it("never includes contact details or salary", () => {
    const text = buildSearchText({
      role: "BMS Operator",
      currentDesignation: "MEP Engineer",
      currentOrganization: "Cushman & Wakefield",
      location: "Noida",
      totalExpMonths: 48,
      relevantExpMonths: 48,
      noticePeriodDays: 15,
      candidateSource: "Pratyarth Services",
      remark: null,
    });
    assert.match(text, /Role sourced for: BMS Operator/);
    assert.match(text, /Relevant experience: 4 years/);
    assert.doesNotMatch(text, /@|7534855802|35000|Remark/);
  });
});
