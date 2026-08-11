# End-to-End Technical Documentation: Vendor Procurement Tagging & Notification Lifecycle

## 1. Executive Summary

This document details the end-to-end technical implementation of the **Vendor Procurement Tagging & Arrangement System** in SaaS One. The feature enables facility management staff to tag the Procurement Team when external vendors or specialized services are required for a ticket. The Procurement Team can subsequently arrange external vendors, update visit schedules, and keep relevant stakeholders notified through dynamic email settings and real-time UI status banners and trace logs.

---

## 2. Database Schema & Migration Layer

### 2.1 Properties Schema Remediation
To resolve database column mismatch errors (`Postgres code 42703`), migrations and API fallback mechanisms were implemented:
- **Migration Script**: `supabase/migrations/20260811000000_add_properties_deleted_at.sql` and `backend/db/schema/evolution.sql`.
- **Columns Added**:
  ```sql
  ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
  ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
  ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
  ```
- **Defensive API Query Fallback**: Updated `app/api/properties/route.ts` to cleanly catch missing column errors and retry without `deleted_at` filtering if schema cache is un-migrated.

### 2.2 Ticket Vendor Procurement Schema
- **Migration Script**: `supabase/migrations/20260810_procurement_vendor_tagging.sql`.
- **Columns Added to `public.tickets`**:
  - `needs_vendor_procurement` (`BOOLEAN DEFAULT false`): Indicates whether external vendor arrangement is required.
  - `vendor_procurement_status` (`TEXT DEFAULT 'none'`): State enum (`'none'`, `'vendor_requested'`, `'vendor_arranged'`).
  - `vendor_procurement_note` (`TEXT`): Specific service/vendor requirements requested by staff.
  - `vendor_arranged_details` (`TEXT`): Visit details and vendor contact information entered by Procurement.
  - `vendor_tagged_at` (`TIMESTAMPTZ`): Timestamp when tagged for procurement.
  - `vendor_arranged_at` (`TIMESTAMPTZ`): Timestamp when vendor was arranged.
  - `vendor_tagged_by` (`UUID`): Foreign key to `public.users(id)`.
  - `vendor_arranged_by` (`UUID`): Foreign key to `public.users(id)`.
  - `assigned_procurement_user_id` (`UUID`): Foreign key to `public.users(id)`.

### 2.3 PostgreSQL Outbox Event Trigger
- **Trigger**: `trg_tickets_vendor_procurement_outbox`
- Inserts structured payload into `public.event_outbox` whenever vendor procurement status changes:
  - `VENDOR_PROCUREMENT_REQUESTED`: Triggered on vendor tag creation.
  - `VENDOR_PROCUREMENT_ARRANGED`: Triggered when status becomes `'vendor_arranged'`.

---

## 3. Backend API Routes & Outbox Event Processing

### 3.1 `POST /api/tickets/[id]/tag-vendor`
- **Purpose**: Allows staff members to tag Procurement for vendor assistance.
- **Payload**: `{ vendor_procurement_note, assigned_procurement_user_id }`.
- **Logic**:
  1. Updates ticket flags: `needs_vendor_procurement = true`, `vendor_procurement_status = 'vendor_requested'`.
  2. Fallback handling for PostgREST schema cache error (`PGRST204`) if `assigned_procurement_user_id` column is pending cache refresh.
  3. Inserts `vendor_procurement_tagged` event into `ticket_activity_log`.
  4. Resolves recipient emails using `EmailRecipientResolver` (`featureKey: 'procurement_vendor_tag'`).
  5. Dispatches email via `EmailService.sendProcurementVendorTagEmail`.

### 3.2 `POST /api/tickets/[id]/vendor-arranged`
- **Purpose**: Allows Procurement team members to mark tickets as vendor arranged or update visit details.
- **Payload**: `{ details }`.
- **Logic**:
  1. Updates ticket flags: `vendor_procurement_status = 'vendor_arranged'`, `vendor_arranged_details = details`, `vendor_arranged_at = NOW()`.
  2. Inserts `vendor_procurement_arranged` (or `vendor_procurement_arranged_updated`) event into `ticket_activity_log`.
  3. Resolves recipients using `EmailRecipientResolver` (`featureKey: 'procurement_vendor_aligned'`) with `contextualEmails = [ticket.raised_by_user.email, ticket.tagged_by_user.email]`.
  4. Dispatches email via `EmailService.sendVendorArrangedEmail`.

### 3.3 Asynchronous Queue Processing (`backend/services/EventProcessor.ts`)
- Listens to `event_outbox` queue for background processing of outbox events.
- **`handleVendorProcurementRequestedEvent`**: Resolves recipients via `EmailRecipientResolver` (`featureKey: 'procurement_vendor_tag'`) and sends vendor tag notification.
- **`handleVendorProcurementArrangedEvent`**: Resolves recipients via `EmailRecipientResolver` (`featureKey: 'procurement_vendor_aligned'`) with contextual inclusion of `raised_by` (requestor) and `tagged_by` (tagger), explicitly excluding assigned MSTs unless configured in UI settings.

