# Ops Board — Design Audit & Direction (v2, grounded)

Scope: **super-admin roles only.** The widget board (`OpsBoard`) is mounted only
in `OrgAdminDashboard.tsx`, which `UnifiedDashboard.tsx` renders exclusively for
`org_super_admin` / `org_admin`. Every change below is inside `.w-*` classes and
the `widgets/` components, so no other role's UI is touched. The app-wide
`--canvas-bg` and `.glass-card` are deliberately **not** modified; canvas chroma
is scoped to the grid via `.ops-grid-canvas`.

Sources read in full before writing any CSS (per the RCA — the first draft of
this work guessed, and guessed wrong on three counts):

- `docs/design-references/research/glass-ambient.md` — glass + severity ladder
- `docs/design-references/awesome-design-md/vercel/DESIGN.md` — elevation, spacing
- `docs/design-references/awesome-design-md/binance/DESIGN.md` — numeric type scale
- `docs/design-references/awesome-design-md/posthog/DESIGN.md` — light-mode density
- `design.md` (monopo saigon) — motion curve, label discipline, restraint budget
- Dribbble 27612526 (crypto) and 25860030 (HR), pulled and read visually

---

## 1. What the references taught

### Crypto dashboard (27612526) — crisp
Surfaces are essentially **opaque**; sharpness comes from a hairline edge +
tight stacked shadow, not blur. One ink-dark anchor card against the pale
board. One figure per card, set large. Pills for state.

### HR dashboard (25860030) — alive + intelligent
The **insight strip**: *"Engagement rose +17% but participation shows a
downward trend"* — a tinted, icon-led line *below* the chart. The chart gives
data; the strip gives meaning. That is "intelligence, not numbers," and it is
now a first-class part of the shell (`.w-insight`), not a stray `<p>`.

### monopo (design.md) — the discipline
Patient motion: `cubic-bezier(0.19, 1, 0.22, 1)`, transforms over position.
Chrome labels whisper at ~11px with wide tracking. Restraint is the loudness
budget: one chromatic gesture, one looping element; everything else quiet.

### glass-ambient.md — the validated recipes (the ones I got wrong first)
- **Blur is a no-op on our canvas.** `blur(20px)` over a 1200px-feature,
    near-white gradient averages to itself; the flat `rgba(255,255,255,.55)`
    tint on top is the "dirty fog" (A0). Fix = asymmetric tint + 1px gradient
    rim + dual inset highlight, with blur **opt-in** (`.is-live`, ≤3 cards).
- **The bevel needs a PAIR of lines.** Bright 1px specular + a dark step
    directly beneath; the bright line alone is why glassmorphism looks like
    stickers. Target ΔL* 2.5–4.0; the classic `.6`-alpha highlight is ΔL* ≈ 0.4
    — literally invisible in light mode (A2).
