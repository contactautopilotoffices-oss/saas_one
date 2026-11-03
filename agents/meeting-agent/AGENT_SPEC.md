# Meeting agent — Ira in FMS meeting rooms

People meet in a room inside FMS. One of our agents is in the room. The first topic
is a review of purchase orders stuck at "pending approval" in Zoho: Ira reads each
one, asks who owns it and what should happen, writes the decision down under the
name of the person who said it, and moves on. An approver confirms the decisions
afterwards. Nothing in Zoho changes because of anything Ira does.

- Agent: `agents/meeting-agent/` (Python, LiveKit Agents 1.8.5, runs on LiveKit Cloud)
- FMS side: `app/api/meetings/*`, `backend/lib/meetings/*`, screens `/[orgId]/meetings`
- Schema: `supabase/migrations/20261006000003_meetings.sql`
- Speech and model: Sarvam end to end — Saaras v3 (codemix) listening, `sarvam-105b-conversations` thinking, Bulbul v3 "kavya" speaking

## Listen-only mode (default since 2026-10-15)

The founder asked that Ira not talk. `MEETING_AGENT_MODE=listen` (the default) gives her no voice and no text output in the room: people run the meeting themselves with the agenda on screen, and Ira silently transcribes, follows which PO is being discussed, and writes proposed decisions. `MEETING_AGENT_MODE=speak` restores the chaired meeting described below.

