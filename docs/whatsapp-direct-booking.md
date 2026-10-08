# Direct WhatsApp booking requests

A clear instruction such as **“Book Boardroom today from 5 PM to 6 PM”** can
start a booking without HI or a menu selection. Once the property, room, date
and times resolve unambiguously, the backend books immediately. This also works
after choosing Book Meeting Room from the menu.

- One permitted property is selected automatically. Multiple permitted properties
  require an exact property name or a choice from the displayed list.
- Missing room, date or times produce a formatted follow-up. An automatic booking
  requires a room name or an explicit selection from the displayed room choices.
  Supplied details are retained for 20 minutes while the user completes the request. Direct automatic
  bookings require an explicit date, even when the organization's reviewed flow
  defaults missing dates to today. Relative dates stay attached to the calendar
  date when the user supplied them.
- A property selected in a legacy booking flow is retained only if current
  access checks permit it. Old room/time/date fields and operation IDs are discarded.
- Negated, conditional, informational and task commands do not start automatic
  booking. Unknown, stale and Task Manager quotes still require clarification.
  Explicit task commands continue through the existing Task Manager handler.
- The LLM extracts source-backed phrases. The app resolves authorized records,
  validates future times, slot coverage and availability, and performs an atomic
  booking transaction. Only tenant roles require meeting-room credits.
- Explicit location constraints are checked even if the model omits them. Multiple
  recognized property/room names, dates or time ranges require a choice rather than executing
  a model-selected subset. These checks supplement the model; unsupported or
  ambiguous wording still needs a clarification.
- A committed operation is recovered before checking its occupied slot on a
  retry. Existing request uniqueness and database overlap protection remain.
  Completion messages continue through the existing notifications/outbox.
- An explicitly supplied purpose such as **“for BD”**, **“for tech team”** or
  **“for a client meeting”** is saved in the booking's existing notes field.
  It is optional (up to 500 characters); omitted notes remain empty. It does not
  change the authenticated booker, attendees, permissions or credit policy.
  Notes are retained while collecting missing details and stored in the initial
  booking transaction so the outbox includes them without a second update.

The exact **Book Meeting Room** menu command still collects details. Providing
details alone shows a review requiring **Confirm Booking**; an explicit instruction
to book enables immediate execution. Tickets still require **Submit Ticket**.

## Deployment and testing

This change adds no environment variables or AiSensy templates.
It uses the existing interpreter settings, Groq model/key and Project API sender.
The tenant credit migration from the preceding booking-credit change remains a
prerequisite: `supabase/migrations/20261006000001_whatsapp_tenant_booking_credits.sql`.
After that migration, run `supabase/migrations/20261006000002_whatsapp_booking_purpose.sql`
before deploying the optional-notes code. It adds a service-only range-booking RPC
overload accepting notes and preserves the seven-argument RPC as a wrapper. It
does not alter tables, existing bookings or credit balances. It can be rerun.

Test with a future time in your permitted property:

> Book Boardroom tomorrow from 5 PM to 6 PM for BD

For a user with multiple properties, include the exact property name or answer
the property question. Check the actual app booking and existing completion
notification. Also test missing dates, unavailable slots, tenant credit failure,
Task Manager replies, omitted notes and duplicate delivery. Local checks use simulated provider
responses; live Groq/AiSensy delivery requires the deployed configuration.
