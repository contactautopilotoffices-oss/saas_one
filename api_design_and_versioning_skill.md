# AI Developer Directive: API Design & Mobile-Web Versioning Rules
**Identifier:** `API_VERSIONING_SKILL`  
**Purpose:** Enforce strict backward compatibility and API versioning rules across the Web app (`saas_one`) and Mobile app (`saas_mobile`) to prevent production crashes on user devices when deploying web features.

> [!IMPORTANT]  
> All AI Coding Assistants (including Antigravity) working on this repository **MUST** load and adhere to these guidelines before creating, modifying, or deleting any API routes or database models.

---

## 1. The Golden Rule of Mobile APIs
Unlike web clients where new code is deployed to all users instantly, **mobile users update their apps sporadically.** A user might run Version `1.0.0` for months while the server is on Version `2.5.0`.
*   **NEVER modify an existing API response key or payload shape.**
*   **NEVER make a previously optional request parameter mandatory.**
*   **NEVER delete an existing API endpoint** unless you have verified from telemetry that *zero* legacy mobile app versions are calling it.

---

## 2. API Versioning Conventions
When creating or refactoring endpoints inside Next.js Route Handlers (`saas_one/app/api/`) or your intermediate servers:

### Directory Structure:
Any new API or major refactor MUST follow the `/api/v{N}/` convention.

```
saas_one/app/api/
├── v1/
│   ├── tickets/
│   │   └── route.ts         <-- Frozen legacy API (Used by older Mobile apps)
│   └── sop/
│       └── route.ts         <-- Legacy checklist runner API
└── v2/
    ├── tickets/
    │   └── route.ts         <-- Modernized API (Used by Web and newer Mobile updates)
    └── sop/
        └── route.ts         <-- Modernized SOP API with removed slot locks
```

### Transitioning Guidelines:
If you need to update an API structure:
1.  **Clone the existing route** from `v1` to `v2`.
2.  Apply the new logic and structural updates strictly in the `v2` directory.
3.  Modify the Web App and the *latest* Mobile App branch to point to `v2`.
4.  Leave the `v1` endpoint completely untouched, functioning as-is for older clients.

---

## 3. Database Schema Mutations
Modifying Supabase tables directly is highly risky for live mobile apps.

*   **Destructive Alterations (Forbidden):** Never drop columns, rename columns, or change column types (e.g., `text` to `jsonb`) if those tables are queried by the mobile client via direct Supabase RLS client bindings (`mobileServices`).
*   **Safe Evolutions (Allowed):** 
    *   Adding new columns is safe **ONLY if they are nullable or have a default value.**
    *   Adding new optional tables is completely safe.
*   **Deprecation Strategy:** If a column `old_status` is being replaced by `new_status`, keep both in the database. Use a database trigger to automatically synchronize `old_status` when `new_status` is updated, preserving compatibility for older mobile builds.

---

## 4. Response & Payload Designing for AI
When writing code for API responses or request parsers, adhere to these programming models:

### A. Null-Safety & Default Values
Older apps might not handle missing keys safely. Always return structural default values.
```typescript
// BAD: Missing properties or undefined keys will crash old React Native models
return NextResponse.json({
  success: true,
  data: tickets.map(t => ({
    id: t.id,
    status: t.status
    // omitted fields will cause 'Cannot read property of undefined' crashes
  }))
});

// GOOD: Always provide fallback defaults
return NextResponse.json({
  success: true,
  data: tickets.map(t => ({
    id: t.id,
    title: t.title || "No Title",
    status: t.status || "open",
    assigned_to: t.assigned_to || null,
    metadata: t.metadata || {} // Fallback object instead of leaving undefined
  }))
}))
```

### B. Graceful Request Payload Fallbacks
If a request comes from an older app without a new mandatory field, the server must handle it gracefully without returning a `400 Bad Request`.
```typescript
// inside route.ts POST/PUT handler
const body = await request.json();

// Fallback logic for legacy mobile payloads
const priority = body.priority || 'medium'; // Provide defaults for missing parameters
const isInternal = body.is_internal !== undefined ? body.is_internal : false;
```

---

## 5. Automated AI Pre-Flight Checklist
Before applying any change to an API or service file, the AI assistant **MUST** self-evaluate using the following prompts and log the answers in the thought trace:

1.  *Is this endpoint or service used by the mobile app?*
2.  *Am I changing the return signature (JSON keys, data types) of this endpoint?*
    *   *If Yes: I must create a new API route version (e.g., `/v2/`) and preserve the old one.*
3.  *Am I introducing database migrations?*
    *   *If Yes: Are the new columns nullable/defaulted?*
4.  *Have I updated the mobile client service files (`mobileServices.ts` / `mobileApi.ts`) to adapt to versioning cleanly?*

---

## 6. How to Invoke This Skill
If you are starting a task that involves API changes, prompt the AI like this:
> *"Implement feature X. Please load the guidelines in `api_design_and_versioning_skill.md` and verify that all database mutations and endpoint refactors remain 100% backward compatible for mobile users."*