What changes against the spec below:
- **3. False positive** `[BAA p.112]`: there is no spoken read-back ("सही है?"), so a misheard decision is no longer corrected in the room by default. It still lands only as a *proposal*; the room sees it appear live on the meeting page and can say a correction, and an approver confirms or rejects each one afterwards. Cost stays **medium**.
- **4. Tools** `[BAA pp.93, 107]`: one tool added, `focus_item(position)`: switch to the PO the room moved to. When-not-to-use is in its description (not for the item already current). The argument is checked against the agenda; an item left without a decision goes back to `pending` (FMS's agent endpoint now accepts `pending`), never silently `parked`. Errors come back as text.
- **5. Prompt** `[BAA pp.105, 114]`: its own five ordered steps with a no-skip clause and "when unsure, stay_quiet". There is no tone example, because nothing she writes is heard or shown.
- **8. Tool interaction** `[BAA p.95]`: expected per message: `focus_item`? → `record_decision` | `park_item` | `note_rule` | `stay_quiet`, with `next_item` after a decided item. **Not yet tested** in listen mode; the 2026-10-06 tests cover speak mode only. This is a known gap under L5.

## Agent Spec — Ira (meeting rooms, PO approvals topic)

**1. Workflow or agent?** Agent. `[BAA p.115]`
   Justification (a): a meeting does not follow a pathway that can be hardcoded. People answer out of turn, talk among themselves, correct each other, ask questions, and state rules in passing. Deciding when to speak, when to stay quiet, when a decision has actually been made, and when to park an item is the varying, "figure it out" work the book reserves for agents. `[BAA p.104, p.115]` The parts that do not vary are deliberately NOT left to the model: the agenda and every fact on it are built by SQL in FMS, the recording notice is a fixed sentence, and which item a decision belongs to is decided by code (always the current one).
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: no prior path exists. Today the 123 pending-approval POs (₹1.32 crore, 64 older than 30 days) are not reviewed in any meeting. The baseline is the purchase team's own spreadsheet review; compare the first two real meetings against it (see 10).

**2. Context** `[BAA p.112]`
   Ira holds this meeting's agenda — PO number, vendor, property, amount and days waiting, frozen when the meeting was created — and what was said in the room since her last turn, one line per speaker, labelled by FMS login. She has no Zoho access, no mailbox, no other meeting, no vendor prices and no history. She cannot quote a number she was not given. Nothing from purchase@ is on the agenda, because accounts, org admins and ops super admins may join and may not read that mailbox.

**3. Cost of a false positive** `[BAA p.112]`
   A wrong decision recorded → **medium**. It lands as a *proposal* on the decision sheet; Ira reads every decision back aloud ("… सही है?"), the room can correct it (the correction supersedes it), and an approver confirms or rejects each one afterwards. Nothing is approved or cancelled anywhere.
   Model tier: `sarvam-105b-conversations`, the fast conversational model Meera already runs on — because turn latency is what makes a live room bearable, and the read-back plus human confirmation catch the errors a larger model would avoid.

**4. Tools**

| tool | description reviewed for when-not-to-use? `[BAA p.107]` | returns errors as text? `[BAA p.94]` | args validated? `[BAA p.93]` | MCP? `[BAA p.106]` |
|---|---|---|---|---|
| `record_decision` | yes — not for a suggestion nobody agreed to, not for another item | yes — "Not saved (…)" and Ira says so | decision is an enum; the item is always the current one, never chosen by the model; FMS re-checks the item belongs to the meeting | no — see 10 |
| `next_item` | yes — refuses to move on with no decision recorded and names `park_item` instead | yes | no arguments | no |
| `park_item` | yes — not when a decision was given | yes | reason clipped to 500 chars by FMS | no |
| `note_rule` | yes — only for a rule beyond this PO | yes | stored as a proposal for an approver; clipped by FMS | no |
| `stay_quiet` | yes — not when asked something directly | n/a (returns nothing, so nothing is said) | no arguments | no |
| `focus_item` | yes — not for the item already current | yes — "There is no item N" | position checked against the agenda; FMS re-checks the item | no |

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: yes, eight. Explicit no-skip clause: "Follow these steps, in order, for every item. Do not skip a step."
   Single-shot tone example: yes, one Hinglish line, marked "do not copy it word for word".
   Terminal state written to data: each item ends `discussed` or `parked` on `meeting_agenda_items`; the meeting ends `ended` when the host closes it.

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat? Yes — the same approvers, vendors and properties every week.
   No memory write-tool ships yet: memory pays off only after evidence accumulates `[BAA p.103]`. The seed is `note_rule`, which records a stated rule as a *proposal* a person must confirm; it accepts one kind only (`rule`) with free text, and the endpoint rejects any other type. `[BAA p.101]` Feeding confirmed rules back into the prompt is the next step, once a few exist.

**7. Multi-agent?** `[BAA p.116]`
   Single agent per room. Each topic is its own prompt function in `prompts.py` and each persona its own entry, so changing the PO topic cannot change another topic's behaviour. A second agent in the same room is not supported, by design.

**8. Evaluation — all four axes** `[BAA pp.118–119]`
   System: every write goes through `/api/meetings/agent`, which validates and returns errors; a failed write is said aloud, not swallowed. The transcript keeps every line spoken, by whom.
   Quality assurance (rubric: family __, tier __, scale __, manual audit __%) `[BAA pp.96–98]`: **not built** — see 10.
   Tool interaction (expected tool set + order; measured call count) `[BAA p.95]`: per item, expected order is present → `stay_quiet`* → `record_decision` → read back → `next_item` | `park_item`. Scripted test (2026-10-06, six turns: opening, side chatter, decision, confirmation, a stated rule, an item nobody owned, a direct question): each turn used exactly the expected tool, or none; three re-runs of the decision turn read back once.
   Agent efficiency (tokens, steps, ₹/successful run; token-vs-tool trade noted) `[BAA p.119]`: model turn 0.1–0.4 s in the text test. In the end-to-end room test (local LiveKit server, synthesized Hinglish speech): the recogniser finalised 0.6 s after the speaker stopped, and Ira started speaking about 3 s after. Tokens and ₹ per meeting are not recorded yet.

**9. Trace** `[BAA pp.119–120]`
   Run/step telemetry wired: partly — every line, decision and item change is stored per meeting and visible on the meeting page. Not yet wired to `withAgentRun` / the Agent Console run log.
   Ad-hoc single-agent testing done before scale `[BAA p.116]`: yes — the text-mode test above, a speech round trip (Bulbul out, Saaras in), and a full room test: a scripted participant joined, Ira was dispatched by the join token, read the agenda from a stand-in FMS, gave the notice, presented PO 1, recorded "cancel · owner Vidya · Friday" from speech, and moved to PO 2 on "हाँ सही है, आगे चलो". **Not yet** a meeting with real people on LiveKit Cloud.

**10. Laws knowingly violated, and why:**
   - **L6 (rubric) and the QA axis of L5** `[BAA pp.96–98, 118–119]`: no grader yet, because there are no real meetings to grade. First step: hand-audit the decision sheets of the first two meetings against their transcripts.
   - **L2 (head-to-head)** `[BAA pp.94–95]`: no automated baseline exists; compare the first two meetings' outcomes with the purchase team's own review of the same POs.
   - **L9 (MCP as transport)** `[BAA pp.106–107]`: the five tools are in-process function tools bound to one meeting; they call one FMS endpoint. Tool discovery would add nothing.
   - **L14 (traceability from run one)** `[BAA pp.119–120]`, partly: the per-meeting record exists, but meetings do not appear in the Agent Console's run log yet.

## Go-live, in order

1. Apply `supabase/migrations/20261006000003_meetings.sql`.
2. Create a free LiveKit Cloud project. In Vercel set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `MEETING_AGENT_SECRET` (any long random string). Deploy FMS.
3. Deploy the agent to LiveKit Cloud — see `README.md`. Its secrets: `SARVAM_API_KEY`, `FMS_BASE_URL`, `MEETING_AGENT_SECRET` (the same string as Vercel).
4. Open **Meetings (Ira)**, build a PO review, join from one device, and run a 3-PO trial before the real meeting.
