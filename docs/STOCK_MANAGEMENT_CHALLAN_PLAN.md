# Stock Management from Monthly Requisition: Plan

**Branch:** `claude/blissful-gates-n9t0ht`
**Status:** Plan only. Nothing built yet. Waiting on the open questions in section 10.
**Builds on:** [MONTHLY_REQUISITION_STANDARD_CATALOG_PLAN.md](MONTHLY_REQUISITION_STANDARD_CATALOG_PLAN.md) (Phases 1 and 2 done; this document is the detailed version of its Phase 3).

---

## 1. What we want

1. A monthly requisition gets approved.
2. The property admin of that property gets an **Upload Delivery Challan** option on it.
3. They upload the challan, check the received quantity of each item, and press **Confirm**.
4. The received quantities are added to that property's **Stock Management**.
5. Properties that never used stock management get a stock list made automatically from the
   items they can see in their monthly requisition. They type in today's stock once.
6. Every property can download **one PDF with the QR code of every item**: 4 per row, item
   name under each QR.
7. ETPL and SS Plaza already run stock management with their own item names. From next month
   they switch to the requisition item names **without losing their current quantities,
   barcodes or movement history**.
8. All of this is switched on property by property, from a setting, not hard coded.

---

## 2. What already exists (reuse, do not rebuild)

| Piece | Where | Note |
|---|---|---|
| Standard item list | `procurement_catalog` | `lifecycle = 'standard'` items are what a requisition shows |
| Which property sees which item | `procurement_catalog.assigned_property_ids` (empty or `'ALL'` = everyone) | The filter lives in `getCatalogWithSitePrices` in [pricingAndAliasService.ts](../backend/lib/procurement/pricingAndAliasService.ts). Stock must reuse this same function so "what you can request" and "what you count" never drift. |
| Requisition record | `property_monthly_requisitions` | Line items are stored in `notes.items` (JSON). Each row id is `cat-<catalog id>`, so the catalog item of every ordered line is recoverable. |
| Approval | [approve/route.ts](../app/api/procurement/requisitions/[id]/approve/route.ts) | `pending_approval` → `approved`; procurement then issues PO → `ordered` |
| Stock tables | `stock_items`, `stock_movements`, `stock_reports` | Quantity is `NUMERIC`. Movement actions today: `add`, `remove`, `adjust`, `initial`. |
| Stock ↔ catalog link | `stock_items.catalog_item_id` (nullable FK) | Exists, mostly empty today. This is the hinge for everything below. |
| QR per item | `stock_items.barcode`, [barcode/route.ts](../app/api/properties/[propertyId]/stock/items/[itemId]/barcode/route.ts), single PNG download in [StockItemList.tsx](../frontend/components/stock/StockItemList.tsx) | Scanner already resolves an item by `barcode` |
| PDF and QR libraries | `jspdf`, `qrcode` in `package.json` | Already installed. No new library needed. |
| PO paperwork storage | [backend/lib/accounts/documents.ts](../backend/lib/accounts/documents.ts) | Already stores challans and GRNs against POs. Reuse its upload pattern. |
| Stock tab for property admin | `PropertyAdminDashboard.tsx` → `StockDashboard` | Already visible to property admins |

---

## 3. A problem to fix before anything else

[requisitions/route.ts:436-510](../app/api/procurement/requisitions/route.ts) runs a background
"sync" every time a requisition is submitted. It:

- matches the requisition line to `stock_items` **by name only**,
- if the name matches, **overwrites `stock_items.quantity`** with the "Avail. Qty" typed on the
  sheet, with **no `stock_movements` row**, so the history no longer adds up,
- if the name does not match, **inserts a new stock item** with an `STK-xxxxx` code.

For ETPL and SS Plaza, whose names differ from the requisition names, every submit since the
catalog-only sheet went live has likely created a second copy of each item (the `STK-` rows)
next to their real ones. For other properties it is quietly creating stock rows they never
asked for.

**Fix (Phase 0):** only run this sync for properties whose stock setting is `catalog` mode
(section 4), match on `catalog_item_id` instead of name, and write the change as an `adjust`
movement. For everyone else it does nothing.

**Check first (read only, run by a human):**

```sql
SELECT p.name, count(*) AS auto_created_rows, min(s.created_at), max(s.created_at)
FROM stock_items s JOIN properties p ON p.id = s.property_id
WHERE s.item_code LIKE 'STK-%'
GROUP BY p.name ORDER BY auto_created_rows DESC;
```

If ETPL or SS Plaza show rows here, the mapping step in section 7 handles them: they are listed
as "auto-created duplicates" and retired (hidden, never deleted).

