# Petty Cash Workflow Audit (30 Oct 2026)

Branch: `audit/petty-cash-workflow-test`
Test file: `tests/petty-cash/workflow-audit.test.mjs`
Run it: `node --test tests/petty-cash/workflow-audit.test.mjs`

## Summary

The core approval chain is solid. Wrong-person actions, self-approval, stale screens, over-allocation and payment mismatches are all blocked correctly in the database.

But the newest migration (29 Oct, `20261029000001_petty_cash_enhancements.sql`) broke things:

1. **Nobody can record an expense right now** (if that migration is live). Every expense save fails with "Expense event requires exact expense identity".
2. **An accountant can only pay out once without a proof.** The second no-proof payout by the same person fails.
3. **Anyone with an old reimbursement record still marked "paid" is blocked forever** from raising new requests.

There are also design gaps: a rejected expense becomes a permanent dead end, the fraud guard blocks normal everyday claims, and there is effectively no money limit on requests anymore.

**Results:** 29 test cases. 17 pass (controls working, or current policy recorded). 12 are marked `todo`, meaning they assert the correct behaviour and currently fail. Each one fails for exactly the reason described below.

---

## 1. How the workflow works

Every request is tied to one property. Each property has a configured **allocator** and **approver** (set by an org or ops super admin under routing settings). Payments and expense reviews are done by anyone with the **accounts** role.

```
Requester           Allocator            Approver           Accounts             Requester           Accounts
(raise request) --> (allocate amount) --> (approve)  -->   (pay / disburse) --> (log expenses,  --> (review each expense,
  status:             status:               status:          status: paid        then settle)        record cash returned,
  submitted           pending_approval      approved         wallet credited     status:             close)
                                                                                  settlement_         status: closed
                                                                                  submitted
```

Side paths:
- **Send back** (allocator or approver, reason required): goes to the requester, who edits and resubmits. It starts again at the allocator.
- **Reject** (allocator or approver, reason required): final.
- **Cancel** (requester only): allowed any time before money is paid.
- **Reassign** (super admin only): moves a stuck request to a different allocator or approver (primary or backup).
- **Draft**: a requester can save without submitting.

**Wallet:** when accounts pays, the requester's wallet for that request is credited. Each expense debits it. Cash handed back is recorded by accounts as a "return". The requester can settle only when the request's wallet is exactly zero. Accounts can close only when every expense is accepted.

Where the rules live: almost everything is enforced inside Postgres functions (`pc_create_request`, `pc_action`, `pc_expense`, `pc_gate`, `pc_review_expense`, `pc_set_routing`). The API routes in `app/api/petty-cash/` are thin wrappers around them. Two extra checks run in TypeScript before an expense is saved: the fraud guard (`backend/lib/pettyCash/fraudDetection.ts`) and the duplicate receipt file check.

## 2. Limits and rules currently in force

| Rule | Value today | Where |
|---|---|---|
| Max request amount | 999,999,999,999.99 (no real cap) | `pc_create_request` |
| Amount precision | 2 decimals, must be > 0 | all money checks |
| Allocated amount | 0 < allocated <= requested | `pc_action` allocate |
| Approver changing amount | Not allowed, must send back | `pc_action` approve |
| Paid amount | Must equal approved amount exactly | `pc_action` pay |
| Payment modes | Cash, UPI, Bank Transfer, Company Card, Other | pay and expense |
| Payment reference | Required for every mode except Cash | pay and expense |
| Payment date | Cannot be in the future (India time) | pay |
| Payment proof on disbursal | Optional since 13 Oct | `pc_action` pay |
| Open requests per person | **Unlimited** since 29 Oct | `pc_gate` |
| Request while holding unspent cash | **Allowed** since 29 Oct | `pc_gate` |
| Request blocked when | Any of your expenses is rejected, or an old v1 advance is unreconciled | `pc_gate` |
| Expense amount | Cannot exceed what is left in that request's wallet | `pc_expense` |
| Bill / proof on expense | Required only when one line is **above** the property threshold (default ₹500; exactly ₹500 needs none) | `pc_expense` |
| Expense date | Not in the future. **No lower limit** | `pc_expense` |
| Spend mode | Operation or Client | `pc_expense` |
| Upload | PDF, PNG, JPEG, WEBP only, 15 MB max, file contents must match the type | `upload/route.ts` |
| Backups per stage | 25 (checked by the API) | `assignments/route.ts` |
| Bulk actions | 1 to 100 requests, allocate or approve only | `bulk/route.ts` |

