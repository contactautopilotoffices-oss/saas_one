# Meera (procurement voice agent): how she works today, and why she is not industry ready

Audit date: 2026-11-05. Branch: `audit/procurement-voice-agent`.
Scope: read-only review of the code, the live Bolna agent backup, the journal and the built-in simulator. No code, prompt or live agent was changed. No real call was placed.

---

## 1. How Meera works today, in plain words

Meera (code name Satej) is a fixed pipeline, not a free-thinking agent. A purchase requirement goes in and moves through these steps:

1. **Structure.** An LLM turns the request form into a short brief (item, quantity, place, deadline). `backend/lib/satej/pipeline.ts:259`
2. **Find vendors.** Exa web search plus an LLM that reads the pages and pulls out business names and phone numbers. Anyone called in the last 30 days is skipped. `pipeline.ts:366`
3. **A person approves the call list.** Calls never start on their own (`SATEJ_AUTO_START_CALLS` is off). `config.ts`
4. **Price target.** If we have at least 3 past Zoho purchases of the same item and unit, Meera gets two numbers: a target and a ceiling. `benchmark.ts`
5. **Calls.** All approved vendors go to Bolna as one CSV batch. Bolna dials from our Plivo number between 10:00 and 18:30, Monday to Saturday. `pipeline.ts:596`
6. **The call itself.** Bolna runs Sarvam end to end: Saaras listens, `sarvam-105b-conversations` thinks, Bulbul voice "Priya" speaks. The whole call is driven by one long prompt. `prompts/voiceAgent.ts`, `scripts/satej-sync-bolna.ts`
7. **Analysis.** After the call, a second LLM reads the transcript and writes down facts with quotes. `prompts/callAnalyst.ts`
8. **Ranking.** Fixed code (not the LLM) scores each vendor out of 100 and ranks them. GST decides qualified or not. `scoring.ts`
9. **Report.** A WhatsApp template goes to the purchase team with a link to the ranked list. `pipeline.ts:893`

On the phone, Meera:
- greets with "हेलो, नमस्ते। क्या मेरी बात {vendor_name} से हो रही है?"
- says who she is and what we need in one breath,
- checks four things in any order: GST, rate (pushes back once if above target), delivery time, experience,
- asks for their name, confirms WhatsApp, says the team will send details, and hangs up.

**Simulator result today:** `npx tsx scripts/satej-simulate.ts` runs every stage with fake calls and prints "All checks passed". It proves the plumbing works. It does not prove a vendor conversation works (see gap 9).

### What is genuinely good
- A person approves every call list before anyone is dialled.
- The score is computed by fixed rules from quoted evidence, so the LLM cannot invent a ranking.
- Meera never sees other vendors' names, our budget, or where the price numbers come from.
- The prompt and voice live in the repo, are pushed by one script, and every live version is backed up.
- The prompt was rewritten from 10 real calls and fixes real problems (textbook Hindi, masculine verbs, survey-style questions, talking over call-screening assistants).

---

## 2. Why Meera is not industry ready

Ranked by how much damage each one does in real use.

### Gap 1. She makes promises that nothing in the system keeps
- She tells every vendor "मैं details WhatsApp पे भेज देती हूँ" and asks them to send their profile and GST certificate. **No code sends anything to a vendor.** The only WhatsApp sent goes to our own team (`pipeline.ts:879`). The vendor waits, nothing arrives, and our name looks bad.
- When a vendor is busy she asks "when should I call back?" and confirms a time (`voiceAgent.ts`, Busy rule). **No callback is ever scheduled.** Bolna's `auto_reschedule` is `false` in the live agent. Worse, that short call is long enough (over 80 characters of transcript) to mark the vendor as `called` (`pipeline.ts:700`), so the vendor is scored as if the conversation happened, and the 30-day do-not-recall rule then blocks them from the next round too.
- The journal itself notes she tells people "you won't be called again", but there is no do-not-call list (`docs/JOURNAL.md`, 2026-10-06, Left undone).

A real procurement executive who promised these things and never did them would lose vendor trust within a week. This is the biggest blocker.

### Gap 2. She has never been tested on a real call with her current setup
The last journal entry on Meera says: "No real phone call has been made on the new Sarvam setup. Four conversation turns were tested against the model directly." The 0.1 second "first token" figure is the LLM alone. Real reply delay also includes listening end detection (300 ms), speech-to-text, voice generation, a 200-token audio buffer, and the phone network. That full delay has never been measured. The test-only "Meera (graph)" agent is still on the old ElevenLabs and Deepgram stack, so a side-by-side comparison is not like for like.