---

## 4. The setting that makes it configurable

One new table, one row per property. This is the `property_catalog_adoption` table already
specified in the earlier plan, with three fields added.

```sql
CREATE TABLE property_stock_settings (
  property_id          uuid PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stock_enabled        boolean NOT NULL DEFAULT false,
  item_source          text NOT NULL DEFAULT 'catalog'
                         CHECK (item_source IN ('legacy', 'catalog')),
  adoption_status      text NOT NULL DEFAULT 'not_started'
                         CHECK (adoption_status IN ('not_started', 'mapping', 'active')),
  cutover_month        date,          -- first month the property sees catalog names
  challan_required     boolean NOT NULL DEFAULT true,
  challan_unlock_status text NOT NULL DEFAULT 'approved'
                         CHECK (challan_unlock_status IN ('approved', 'ordered')),
  updated_by           uuid REFERENCES users(id),
  updated_at           timestamptz DEFAULT now()
);
```

What each setting means:

| Setting | Values | Effect |
|---|---|---|
| `stock_enabled` | on / off | Shows the Stock tab and the challan option for that property |
| `item_source` | `legacy` / `catalog` | `legacy` = keep today's own item list (ETPL, SS Plaza until cutover). `catalog` = items come from the monthly requisition list. |
| `adoption_status` | `not_started` → `mapping` → `active` | Where the property is in the switch-over. Only `active` gets the automatic links. |
| `cutover_month` | e.g. `2026-12-01` | From this month the property sees the catalog names |
| `challan_unlock_status` | `approved` / `ordered` | Whether the challan button appears right after approval or only after PO is issued |

Starting values:

| Property | stock_enabled | item_source | adoption_status | cutover_month |
|---|---|---|---|---|
| ETPL | on | legacy | mapping | next month |
| SS Plaza | on | legacy | mapping | next month |
| Every other property | on (or off until they are ready) | catalog | active | none |

Where it is edited: a small **Stock Settings** panel for `org_super_admin` / `master_admin`
(and procurement, if you want), listing every property with these toggles. No property admin
can change it. A property with no row behaves exactly as today, so the migration changes
nothing on day one.

---

## 5. Flow A: properties new to stock management (the easy case)

### 5.1 Building their stock list

When a property is `catalog` + `active`, the Stock tab shows:

> "Your stock list is built from your monthly requisition items. 87 items. **Set up stock**"

Pressing it creates one `stock_items` row per item that property can see (same filter as the
requisition: standard lifecycle + `assigned_property_ids`), with:

- `catalog_item_id` set, `name` / `unit` / `category` copied from the catalog,
- `quantity = 0`,
- a barcode generated with the same logic as the existing barcode route, so scanning works.

It is idempotent: pressing it again only adds items that are missing. When procurement later
assigns a new item to the property, the Stock tab shows "3 new items from your requisition
list, **Add**". Items removed from the property's list are not deleted; they are hidden from
new entry once quantity is zero.

### 5.2 Entering current stock

An **Opening Stock** screen: one table of all items (grouped by category, same order as the
requisition sheet), a "Current Qty" box per row, one **Save** button. Saving writes one
`initial` movement per item that changed, so history starts clean. The existing Bulk Import
(Excel) stays available for sites that prefer a sheet.

### 5.3 QR code PDF (all properties, including ETPL and SS Plaza)

A **Download QR Codes (PDF)** button on the Stock tab.

- A4 portrait, **4 columns**, as many rows as fit (about 5 per page), page breaks automatic.
- Each cell: the QR code, the item name under it (wrapped to 2 lines), and the item code small
  underneath. Property name and date in the page header.
- The QR content is the item's existing `barcode` value. For ETPL and SS Plaza this means
  **stickers they already printed keep working**; nothing is regenerated.
- Items without a barcode get one generated first.
- Filters before download: all items, one category, or ticked items only (to reprint a few).
- Built in the browser with `jspdf` + `qrcode`, which are already installed. No server load,
  no new library.

---

## 6. Flow B: delivery challan to stock (all properties)

### 6.1 Who sees it and when

On the property admin's requisition list, a requisition shows **Upload Delivery Challan** when:

- its status is `approved` (or `ordered`, per `challan_unlock_status`), and
- the property has `stock_enabled = true`, and
- the user is a property admin of **that** property.

### 6.2 Upload and confirm

1. Upload the challan (photo or PDF) plus challan number and date.
2. The screen lists every item from that requisition with `requested_qty > 0`:
   Item, Unit, Ordered Qty, Already Received, **Received Now** (pre-filled with what is still
   pending), Remarks.