## 3. Where it fails

Ranked by impact. "Reachable from the UI" means a normal user can hit it from the app today.

### BUG-1 (Critical): Recording any expense fails
- **What happens:** Requester logs an expense and gets "Expense event requires exact expense identity". Nothing can be spent against an advance, so nothing can be settled or closed.
- **Why:** The notification trigger added on 7 Oct (`pc_activity_outbox`) refuses an `expense_recorded` activity row unless it carries `metadata.expense_id`. The 13 Oct version of `pc_expense` wrote that metadata. The 29 Oct rewrite of `pc_expense` dropped it.
- **Reachable from the UI:** Yes, every expense, every user.
- **Test:** `BUG-1` (todo) and `BUG-1 (evidence)`.
- **Fix:** New migration that restores `metadata = jsonb_build_object('expense_id', e.id)` on the activity insert in `pc_expense`.

### BUG-2 (High): Second no-proof payout by the same accountant fails
- **What happens:** The first time an accountant pays without attaching a proof, it works. The second time, it fails with "Proof must be an owned uploaded file".
- **Why:** `backend/lib/pettyCash/actions.ts` creates a placeholder "Disbursement Voucher" upload with storage path `<org>/<user>/disbursement_voucher.txt`. That path is the same every time for that user, and `storage_path` is UNIQUE. The second insert fails, the error is ignored, and the payout then points at an upload that does not exist.
- **Reachable from the UI:** Yes. The live screen (`WorkflowRequestDetail.tsx`) always sends an empty proof list when nothing is attached.
- **Test:** `BUG-2` (runs the real `actions.ts` code against the database).
- **Fix:** Include the voucher id in the path (for example `.../disbursement_voucher_<id>.txt`) and stop if the insert returns an error.

### BUG-3 (High): Old reimbursement records block people forever
- **What happens:** A user who has an old (v1) **reimbursement** record still marked `paid` or `settlement_submitted` gets "Reconcile existing advance balance and proofs before requesting more cash". Accounts cannot close that record because reimbursements are read-only. So the user can never raise a request again.
- **Why:** The 4 Oct version of `pc_gate` only looked at `request_type = 'advance'`. The 29 Oct rewrite dropped that filter.
- **Reachable from the UI:** Yes, for any user with such history. Run query Q2 below to see who is affected.
- **Test:** `BUG-3` and `BUG-3 (evidence)`.
- **Fix:** Put `AND r.request_type = 'advance'` back into the legacy check in `pc_gate`.

### BUG-4 (High): A rejected expense is a dead end
- **What happens:** Accounts rejects an expense (say a personal purchase). The requester can only "correct" it by uploading a new proof; they cannot change the amount or withdraw it. Accounts cannot record the money being paid back, because the rejected amount is still counted as spent. Until accounts accepts the rejected expense, the request cannot settle or close, **and that person cannot raise any new request**.
- **Reachable from the UI:** Yes.
- **Test:** `BUG-4` and `BUG-4 (evidence)`.
- **Fix (needs a business decision):** Add a "void expense" path. Either the requester withdraws a rejected expense (its debit is reversed), or accounts records a recovery that offsets it.

### BUG-5 (Medium): Duplicate reference checks
- **5a:** The 29 Oct `pc_expense` also dropped the friendly "Duplicate payment reference: ... already claimed" check. The database unique index still blocks duplicates, but users now see a raw message: `duplicate key value violates unique constraint "uq_petty_cash_expenses_org_payment_ref"`.
- **5b:** That unique index also covers **Cash** expenses. Staff often type "NA", "-" or "cash" in the reference box for cash. The second cash expense with the same placeholder anywhere in the org is blocked.
- **Tests:** `BUG-5`, `BUG-5b`.
- **Fix:** Restore the friendly check, and limit the index to non-cash modes (or clear the reference for Cash).

### BUG-6 (Medium): No separation between approving and paying
- **What happens:** If an accounts user is set as a property's approver, they can approve a request and then disburse it themselves. The system only stops requesters paying themselves.
- **Test:** `BUG-6`.
- **Fix:** In `pay`, block the actor if they are the request's `approver_id` or `allocated_by`.

### BUG-7 (Low, API only today): Routing can lose its primary
- **What happens:** The 29 Oct `pc_set_routing` (7 arguments) no longer checks that a primary is not also in its own backup list. If it is, the primary gets demoted and the property stops accepting requests ("Property routing is not configured or inactive"). It also accepts duplicate backups and no longer records backups in the configuration history.
- **Reachable from the UI:** Not today. The routing screen always sends empty backup lists. It is reachable through the API.
- **Test:** `BUG-7`.
- **Fix:** Bring back the checks from the 4 Oct version.

