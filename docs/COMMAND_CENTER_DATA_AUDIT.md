# Super Admin dashboard — data audit

Date: 16 Oct 2026. Scope: the Command Center screen (All Properties view), top row and Priority Actions.
Method: every number on the screenshot was traced to its code and recounted from the live database (read-only, no
changes). Nothing has been fixed yet.

---

## 1. Numbers that are correct

| On screen | Recount from database | OK? |
|---|---|---|
| Health score **81** | SLA 51 × 40 + Resolution 97 × 30 + Urgency 92 × 30 + Budget 100 × 20, divided by 120 = 80.9 | ✅ |
| SLA **51** | 90 breached out of 183 active tickets → 51% within SLA | ✅ |
| Resolution **97** | 5,615 resolved out of 5,798 tickets | ✅ |
| Urgency **92** | 100 − 2 × 4 urgent | ✅ |
| **4** urgent open tickets (Health card and Tickets at Risk) | 4 | ✅ same on both cards |
| Breached **90** + Within SLA **93** = 183 active | 183 active (91 breached at the time of recount — a ticket crossed its deadline) | ✅ |
| **4 of 23** buildings need attention | 4 buildings score below 85 | ✅ |
| Portfolio scores 62 / 63 / 71 / 80 / 94 | same | ✅ |
| SS Plaza: 2 urgent, 153 active, 90% of 1,580 resolved (AI Brief and Portfolio) | same | ✅ same on both cards |
| Mailbox 827 / 421 / 73 (Mailbox card and AI Brief) | same | ✅ same on both cards |
| June spend **89.4%**, Budget **89%**, overspend **₹0**, exposure **₹0** | June budget ₹1.87 Cr, actual ₹1.67 Cr = 89.4% | ✅ |

---

## 2. Numbers that are wrong

### 2.1 "Active" ticket counts are too high for some buildings 🔴
Waitlisted tickets are counted twice in Portfolio Overview (and in the AI Brief when it names such a building).

| Building | Shows | Real |
|---|---|---|
| C Mafatlal Chambers | 13 active | **10** |
| B Mafatlal Chambers | 5 active | **3** |

The other cards (Health score, Tickets at Risk) use the correct count, so the cards disagree with each other.
Cause: the server already adds waitlist into "open", and the card adds it again (`mockData.ts` `activeTicketsOf`).

### 2.2 Electricity Alert shows an old reading, not the latest 🔴
- Shows: **13,208×, logged 25 Jun 2026**.
- Newest abnormal reading in the database: **27 Sep 2026, AMR Altruist, DG meter, 654×**.
- Cause: the server sends only the first 10 of 78 abnormal readings, in no particular order, and the card picks the
  newest of those 10 (`app/api/electricity/pace/route.ts`).
- Also: these "alerts" are mostly typing mistakes in meter entries (one is 2,501,062× typical), not real consumption
  spikes.

### 2.3 "18 Healthy buildings" is mostly buildings with no data 🟠
- 13 of the 18 have **zero tickets ever**. They score 100 because there is nothing to count, not because they are
  healthy.
- The inactive property "Mumbai" is counted in the 23 buildings.
- Only 5 buildings that actually use ticketing are healthy (ETPL Digitide, AMR Altruist, RUPA Solitaire, Bajaj
  Kolkata, Indore).

### 2.4 Priority Actions badge "5" is fixed text 🟠
It is written into the code (`mockData.ts`), not counted. It shows 5 even though the Workforce card has no data.

---

## 3. Numbers that are right but read wrongly

| Where | What it says | What it actually is |
|---|---|---|
| Health card strip | 4 need attention + 18 healthy | Adds to 22, not 23. Rabale (94, amber "watch") is in neither group. |
| SLA breached 90 | Tickets that missed SLA | 72 of the 91 are **pending validation** (work done, waiting for the tenant to confirm). Only 19 are really still being worked on. Business decision: should these count as breached? |
| "Urgent" (4) | Urgent tickets | High + critical + urgent. Today: 3 high, 1 critical, 0 marked urgent. |
| Tickets at Risk "4 at risk of breach" | Tickets about to miss SLA | The same 4 urgent tickets. No deadline check is done. |
| Purchase Mailbox "827 total emails" | Emails | 827 email **conversations**, including 261 "no discovery" and 72 "other" that need nothing. |
| AI Brief "421 purchase requests" | Purchase requests | 421 email conversations nobody has acted on. Not purchase requests. |
| Budget "LIVE", AI Brief "June spend" | Current spend | The latest budget data imported is **June 2026**. July–September are not imported. The card does not say which month. |
| Workforce Coverage "DEMO" | Demo numbers | No numbers are shown at all. The roster feed returned nothing. "No data" would be accurate. |
| AI Brief | Written by AI | A fixed sentence template filled with numbers, no AI. "View full brief" button does nothing. |
| Health bars "w40 w30 w30 w20" | Weights | They add to 120, not 100. The maths is right, the display is confusing. |

