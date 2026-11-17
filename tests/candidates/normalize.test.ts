import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cleanText,
  FIXED_PREFIX,
  isFixedNote,
  parseExpectedHike,
  formatMonths,
  parseDate,
  parseEmail,
  parseExperienceMonths,
  parseNoticeDays,
  parsePhone,
  parseRupeesMonthly,
  sheetNameKey,
  splitOrganization,
  statusFromRemark,
} from "../../backend/lib/candidates/normalize";

describe("cleanText", () => {
  it("trims, collapses spaces, and nulls placeholders", () => {
    assert.equal(cleanText("  Amit   Babu "), "Amit Babu");
    for (const empty of ["", " ", "-", "NA", "n/a", "nil", null, undefined]) assert.equal(cleanText(empty), null);
  });
});

describe("parseExperienceMonths", () => {
  const months = (v: unknown) => parseExperienceMonths(v).value;
  it("reads the sample sheet's values", () => {
    assert.equal(months("4 Yrs"), 48);
    assert.equal(months("5 Yrs"), 60);
    assert.equal(months("3 Yrs"), 36);
  });
  it("reads other common forms", () => {
    assert.equal(months("4.5 years"), 54);
    assert.equal(months("4 yrs 6 months"), 54);
    assert.equal(months("4y 6m"), 54);
    assert.equal(months("6 months"), 6);
    assert.equal(months("Fresher"), 0);
    assert.equal(months("4"), 48);
    assert.equal(months(4), 48);
    assert.equal(months("3+ yrs"), 36);
    assert.equal(months(""), null);
  });
  it("fixes ranges automatically and flags unreadable text", () => {
    const range = parseExperienceMonths("4-5 yrs");
    assert.equal(range.value, 48);
    assert.match(range.note ?? "", /range/);
    assert.equal(range.issue, undefined);
    const junk = parseExperienceMonths("lots");
    assert.equal(junk.value, null);
    assert.match(junk.issue ?? "", /could not be read/);
  });
});

describe("parseNoticeDays", () => {
  const days = (v: unknown) => parseNoticeDays(v).value;
  it("reads the sample sheet's values", () => {
    assert.equal(days("15 Days"), 15);
    assert.equal(days("30 Days"), 30);
  });
  it("reads months, weeks and immediate", () => {
    assert.equal(days("Immediate"), 0);
    assert.equal(days("1 month"), 30);
    assert.equal(days("2 Months"), 60);
    assert.equal(days("1 week"), 7);
    assert.equal(days(45), 45);
    assert.equal(days("90"), 90);
  });
  it("uses the upper end of a range (fixed automatically)", () => {
    const r = parseNoticeDays("15-30 days");
    assert.equal(r.value, 30);
    assert.match(r.note ?? "", /range/);
  });
  it("reads immediate as typed in a hurry", () => {
    for (const v of ["immedaite joiner", "Imidiate", "immediately", "Immediate"]) assert.equal(days(v), 0, v);
  });
  it("counts a last working day from the reference date", () => {
    const named = parseNoticeDays("21st july - lwd", "2026-06-30");
    assert.equal(named.value, 21);
    assert.match(named.note ?? "", /last working day 2026-07-21/);
    assert.equal(parseNoticeDays("30th Jul LWD", "2026-06-30").value, 30);
    assert.equal(parseNoticeDays("15/07/2026", "2026-06-30").value, 15);
    assert.equal(parseNoticeDays(46234, "2026-06-30").value, 31, "Excel date 2026-07-31");
    const past = parseNoticeDays("1st june lwd", "2026-06-30");
    assert.equal(past.value, 0);
    assert.match(past.note ?? "", /before the sourcing date/);
    assert.ok(parseNoticeDays("1 jan 2028", "2026-06-30").issue, "more than a year away is flagged");
  });
  it("keeps word answers as text", () => {
    for (const v of ["np ( negotiable )", "As per company norms", "Negotiable"]) {
      const r = parseNoticeDays(v);
      assert.equal(r.value, null);
      assert.equal(r.text, v);
      assert.equal(r.issue, undefined);
    }
  });
  it("flags serving notice", () => {
    assert.match(parseNoticeDays("Serving notice").issue ?? "", /serving/);
  });
});

