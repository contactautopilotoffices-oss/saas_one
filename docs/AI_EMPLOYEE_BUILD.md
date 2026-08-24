# AI Employee — What We Build

This is the working document. Read this one.
(`AI_EMPLOYEE_PLATFORM_PLAN.md` and `AI_EMPLOYEE_PLATFORM_THESIS.md` are background.)

---

## Your ask, as the spine

You described a chain with five links:

```
1. Employee has a task
2. Agent checks she actually did it
3. Task connects to her goal
4. Her goal moves the company goal
5. Whole department does it  →  ROI
```

Plus one thing you said twice, which I under-built last time:

```
6. The agent helps SET the goal, not just track it
```

Everything below is these six links. Nothing else.

---

## Link 1 — The task

**What it is:** the specific thing Priyanka does that makes 48-hour delivery happen.

**Where tasks come from — two options:**

| Option | How it works | Problem |
|---|---|---|
| **A. She lists them** | Priyanka writes her tasks when setting the goal | Static list. Goes stale. She writes what she thinks she does, not what she does |
| **B. Agent generates them from real work** | Every open material request produces its own tasks: "raise PO for REQ-4471", "chase vendor on REQ-4468 — 26h elapsed" | Needs the request data to be readable |

**Build B.** A task list that regenerates from live work is always current and always specific. A written list is a document; generated tasks are the job.

**What this means concretely:** the agent looks at every open request each morning and produces Priyanka's task list for the day, ordered by which one will breach first.

---

## Link 2 — Checking she did it

This is the part that makes or breaks trust. Three kinds of proof:

| Proof | Example | Strength | Needs |
|---|---|---|---|
| **System** | PO raised at 14:32 — timestamp exists in the system | Strongest. No human input | Data must be readable |
| **Artifact** | Vendor chase email exists, delivery photo uploaded | Good | A place to attach it |
| **Claim** | She ticks a box saying she did it | Weak. Gameable | Nothing |

**Rule to hold:** every tracked task must have system or artifact proof. If a task can only ever be confirmed by someone saying so, either instrument it or stop tracking it. Don't track it on claims — a metric built on tickboxes tells you nothing and everyone knows it.

**Actionable:** take Priyanka's task list and mark each task S, A, or C. Every C is a decision: instrument it, or drop it.

---

## Link 3 — Task connects to goal

The 48 hours is not one block of time. It is spent in stages:

| Stage | From → To | Who controls it |
|---|---|---|
| 1 | Request raised → approved | Property admin |
| 2 | Approved → PO raised | **Priyanka** |
| 3 | PO raised → vendor dispatches | Vendor |
| 4 | Dispatched → delivered at site | Transport / site |

Add them up and you get the total TAT.

**Why this matters for your ask:** you said the agent should "track how she is doing." To do that honestly it has to know *which stage her tasks live in*. Her tasks sit in stage 2, plus chasing behaviour in stage 3.

**The consequence you need to decide on:** if the vendor takes 3 days, Priyanka misses 48 hours through no fault of hers. If the agent nudges her for that, she stops trusting it in the first week and the project is over. So her goal should be measured on the stages she controls, while the company goal stays on the full 48 hours.

**Actionable:** measure the four stages on real historical data before anything else. You will likely find one stage eats most of the time, and that finding alone is worth having.

---

## Link 4 — Her goal moves the company goal

Company goal: less friction and delay in site material delivery.

That needs a number, or it can't be moved measurably. Candidates:

- % of site material requests delivered within 48h
- Number of times site work stopped waiting for material
- Number of emergency local purchases at retail rates

**Recommendation:** use all three. The first is the headline. The second and third stop the first from being gamed — you can hit 48 hours by splitting shipments and buying locally at a premium, and both would look like success on the first number alone.

**How Priyanka's goal connects:** her stage-2 and stage-3 performance is one input into the first number. Other people own the other stages. When all stage owners have goals, the company number moves.

---

## Link 5 — Department scale → ROI

Same goal structure given to every procurement owner, then rolled up.

**To claim ROI you need three things, and two of them must exist before you start:**

1. **Baseline** — what the number was for 90 days before the agent existed. Must be captured and frozen first. Cannot be reconstructed convincingly afterwards.
2. **A holdout** — two comparable properties left off the agent for six weeks. Without this, you cannot separate the agent's effect from seasonality, a vendor change, or people simply behaving differently because they know they're measured. This costs nothing except patience.
3. **A value per unit** — what one hour of delay costs, or what one site stoppage costs.

**Actionable:** decide the holdout properties now, before Phase 1. It is free at the start and impossible to add later.

**On point 3:** if nobody can put a number on the cost of delay, report ROI in hours saved and stoppages avoided. That is still a real result. An invented rupee figure gets picked apart in the first review and takes the real findings down with it.

---

## Link 6 — Agent helps set the goal

You asked for this twice and I gave you a database table last time. Here is what it actually does.

When Priyanka sits down to set her goal, the agent should:

