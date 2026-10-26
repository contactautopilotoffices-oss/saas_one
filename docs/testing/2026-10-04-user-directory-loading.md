# User Directory scope and loading regressions

Implemented for the user-management requirements supplied on 2026-10-04. Local validation ran on 2026-10-05.

## Behavior

`frontend/components/dashboard/UserDirectory.tsx` waits until `orgId` or `propertyId` is available. An unresolved scope displays a waiting message and sends no list request. Each scope change clears prior rows, the selected profile, and property-assignment display caches.

List loads have separate waiting, loading, successful, and error states. Non-successful HTTP responses, transport failures, and malformed successful responses display an accessible error alert with **Retry**. “No users found” appears only after a successful response with a users array, including when filters remove every returned row.

Every new list request invalidates and aborts the prior request. The request ID protects state even if a transport ignores cancellation. Responses from earlier organization/property requests cannot replace rows, introduce an error, or finish the current request’s loading state. Effect cleanup invalidates pending requests on scope changes and unmount, including React StrictMode cleanup.

Approval and rejection send `organizationId`, preferring the current directory organization and otherwise using the organization returned on the scoped membership row. Only the component’s explicit `propertyId` is sent. Organization-only actions omit `propertyId` so a merged row’s first property cannot narrow organization approval/rejection to an arbitrary property. Property-scoped actions always use the selected component property. The directory profile display uses fields supplied by the list endpoint; it does not query or depend on a `users.organization_id` column. Membership authorization and employee-profile organization resolution remain server-side responsibilities.

## Automated fixture

Run:

```sh
node --test tests/users/directory-loading.test.mjs
```

The test bundles the real component using the repository’s existing Next webpack and TypeScript packages, then runs installed Chromium through Playwright. No dependency download is necessary. The fixture uses a loopback HTTP server, mocked identity/database boundaries, inert ancillary dialogs, and controlled HTTP responses. It runs the component in React StrictMode and deliberately ignores AbortSignal in deferred responses to prove request invalidation is effective independently of cancellation. It does not access a live database or send notifications.

Twelve browser regressions cover:

- No request or empty state before scope hydration; successful empty organization load.
- API error details, visible Retry, and successful retry to an empty response.
- Transport errors and malformed successful payloads.
- Stale organization success after the current organization succeeds.
- Stale property failure while a newer property request is still loading.
- Clearing rows and the open profile when scope disappears, awaiting the profile’s exit animation by DOM condition.
- Approval and rejection across organization-only, organization-plus-property, and property-only scopes (six cases). Organization-only payloads omit the arbitrary row property; property-scoped payloads use the selected property, and property-only payloads retain verified membership-row organization context.

The initial eight tests failed against the original component for the expected missing behavior before the component was edited. Six expanded action-scope tests also failed against the first implementation because it used the arbitrary row property, while six loading tests remained green. All twelve passed after correcting action property scope. The sandbox may require loopback/browser network capability even though the fixture makes no external requests.

Focused lint on the component and test reports seven existing `no-explicit-any` errors and eight existing unused-import/variable or image warnings. The component at HEAD has seven errors and nine warnings; this change removes its prior missing effect dependency warning and adds no lint findings. The test file itself has no lint findings. `git diff --check` passes for the changed files. Repository TypeScript and broader suites are recorded in the combined delivery verification.

## Manual preview checks

1. Open User Management while organization/property context is resolving. Confirm no unscoped `/api/users/list` request occurs.
2. Make the list endpoint return a 403/500 or interrupt connectivity. Confirm an error and Retry appear, with no “No users found” state. Restore the endpoint and retry.
3. Load a valid empty directory; confirm its empty state appears only after the response succeeds.
4. Throttle list responses and switch organization/property before the earlier request completes. Confirm the latest scope stays visible even when the earlier response arrives last.
5. Open a user profile, then switch scope. Confirm old rows and the profile disappear.
6. Approve/reject a pending fixture membership and inspect the request body for the current `organizationId`. Organization-only actions must omit `propertyId`; property-scoped actions must send the component’s selected property. Confirm backend scope validation separately.

The automated fixture verifies component behavior rather than the complete authenticated dashboard or live membership data. Real-record actions and outbound notifications were not exercised.
