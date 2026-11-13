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
- `POST /api/properties/[propertyId]/sop/completions/[completionId]/approve-step`: Checker sign-off for one step (admins or the assigned checker only).
- `GET|POST /api/properties/[propertyId]/sop/completions/[completionId]/ai-feedback`: Checker corrections on AI parameter verdicts (GET also returns `can_review`).

## Strict parameter checks and checker learning (2026-11)
- Reference photos are treated as **angles**. The AI decides which parameters belong to which angle, matches each staff photo to an angle (`matched` / `angle_mismatch` / `missing`), and must report every configured parameter as `pass`, `needs_attention`, `fail` or `not_visible`.
- A parameter that is `not_visible` (or that the AI did not report) is flagged and the step gets `ai_needs_review = true`. It no longer passes silently. `pass` also needs every angle matched, no failed parameter, and a score at or above the property's `ai_scoring_threshold`.
- In the completion detail, the assigned checker or a property/org admin can mark each parameter "AI is right" or "AI is wrong" and choose the correct status, with an optional note. Rows go to `sop_ai_feedback`.
- On the next scoring, corrections for the same step, and for parameters with the same name on other checklists in the organization, are added to the prompt as standing rules.
- Photos are stored as relative `/api/storage/...` links; the scorer now reads them straight from Supabase storage (`lib/sop/checklistAiReview.ts`).
- Migration: `supabase/migrations/20261112000001_checklist_ai_parameter_feedback.sql` (applied by a human).

## Agent Spec: Checklist vision scorer

**1. Workflow or agent?** workflow `[BAA p.104]`
   Justification `[BAA p.115]`: the path is fixed (load photos → load checker corrections → one vision call → rules in code → save), so neither (a) nor (b) applies. No tools, no loop.
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: no deterministic path exists for judging cleanliness from photos. The previous prompt is the baseline; no A/B on a fixed case set has been run yet (see 10).

**2. Context** `[BAA p.112]`
   Reference angle images with labels, staff photos, the step's parameter names, the shift dates, the property's pass threshold, and up to 25 checker corrections (this step first, then the same parameter name elsewhere in the organization). Nothing from other properties or organizations.

**3. Cost of a false positive** `[BAA p.112]`
   High: a wrong "pass" hides a dirty area from the checker. So the rules in code override the model: anything unseen is flagged for a human, and pass needs every parameter seen. Model tier unchanged: `qwen3.8-27b` on engy.ai, backup Groq `GROQ_VISION_MODEL`; changing provider was out of scope.

**4. Tools** none. Structured JSON output only.
   | tool | when-not-to-use reviewed `[BAA p.107]` | errors as text `[BAA p.94]` | args validated `[BAA p.93]` | MCP `[BAA p.106]` |
   |---|---|---|---|---|
   | (none: structured output only) | N/A | N/A: unreadable reply returns 502, missing parameters become `not_visible` | yes: every configured parameter is mapped back by normalized name; statuses outside the enum become `not_visible` | N/A |

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: yes (5). Explicit no-skip clause: yes ("do every step, in order, do not skip any"). Single-shot tone example: partial (example reasons and staff messages inline, no full worked example). Terminal state written to data: `ai_cleanliness_score`, `ai_parameter_scores`, `ai_photo_matches`, `ai_pass`, `ai_needs_review`, `ai_analyzed_at`.

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat? Yes: the same steps are photographed every shift. Write path is the checker, not the model (`ai-feedback` route). Scope-key rejection `[BAA p.101]`: the route refuses a parameter the AI did not score on that step and any status outside the enum, and only the assigned checker or an admin may write.

**7. Multi-agent?** `[BAA p.116]` Single prompt. One scorer per step; the test sandbox (`test-vision`) still has its own copy of the old prompt, so a change here cannot regress it, but they will drift.

**8. Evaluation: all four axes** `[BAA pp.118–119]`
   System: server logs per failed image load and per provider failure; `modelUsed` in the response.
   Quality assurance (rubric) `[BAA pp.96–98]`: **NOT BUILT.** The checker corrections in `sop_ai_feedback` are the natural labelled set (AI verdict vs. human verdict per parameter) for a rubric and an agreement rate.
   Tool interaction `[BAA p.95]`: N/A (no tools). The equivalent check is how many parameters come back `not_visible` and how often checkers overturn the AI; both are readable from saved data.
   Agent efficiency `[BAA p.119]`: one call per step; at most 5 + 5 images at 640px; corrections capped at 25 lines. Tokens are not recorded.

**9. Trace** `[BAA pp.119–120]`
   Run/step telemetry wired: no (only the saved result and logs). Ad-hoc single-agent testing before scale `[BAA p.116]`: not done in this change; needs a run against real photos after the migration is applied.

**10. Laws knowingly violated, and why:**
   - L2 (no A/B vs. the old prompt on a fixed case set): no labelled set existed. The correction table creates one; run the A/B once enough corrections exist.
   - L5/L6 (no rubric, no manual audit %): same reason; do not quote an accuracy number for this scorer yet.
