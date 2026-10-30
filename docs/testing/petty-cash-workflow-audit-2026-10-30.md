# Petty Cash Workflow Audit and Fixes (30 Oct 2026)

Branch: `audit/petty-cash-workflow-test` (PR #132)
Tests: `tests/petty-cash/workflow-audit.test.mjs`
Run them: `node --test tests/petty-cash/workflow-audit.test.mjs`
Database fix: `supabase/migrations/20261030000001_petty_cash_audit_fixes.sql` (**not applied yet**)

## Summary

The first pass of this audit found 9 bugs. The worst: after the 29 Oct migration, **nobody could record an expense**. All 9 are now fixed in code and in one new migration. Two business rules you asked for are added:

- **A bill cannot be dated before its request.** The same day or later is fine.
- **An expense without a bill needs a written reason** (at least 10 characters).

As you confirmed, people can still raise a new request while they hold cash or have another request open.

**Tests:** 32 cases in the audit suite, all passing, run against every petty cash migration in order, including the new one. All 77 existing petty cash tests were run as well. 76 pass. The one that fails is a dashboard navigation check that also fails on `main`.

**Nothing has been applied to the live database.** Someone needs to apply the migration and deploy the code. See section 6.

---

## 1. How the workflow works

Every request belongs to one property. Each property has an **allocator** and an **approver**, set by an org or ops super admin. Payouts and expense reviews are done by the **accounts** role.

```
Requester          Allocator           Approver          Accounts            Requester            Accounts
raise request -->  set amount   -->    approve    -->    pay out    -->      log expenses,  -->   review expenses,
(submitted)        (pending_           (approved)        (paid; wallet       then settle          collect unspent cash,
                    approval)                             credited)          (settlement_         close (closed)
                                                                              submitted)
```

- **Send back** (allocator or approver, reason required): back to the requester, who edits and resubmits.
- **Reject** (allocator or approver, reason required): final.
- **Cancel**: requester only, any time before payout.
- **Reassign**: super admin moves a stuck request to another allocator or approver.
- **Wallet**: payout credits it, each expense debits it, cash handed back is a "return". Settle needs the wallet at exactly zero. Close needs every expense accepted (or withdrawn).
- **New: Withdraw**: a rejected expense can be withdrawn by the requester or accounts, with a reason. Its amount goes back into the wallet, and accounts then collects that cash as a normal return.

## 2. Limits and rules now in force

| Rule | Value | Changed today? |
|---|---|---|
| Max request amount | 999,999,999,999.99 (no real cap) | No |
| Amounts | More than 0, at most 2 decimals | No |
| Allocated amount | Up to the requested amount | No |
| Approver changing amount | Not allowed, must send back | No |
| Paid amount | Must equal approved amount | No |
| Who can pay | Accounts, but **not** the requester, the allocator or the approver of that request | **Yes** |
| Payment reference | Required for all modes except Cash | No |
| Payment / expense date | Not in the future (India time) | No |
| Payment proof on payout | Optional | No (now works every time) |
| Open requests per person | Unlimited, even while holding cash | No (confirmed by you) |
| What blocks a new request | A rejected expense not yet fixed or withdrawn, or an old unreconciled v1 advance | **Yes**: old reimbursements no longer block |
| Expense amount | Up to what is left in that request's wallet | No |
| Bill on an expense | Required when one line is above the property threshold (default ₹500) | No |
| No bill attached | **A reason of at least 10 characters is required** | **New** |
| Bill date | **On or after the request date**, and not in the future | **New** |
| Duplicate payment reference | Blocked with a clear message. Cash expenses are not checked | **Yes** |
| Similar expense (same amount, date and vendor, or a UPI ref 1 or 2 digits off) | Saved with a warning that accounts sees on the timeline | **Yes** (was blocked) |
| Upload | PDF, PNG, JPEG, WEBP, max 15 MB. Phone JPEGs with extra trailing data now accepted | **Yes** |
| Routing backups | Up to 25 per stage, no duplicates, primary cannot be its own backup | **Yes** (checks restored) |

## 3. What was broken and how it is fixed

| ID | Severity | Problem | Fix |
|---|---|---|---|
| BUG-1 | Critical | Every expense failed with "Expense event requires exact expense identity" | `pc_expense` writes `metadata.expense_id` again, which the notification trigger needs |
| BUG-2 | High | An accountant could pay out without proof only once; the 2nd failed | Each placeholder voucher gets its own file path, and a failed insert now stops the payout cleanly (`actions.ts`) |
| BUG-3 | High | An old "paid" reimbursement blocked that person from new requests forever | `pc_gate` checks only advances again. Unreconciled old **advances** still block (tested) |
| BUG-4 | High | A rejected expense could not be resolved; it blocked closing and all future requests | New **Withdraw** action (`pc_withdraw_expense`). Amount returns to the wallet, accounts collects it, and the request can close |
| BUG-5 | Medium | Duplicate UTR showed a raw database error; "NA" on two cash expenses counted as a duplicate | Clear message restored; the uniqueness rule now skips Cash and withdrawn expenses |
| BUG-6 | Medium | The approver (if in accounts) could also pay out the same request | Pay is refused for whoever allocated or approved that request |
| BUG-7 | Low | Routing could silently lose its primary allocator; backups were not recorded | 4 Oct checks restored in the 7-argument `pc_set_routing`; backups saved to history |
| BUG-8 | Medium | Fraud guard blocked normal claims (two ₹50 auto rides, two staff at one tea shop, close UPI refs) | These now save with a warning shown on the timeline. Exact UTR and exact receipt file still block. An exact match is now found even if a near match comes first in the list |
| BUG-9 | Low | Samsung-style JPEGs were rejected | Only the JPEG start marker is checked; the image is still fully decoded before saving |

## 4. Files changed

**Database** (one new migration, function definitions plus small schema additions, no data rewritten):
- New column `petty_cash_expenses.no_bill_reason`.
- New status `withdrawn` for expenses; new wallet entry kind `reversal`.
- Updated: `pc_balance`, `pc_gate`, `pc_wallet`, `pc_expense`, `pc_review_expense`, `pc_action`, `pc_report`, `pc_set_routing`, `pc_activity_outbox`. New: `pc_withdraw_expense`.
- The duplicate-reference index is rebuilt to skip Cash and withdrawn expenses.

**Server:** `backend/lib/pettyCash/actions.ts`, `wallet.ts`, `evidence.ts`, `fraudDetection.ts`; routes `app/api/petty-cash/[id]/expenses`, `expenses/[expenseId]` (new `withdraw` action), `ocr`.

**Screens:**
- Expense form:
  - Asks for the no-bill reason.
  - The date picker cannot go before the request date.
  - Possible duplicates show as an amber warning instead of a block. An exact UTR still blocks.
- Expense table: shows the no-bill reason and a **Withdraw expense** button on rejected expenses (for the requester and accounts).

## 5. Test cases (all 32 pass)

| # | Scenario | Result |
|---|---|---|
| 1 | Full lifecycle: partial allocation, cash payout, billed and no-bill expenses, return, settle, review, close; notifications created | Closed |
| 2 | Allocate 1000.01, 1500, 0, -5, 10.005 on a ₹1000 request | All refused |
| 3 | Approver changes amount; send back without reason; resubmit with new amount | Refused, refused, back to allocator |
| 4 | Wrong stage actor, self allocation, stale screen, allocator raising own request, vendor, reject with no reason | All refused |
| 5 | Non-accounts pays, wrong amount, UPI without ref, unknown mode, future date, cancel after payout | All refused |
| 6 | Over balance, future date, ₹501 without bill, ₹500 without bill, bad spend mode, UPI without ref | Only ₹500 accepted |
| 7 | Settle with cash in hand, over-return, return without remark, close with pending expense, requester closing | All refused |
| 8 | Two more requests while holding ₹4,900 | Allowed (your rule) |
| 9 | Request 10 days old: bill 11 days old, bill from 2019, bill same day as request, bill 3 days old | First two refused, last two saved |
| 10 | No bill and no reason; reason "NA"; proper reason; bill attached with a reason; ₹700 with only a reason | Refused, refused, saved, saved (reason dropped), refused |
| 11 | Record expense with all migrations | Saved, notification carries the expense id |
| 12 | Same accountant pays 3 requests without proof | All paid |
| 13 | Voucher cannot be created | Payout stops with the real error |
| 14 | User with an old paid reimbursement raises a request | Allowed |
| 15 | User with an old unreconciled advance raises a request | Still blocked (correct) |
| 16 | Rejected ₹300 expense withdrawn, ₹800 returned, settle, close, new request | Closed, wallet and report show ₹200 spent, new request allowed |
| 17 | Withdraw a pending expense; coworker or allocator withdraws; withdraw twice; review or correct after withdrawal | All refused; accounts can withdraw |
| 18 | Same UPI ref twice (different case, spaces) | Refused: "Duplicate payment reference: ... already claimed" |
| 19 | Reference reused after the first expense was withdrawn | Allowed |
| 20 | Two cash expenses with ref "NA" | Both saved |
| 21 | Accounts user approves then tries to pay; another accountant pays | Refused, then paid |
| 22 | Primary as own backup, duplicate backups, 26 backups; then a valid save with threshold ₹750 | Refused x3; valid save routes correctly and records backups and threshold |
| 23 | Two ₹50 auto rides; two staff at one tea shop; UPI ref 1 digit off | Warnings, not blocks |
| 24 | Exact UTR listed after a near match | Still blocked |
| 25 | Cash placeholder that looks like a UPI ref | Not treated as a duplicate |
| 26 | JPEG with trailing data; plain text pretending to be an image | Accepted; rejected |
| 27 | Wallet totals with a withdrawn expense | Spent and balance correct |
| 28 to 32 | Policy checks: no money cap, split bills, no overspend path, admin cannot cancel, allocator leaving blocks a property | Behaviour recorded as-is |

## 6. To go live

1. **Deploy the app code first.** The new screens send the no-bill reason. The current database simply ignores it, so this is safe on its own.
2. **Then apply** `supabase/migrations/20261030000001_petty_cash_audit_fixes.sql`. If you apply it before the code, the old screen will not send a reason, and no-bill expenses will be refused until the code is live.
3. After applying, run Q1 below. It should return `true`.

Read-only checks for the Supabase SQL editor:

```sql
-- Q1. Is the fixed pc_expense live? (true = fixed)
SELECT position($q$'expense_id'$q$ in prosrc) > 0 AS writes_expense_id
FROM pg_proc WHERE proname = 'pc_expense';

-- Q2. People who were blocked by old reimbursements (unblocked once the migration is applied)
SELECT r.requester_id, u.full_name, r.request_no, r.status, s.unaccounted
FROM petty_cash_requests r
JOIN petty_cash_settlement_status s ON s.request_id = r.id
JOIN users u ON u.id = r.requester_id
WHERE r.request_type = 'reimbursement' AND r.workflow_version = 1
  AND s.is_open_advance AND (s.unaccounted > 0 OR s.bills_rejected > 0);

-- Q3. People stuck on a rejected expense (they can now withdraw it)
SELECT e.requester_id, u.full_name, count(*) AS rejected, sum(e.amount) AS amount
FROM petty_cash_expenses e JOIN users u ON u.id = e.requester_id
WHERE e.review_status = 'rejected' GROUP BY 1, 2;

-- Q4. Approved requests waiting for payout that their own allocator/approver can no longer pay (BUG-6).
-- Another accounts user must pay these. Check before applying the migration.
SELECT r.request_no, r.property_id, r.allocated_by, r.approver_id
FROM petty_cash_requests r
WHERE r.status = 'approved'
  AND (EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = r.organization_id
               AND m.is_active AND m.role = 'accounts' AND m.user_id IN (r.allocated_by, r.approver_id))
    OR EXISTS (SELECT 1 FROM property_memberships m WHERE m.property_id = r.property_id
               AND m.is_active AND m.role = 'accounts' AND m.user_id IN (r.allocated_by, r.approver_id)));
```

## 7. Still open (your call)

These work as coded. I did not change them because they are business decisions:

- **No money cap** on a request. Only the allocator's judgement limits it.
- **Proof threshold is per line.** A ₹900 bill split into two ₹450 lines needs no bill. It does now need a written reason each time, and accounts reviews every line.
- **No out-of-pocket claim.** If someone spends more than they were given, there is no way to claim the difference.
- **Only the requester can cancel.** A super admin cannot cancel a stuck request.
- **Backups do not take over automatically.** If the primary allocator or approver is deactivated, that property is blocked until routing is changed.
- **No notification on withdraw.** Withdrawing an expense shows on the request timeline, but no email or WhatsApp is sent (there is no template for it).
- **iPhone HEIC photos** are still not accepted.

## 8. What was and was not checked

**Checked:**
- All database rules, by running every petty cash migration in order on PGlite (in-process Postgres, the same engine the existing tests use).
- The payout code, fraud guard, upload check and wallet totals, by loading the real TypeScript files.
- All existing petty cash tests (76 of 77 pass; the failure also fails on `main`).
- TypeScript: no new errors. The 2 errors it reports already exist on `main`.
- ESLint on changed files: no new problems compared with `main`.
- The repo's SQL migration linter: clean.

- The petty cash browser test suite (`browser.test.mjs`): 1 of 10 passes. **It is the same 1 of 10 on `main` without these changes**. The 9 failures look for buttons the current UI no longer has (for example a "View" button), so that suite is out of date. The suite also expects Chromium at `/usr/bin/chromium`.

**Not checked:**
- The live database (the project rules say read-only, and I have no access).
- Clicking through the new no-bill reason field and Withdraw button by hand in a browser. The out-of-date browser suite above does not cover them.
- Real email, WhatsApp or push sending.