---

## 4. Three different "building score" rules

| Card | Rule |
|---|---|
| Operations Health Score | SLA + resolution + urgency (−2 per urgent) + budget |
| Portfolio Overview | resolution rate − 5 per urgent (ignores SLA) |
| `/api/command-center/portfolio` (not used by any card) | penalties for SLA, backlog, PPM, meters, budget |

So SS Plaza scores 80 in Portfolio even though more than half the portfolio's active tickets are past SLA. One rule
should be chosen and used everywhere.

---

## 4b. Side-by-side: today's score vs the proposed rule (live data, 16 Oct 2026, read-only)

Columns: **Today** = Portfolio Overview today. **Unused rule** = `scoring.ts` exactly as written. **Adjusted** = the same
rule with four changes (below). Open = tickets the team is still working on; Waiting = finished, waiting for the
tenant to confirm.

| Building | Open | Waiting | Today | Unused rule | Adjusted | What drives it |
|---|---|---|---|---|---|---|
| SS Plaza | 14 | 139 | 80 | 31 | **48** | 11 of 14 open tickets past SLA |
| D Mafatlal Chambers | 4 | 0 | 71 | 57 | **52** | all 4 open tickets past SLA |
| AMR Altruist | 2 | 0 | 98 | 43 | **53** | both open tickets past SLA |
| Rabale | 4 | 0 | 94 | 71 | **69** | 1 of 4 past SLA (3 have no deadline) |
| ETPL Digitide | 7 | 0 | 95 | 61 | **79** | 1 of 7 past SLA (3 have no deadline) |
| Indore | 0 | 0 | 100 | 78 | **96** | 6% over budget (June) |
| C Mafatlal Chambers | 10 | 0 | 62 | 96 | **96** ⚠️ | none late — but **all 10 have no deadline** |
| B Mafatlal Chambers | 3 | 0 | 63 | 99 | **99** ⚠️ | none late — but **all 3 have no deadline** |
| RUPA Solitaire | 0 | 0 | 100 | 33 | **100** | nothing open (unused rule: 97% PPM overdue) |
| Bajaj Kolkata | 0 | 0 | 100 | 100 | **100** | nothing open |
| 12 others | 0 | 0 | 100 | 100 or no data | **No data** | never used ticketing (MyGate, 3i, Noida only have budget data) |

Groups: today 4 bad / 1 watch / 17 healthy. Adjusted: **5 bad / 0 watch / 5 healthy / 12 no data**.
SLA breached across the portfolio: 91 today → **39** with the new SLA rule (of 183 active).

**The four adjustments, and why**
1. Tickets waiting for the tenant are left out of both "past SLA" and "backlog" (52 of them were finished on time).
2. A building that uses ticketing and has nothing open counts as clean on tickets. As written, it counts as "no
   ticket data" (Indore 78, RUPA 33).
3. PPM and "bad meter readings" are left out for now. 613 of 749 PPM tasks show overdue (82%), which looks like the
   PPM log is not kept up to date, not like real missed maintenance. Most bad meter readings are typing mistakes.
   Both can come back once that data is reliable.
4. A building needs at least 2 signals to get a score, otherwise "limited data". As written, a building with only
   budget data drops to 86 for being 3.6% over budget (MyGate).

**Still open:** 22 of the 44 open tickets have no SLA deadline at all, so their lateness can't be measured. C and B
Mafatlal look healthy only because of this. Fix at the source: every ticket should get a deadline.

---

## 5. Suggested fixes (not done — needs approval)

1. Stop counting waitlist twice (one-line change in `activeTicketsOf`).
2. Electricity Alert: have the server sort abnormal readings newest first before taking 10.
3. Show buildings with no tickets as "no data", not "healthy"; leave inactive properties out of the 23.
4. Count the Priority Actions badge from the cards that actually have something to act on.
5. Fix labels: "conversations" instead of "emails", "high-priority" instead of "urgent", say the budget month, "No
   data" instead of "Demo" on Workforce.
6. Owner decisions: should pending-validation tickets count as SLA breached? Which single score rule should all
   cards use?