describe("parseRupeesMonthly", () => {
  const rupees = (v: unknown) => parseRupeesMonthly(v).value;
  it("reads K amounts in any case or spacing (owner: monthly in-hand)", () => {
    assert.equal(rupees("35K"), 35000);
    assert.equal(rupees("25k"), 25000);
    assert.equal(rupees("35 K"), 35000);
    assert.equal(rupees("37.5K"), 37500);
  });
  it("reads plain amounts", () => {
    assert.equal(rupees("35,000"), 35000);
    assert.equal(rupees("₹ 35000"), 35000);
    assert.equal(rupees("Rs. 28000/-"), 28000);
    assert.equal(rupees(30000), 30000);
  });
  it("treats lakh amounts as per year (fixed automatically; flagged under 1.5 lakh)", () => {
    const r = parseRupeesMonthly("3.6 LPA");
    assert.equal(r.value, 30000);
    assert.match(r.note ?? "", /per year/);
    assert.equal(r.issue, undefined);
    assert.equal(rupees("4 lakh"), 33333);
    assert.match(parseRupeesMonthly("1L").issue ?? "", /check it was not per month/);
  });
  it("reads routine shorthand automatically and flags real guesses", () => {
    assert.equal(parseRupeesMonthly("35").value, 35000);
    assert.match(parseRupeesMonthly("35").note ?? "", /thousands/);
    assert.equal(parseRupeesMonthly("30 in hand").value, 30000);
    assert.equal(parseRupeesMonthly("30+K").value, 30000);
    assert.equal(parseRupeesMonthly("360000").value, 30000);
    assert.match(parseRupeesMonthly("0.3").issue ?? "", /lakh/);
  });
  it("keeps words in the remark instead of flagging them", () => {
    for (const v of ["Negotiable", "As per company Norms", "abc", "Rejected/ Lack of exp in FE"]) {
      const r = parseRupeesMonthly(v);
      assert.equal(r.value, null, v);
      assert.equal(r.text, v, v);
      assert.equal(r.issue, undefined, v);
    }
  });
  it("reads CTC amounts and says they are CTC", () => {
    const r = parseRupeesMonthly("40 ctc");
    assert.equal(r.value, 40000);
    assert.match(r.note ?? "", /CTC, not in-hand/);
    assert.equal(r.text, "40 ctc");
  });
});

describe("parseExpectedHike", () => {
  it("adds the lower percentage to the current in-hand", () => {
    assert.equal(parseExpectedHike("30% Hike", 30000)?.value, 39000);
    assert.equal(parseExpectedHike("30%-40% Hike", 30000)?.value, 39000);
    assert.equal(parseExpectedHike("35%-40%", 20000)?.value, 27000);
    assert.equal(parseExpectedHike("30% Hike", null)?.value, null);
    assert.equal(parseExpectedHike("35K", 30000), null, "not a hike");
    assert.equal(parseExpectedHike("30", 30000), null, "a bare number is not a hike");
  });
});

describe("FIXED_PREFIX", () => {
  it("marks automatic fixes apart from issues", () => {
    assert.equal(isFixedNote(FIXED_PREFIX + "x"), true);
    assert.equal(isFixedNote("Email is not valid"), false);
  });
});

describe("parseDate", () => {
  it("reads day-first Indian dates", () => {
    assert.equal(parseDate("30-06-2026").value, "2026-06-30");
    assert.equal(parseDate("30/06/2026").value, "2026-06-30");
    assert.equal(parseDate("1.7.26").value, "2026-07-01");
  });
  it("reads ISO, month names and Excel serials", () => {
    assert.equal(parseDate("2026-06-30").value, "2026-06-30");
    assert.equal(parseDate("30 Jun 2026").value, "2026-06-30");
    assert.equal(parseDate(46203).value, "2026-06-30");
  });
  it("rejects impossible dates", () => {
    assert.equal(parseDate("31-02-2026").value, null);
    assert.equal(parseDate("06-30-2026").value, null);
  });
});

