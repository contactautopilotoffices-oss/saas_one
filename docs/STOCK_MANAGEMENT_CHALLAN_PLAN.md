# Stock Management from Monthly Requisition: Plan (v2)

**Branch:** `claude/blissful-gates-n9t0ht`
**Status:** Built (phases 0 to 3). The SQL in
[20261026000001_stock_from_requisition.sql](../supabase/migrations/20261026000001_stock_from_requisition.sql)
is run by hand in the Supabase SQL editor. Until it is run, every property behaves exactly as before.
See section 10 for what changed from this plan while building.
**Builds on:** [MONTHLY_REQUISITION_STANDARD_CATALOG_PLAN.md](MONTHLY_REQUISITION_STANDARD_CATALOG_PLAN.md) (Phases 1 and 2 done).

## Decisions taken

| Question | Decision |
|---|---|
| When does the challan button appear? | **Right after approval** (status `approved`) |
| How do ETPL and SS Plaza move to the new item names? | **No mapping, no sync.** Flip a switch. The requisition items appear as their stock list. The old list is kept untouched as a read-only "Old Stock" view. |
| Is the requisition unit the counting unit? | **Yes.** No unit conversion is built. |

This replaces section 7 of v1 (mapping wizard, merges, aliases). None of that is built.

---

## 1. The idea in one line

Every stock row gets a label saying where it came from: **old list** or **requisition list**.
A per-property switch decides which list the property sees. Nothing is ever matched by name,
copied across, renamed or deleted.

```
                 property switch = "Requisition items"
                               │
   stock_items rows ───────────┼──────────────────────────────
   item_source = 'legacy'      │   item_source = 'catalog'
   (old names, old qty,        │   (requisition names, one row per
    old barcodes, history)     │    catalog item, qty entered fresh)
   ── shown as read-only       │   ── shown as the live stock list
      "Old Stock" tab          │
```

Switch it back and the old list is the live list again, exactly as it was.

---

## 2. What already exists (reuse)

| Piece | Where |
|---|---|
| Items each property can request | `procurement_catalog`, filtered by `lifecycle = 'standard'` and `assigned_property_ids` in `getCatalogWithSitePrices` ([pricingAndAliasService.ts](../backend/lib/procurement/pricingAndAliasService.ts)). Stock reuses this exact function. |
| Requisition and its line items | `property_monthly_requisitions`, items in `notes.items`; each row id is `cat-<catalog id>` so ordered items map to catalog items with no guessing |
| Approval | [approve/route.ts](../app/api/procurement/requisitions/[id]/approve/route.ts): `pending_approval` → `approved` |
| Stock tables | `stock_items` (has `catalog_item_id`), `stock_movements`, `stock_reports` |
| QR per item | `stock_items.barcode`, scan page resolves by row id |
| PDF + QR libraries | `jspdf`, `qrcode` already in `package.json` |
| Challan file storage pattern | [backend/lib/accounts/documents.ts](../backend/lib/accounts/documents.ts) |

---

## 3. Phase 0: switch off the existing auto sync

[requisitions/route.ts:436-510](../app/api/procurement/requisitions/route.ts) runs on every
requisition submit. It matches requisition lines to stock **by name**, overwrites stock
quantity with the typed "Avail. Qty" without a history row, and inserts new `STK-xxxxx` items
when a name does not match. This is the kind of sync that causes problems, and it has
probably already created extra rows at ETPL and SS Plaza.

**Change:** remove this block. Submitting a requisition stops writing to stock at all. Stock
changes only through stock screens and challan confirmations.

Any `STK-` rows it already created are marked `legacy` by the Phase 1 migration like every
other existing row, so they disappear from the live list when a property switches over. They
are not deleted.

Read-only check (for a human to run, to see how many exist):

```sql
SELECT p.name, count(*) AS auto_created_rows
FROM stock_items s JOIN properties p ON p.id = s.property_id
WHERE s.item_code LIKE 'STK-%'
GROUP BY p.name ORDER BY auto_created_rows DESC;
```

---

## 4. Phase 1: the switch

### 4.1 Database (additive only)

```sql
-- Every existing row becomes 'legacy' automatically through the default.
ALTER TABLE stock_items
  ADD COLUMN IF NOT EXISTS item_source text NOT NULL DEFAULT 'legacy'
    CHECK (item_source IN ('legacy', 'catalog'));

-- One requisition-list row per item per property, so creating rows can be re-run safely.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_items_catalog_per_property
  ON stock_items (property_id, catalog_item_id)
  WHERE item_source = 'catalog';

CREATE TABLE property_stock_settings (
  property_id      uuid PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_source      text NOT NULL DEFAULT 'legacy' CHECK (item_source IN ('legacy', 'catalog')),
  switched_at      timestamptz,
  switched_by      uuid REFERENCES users(id),
  updated_at       timestamptz DEFAULT now()
);
```