---

## 4. Email Recipient Resolution & Notification Services

### 4.1 Dynamic Recipient Resolver (`backend/services/EmailRecipientResolver.ts`)
Decouples email recipient logic from hardcoded roles. Queries `organization_settings.email_service_config` per organization and resolves targets across:
- **Target Roles**: `org_super_admin`, `property_admin`, `procurement`, etc.
- **Specific User IDs**: Direct individual user assignments.
- **Explicit Email Addresses**: Custom external email overrides.
- **Contextual Ticket Recipients**:
  - `procurement_vendor_tag`: Target role `['procurement']`.
  - `procurement_vendor_aligned`: Contextual recipients `raised_by_user` (requestor) & `tagged_by_user` (tagger) + explicit/role overrides from UI.

### 4.2 Email HTML Templates (`backend/services/EmailService.ts`)
- **`sendProcurementVendorTagEmail`**:
  - Displays: Ticket Number, Title, Property Name, Tagger Name, Original Ticket Description, and Vendor Service Requirements.
- **`sendVendorArrangedEmail`**:
  - Displays: Ticket Number, Title, Property Name, Arranged By Name, Ticket Description, and Vendor Visit Details / Schedule.

---

## 5. Frontend UI Implementation (`app/tickets/[ticketId]/page.tsx` & Admin Settings)

### 5.1 Admin Settings (`frontend/components/admin/EmailServiceSettings.tsx`)
Added interactive Email Service UI Cards for Org Super Admins under **Settings > Email Service Settings**:
- 🏷️ **Vendor Procurement Tagging** (`procurement_vendor_tag`): Configure who gets notified when vendor arrangement is requested.
- 🟢 **Vendor Aligned / Arranged Updates** (`procurement_vendor_aligned`): Configure recipient roles, users, and explicit email addresses when vendors are aligned.

### 5.2 Tag Vendor Procurement Modal
- **Modal Component**: Renders animated `<AnimatePresence>` modal on button click `"Tag Procurement (Vendor Needed)"` / `"Edit Vendor Request"`.
- **Form Bindings**: Textarea for vendor requirements notes (`vendorNoteInput`) and optional dropdown for specific procurement user assignment (`handleTagVendorProcurement`).

### 5.3 Ticket Details Vendor Status Banner
- Prominently placed under the **Details** section (`section-details`):
  - **Pending State**: Amber status banner (`⏳ Vendor Arrangement Requested`) showing requested service notes.
  - **Arranged State**: Emerald status banner (`✓ Vendor Arranged by Procurement`) showing arranged visit schedule and vendor details.

### 5.4 Sequence Activity Flow & Internal Trace Log
- **Sequence Activity Node**: Renders a dedicated pipeline stage node (with `ShoppingBag` icon and timestamps) between *Technician Assigned* and *Work Started*.
- **Internal Trace Log**: Displays all `vendor_procurement_*` activity log events (`vendor_procurement_tagged`, `vendor_procurement_updated`, `vendor_procurement_removed`, `vendor_procurement_arranged`, `vendor_procurement_arranged_updated`) with exact timestamps, user names, action titles, and details notes.

---

## 6. Inventory of Modified & Created Files

| File Path | Component / Layer | Summary of Technical Changes |
| :--- | :--- | :--- |
| `supabase/migrations/20260810_procurement_vendor_tagging.sql` | DB Migration | Added vendor procurement columns to `tickets` table and outbox triggers. |
| `supabase/migrations/20260811000000_add_properties_deleted_at.sql` | DB Migration | Added missing `deleted_at`, `is_active`, and `status` columns to `properties`. |
| `app/api/properties/route.ts` | Backend API | Added fallback catch for missing `deleted_at` column (`Postgres 42703`). |
| `app/api/tickets/[id]/tag-vendor/route.ts` | Backend API | Endpoint to tag procurement team, handles fallback `PGRST204`, resolves recipients. |
| `app/api/tickets/[id]/vendor-arranged/route.ts` | Backend API | Endpoint for procurement to arrange vendor, resolves recipients via `EmailRecipientResolver`. |
| `backend/services/EmailRecipientResolver.ts` | Service | Added `procurement_vendor_tag` and `procurement_vendor_aligned` feature key configs. |
| `backend/services/EventProcessor.ts` | Event Queue | Fixed outbox event processing to use `EmailRecipientResolver` for vendor outbox events. |
| `backend/services/EmailService.ts` | Email Service | Formatted HTML templates for vendor tag and vendor arranged emails. |
| `frontend/components/admin/EmailServiceSettings.tsx` | Admin UI | Added UI settings cards for vendor tagging & vendor aligned email configurations. |
| `app/tickets/[ticketId]/page.tsx` | Frontend Page | Added tag vendor modal, status banner, sequence pipeline step node, trace log rendering, and fixed TypeScript interface. |
