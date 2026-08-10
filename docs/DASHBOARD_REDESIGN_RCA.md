# Ops dashboard redesign — what the research found, and why the design came out bad

**Date:** 2026-08-02
**Status:** RCA. Remediation listed at the end is not yet applied.

---

## 1. Summary

Nine agents were commissioned to research design references and audit the codebase before
rebuilding the Operations Super Admin dashboard. **All eight research/audit agents returned
successfully, producing 284,864 characters of findings.**

**Almost none of it reached the design.**

The CSS design language, the card chrome, the type treatment, the spacing and the elevation
were written from my own judgement while the research sat unread on disk. The user's
assessment — "why does it feel so off", "crappy" — is correct, and traceable to that.

This document records what the research actually said, what was built instead, and the gap.

---

## 2. What was commissioned

One workflow, three phases:

| Phase | Agents |
|---|---|
| Design research | `awesome-design-md`, `aceternity + 21st.dev`, `refero + dribbble`, `widget-systems`, `glass + ambient alerts`, `data-viz for ops` |
| Codebase audit | `OrgAdminDashboard`, `module data APIs`, `existing design system` |
| Synthesis | one agent to fold all nine into a single build spec |

---

## 3. What came back

All 8 research/audit agents completed. Reports are vendored at
`docs/design-references/research/`.

| Report | Size | Headline finding |
|---|---|---|
| `awesome-design-md.md` | 29,014 | 74 production design systems mined; per-system verbatim scales |
| `glass-ambient.md` | 40,267 | Root cause of "dirty fog" glass on a near-white canvas + a calm-tech severity ladder |
| `aceternity-21st.md` | 44,151 | Aceternity's shadcn registry returns verbatim source; which effects die in light mode |
| `refero-dribbble.md` | 23,914 | Ops dashboard layout patterns; refero returns full token dumps via plain WebFetch |
| `dataviz.md` | 46,804 | Chart choice per ops story, with a palette validator actually run |
| `design-system.md` | 41,878 | This repo's token inventory. **`DESIGN_SYSTEM_GUIDE.tsx` is 0 bytes** |
| `api-map.md` | 31,181 | Endpoint + shape per module; the unauthenticated-route findings |
| `orgadmin-audit.md` | 27,655 | Structural map of the 4,259-line dashboard being replaced |

**The synthesis agent never ran.** The workflow was interrupted before phase 3, so no
consolidated spec was ever produced. That is the proximate cause — but not the root one.

---

## 4. Root cause

**The synthesis agent failing is not why the design is bad. The design is bad because I did
not read the eight reports that did return.**

The reports were on disk and readable the whole time. My actual consumption:

- `api-map.md` — grepped ~3,000 of 31,181 chars, for one endpoint shape
- every other report — the first ~180 characters, from a journal listing

I then wrote the entire design language from scratch.

Three compounding failures:

1. **I treated the synthesis agent as the only consumer of the research.** When it died, I
   proceeded as though the research had died with it. It had not.
2. **I did not verify visually until forced to.** The first time I rendered the cards and
   looked at them was *after* the user sent a screenshot calling it off. A Playwright
   render against the compiled stylesheet took four minutes and immediately exposed
   content overflowing every card — a defect that would have been obvious on day one.
3. **A stale-CSS bug masked the problem.** `next dev` does not recompile `globals.css` on
   save; only deleting `.next` picks it up. So the first screenshot showed cards with *no
   styling at all*, which I initially read as a design problem rather than a build problem.
   Real, but it delayed finding the actual design failures underneath.

---

## 5. The gap, specifically

What the vendored references specify, against what was built.

### 5.1 Elevation — the clearest failure

**Vercel** (`docs/design-references/awesome-design-md/vercel/DESIGN.md`), verbatim:

> "The brand uses **STACKED** shadows — multiple small offsets layered to fake natural
> light — **never a single 8-px-blur generic drop**. Inset hairline rings are always added
> so the card edge stays crisp."

Its five-level ladder, every level carrying the inset hairline:

```css
/* L1 */ box-shadow: 0 0 0 1px #00000014 inset;
/* L3 */ box-shadow: 0 0 0 1px #00000014 inset, 0px 2px 2px #0000000a, 0px 8px 8px -8px #0000000a;
/* L5 */ box-shadow: 0 0 0 1px #00000014 inset, 0px 1px 1px #00000005,
                     0px 8px 16px -4px #0000000a, 0px 24px 32px -8px #0000000f;
```

**What I shipped:** a single generic drop shadow. Exactly the thing the reference names as
the mistake. There is no elevation ladder at all — every card sits at one level, so nothing
on the board can be visually prioritised over anything else.

**Linear** adds: *"Subtle white edge highlight on the top edge of lifted panels"* and
*"avoid skipping levels"* in its four-step surface ladder. Neither was implemented.