A property with no settings row behaves as `legacy`, which is exactly today's behaviour. So
the migration changes nothing anyone can see until someone flips a switch.

### 4.2 The settings screen

**Stock Settings** panel (org admin / master admin / procurement), one line per property:

| Property | Stock list | Items | Switched on |
|---|---|---|---|
| ETPL | ( ) Old list  (•) Requisition items | 92 | 1 Dec 2026 by ... |
| SS Plaza | (•) Old list  ( ) Requisition items | 140 old | |
| Property X | ( ) Old list  (•) Requisition items | 87 | |

Turning a property to **Requisition items** shows a confirmation:

> "87 requisition items will become SS Plaza's stock list, starting at quantity 0. The current
> 140 items move to **Old Stock** (read only, nothing deleted). Staff should enter current
> stock after switching and print the new QR codes."

### 4.3 What happens when the switch is turned on

1. For every item the property sees in its monthly requisition, a stock row is created with
   `item_source = 'catalog'`, `catalog_item_id` set, name / unit / category copied from the
   catalog, `quantity = 0`, and a new barcode.
2. Old rows are **not touched**: same quantity, barcode, history.
3. Rows that already exist are skipped (the unique index), so turning it on twice is harmless.

Later, when procurement assigns a new item to the property, the stock list adds it at 0 the
next time it loads. This only ever **adds** requisition items; it never looks at old items, so
it cannot mix the two lists. If an item is taken off the property's requisition list, its stock
row stays (with its quantity) under "Not on requisition list any more" until it reaches 0.

### 4.4 Screens that must respect the switch

Every place that reads `stock_items` filters by the property's current `item_source`:

- [stock/items/route.ts](../app/api/properties/[propertyId]/stock/items/route.ts) (the stock list)
- stock movements and the movement modal (only live items can be moved)
- [generate-stock-reports cron](../app/api/cron/generate-stock-reports/route.ts) (daily report counts live items only)
- the stock widget on dashboards, the org-level stock report

### 4.5 Old Stock tab (ETPL, SS Plaza, anyone who switches)

- Read only: name, last quantity, unit, full movement history, old reports.
- No add / remove / delete on old items.
- Old daily `stock_reports` rows stay as they are.
- Scanning an old QR sticker opens the item with a banner: "This is an old item. Print the
  new QR codes from the Stock tab."

---

## 5. Phase 2: enter current stock + QR code PDF

### 5.1 Opening stock

**Update Current Stock** screen on the Stock tab: one table of all live items, grouped by
category in the same order as the requisition sheet, a "Current Qty" box per row, one
**Save**. Saving writes an `initial` movement for each first entry and an `adjust` movement
for any later recount, so every number has a history line. The existing Excel Bulk Import
remains for sites that prefer a sheet.

### 5.2 QR code PDF

**Download QR Codes (PDF)** on the Stock tab:

- A4, **4 columns**, rows fill the page, automatic page breaks.
- Each cell: QR code, **item name below** (up to 2 lines), item code in small text.
- Page header: property name and date.
- Options: all items, one category, or ticked items only (for reprints).
- Built in the browser with the already-installed `jspdf` and `qrcode`. No new library.

---

## 6. Phase 3: delivery challan to stock

### 6.1 Who sees the button and when

On the property admin's requisition list, **Upload Delivery Challan** appears when:

- the requisition status is `approved` (right after approval), and
- the property is on **Requisition items** (catalog mode), and
- the user is a property admin of that property.

ETPL and SS Plaza get the button once they are switched over, which is what we want: receipts
must land in the requisition-item list, not the old list.

### 6.2 The flow

1. Upload the challan (photo or PDF), challan number, challan date.
2. A table lists every item in that requisition with `requested_qty > 0`:
   **Item · Unit · Ordered · Already received · Received now · Remarks**.
   "Received now" is pre-filled with what is still pending.
3. The admin corrects short or missing items.
4. **Confirm** shows "12 items, 340 units will be added to stock", then posts.

Partial deliveries: a second challan can be uploaded for what is still pending. The requisition
moves to `partially_received`, then `received` once everything has arrived (or the admin marks
the rest "not coming").

### 6.3 What Confirm writes

In one database function, so it is all or nothing and a double click cannot add stock twice:

- for each line, find the live stock row by `catalog_item_id` (create it at 0 if missing),
- add the received quantity and write a `stock_movements` row with new action `receipt`,
  linked to the challan,
- mark the challan `confirmed` with who and when, update the requisition status.

Matching is by catalog item id from the requisition line. **Never by name.**

### 6.4 New tables and columns (additive)

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
  item_name        text NOT NULL,   -- snapshot
  unit             text,
  ordered_qty      numeric NOT NULL DEFAULT 0,
  received_qty     numeric NOT NULL DEFAULT 0,
  remarks          text,
  movement_id      uuid REFERENCES stock_movements(id)
);
```

Plus: `receipt` added to the `stock_movements.action` CHECK, a nullable
`stock_movements.delivery_id`, and `partially_received` / `received` added to the requisition
status CHECK. Challan files go in the existing `procurement_requisitions` bucket under
`deliveries/<property>/<requisition>/`.

---

## 7. Rollout

| When | Who | What |
|---|---|---|
| Now | Dev | Phases 0 to 3 built and deployed. All properties still on **Old list**, so nothing changes for anyone. |
| Now | Admin | Switch on the properties that never used stock. They enter current stock and print QR codes. |
| 1st of next month | Admin | Switch ETPL and SS Plaza. Their old items move to Old Stock (kept). They enter current stock on the new list and print new QR codes. |
| After that | Property admins | Every approved requisition: upload challan, confirm, stock goes up. |

If anything goes wrong at a property, switch it back to **Old list**: the old items return as
they were, and the requisition-item rows stay hidden until it is switched on again.

## 8. Build order

| Phase | Scope |
|---|---|
| **0** | Remove the name-based auto sync from requisition submit |
| **1** | `item_source` column, `property_stock_settings`, Stock Settings panel, all stock reads filtered, Old Stock tab |
| **2** | Update Current Stock screen, QR code PDF |
| **3** | Delivery challan upload, confirm, `receipt` movements, new requisition statuses |
| **4** (later) | Requisition sheet "Avail. Qty" pre-filled from live stock |

All migrations add tables, nullable columns or wider CHECK lists. Nothing is dropped, no
existing row is rewritten by a migration. Per repo rules, migrations are written here and
applied by a human.

No AI or model call is in this plan, so the Agent Doctrine spec block does not apply.

## 9. Still open

1. **Phase 0:** OK to stop requisition submit from writing to stock completely?
2. **Short delivery:** keep the pending quantity open for a later challan (recommended), or
   close the requisition at the first challan?
3. **Who else can upload a challan:** only property admins, or also soft service managers /
   site staff of that property?
4. **QR printing:** plain A4 and cut, or sticker sheets with a fixed label size?

## 10. As built

Decisions taken after v2, and where the build differs from the sections above:

| Topic | As built |
|---|---|
| Who uploads a challan | Property admins of that property only (checked on the server against `property_memberships`) |
| When the button shows | Status `approved`, and still after procurement issues the PO (`ordered`), because goods usually arrive after the PO |
| Requisition statuses | **Not changed.** No `partially_received` / `received`. Changing the status would break "Issue PO", which needs `approved`. Delivery progress lives in `requisition_deliveries`, and the challan screen shows ordered / already received / pending per item. |
| Movement action | Received stock is written as a normal `add` movement with `stock_movements.delivery_id` set, so the daily stock report counts it with no change. No `receipt` action. |
| Old Stock tab | Shown only when the property is on requisition items **and** has real old stock. Rows the removed auto-sync created (`STK-` codes) do not count unless someone recorded a movement on them. A property that never used stock management sees no Old Stock tab. |
| Requisition submit | No longer writes to stock at all (the name-based sync is deleted). Stock changes only through the stock screens and confirmed challans. |
| Short delivery | Whatever is not received stays pending for the next challan. A challan can never take an item past what was ordered (enforced in the database). |
| QR PDF | A4, 4 per row, 5 rows per page, plain QR with the item name under it. The QR holds the item's existing barcode value, so the existing scanner reads it. |
| Requisition-item list | Items cannot be added, renamed or deleted from the stock screen (they come from procurement). "Update Stock" sets today's count; each change gets a history line. |

Where things are:

- Switch: Procurement > **Stock Settings** (procurement, org super admin, master admin)
- Stock tab: **QR PDF**, **Update Stock**, and **Old Stock** when applicable
- Monthly Requisitions list: **Delivery Challan** button on approved / PO-issued requisitions
- Database test: `node --test tests/stock-from-requisition-db.test.mjs`