### BUG-8 (Medium): Fraud guard blocks normal claims
The pre-save fraud guard in `fraudDetection.ts` treats these everyday cases as fraud and refuses to save them:
- **8a:** Two auto rides at the same fare on the same day in the same request.
- **8b:** Two different employees buying ₹200 of tea at the same shop on the same day.
- **8c:** A real UPI reference that differs from an older one by one or two digits (UPI refs from the same bank are often close).
- It also matches vendor names by substring ("Xerox" and "Xerox shop" count as the same vendor).
- It only looks at the latest 300 expenses in the whole org, so older true duplicates slip through.
- **Fix:** Turn these heuristics into warnings for accounts to review, not hard blocks. Keep hard blocks only for exact UTR and exact file matches.

### BUG-9 (Low): Some phone photos are rejected
- JPEGs that carry extra data after the image end marker (common on Samsung phones) are rejected as "File contents do not match".
- iPhone HEIC photos are not supported at all.
- **Test:** `BUG-9`.

### Policy risks (working as coded, but you should decide if this is intended)

| Risk | Effect | Test |
|---|---|---|
| No money cap | A request for ₹999 billion is accepted. Only the allocator's judgement limits it. | POLICY no ceiling |
| Unlimited parallel advances | One person can have many open requests and keep unspent cash while asking for more (the old "wallet must be zero" rule was removed on 29 Oct). | POLICY parallel advances |
| Proof threshold is per line | A ₹900 bill split into two ₹450 lines needs no bill. | POLICY split |
| No lower date limit | A 2019 bill can be claimed on a 2026 advance. | POLICY 2019 |
| No overspend path | If someone spends more than they were given (out of pocket), there is no way to claim the difference. | POLICY overspend |
| Admin cannot cancel | Only the requester can cancel. If the requester leaves the company, a pending request sits until reassigned. | POLICY admin cancel |
| Backups are not automatic | If the primary allocator or approver is deactivated, no one at that property can raise a request until a super admin changes routing. | POLICY allocator leaves |

## 4. Other things found

- **The existing test harness misses 4 migrations.** `tests/petty-cash/database.mjs` only applies migrations up to 6 Oct. Nothing tests the SQL from 7 Oct, 13 Oct (x2) or 29 Oct. That is how BUG-1, BUG-3 and BUG-5a reached `main` unnoticed. The new suite fixes this for its own tests.
- **npm test scripts fail on Node 22.** They use `--test-isolation=none`, which needs Node 23.6+. On Node 22 the flag is `--experimental-test-isolation=none`.
- **Existing suite baseline:** 76 of 77 pass. The one failure (`sidebar.test.mjs`, "role dashboards ... StaffDashboard") is a source-text check on dashboard navigation, not workflow logic. It fails on `main` as well.
- **Dead code with different rules:** `backend/lib/pettyCash/transitions.ts` and `frontend/components/pettyCash/RequestDetailDrawer.tsx` are not used anywhere. They describe an older flow with no allocation step (admins can cancel, the approver can change the amount). `RequestDetailDrawer` never sends `expected_version`, so every action from it would fail. These are safe today, but someone could wire them back in by mistake.
- **Raw database errors reach users.** For example, an amount of "abc" returns `invalid input syntax for type numeric: "abc"`.
- **Proof threshold typo is silently ignored.** In `assignments/route.ts`, a non-numeric threshold becomes `NaN`, which is sent as null, so the threshold is just not updated and no error is shown.

## 5. All test cases