3. The admin corrects anything that did not arrive or arrived short.
4. **Confirm** shows a summary ("12 items, 340 units will be added to stock") and then posts.

Partial deliveries are allowed: a second challan can be uploaded for what is still pending.
The requisition moves to `partially_received`, then `received` when everything ordered has
arrived (or the admin marks the rest "not coming").

### 6.3 What Confirm writes

All in one database function (so it is all or nothing, and pressing Confirm twice cannot add
stock twice):

- one `stock_movements` row per line, new action **`receipt`**, linked to the challan,
- `stock_items.quantity` increased by the received amount,
- the challan marked `confirmed` with who and when,
- if a catalog item has no stock row yet at that property, the row is created first at 0.

Matching is **by `catalog_item_id` only, never by name.**

For a property still in `mapping` (ETPL, SS Plaza before cutover), any line whose catalog item
is not yet linked asks the admin to pick which of their existing items it is, or "new item".
That choice is saved as the mapping, so the mapping fills itself in as deliveries arrive.

### 6.4 New tables

```sql
CREATE TABLE requisition_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id      uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  requisition_id   uuid NOT NULL REFERENCES property_monthly_requisitions(id) ON DELETE CASCADE,
  challan_number   text,
  challan_date     date,
  file_url         text NOT NULL,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled')),
  uploaded_by      uuid REFERENCES users(id),
  confirmed_by     uuid REFERENCES users(id),
  confirmed_at     timestamptz,
  created_at       timestamptz DEFAULT now()
);

CREATE TABLE requisition_delivery_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id      uuid NOT NULL REFERENCES requisition_deliveries(id) ON DELETE CASCADE,
  catalog_item_id  uuid REFERENCES procurement_catalog(id),
  stock_item_id    uuid REFERENCES stock_items(id),
  item_name        text NOT NULL,      -- snapshot, never changes later
  unit             text,
  ordered_qty      numeric NOT NULL DEFAULT 0,
  received_qty     numeric NOT NULL DEFAULT 0,
  remarks          text,
  movement_id      uuid REFERENCES stock_movements(id)
);
```

Plus, additive only:

- `stock_movements.action` CHECK extended with `receipt` (and `merge`, see 7.4),
- `stock_movements.delivery_id` nullable column,
- requisition status CHECK extended with `partially_received` and `received`.

Challan files go in the existing `procurement_requisitions` storage bucket under
`deliveries/<property>/<requisition>/`.

---

## 7. Flow C: ETPL and SS Plaza, switching names without losing data

### 7.1 The one rule

**`catalog_item_id` is the item's identity. The name is only a label.**

Their existing `stock_items` rows are kept as they are. We **link** each one to its catalog
item; we do not create new rows next to them. Because the row is the same row:

- quantity stays,
- barcode stays (printed QR stickers keep working),
- every past `stock_movements` row stays attached,
- reports before and after cutover are continuous.

### 7.2 New columns on `stock_items` (additive, nothing dropped)

```sql
ALTER TABLE stock_items
  ADD COLUMN IF NOT EXISTS local_name        text,     -- their old name, kept forever
  ADD COLUMN IF NOT EXISTS is_site_specific  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_retired        boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS merged_into_id    uuid REFERENCES stock_items(id);
```

And a mapping history table so the whole mapping can be undone:

```sql
CREATE TABLE stock_mapping_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id        uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  stock_item_id      uuid NOT NULL REFERENCES stock_items(id),
  action             text NOT NULL,   -- link | keep_site_specific | retire | merge | create
  previous_name      text,
  previous_catalog_item_id uuid,
  new_catalog_item_id      uuid,
  done_by            uuid REFERENCES users(id),
  done_at            timestamptz DEFAULT now(),
  undone_at          timestamptz
);
```

### 7.3 The mapping screen (one time, per property)

Run this month, while the property is still in `mapping` and still sees its old names.

Two columns side by side: **their current item** (name, unit, qty) and **the requisition item**
it should become. The system pre-fills suggestions; a person confirms every line. Five buckets:

| Bucket | What the system suggests | What confirming does |
|---|---|---|
| **Sure match** | Same name after cleaning (case, spaces, "ltr"/"l") and same unit | Pre-ticked. Links the row: sets `catalog_item_id`, saves old name in `local_name`. |
| **Possible match** | Similar name, shown with both units | Admin picks. If units differ (e.g. "Box" vs "pcs") it will not link until that is sorted out. |
| **No requisition equivalent** | Their item is not on the catalog | **Keep as site-specific** (stays countable) or **Retire** (hidden, history kept) |
| **Auto-created duplicates** | The `STK-` rows from section 3 | Retire. If one has a real quantity, merge it (7.4). |
| **Catalog items they have no row for** | Requisition item with no match | Created at quantity 0 on confirm |