### 5.2 Numeric typography — not implemented at all

**Binance** (`binance/DESIGN.md`) is the reference for dense financial data and specifies a
**separate numeric type scale**:

```
number-display  40 / 700 / 1.1 / -0.3px
number-md       16 / 500 / 1.4
number-sm       14 / 500 / 1.4
```

> "Display sizes use weight 700 — heavier than most marketing systems… numbers need to read
> at a glance, headlines need to compete with chart visualisations and dense data tables."

**What I shipped:** one type scale for everything. Metrics use the same weights and tracking
as labels. On a board whose entire job is numbers — ₹1.67cr, 50.2k kWh, 89.4% — this is the
single biggest legibility loss.

### 5.3 Spacing rhythm — inverted

**Vercel**, verbatim:

> "Inside a card, the headline/paragraph stack is tight (8px gap), then a wider gap before
> the CTA cluster. **Large gaps + tight interior, never the other way around.**"

**What I shipped:** near-uniform `mt-2.5` / `mt-3` throughout, and a 16px grid gutter. So
interior spacing and exterior spacing are nearly equal, which is what makes the cards read
as undifferentiated blocks with no internal grouping.

### 5.4 Density model — wrong reference class

**PostHog** is flagged in the library as *"cream canvas + white cards, best light-mode
density model"* — the closest analogue to our `#FAFBFC` canvas with white cards. Never opened.

**Binance** gives concrete row geometry for dense lists: 12px vertical row padding,
transparent row background, hairline divider between rows, 24px card padding. Our ranked
rows were built by eye.

Binance also warns semantic colours should be *"applied as text colour rather than badge
background"* and *"Don't use them as background fills on cards."* Our widgets use tinted
`rgba(...)` chip backgrounds throughout — arguably defensible for chips, but it was never a
decision, just a default.

### 5.5 Glass

**Apple** is the only real glassmorphism spec in the library: `saturate(180%) blur(20px)` at
80% opacity. The commissioned `glass-ambient.md` report additionally diagnoses why naive
blur on a near-white canvas reads as dirty fog.

This is the one area where the shipped result is close to right — the inset bevel highlight
and saturate boost are both present. But they were arrived at independently, not read, so
the surrounding values (opacity, blur radius) are unvalidated guesses.

Worth noting the library also contains the counter-argument: `cal/DESIGN.md` is explicitly
anti-glass. That trade-off was never considered.

---

## 6. What was NOT wrong

To be fair to the work that did land, and to keep the RCA honest:

- The **data layer** is sound and independently verified. The AOP importer reconciles to the
  rupee against the workbook's own Summary tab across all three months, and it caught two
  real defects in the source data (a ₹3.0cr rent misclassification, and Noida's stale month
  headers) plus one in its own first draft (a hardcoded year that would have silently
  overwritten a financial year).
- The **information design** — what each tile says — is defensible and mostly came from
  first-principles reasoning about the actual data: utilisation rather than raw spend,
  money-at-risk rather than bill count, same-days-last-month rather than a bare total,
  anomaly-guarded aggregates.
- The **audits** found genuine live bugs: three unauthenticated service-role routes, a GET
  that writes to the database, ticket counts that are `created_at` cohorts rather than live
  state, and a stock report field that is structurally always zero.

The failure is specifically **visual craft**: elevation, type scale, rhythm, density.

---

## 7. Remediation

### 7.1 Done

- **Vendored** all 74 `DESIGN.md` files into `docs/design-references/awesome-design-md/`.
  They were previously only in `/tmp`, one reboot from being lost. Stub `README.md`
  redirects stripped; only real design content kept.
- **Vendored** all 8 research reports into `docs/design-references/research/`.
- **Created `.claude/agents/frontend-designer.md`** — a subagent that must open the relevant
  `DESIGN.md` files and cite specific values before writing CSS, with a per-task routing
  table. This is the enforcement mechanism that was missing.

### 7.2 Not done

- **Rebuild the elevation system** on Vercel's stacked-shadow ladder with inset hairlines.
  Adopt at least three levels so the board can express priority.
- **Add a numeric type scale** per Binance. This is the highest-leverage single change.
- **Re-space the cards** to Vercel's tight-interior / loose-exterior rhythm.
- **Read `posthog/DESIGN.md`** and reconcile our light-mode density against it.
- **Read `glass-ambient.md`** and replace the guessed blur/opacity with its validated recipe.
- **Read `refero-dribbble.md`** for the ops layout patterns, and `dataviz.md` before any
  further chart work.
- Add the `frontend-designer` agent to `CLAUDE.md` so it is routed to by default.

---

## 8. Process lesson

Commissioned research has to be **read by whoever writes the code**, not delegated onward to
a synthesis step that may never run. And a visual change is not verified until someone has
looked at a rendered pixel — a typecheck passing and a route returning 200 says nothing
about whether the design is any good.