| # | Scenario | Expected | Result |
|---|---|---|---|
| 1 | Full lifecycle with partial allocation, cash payout, bill and no-bill expenses, cash return, settle, review, close | Ends `closed` | Pass (with BUG-1 trigger set aside) |
| 2 | Allocate 1000.01, 1500, 0, -5, 10.005 on a ₹1000 request | All refused | Pass |
| 3 | Approver changes amount; send back without reason; resubmit with new amount | Refused, refused, back to allocator | Pass |
| 4 | Approver acting at allocation stage; requester allocating own; stale screen; allocator raising own request; vendor raising; reject without reason | All refused | Pass |
| 5 | Non-accounts pays; wrong paid amount; UPI with no ref; unknown mode; future date; cancel after paid | All refused | Pass |
| 6 | Expense above balance; future date; ₹501 with no bill; ₹500 with no bill; bad spend mode; UPI with no ref | Refused except ₹500 | Pass |
| 7 | Settle with cash in hand; over-return; return without remark; close with pending expense; requester closing | All refused | Pass |
| 8 | Request ₹999,999,999,999.99 | Accepted (no cap) | Pass (policy risk) |
| 9 | 2nd and 3rd request while ₹4,900 unspent | Accepted | Pass (policy risk) |
| 10 | ₹900 split as 2 × ₹450 with no bill | Accepted | Pass (policy risk) |
| 11 | Expense dated 2019 | Accepted | Pass (policy risk) |
| 12 | Spend beyond the advance | Refused, no claim path | Pass (policy risk) |
| 13 | Super admin cancels someone's request | Refused | Pass (policy risk) |
| 14 | Primary allocator deactivated, coworker raises request | Refused | Pass (policy risk) |
| 15 | Record ₹100 expense with all migrations | Should save | **Fails: BUG-1** |
| 16 | Same, check message | "Expense event requires exact expense identity" | Pass (confirms bug) |
| 17 | Same accountant pays two requests with no proof | Both should pay | **Fails on 2nd: BUG-2** |
| 18 | User with old paid reimbursement raises request | Should be allowed | **Fails: BUG-3** |
| 19 | Accounts tries to close that reimbursement | Refused (read-only) | Pass (confirms bug is permanent) |
| 20 | Expense rejected, accounts records recovery of full amount | Should be possible | **Fails: BUG-4** |
| 21 | Rejected expense: correct amount, settle, raise new request | All refused | Pass (confirms dead end) |
| 22 | Same UPI ref twice (different case and spaces) | Clear duplicate message | **Fails: raw DB error, BUG-5** |
| 23 | Two cash expenses with ref "NA" | Both should save | **Fails: BUG-5b** |
| 24 | Accounts user approves then pays same request | Payment should be refused | **Fails: BUG-6** |
| 25 | Routing with primary allocator also in backups, then raise request | Should still route | **Fails: BUG-7** |
| 26 | Two ₹50 auto rides, same day, same request | Both claimable | **Fails: BUG-8a** |
| 27 | Two employees, ₹200 tea, same shop, same day | Both claimable | **Fails: BUG-8b** |
| 28 | UPI ref 428910289419 after 428910289418 | Not a duplicate | **Fails: BUG-8c** |
| 29 | JPEG with trailing bytes after end marker | Accepted | **Fails: BUG-9** |

## 6. Check production impact (read-only queries)

These only read data. Run them in the Supabase SQL editor.

```sql
-- Q1. Is the broken pc_expense live? (false = BUG-1 is live)
-- Looks for the quoted key 'expense_id' that only the working version writes.
SELECT position($q$'expense_id'$q$ in prosrc) > 0 AS writes_expense_id
FROM pg_proc WHERE proname = 'pc_expense';

-- Q2. Users permanently blocked by old reimbursements (BUG-3)
SELECT r.requester_id, u.full_name, r.request_no, r.status, s.unaccounted
FROM petty_cash_requests r
JOIN petty_cash_settlement_status s ON s.request_id = r.id
JOIN users u ON u.id = r.requester_id
WHERE r.request_type = 'reimbursement' AND r.workflow_version = 1
  AND s.is_open_advance AND (s.unaccounted > 0 OR s.bills_rejected > 0);

-- Q3. Accountants who have already used their one no-proof payout (BUG-2)
SELECT uploaded_by, count(*) FROM petty_cash_uploads
WHERE storage_path LIKE '%/disbursement_voucher.txt' GROUP BY uploaded_by;

-- Q4. People currently stuck on a rejected expense (BUG-4)
SELECT e.requester_id, u.full_name, count(*) AS rejected, sum(e.amount) AS amount
FROM petty_cash_expenses e JOIN users u ON u.id = e.requester_id
WHERE e.review_status = 'rejected' GROUP BY 1, 2;
```

## 7. What was and was not tested

**Tested:** All database rules by running the real migration SQL, in order, on PGlite (an in-process Postgres engine, the same one the existing tests use). The payout code in `actions.ts`, the fraud guard and the upload validator, by loading the real TypeScript with a mocked database client.

**Not tested:** The live production database (no access, and the project rules say read-only). The UI in a browser. Email, WhatsApp and push sending. The OCR route. API auth wrappers beyond what the existing `api.test.mjs` already covers.

**No application code was changed.** This branch only adds the test file and this report. None of the fixes above have been applied.