### Gap 3. Nobody measures whether a call was good
- There is no grader for call quality. The spec admits this: doctrine law L6 and the quality axis of L5 are "not built yet" (`docs/satej/AGENT_SPEC.md`, item 10). Per `docs/AGENT_DOCTRINE.md` section 2, an agent without these cannot be called "evaluated".
- There is no dashboard of the numbers any voice team watches: connect rate, how many calls collected all four facts, vendor hang-up rate, how often she talked over the vendor, average reply delay, how often she was asked "are you a robot".
- The promised comparison against the purchase team's own shortlist on the first five requirements (L2) has no record of being done.
- The whole design rests on 10 answered calls. Industry-grade voice agents are tuned on hundreds.

### Gap 4. The ranking scores her on questions she is told not to ask
On 6 Oct the call was cut down to four checks, and she was told never to judge turnover. But `scoring.ts` still gives points for things the call never covers:

| Score part | Points | Does Meera ask? |
|---|---|---|
| Turnover | 5 | No, deliberately removed |
| References offered | up to 5 of the 15 for clientele | No |
| 3 or more named clients | full 10 | She asks for "one or two places" only |
| Company profile on the call | 2 | She asks them to send it later, the call cannot confirm it |

So a vendor's score depends on what they happen to volunteer, not on how good they are. Around 15 to 20 points out of 100 are close to unreachable from the call she actually makes.

### Gap 5. Only Hinglish, only Mumbai, in a company that works in six cities
The company brief lists Mumbai, Bengaluru, Noida, Hyderabad, Indore and Kolkata. But the agent is fixed to Hindi (`language: 'hi'`), the per-language switch is turned off (`multilingual_config.enabled = false` in `scripts/satej-sync-bolna.ts`), and the prompt makes her "a busy office coordinator from Mumbai". A Bengaluru, Hyderabad or Kolkata vendor who would rather speak Kannada, Telugu or Bengali gets Hinglish. There is one voice for every city.

### Gap 6. She has no tools during the call
The live agent has `api_tools: null` and `dtmf_enabled: false`. During a call she cannot:
- send the WhatsApp the vendor asks for ("अभी भेज दो details"),
- book a callback in a calendar,
- hand the call to a person on our team when the vendor wants to talk to someone senior,
- press a key to get through an IVR ("press 1 for sales"); the prompt simply tells her to hang up on IVRs,
- look up the exact site address, a drawing, or a spec sheet.

Everything she cannot answer becomes "मैं team से confirm करके WhatsApp पे बता देती हूँ", which loops back to Gap 1.

### Gap 7. Missed calls back to our number go nowhere
`inbound_phone_number` is `null` on the live agent. In India, a vendor who missed the call often rings the number back. Nobody, human or Meera, answers that.

### Gap 8. Compliance basics are missing
- Calls are recorded and transcribed, but she never says "this call may be recorded". Under India's DPDP Act 2023, personal data processing generally needs notice. (Legal should confirm the exact requirement for business calls.)
- No check against the national Do-Not-Disturb registry before dialling numbers scraped from the web. The only block is a manually kept env list (`SATEJ_BLOCKED_NUMBERS`).
- She only admits she is an AI if asked directly. Some regions (for example the EU AI Act, Article 50) require telling people up front. Worth deciding as a company policy now, before scale.

### Gap 9. The test does not test the conversation
`scripts/satej-simulate.ts` uses canned transcripts from `clients/mocks.ts` that still include the turnover question (the simulator output says "Avoided the turnover question"). That question was removed from the live script on 6 Oct. There are no unit tests for Meera under `tests/`. So the green "All checks passed" does not cover anything a vendor actually hears.

### Gap 10. One number, one batch, one burst
All vendors in a requirement are dialled from the same Plivo number in the same window. High-volume calling from one unbranded number is how numbers get labelled "Spam" on Truecaller and similar apps, which kills the answer rate. There is no branded caller ID and no spreading of calls across numbers or time.

---

## 3. Why she cannot act like a real human on the phone

These are about how the conversation feels, not about the business process.

