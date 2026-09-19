# Standardised Monthly Requisition Items — Plan

**Branch:** `feat/monthly-requisition-standard-catalog`
**Status:** Phase 1 built (template, procurement upload, safe production migration path).
Phases 2–4 still planned.
Excel column spec was set by us — see §4.2; adjust if the stakeholder's sheet differs.

---

## 1. Goal

One standard item master, owned by Procurement, uploaded as an Excel file, that every
property sees as the item list when filling its monthly requisition.

Later (Phase 3), the same standard items become the item list that site teams do stock
entries against, so that "what you can request" and "what you count" are the same list.

---

## 2. What already exists (do not rebuild this)

We are much closer to this than it looks. The current state:

| Piece | Where | State |
|---|---|---|
| Org-level item master | `procurement_catalog` table | **Exists.** Columns: `name`, `description`, `category`, `unit`, `estimated_price`, `brand`, `color_size_details`, `unit_price`, `photo_url`, `is_active`, `organization_id` |
| Excel upload into the master | `catalog/bulk-upload` (AI column guesser) | **Replaced** by the template import in §4 — route deleted |
| Per-property price override | `item_site_prices` table | Exists |
| Procurement UI for catalog + pricing | [ProcurementCatalogModal.tsx](frontend/components/procurement/ProcurementCatalogModal.tsx), [SitePricingAdminTab.tsx](frontend/components/procurement/SitePricingAdminTab.tsx) | Exists, role-gated to `procurement` / `org_super_admin` / `master_admin` |
| Requisition sheet the property admin fills | [SiteRequisitionSheet.tsx](frontend/components/procurement/SiteRequisitionSheet.tsx) | Exists; already pulls catalog + site prices + live stock |
| Requisition line items with a catalog link | `requisition_items.catalog_item_id` | Exists |
| Stock item → catalog link | `stock_items.catalog_item_id` (nullable FK, indexed) | **Exists already** — added in [20260820_site_specific_pricing_and_requisition_outbox.sql](backend/db/migrations/20260820_site_specific_pricing_and_requisition_outbox.sql). This is the hinge the whole Phase 3 answer turns on. |

Three things are actually wrong today:

1. **The requisition list is stock-first, not catalog-first.**
   [SiteRequisitionSheet.tsx:252-296](frontend/components/procurement/SiteRequisitionSheet.tsx#L252) builds rows from the
   property's `stock_items` first, then appends catalog items that weren't already matched
   by normalised name. Result: the sheet a property sees is shaped by *that property's* stock
   list, so two properties see two different sheets. That is the opposite of standardised.

2. **Dead hardcoded item lists.** `DEFAULT_HK_ITEMS` and `DEFAULT_BEVERAGE_ITEMS`
   ([SiteRequisitionSheet.tsx:55-87](frontend/components/procurement/SiteRequisitionSheet.tsx#L55)) are declared and never
   referenced. Delete them — they are a second, stale definition of "standard items".

3. **Two unreviewed sync scripts already do the dangerous version of Phase 3.**
   - `scripts/sync_all_catalog_to_stock.js` — hardcoded `organizationId`, mass-inserts every
     catalog item into every property's `stock_items`. This is exactly the duplicate-creation
     problem described in §6.
   - `scripts/link_stock_to_catalog.js` — links by substring match, first-match-wins, no human
     review, no unit check. `"Wiper Small"` and `"Wiper Big"` both contain `"wiper"`.

   Both should be retired in favour of the reviewed flow in §6.

---

## 3. Data model changes

### 3.1 `procurement_catalog` hardening — SHIPPED

[20260919000001_procurement_catalog_standard_template.sql](supabase/migrations/20260919000001_procurement_catalog_standard_template.sql)
adds `item_code`, `sort_order`, `import_batch_id` and `deactivated_at`, a case-insensitive
unique index on `(organization_id, item_code)`, and backfills a code onto every existing row.

`item_code` matters more than it looks — see §4.2.

### 3.2 `catalog_import_batches` — SHIPPED

Every Excel upload becomes a batch record, so a bad upload is explainable and reversible.
The shipped table also carries `staged_rows` (the previewed diff, applied on commit),
`photo_count` and `expires_at` — a preview is good for 24 hours. As shipped:

```sql
CREATE TABLE catalog_import_batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploaded_by      uuid REFERENCES users(id),
  file_name        text,
  file_url         text,              -- keep the original Excel in storage
  row_count        integer,
  created_count    integer,
  updated_count    integer,
  unchanged_count  integer,
  deactivated_count integer,
  error_count      integer,
  column_mapping   jsonb,             -- header -> field, as actually applied
  errors           jsonb DEFAULT '[]'::jsonb,
  status           text DEFAULT 'previewed',  -- previewed | committed | rolled_back
  committed_at     timestamptz,
  created_at       timestamptz DEFAULT now()
);
```

### 3.3 `procurement_item_aliases` — PHASE 3, not yet migrated

The key that makes legacy names survive standardisation. A property keeps calling it
"Toilet Paper Roll"; procurement calls it "Toilet Roll"; both resolve to one `catalog_item_id`.

```sql
CREATE TABLE procurement_item_aliases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  catalog_item_id  uuid NOT NULL REFERENCES procurement_catalog(id) ON DELETE CASCADE,
  property_id      uuid REFERENCES properties(id) ON DELETE CASCADE,  -- NULL = org-wide alias
  alias_text       text NOT NULL,
  normalized_alias text NOT NULL,
  source           text DEFAULT 'MANUAL',   -- MANUAL | STOCK_MIGRATION | PO_PARSE | EXCEL_IMPORT
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz DEFAULT now(),
  UNIQUE(organization_id, property_id, normalized_alias)
);
```

This mirrors the `property_aliases` pattern already in
[pricingAndAliasService.ts](backend/lib/procurement/pricingAndAliasService.ts) — same idea, applied to items instead of sites.
It also pays off later for PI/PO line-item matching.

### 3.4 `property_catalog_adoption` — PHASE 3, not yet migrated

Lets us roll out property by property instead of all at once.

```sql
CREATE TABLE property_catalog_adoption (
  property_id      uuid PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uses_stock_module boolean DEFAULT false,
  status           text NOT NULL DEFAULT 'not_started', -- not_started | mapping | active
  mapped_by        uuid REFERENCES users(id),
  mapped_at        timestamptz,
  notes            text,
  updated_at       timestamptz DEFAULT now()
);
```

### 3.5 `stock_items` additions (Phase 3, non-destructive)

```sql
ALTER TABLE stock_items
  ADD COLUMN IF NOT EXISTS local_name        text,     -- what the site team calls it
  ADD COLUMN IF NOT EXISTS is_site_specific  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_retired        boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS unit_conversion_factor numeric DEFAULT 1,
  ADD COLUMN IF NOT EXISTS merged_into_id    uuid REFERENCES stock_items(id);
```

No column is dropped. `quantity`, `barcode`, and `stock_movements` are never touched by any
migration step.

---

## 4. Procurement-side Excel upload

### 4.1 Where it goes — BUILT

Procurement → **Catalog** tab → **Upload Excel**. The button replaces the old "Bulk Upload"
entry in [ProcurementCatalogModal.tsx](frontend/components/procurement/ProcurementCatalogModal.tsx) and opens
[CatalogTemplateUploadModal.tsx](frontend/components/procurement/CatalogTemplateUploadModal.tsx). Nothing new was added to
the sidebar or the role matrix — it reuses the existing `canManageCatalogAndPricing` gate, and
every endpoint re-checks `procurement` / `org_super_admin` / `master_admin` server-side.

Flow: **Download template → fill it → upload → review the diff → apply**.

Endpoints:
- `GET  /api/procurement/catalog/template` — the .xlsx, blank or `?include=current`
- `POST /api/procurement/catalog/import/preview` — parses, classifies, stages a batch; writes nothing to the catalog
- `POST /api/procurement/catalog/import/commit` — applies a staged batch

### 4.2 Columns — BUILT

The template is procurement's existing requisition sheet, unchanged: same seven columns,
same header wording. Qty is dropped (a master list has no quantity) and Category takes its
place. Nothing else is added.

| # | Excel column | Maps to | Notes |
|---|---|---|---|
| 1 | Sr. No. | `sort_order` | Fixes the row order on every property's sheet. Pre-filled on the downloaded template. |
| 2 | **Item Description** | `name` | **Required.** Pack size stays in the name, as today ("Bleach Chemical 5 Ltr"). |
| 3 | Category | `category` | Dropdown-locked to HK / Beverages / Technical / General. Free text is mapped (Housekeeping→HK, Pantry→Beverages, Electrical→Technical); unrecognised→General. |
| 4 | Unit | `unit` | Unit of issue as bought ("5 L Can", "KG", "pcs"). **This is what stock is counted in.** |
| 5 | brands | `brand` | Approved brand, `NA` where none. |
| 6 | final rate | `unit_price` + `estimated_price` | Currency symbols and separators stripped. |
| 7 | IMAGE | `photo_url` | Picture pasted into the cell, or a public image URL. |

Defined once in [catalogTemplate.ts](backend/lib/procurement/catalogTemplate.ts) (`CATALOG_TEMPLATE_COLUMNS`), which the
download endpoint, the parser, the error messages and the UI diff labels all read from.

**The IMAGE column.** Pictures pasted into the cell (Insert → Picture → Place in Cell) are read
straight out of the .xlsx — ExcelJS exposes each picture's anchor, and a picture anchored at
row *N* belongs to the item on row *N*. They are resized to 800px, converted to webp via
`sharp`, and stored in the existing `procurement-items` bucket. Max 5 MB per picture.

A file that still has the old **Qty** column uploads fine — the column is reported as ignored
rather than rejected.

**Consequence of having no item-code column** (raised, and settled in favour of keeping the
sheet as-is): items are matched on their **Item Description**. Editing a description is
therefore indistinguishable from adding a new item, and would create a duplicate while the old
entry becomes an orphan. Mitigation shipped: when an upload both adds items and leaves items
out, the preview raises a warning naming both counts and telling the uploader to check for the
same product under two names. `item_code` still exists in the database — generated
server-side, backfilled onto existing rows — so switching to code-based matching later is a
column addition, not a re-model.

### 4.5 Migrating a live production catalog — BUILT

Adopting the standard list on a database real sites are using must not make an item
disappear mid-month. Three things make that safe:

**1. A three-state lifecycle** ([20260919000002](supabase/migrations/20260919000002_procurement_catalog_lifecycle.sql)).
`is_active` stays the hard visibility gate the rest of the app already reads; `lifecycle`
adds the distinction on top:

| State | Requestable? | Meaning |
|---|---|---|
| `standard` | yes | On the current standard template |
| `legacy` | **yes, fully** | Pre-standardisation item. Grouped separately and marked as being phased out, but nothing breaks for the sites still using it. |
| `retired` | no | Hidden from new requisitions. Never deleted — past requisitions and stock rows keep resolving. |

Every existing row defaults to `standard`, so the migration itself changes nothing a user
can see.

**2. Per-item decisions, defaulting to Keep.** Items absent from the uploaded template are
never touched automatically. The preview lists each one with **how much stock sites are still
holding of it** and offers Keep / Legacy / Retire. `legacy` is the migration setting: run the
first standard upload, mark the old items legacy, and phase them out as stock runs down.

**3. The whole import can be undone.** `POST /api/procurement/catalog/import/rollback` reverts
updated fields to their recorded previous values, deactivates items the batch created, and
restores anything it marked legacy or retired. Only the most recent committed batch can be
rolled back — reverting underneath a newer import would silently clobber it.

**Deploy order matters.** The import endpoints need the new columns. Run both migrations
before (or with) the deploy; until then they return a 503 naming the migrations rather than a
generic error. The shared catalog endpoints were deliberately left untouched so the existing
screens keep working either way.

### 4.3 Upload semantics — BUILT

- **Dry run first.** `POST .../catalog/import/preview` returns a per-row classification:
  `create` / `update` (with a field-level before→after diff) / `unchanged` / `error`, plus the
  set of existing active items **absent from the file** (candidates for deactivation).
- **Commit is a separate call** against the previewed `batch_id`. Nothing is written from the
  preview call.
- **Deactivation is never automatic.** Items missing from the upload are listed, and the
  uploader ticks which to deactivate. Deactivation = `is_active = false`, never `DELETE` —
  historic requisitions and stock rows must keep resolving.
- **Row cap raised** from the current 500, with chunked inserts.
- **Idempotent**: re-uploading the same file yields all `unchanged`.

### 4.4 The AI column mapper — REMOVED

The old `catalog/bulk-upload` route called Groq (`llama-3.3-70b-versatile`) to guess which
spreadsheet column was which. With a fixed template that guess buys nothing and can silently
map the wrong column, so the route is deleted and replaced by a deterministic matcher: exact
canonical header first, then a fixed synonym table, with unmatched columns reported back to
the uploader rather than guessed at.

This also closes a [CLAUDE.md](CLAUDE.md) / [AGENT_DOCTRINE.md](docs/AGENT_DOCTRINE.md) gap — that route was an
AI agent with no Agent Spec Block. Removing the agent removes the obligation; there is now no
model call anywhere in this feature.

(`catalog/bulk` is a different, still-used route behind Site Pricing and is untouched.)

### 4.6 Per-property controls removed from the requisitions screen — DONE

With one standard list, the controls that existed because items and rates differed per
property are hidden behind `SHOW_LEGACY_PER_PROPERTY_CONTROLS` in
[procurementFeatureFlags.ts](frontend/components/procurement/procurementFeatureFlags.ts) — a flag rather than a deletion, so
production rollback is one line:

- **Site Prices** button + the **Site Pricing & Aliases** sidebar tab
- **Property Budgets** button (already a dead link in the live shell — `onNavigateToBudgets`
  was never passed and nothing opened the budget modal)
- **Export Master (.xlsx)** button

Kept: Upload Quote (Multi-Site), Feedback Reports, Create Requisition, Refresh.

Deep links to the hidden tabs are filtered too, so a stale bookmark cannot resurface a tab
that has no sidebar entry. Note that hiding the Budgets UI does **not** switch budget
enforcement off — budgets already stored against a property still drive the over-budget
warning on the requisition sheet; they just can't be edited from the UI.

---

## 5. Property-admin side: the requisition sheet

Change [SiteRequisitionSheet.tsx](frontend/components/procurement/SiteRequisitionSheet.tsx) from stock-first to
**catalog-first**:

1. Load the standard catalog for the org (active items, ordered by `sort_order`, then name),
   grouped into the existing category tabs. **This is identical for every property.**
2. Overlay the property's price from `item_site_prices` (existing behaviour, keep it).
3. Overlay `available_stock_qty` by joining on `stock_items.catalog_item_id`, falling back to
   the alias table, then to normalised name. If the property has no stock module, this column
   shows blank/0 and stays manually editable exactly as today.
4. Render **site-specific items** — stock rows with no `catalog_item_id` — in a separate,
   clearly labelled block below the standard list, so they are visible but obviously not part
   of the standard.
5. "Add row" still works, and a manually added row gets flagged so procurement can later
   promote it into the standard catalog (a nice feedback loop: what sites keep adding by hand
   is what the standard is missing).

`requisition_items` already snapshots `item_name`, `unit`, `unit_price` at submit time — keep
that. A later catalog upload must never retroactively change a submitted requisition. Add
`import_batch_id` to the snapshot so we can explain why last month's sheet differs from this
month's.

---

## 6. Phase 3 — how the standard items drive stock management

### 6.1 The shape of it

Today the two lists are independent: `procurement_catalog` is what you can *request*,
`stock_items` is what a site *counts*. They are joined only by `stock_items.catalog_item_id`,
which exists but is mostly unset.

The target is one identity:

```
procurement_catalog (org-wide, from the Excel)
        │  catalog_item_id
        ├──────────────► stock_items      (per property: quantity, barcode, location)
        │                      │ item_id
        │                      └────────► stock_movements  (every in/out, immutable)
        └──────────────► requisition_items (what was asked for, price snapshotted)
```

**One rule makes the whole thing work: `catalog_item_id` is the item's identity.**
`stock_items.name` becomes a per-site display label, not an identifier. A site team that calls
it "Bleach 5L" and a template that calls it "Bleach Chemical 5 Ltr" are the same row in every
report, because both carry the same `catalog_item_id`.

### 6.2 What each screen does after the change

**Monthly requisition (property admin).** Renders the standard catalog in `Sr. No.` order,
grouped by Category — identical for every property. `available_stock_qty` is no longer typed by
hand: it is read from `stock_items` joined on `catalog_item_id`. Site-specific items appear in
a separate labelled block below.

**Stock entry (site team).** The "add item" list stops being free text and becomes the standard
catalog. A site team can only count things that exist on the standard list (plus that site's
own site-specific items), which is what makes cross-property stock reporting meaningful for the
first time.

**Goods receipt closes the loop.** When a requisition is approved and delivered, the received
quantities post as `stock_movements` against the same `catalog_item_id`. Requested → ordered →
received → counted becomes one chain per item, per site, per month. That chain is what makes
consumption rate, and therefore next month's suggested quantity, computable.

### 6.3 Unit is the thing that will bite

`Unit` in the template ("5 L Can") is the unit of *purchase*. Site teams often count in a
different unit — litres, or loose pieces out of a box. If the two drift, every stock number is
silently wrong.

Two decisions needed before Phase 3 starts:

1. **Is the template's Unit also the stock-keeping unit?** Simplest answer is yes — you buy a
   5 L Can, you count 5 L Cans. Recommended.
2. If not, `stock_items` needs `stock_unit` + `units_per_purchase_unit` (e.g. 1 Box = 24 pcs),
   and every movement records which unit it was entered in. This is real complexity; only take
   it if sites genuinely cannot count in purchase units.

The reconciliation wizard (§6.5) refuses to link two items whose units differ until this is
answered explicitly for that item.

### 6.4 The two populations

**Group A — properties not using stock management.** Easy, but do **not** mass-seed them. The
requisition sheet renders from the catalog whether or not stock rows exist. Create `stock_items`
lazily — when the property turns the stock module on, or on first goods receipt — all at
`quantity = 0` with `catalog_item_id` set. Mass-seeding every property up front (what
`scripts/sync_all_catalog_to_stock.js` does today) forces the stock module onto sites that never
asked for it and fills their dashboards with hundreds of zero rows.

**Group B — properties already running stock management on their own item list.** Their
`stock_items` carry live quantities, barcodes and movement history. Those are the property's
books. Dropping standard items in alongside creates a second "Bleach Chemical 5 Ltr", the site
team enters against whichever they clicked, and both the stock report and the requisition's
`available_stock_qty` go *quietly* wrong — which is worse than loudly wrong.

### 6.5 The mechanism: a one-time reconciliation wizard per property

Not a script. A reviewed pass, driven by `property_catalog_adoption.status`
(`not_started` → `mapping` → `active`), so rollout is per property rather than big bang. A
property in `mapping` keeps today's behaviour until it flips to `active`.

Four buckets:

1. **Confident match** — normalised name equal *and* unit equal. Pre-ticked. Confirming writes
   `catalog_item_id`, copies the old name into `stock_items.local_name`, and records it in
   `procurement_item_aliases`. Quantity, barcode, movements: untouched.
2. **Needs review** — fuzzy candidates with a confidence score and both units shown side by
   side. A cross-unit link is refused until §6.3 is answered for that item.
3. **No standard equivalent** — *Keep as site-specific* (`is_site_specific = true`; stays
   countable, shows in the requisition's site-specific block) or *Retire* (frozen, history kept,
   hidden from new entry).
4. **Standard items the property has no row for** — created at `quantity = 0` on confirm.

Two rules make it safe: nothing is written until the whole sheet is confirmed, and there is no
`DELETE` anywhere — no quantity is rewritten, no `stock_movements` row is edited.

### 6.6 The one destructive case: merges

Two legacy rows mapping to one standard item — "Bleach 5L" (qty 40) and "Bleach Chemical 5 Ltr"
(qty 12). You cannot link both; you must merge. Pick a survivor, repoint
`stock_movements.item_id`, set `merged_into_id` on the loser, and write a `stock_movements` row
with `action = 'merge'` and `quantity_change = +12` on the survivor so the ledger still adds up
on paper. Gate it behind a confirmation stating the resulting quantity. This is the only
operation in the whole plan that changes a number the site team owns, and it should look like
it.

### 6.7 Why not the alternatives

- **Hard reset** (archive all old stock items, seed standard at 0, ask sites to recount) is
  genuinely cleaner and worth offering as an *opt-in* per property — a site with messy data may
  prefer it — but as a default it costs every site a full physical count and throws away the
  consumption history right when we want it for forecasting.
- **Requisition only, never touch stock** is zero-risk but permanently leaves the two lists out
  of sync, which is the problem we set out to solve.
- **Automatic fuzzy linking with no review** (what `scripts/link_stock_to_catalog.js` does
  today) will mislink a meaningful fraction — and a mislink is invisible until a stock report is
  wrong. Do not ship it.

### 6.8 Order of work

1. Catalog uploaded and reviewed (Phase 1, done) — mapping against a half-finished standard list
   is wasted effort.
2. Catalog-first requisition sheet (Phase 2).
3. Answer §6.3 (is purchase unit = stock unit?).
4. `stock_items` columns + `procurement_item_aliases` + `property_catalog_adoption` migrations.
5. Wizard, on Group A first (low risk, proves the join), then Group B one property at a time,
   starting with the smallest/cleanest stock list.
6. Goods receipt → `stock_movements` posting, which is what finally makes consumption reporting
   possible.

## 7. Phased delivery

| Phase | Scope | Ships |
|---|---|---|
| **1** ✅ | Schema (§3.1, §3.2), Excel template + preview/commit import, upload UI in the procurement Catalog tab | Procurement can upload and maintain the standard list |
| **2** | Catalog-first requisition sheet, site-specific block, delete dead defaults | Every property fills the same sheet |
| **3** | `stock_items` columns, reconciliation wizard, merge flow, adoption rollout | Stock entries and requisition share one item list |
| **4** | Retire `sync_all_catalog_to_stock.js` / `link_stock_to_catalog.js`; promote hand-added rows into the catalog | Cleanup + feedback loop |

Phases 1 and 2 are independently shippable and useful on their own. Phase 3 does not start
until the catalog has actually been uploaded and reviewed, because mapping against a
half-finished standard list is wasted effort.

---

## 8. Open questions

1. **Do the columns in §4.2 match your sheet?** They are built and working; changing one is a
   single edit to `CATALOG_TEMPLATE_COLUMNS`, but it is cheapest to settle now.
2. **Aliases and adoption tables (§3.3, §3.4) are specified but not yet migrated** — they
   belong to Phase 3 and are not needed to upload the standard list.
3. **Is the standard list truly global, or per property group?** Current model is org-wide
   (`procurement_catalog.organization_id`). If some sites are pantry-only or Technical-only, we
   need either a `applies_to_property_types` field or a per-property include/exclude — cheap
   now, expensive to retrofit.
4. **Who runs the reconciliation wizard** — procurement centrally, or each property admin?
   Procurement centrally is more consistent; property admins know their own items better.
   My lean: procurement drives it, with the property admin's confirmation required to commit.
5. **Categories.** The sheet currently hardcodes `HK | Beverages | Technical | General`. Should
   the Excel's Category column be free text mapped onto those four, or should the four become
   data?