Nothing is written until the admin presses **Save mapping**. Every change goes into
`stock_mapping_log`, and **Undo mapping** reverts all of it. There is no `DELETE` anywhere and
no quantity is changed in this step (except merges, below).

Who runs it: suggested procurement or org admin prepares it, the property admin confirms
(they know their own items). See open question 3.

### 7.4 The only case that changes a number: two old items, one catalog item

Example: "Bleach 5L" (qty 40) and "Bleach Chemical 5 Ltr" (qty 12) are the same thing. One row
survives, the other gets `merged_into_id` and is retired, and the survivor gets a `merge`
movement of +12 so the ledger still adds up. The confirm box states the result ("Bleach
Chemical 5 Ltr will show 52"). This is the only place the plan touches a quantity the site
owns, so it is explicit.

### 7.5 Cutover

On `cutover_month` (or when the admin flips it after mapping is done):

- `item_source` becomes `catalog`, `adoption_status` becomes `active`,
- the Stock tab shows the catalog name; the old name shows small underneath for one or two
  months ("was: Toilet Roll Big") so staff are not confused,
- scanning an old sticker still opens the right item,
- they do one stock count on the Opening Stock screen (5.2). Differences are written as
  `adjust` movements, so the change is visible in history, not hidden.

If something looks wrong, the admin sets `item_source` back to `legacy`: the old names come
back because `local_name` was never lost.

---

## 8. Build order

| Phase | What | Why this order |
|---|---|---|
| **0** | Gate the name-based stock sync in `requisitions/route.ts` (section 3). Run the read-only `STK-` check. | Stops new damage to ETPL / SS Plaza data before anything else |
| **1** | `property_stock_settings` table + settings panel. QR code PDF download. | Settings are needed by everything. The PDF is useful to everyone right away and is low risk. |
| **2** | Flow A: "Set up stock" from requisition items + Opening Stock screen | Proves the catalog link on properties with no old data |
| **3** | Flow B: challan upload, confirm, `receipt` movements, new requisition statuses | Needs the links from Phase 2 to post into |
| **4** | Flow C: mapping screen, merge, undo, cutover for ETPL then SS Plaza | Done this month so next month's requisition can switch |
| **5** | Requisition sheet's "Avail. Qty" pre-filled from stock (for `active` properties) | Closes the loop: requested, received, counted all on one item |

Each phase is shippable alone. Migrations are all additive (new tables, new nullable columns,
widened CHECK lists). No column is dropped and no existing row is rewritten by a migration.
Per repo rules, migrations are written in this branch but applied by a human.

## 9. Files expected to change

- `app/api/procurement/requisitions/route.ts` (Phase 0 gate only)
- New: `supabase/migrations/2026xxxx_property_stock_settings.sql`, `..._requisition_deliveries.sql`, `..._stock_items_catalog_identity.sql`
- New API routes under `app/api/properties/[propertyId]/stock/` (`setup`, `opening`, `qr-pdf` data, `mapping`) and `app/api/procurement/requisitions/[id]/deliveries/`
- New components in `frontend/components/stock/` (`OpeningStockSheet`, `QrCodeSheetButton`, `StockMappingWizard`) and `frontend/components/procurement/` (`DeliveryChallanModal`)
- Small additions to `StockDashboard.tsx`, `StockItemList.tsx`, `MonthlyRequisitionsTab.tsx`

No AI or model call is part of this plan, so the Agent Doctrine spec block does not apply. If
we later want the challan read automatically (OCR), that is an agent and gets its own spec.

## 10. Open questions

1. **Unit:** is the requisition unit also the counting unit? (You buy a "5 L Can", you count
   cans.) Recommended yes. If some items are bought in boxes but counted in pieces, we need a
   conversion per item, which adds real work.
2. **When does the challan button appear:** right after approval, or only after procurement
   issues the PO (`ordered`)?
3. **Who does the ETPL / SS Plaza mapping:** procurement / org admin, the property admin, or
   prepared by one and confirmed by the other?
4. **Should other properties get stock switched on for all at once**, or one by one from the
   settings panel?
5. **Short delivery:** if a challan has less than ordered, should the pending quantity stay
   open for a later challan (recommended), or close the requisition?
6. **QR label size:** 4 across on A4 gives roughly 4.5 cm QR codes. Are they printing on plain
   A4 and cutting, or on a sticker sheet with a fixed label size?