| What a real person does | What Meera does today | Where |
|---|---|---|
| Says "हाँ... हम्म... अच्छा" **while** the vendor is still talking | Stays silent until the vendor stops. Backchannel sounds are off (`backchanneling: false`) and so are fillers (`use_fillers: false`) | live agent `task_config` |
| Keeps talking when the vendor says "हाँ हाँ" in the middle | Two words are enough to stop her (`number_of_words_for_interruption: 2`, `interruption_backoff_period: 0`), so a simple "हाँ जी" cuts her off mid-sentence | live agent `task_config` |
| Waits when the vendor says "एक minute, rate check करता हूँ" | Asks "Hello? आवाज़ आ रही है?" after 10 seconds of silence and hangs up after 15 | `trigger_user_online_message_after: 10`, `hangup_after_silence: 15` |
| Lets a good conversation run long | Hard cut at 5 minutes, even mid-sentence | `call_terminate: 300` |
| Remembers "we spoke last month about water jars" | Every call is a cold call. No memory of past calls, past quotes or past orders with that vendor | `AGENT_SPEC.md` item 6 |
| Knows the job well enough to answer "what size?", "which brand?", "can I see the site?" | Knows only a one-line summary, quantity, place and deadline. Everything else is deferred to WhatsApp | `CALL_VARIABLES` in `voiceAgent.ts` |
| Negotiates: trades quantity for price, asks about payment terms, comes back a second time | Pushes back once, never twice, never agrees anything | `voiceAgent.ts`, Rate rules |
| Steers the call by judgment | An LLM decides when to hang up (`call_cancellation_prompt`, `hangup_after_LLMCall: true`), and nothing checks that all four facts were collected before she closes | `satej-sync-bolna.ts` |
| Sounds different on different days | Same voice, same office background track, same greeting, every call | `VOICE`, `ambient_noise_track` |
| Calls back when promised, sends what was promised | Does neither (Gap 1) | |

**An honest note on "acting as a real human".** The right goal is a call that is as good as a skilled human's, not a call that fools the vendor. Meera's current honesty rule (admit being an AI when asked) is the right baseline and should stay. Trying to pass as a person is a legal and reputation risk that grows with every call.

---

## 4. What to fix, in order

**Before any more real vendor calls**
1. Keep the promises: send the vendor a WhatsApp right after the call (needs a vendor-facing AiSensy template), and turn a confirmed callback time into a scheduled call.
2. Keep a do-not-call list in the database and check it before every batch.
3. Add a one-line recording notice to the greeting, and decide the AI disclosure policy.
4. Place 5 to 10 "Call me first" calls on the Sarvam stack and measure the real reply delay end to end.

**Before calling at scale**
5. Make the ranking match the call: drop or re-weight turnover, references and profile points, or ask about them again.
6. Tune the listening settings: raise the interruption word count to 3 or 4, turn on backchanneling, raise silence hang-up to around 30 seconds with a "no problem, I'll hold" line.
7. Add in-call tools: send WhatsApp, book callback, transfer to a person, DTMF for IVRs.
8. Point the Plivo number's inbound calls at Meera or a person.
9. Build the call-quality grader (doctrine L6) and a small call metrics board.
10. Update the simulator's mock transcripts to match the current script, and add unit tests for `scoring.ts` and `buildCallCsv`.

**To feel like a strong procurement executive**
11. Vendor memory: past calls, quotes and POs with that vendor, read at call time.
12. Language and voice chosen by city.
13. Richer job details on the call (spec, brand, site visit), and a second negotiation round when the gap is large.
14. Spread calls across several branded numbers and times.

---

## 5. What was checked and what was not

**Checked:** the full Meera code path (`backend/lib/satej/`, `app/api/satej/`, `scripts/satej-sync-bolna.ts`), the live Bolna agent backup from 2026-10-06 (`docs/satej/bolna-agent-backup-2026-10-06-09-50-38.json`), the agent spec, the doctrine, the journal, and a run of `scripts/satej-simulate.ts` (passed).

**Not checked:**
- The live Bolna agent today. The backup is from 6 Oct; settings the sync script does not touch (interruption, silence, fillers, tools, inbound) are assumed unchanged since then.
- Whether the benchmark and FAQ migrations have been applied in the database. As of 6 Oct they were not, which would mean Meera calls with no price target and no FAQ.
- Real call recordings or transcripts.
- Legal advice. The compliance points in Gap 8 are flags for the legal team, not conclusions.
