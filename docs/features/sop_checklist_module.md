# SOP Checklist Module - Feature Documentation

## Overview
The Standard Operating Procedure (SOP) Checklist module allows property management staff to run daily, weekly, monthly, and on-demand checklists with camera-based verification, AI scoring, and CAD floorplan overlays.

---

## Database Schemas

### 1. `sop_templates`
- `id`: UUID (Primary Key)
- `property_id`: UUID (FK to `properties.id`)
- `organization_id`: UUID (FK to `organizations.id`)
- `title`: TEXT (NOT `name` - template title)
- `description`: TEXT
- `category`: TEXT
- `frequency`: TEXT ('daily', 'weekly', 'monthly', 'on_demand')
- `assigned_to`: TEXT[] (Array of user IDs or roles)
- `start_time`: TIME
- `end_time`: TIME
- `is_active`: BOOLEAN
- `is_running`: BOOLEAN

### 2. `sop_checklist_items`
- `id`: UUID (Primary Key)
- `template_id`: UUID (FK to `sop_templates.id`)
- `title`: TEXT
- `description`: TEXT
- `requires_photo`: BOOLEAN
- `requires_comment`: BOOLEAN
- `is_optional`: BOOLEAN
- `reference_photo_url`: TEXT
- `cad_area_id`: TEXT

### 3. `sop_completions`
- `id`: UUID (Primary Key)
- `template_id`: UUID (FK to `sop_templates.id`)
- `property_id`: UUID (FK to `properties.id`)
- `organization_id`: UUID (FK to `organizations.id`)
- `completion_date`: DATE
- `status`: TEXT ('assigned', 'in_progress', 'completed', 'missed')
- `is_late`: BOOLEAN
- `completed_by`: UUID (FK to `users.id`)
- `completed_at`: TIMESTAMPTZ

### 4. `sop_completion_items`
- `id`: UUID (Primary Key)
- `completion_id`: UUID (FK to `sop_completions.id`)
- `checklist_item_id`: UUID (FK to `sop_checklist_items.id`)
- `is_checked`: BOOLEAN
- `checked_by`: UUID (FK to `users.id`)
- `checked_at`: TIMESTAMPTZ
- `photo_url`: TEXT
- `video_url`: TEXT
- `comment`: TEXT
- `value`: TEXT

---

## Outbox Triggers
- **`trg_sop_runs_outbox`** ON `public.sop_completions`:
  - Fires `AFTER INSERT OR UPDATE OF status ON public.sop_completions`.
  - Function: `public.fn_sop_runs_outbox()`.
  - Queries `title` from `public.sop_templates` (using `template_id`).
  - Publishes `SOP_STARTED` or `SOP_COMPLETED` events to `public.event_outbox`.

---

## API Endpoints
- `GET /api/properties/[propertyId]/sop/completions`: Lists checklist completion sessions.
- `GET /api/properties/[propertyId]/sop/completions/[completionId]`: Fetches a single session with items.
- `PUT /api/properties/[propertyId]/sop/completions/[completionId]`: Updates completion session status or individual item checks/photos.
- `POST /api/properties/[propertyId]/sop/completions/[completionId]/score-photo`: Runs AI cleanliness scoring.