- **Severity: health is communicated by ABSENCE** (B0). Twelve green dots is
    twelve lights. L0 renders nothing. Shape is the redundant channel
    (solid → +halo → +rim+shadow), never colour alone — peripheral vision is
    rod-dominated. The **glass rim itself carries severity** (B2 note: "the 1px
    specular highlight that already sells the glass becomes the carrier").
- **Exactly one looping element on the entire screen** (B1). Lead-tile
    arbitration lives in the grid, not per card.
- **Freshness is a property, not an event** (B3). Properties get *type*;
    events get dots. So no breathing dot on the timestamp — plain tabular
    text, amber only when actionable.
- **Habituation >2 min**: anything looping that long stops being seen. So
    data moves when it *changes* (one-shot tick), which is the only motion
    that carries information.

### Vercel — elevation & spacing
"STACKED shadows… never a single 8-px-blur generic drop. Inset hairline rings
are always added" — the old `--w-shadow` was the named mistake. Now a 3-rung
ladder (rest L2 / hover L3 / drag L5, verbatim offsets). Spacing philosophy:
"large gaps + tight interior, never the other way around" → grid gutter
16→24px, card interior padding compressed.

### Binance — numeric type scale
Numbers get their own ramp: `number-display 40/700/1.1/-0.3px`, `number-md
16/500`. Our metrics were 800-weight sharing chrome tracking — the biggest
legibility loss on a board that is nothing but numbers. Now 700/1.1/-0.3px,
tabular figures.

---

## 2. What shipped (all additive, super-admin board only)

`app/globals.css` — widget block rewritten:

- **Glass v2 tokens**: asymmetric tint stops, gradient rim stops, dual inset
  highlights, `saturate(180%)` + `brightness(1.02)` for the opt-in live blur,
  thickness-by-size (`data-size` → radius 16/20/22/26px + blur 14/20/24/28px,
  Apple's Liquid Glass "thicker material" rule — makes resize feel physical).
- **`.w-card`**: `border: 0` (rim is a masked gradient `::before`, bright at
  the top arc → primary-tinted at the bottom), inset bevel pair + Vercel
  stacked shadow in one declaration, `isolation: isolate` (Safari fix).
- **Severity ladder**: `ok` = nothing; `info` = solid secondary dot, one entry
  pop; `warn` = 7px dot + halo + rim recolour; `critical` = 8px dot + halo +
  full rim + red-cast shadow. Loop only with `[data-lead='true']`; heartbeat is
  0.55Hz with 8% rise / 26% fall / 66% dwell — a heartbeat, not a strobe.
- **`data-tone='ink'`**: the opaque dark anchor (crypto move), glow painted
  inside, inverted text. CSS ships; wiring to one widget is the next pass,
  after visual verification.
- **`.w-insight`**: the intelligence strip (HR move), spark icon + tinted row.
- **`.w-tick`**: one-shot 4px rise + fade on value change (transform+opacity
  only — never forces a re-blur).
- **`.ops-grid-canvas`**: brand-hue chroma washes (α ≤ 0.10) behind the grid
  only, so the tint has something to separate from. App canvas untouched.
- **Reduced motion**: all loops written 0% ≡ 100% so the global blanket lands
  on the correct static frame; critical gains a static inset edge bar as the
  non-motion channel.

`WidgetShell.tsx` — `data-size`, `data-lead`, `data-tone`; headline renders as
`.w-insight` with a spark icon; `Metric` re-keys on value so the tick fires
once per change; xl metric now 40px per Binance number-display.

`WidgetGrid.tsx` — severity registry + **arbiter** (highest severity wins,
ties break by position; exactly one `lead`); grid gutter 16→24px; rows at the
documented 152px; `.ops-grid-canvas` on the grid.

---

## 3. What "alive electricity" means here, precisely

Not shimmer. Four motions, three of them one-shot:

1. **Critical heartbeat** — the rim of the lead critical card breathes at
   0.55Hz. The only loop on the board; it *is* the current in the wire.
2. **Value tick** — when a number changes, it rises 4px and fades in over
   500ms on the patient curve. Data that moves when it changes is what makes
   a board feel live rather than refreshed.
3. **Entry pop** — a new info signal scales in once, 220ms, then holds still.
4. **Hover glide** — 360ms patient-curve lift on the elevation ladder.

Everything else is static, by design: habituation research says a fifth loop
would be invisible inside two minutes and would devalue the one that matters.

## 4. Explicitly rejected

- *App-wide `--canvas-bg` / `.glass-card` changes* — out of scope (super-admin
  only); `.glass-card` remains the known-foggy recipe for the rest of the app,
  flagged for a separate pass.
- *Breathing dot on the freshness stamp* — B3: freshness is a property, and
  properties get type, not dots.
- *Bevel drift / ambient shimmer loops* — habituation; also violates the
  one-loop budget.
- *Iridescent page backdrop from the target mock* — monopo's one-gesture
  budget; the board's gesture is the ink anchor + chroma canvas.
- *Radius change to monopo's 0/75 jump* — wrong tool for a 12-tile grid; we
  take the discipline (few radii, consistent), not the values.
