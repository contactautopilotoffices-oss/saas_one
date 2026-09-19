# Standardised Monthly Requisition Items — Plan

**Branch:** `feat/monthly-requisition-standard-catalog`
**Status:** Phase 1 built (template + procurement upload). Phases 2–4 still planned.
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

Defined once in [catalogTemplate.ts](backend/lib/procurement/catalogTemplate.ts) (`CATALOG_TEMPLATE_COLUMNS`), which the
download endpoint, the parser and the UI hints all read from.

| # | Excel column | Maps to | Notes |
|---|---|---|---|
| 1 | Item Code | `item_code` | Stable upsert key. Blank on a new item generates one (HK-0001, BEV-0002…). |
| 2 | **Item Name** | `name` | **Required.** |
| 3 | Category | `category` | Dropdown-locked to HK / Beverages / Technical / General. Free text is mapped (Housekeeping→HK, Pantry→Beverages, Electrical→Technical), unrecognised→General. |
| 4 | Brand | `brand` | |
| 5 | Specification | `color_size_details` | Colour / size / spec |
| 6 | UOM | `unit` | Defaults to `pcs` |
| 7 | Standard Rate | `unit_price` + `estimated_price` | Currency symbols and separators stripped. Per-property overrides still live in `item_site_prices`. |
| 8 | **Photo** | `photo_url` | Picture pasted into the cell, **or** a public image URL. See below. |
| 9 | Sort Order | `sort_order` | Fixes the row order on every property's sheet |
| 10 | Description | `description` | |

**The Photo column.** Pictures pasted into the cell (Insert → Picture → Place in Cell) are
read straight out of the .xlsx — ExcelJS exposes each picture's anchor, and a picture
anchored at row *N* belongs to the item on row *N*. They are resized to 800px and converted
to webp via `sharp`, then stored in the existing `procurement-items` bucket. A typed or
hyperlinked image URL in the same cell works as an alternative. Cap is 5 MB per picture.

The workbook also carries a second **Instructions** sheet documenting every column, and the
header row carries per-column cell notes.

**On Item Code:** the migration backfills a code onto every existing catalog row, so
"download with current items → edit → re-upload" round-trips without creating duplicates
from day one. Renaming an item is then a safe update rather than a new row.

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

## 6. Phase 3 — stock management, and the migration problem

> *"For properties not using stock management we can directly show these items in their stock
> management, but properties already using stock management with old items will cause a
> problem, right?"*

Right. And the fix is: **link, don't seed.**

### 6.1 The two populations

**Group A — no stock management yet.** Easy, but do not mass-seed them either. Let the
requisition sheet render from the catalog regardless of whether stock rows exist. Create
`stock_items` rows lazily — at the moment the property switches the stock module on, or on
first goods receipt — all at `quantity = 0`, all with `catalog_item_id` set. Mass-seeding
every property up front (what `sync_all_catalog_to_stock.js` does today) forces the stock
module on properties that never asked for it and fills their dashboards with hundreds of
zero-quantity rows.

**Group B — already running stock management on their own item list.** This is the real work.
Their `stock_items` carry live quantities, barcodes, and `stock_movements` history. Those are
the property's books. Standard items dropped in alongside would create a second "Toilet Roll"
row, the site team would enter against whichever they happened to click, and both the stock
report and the requisition's `available_stock_qty` would be wrong — quietly wrong, which is
worse.

### 6.2 The mechanism: a per-property reconciliation wizard, run once

Not a script. A reviewed, one-time UI pass per property, driven by
`property_catalog_adoption.status`: `not_started` → `mapping` → `active`.

The wizard shows the property's existing stock items against the standard catalog in three
buckets:

**Bucket 1 — Confident match** (normalised name equal, *and* unit equal). Pre-ticked.
Confirming writes `stock_items.catalog_item_id`, copies the old name into `local_name`, and
records the old name in `procurement_item_aliases`. Quantity, barcode, movements: untouched.

**Bucket 2 — Needs review.** Fuzzy candidates (token overlap / trigram), each with a
confidence score and the unit shown next to both sides. The user picks the right standard
item or "none of these". **Unit mismatch is the silent killer here** — legacy "Toilet Roll"
measured in `Roll`, standard measured in `pcs`. The wizard must refuse a link across
differing units until the user either supplies a `unit_conversion_factor` or explicitly
acknowledges the units are equivalent.

**Bucket 3 — No standard equivalent.** Per item, choose:
- *Keep as site-specific* → `is_site_specific = true`. Stays in stock, stays countable,
  appears in the requisition's site-specific block. Never auto-deleted.
- *Retire* → `is_retired = true`, quantity frozen, history kept, hidden from new entry.

**Bucket 4 — Standard items the property has no row for.** Created at `quantity = 0` on
confirm, with `catalog_item_id` set.

Two rules make this safe:
- **Nothing is written until the whole sheet is confirmed**, and the confirmation writes an
  audit row naming who mapped what — so a bad mapping session is traceable and reversible.
- **No `DELETE`, ever.** No quantity is rewritten. No `stock_movements` row is edited.

### 6.3 The one genuinely destructive case: merges

Two legacy rows mapping to one standard item — "Toilet Roll" (qty 40) and "Toilet roll big"
(qty 12) both → standard "Toilet Roll". You cannot link both; you must merge.

Handle it explicitly: pick a survivor, repoint `stock_movements.item_id` to the survivor, set
`merged_into_id` on the loser, and write a `stock_movements` row with `action = 'merge'` and
`quantity_change = +12` on the survivor so the ledger still adds up on paper. Gate it behind a
confirmation that states the resulting quantity. This is the only operation in the whole plan
that changes a number the site team owns, and it should look like it.

### 6.4 Why not the alternatives

- **Hard reset** (archive all old stock items, seed standard ones at 0, ask sites to recount)
  is tempting and genuinely cleaner. It costs every site a full physical count and throws away
  consumption history right when we want to start using it for forecasting. Worth offering as
  an *opt-in* per property — a site with genuinely messy data may prefer it — but it should not
  be the default.
- **Show standard items in requisition only, never touch stock** is the zero-risk option, but
  it permanently leaves the two lists out of sync, which is the problem we set out to solve.
- **Automatic fuzzy linking with no review** (what `link_stock_to_catalog.js` does today) will
  mislink a meaningful fraction of items — and a mislink is invisible until a stock report is
  wrong. Do not ship it.

### 6.5 Rollout order

Group A first (low risk, proves the catalog-first sheet), then Group B one property at a time,
starting with whichever site has the smallest / cleanest stock list. `property_catalog_adoption`
means a property in `mapping` keeps its old behaviour until it flips to `active`, so a stalled
mapping never blocks anyone.

---

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
