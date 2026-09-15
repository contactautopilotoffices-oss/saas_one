# ⚛️ REACT & UI COMPONENT CONTRACT RULE

To ensure clean, lag-free UI components that never crash or missing edge-case states, EVERY React component created or modified in `frontend/` MUST fulfill this contract:

---

## 1. MANDATORY THREE UI STATES
Every dynamic component (lists, dashboards, modals, stat cards) MUST implement:
1. **Loading State**: Show smooth skeleton loaders (`<Skeleton />` from `frontend/components/ui/Skeleton`) while fetching data. Never leave blank white screens.
2. **Empty State**: When `data.length === 0`, show a clean empty state indicator with an icon and clear message (e.g. *"No tickets found for this period"*).
3. **Error State**: Handle fetch failures gracefully with a retry button or error banner, without crashing the page.

---

## 2. STATE & EVENT PERFORMANCE
- **Optimistic Updates**: For check actions, button toggles, or status updates, update the UI state optimistically first, then trigger background sync.
- **Audio Feedback**: For check/complete actions, play tickle sound (`playTickleSound()` from `frontend/utils/sounds`).
- **Memory Leaks**: Clean up `setInterval`, `setTimeout`, and Supabase realtime subscriptions in `useEffect` cleanup return functions.

---

## 3. SECURITY & RLS SEPARATION
- **Frontend Components**: Use `createClient()` from `@/frontend/utils/supabase/client` for real-time channels and user-authenticated queries.
- **Backend API Routes (`app/api/`)**: Use `supabaseAdmin` from `@/backend/lib/supabase/admin` for privileged database writes after verifying session auth (`supabase.auth.getUser()`).