**1. Tell her where she stands today**
> "Over the last 90 days: median 44h, 90th percentile 71h. 18 of 210 requests took over 4 days."

**2. Tell her if the goal is reachable**
> "Of your 71h at the 90th percentile, 38h is vendor dispatch. Even with perfect performance on your own stages you'd land around 52h. 48h is not reachable this quarter without changing vendors or ordering earlier."

This is the most valuable thing the agent does, and it happens before any tracking starts. A goal that is arithmetically impossible demotivates the person and discredits the system.

**3. Propose a goal that is reachable and still a stretch**
> "Recommend: 90% within 55h this quarter. Separately, a vendor lead-time goal — that's where the real 20 hours are."

**4. Break it into tasks and checkpoints**
> "That means PO within 4h of approval, and first vendor chase at the 24h mark. Weekly check every Monday."

**5. Flag what could go wrong while she chases it**
> "Watch: cost per order, and emergency purchases. If those rise while TAT falls, we've moved the problem, not fixed it."

Steps 1 and 2 need only historical data — no AI required, and they are buildable in the first two weeks.

---

## What to do next — in order

| # | Action | Why it's first | Output |
|---|---|---|---|
| 1 | Pull 90 days of material requests. Compute real TAT, split across the 4 stages | Everything depends on this being possible. If the data won't support it, the plan changes | One chart: where the hours actually go |
| 2 | Check whether stage timestamps are complete | If transitions are logged on some paths and not others, every number after this is quietly wrong | Coverage % per stage |
| 3 | Sit with Priyanka for one hour. Write down what she actually does in a day | Link 1 needs the real task list, not an assumed one | Task list |
| 4 | Mark each task S / A / C for proof type | Link 2. Decides what's trackable | Annotated task list |
| 5 | Decide clock start and stop (see questions) | Changes who gets measured on what | One line, written down |
| 6 | Pick the two holdout properties | Free now, impossible later | Two property names |

Steps 1–6 take about two weeks and contain no AI. **Do not skip them to get to the agent faster.** If step 1 shows the data can't support a stage-level TAT, then an agent built on it would be confidently wrong — and confidently wrong in front of the procurement team is the one failure you can't recover from.

After that:

| Phase | Weeks | What ships |
|---|---|---|
| Goal setting | 2 | Agent does Link 6 steps 1–3 for Priyanka. She sets a real goal from real data |
| Tracking | 3 | Daily task list, stage-level tracking, verification. Agent watches but sends nothing for the first 2 weeks — you read what it *would* have sent and check it's right |
| Nudging | 2 | Agent starts messaging. Message budget, escalation path, and a way for her to reply "blocked because X" |
| Department | 3 | Same structure for other owners. Rollup. Holdout running |
| ROI | 2 | Baseline vs now vs holdout |

---

## Questions I need answered

These change what gets built. Ordered by how much.

**1. Where does Priyanka actually do this work today?**
Your procurement module, Zoho, WhatsApp, email, a spreadsheet — or a mix?
*Why it matters:* determines whether stage timestamps exist at all. If most of it happens in WhatsApp, the first job is capturing the work, not measuring it, and that changes the whole first phase.

**2. When does the 48-hour clock start, and when does it stop?**
Start: when the site raises the request, or when it's approved?
Stop: when material reaches the gate, or when site accepts it?
*Why it matters:* decides whether Priyanka is measured on approval delays she doesn't control. This is the single most consequential decision on this list.

**3. Which stages does Priyanka actually own?**
My guess is stage 2 fully, and chasing in stage 3. Correct me.
*Why it matters:* she gets nudged for these and nothing else.

**4. Who owns the other stages, and will they get goals too?**
*Why it matters:* if only Priyanka has a goal, she absorbs blame for a chain she doesn't control, and the company number won't move much. If nobody else is willing to take a goal, that's worth knowing now.

**5. Do we have 90 days of usable history?**
*Why it matters:* no baseline means no ROI claim later. If history is thin, we spend 90 days measuring before the agent does anything — that's a real timeline change worth knowing up front.

**6. What does a late delivery actually cost?**
Idle site labour? Rework? Client penalty? Or mainly frustration?
*Why it matters:* decides whether ROI is stated in rupees or in hours and stoppages. Both are fine. Guessing is not.

**7. Is Priyanka a volunteer for this?**
*Why it matters:* the first person shapes whether the team reads this as help or as surveillance. If she asked for it, we build differently — more openly, faster — than if she was assigned it.

---

## Two things I'd hold to

**She sees her own numbers before her manager does.** Always. If someone is first shown their own metric in a review, they will stop feeding the system honestly, and the data quietly degrades from that day. This costs nothing to build in now.

**Every goal carries a guardrail.** "48 hours, without cost per order rising and without emergency purchases rising." A goal chased hard enough with no guardrail moves the problem sideways instead of fixing it — faster delivery bought with premium freight and local retail purchases is not a win, and it will show up in someone else's budget.