describe("parseEmail / parsePhone", () => {
  it("keys valid emails in lower case and flags invalid ones", () => {
    assert.deepEqual(parseEmail("Er.Babu.Amit@Gmail.com"), { value: "Er.Babu.Amit@Gmail.com", key: "er.babu.amit@gmail.com" });
    const repaired = parseEmail("vbhoir868@@gmail.com");
    assert.equal(repaired.value, "vbhoir868@gmail.com");
    assert.equal(repaired.key, "vbhoir868@gmail.com");
    assert.match(repaired.note ?? "", /corrected/);
    assert.equal(parseEmail("a@b,com").key, "a@b.com");
    const bad = parseEmail("not-an-email");
    assert.equal(bad.key, null);
    assert.match(bad.issue ?? "", /not a valid/);
  });
  it("keys 10-digit Indian mobiles", () => {
    assert.equal(parsePhone(7534855802).key, "7534855802");
    assert.equal(parsePhone("+91 95993 58284").key, "9599358284");
    assert.equal(parsePhone("09604560296").key, "9604560296");
    const bad = parsePhone("12345");
    assert.equal(bad.key, null);
    assert.ok(bad.issue);
  });
  it("uses the first mobile when a cell has two", () => {
    const two = parsePhone("8318014421 / 9721868252");
    assert.equal(two.key, "8318014421");
    assert.deepEqual(two.extra, ["9721868252"]);
    assert.ok(two.note);
    assert.equal(two.issue, undefined);
  });
});

describe("splitOrganization", () => {
  it("splits 'MEP Engineer at Cushman & Wakefield'", () => {
    const r = splitOrganization("MEP Engineer at Cushman & Wakefield", "MEP Engineer");
    assert.equal(r.organization, "Cushman & Wakefield");
    assert.equal(r.designation, "MEP Engineer");
    assert.ok(r.note);
    assert.equal(splitOrganization("Security guard at Private Eye,", null).organization, "Private Eye");
  });
  it("fills an empty designation from the split", () => {
    assert.equal(splitOrganization("Supervisor at Lodha Group", null).designation, "Supervisor");
  });
  it("leaves plain names alone", () => {
    assert.deepEqual(splitOrganization("BuildMyInfra", "BMS Operator"), { organization: "BuildMyInfra", designation: "BMS Operator" });
  });
});

describe("statusFromRemark", () => {
  it("maps the sample remarks", () => {
    assert.equal(statusFromRemark("Rejected cause budget issue"), "rejected");
    assert.equal(statusFromRemark("Not resposnding"), "not_responding");
    assert.equal(statusFromRemark("Not responding"), "not_responding");
  });
  it("maps others and defaults to new", () => {
    assert.equal(statusFromRemark("Shortlisted for round 2"), "shortlisted");
    assert.equal(statusFromRemark("Not selected"), "rejected");
    assert.equal(statusFromRemark("Interview scheduled"), "interview");
    assert.equal(statusFromRemark("Joined on 1st"), "joined");
    assert.equal(statusFromRemark("On hold"), "on_hold");
    assert.equal(statusFromRemark(null), "new");
    assert.equal(statusFromRemark("good profile"), "new");
  });
});

describe("helpers", () => {
  it("sheetNameKey ignores case and extension (owner: same file name = same sheet)", () => {
    assert.equal(sheetNameKey("Candidates June.xlsx"), sheetNameKey("candidates june.CSV"));
    assert.notEqual(sheetNameKey("Candidates June.xlsx"), sheetNameKey("Candidates July.xlsx"));
  });
  it("formatMonths", () => {
    assert.equal(formatMonths(48), "4 years");
    assert.equal(formatMonths(54), "4 years 6 months");
    assert.equal(formatMonths(6), "6 months");
    assert.equal(formatMonths(null), null);
  });
});
