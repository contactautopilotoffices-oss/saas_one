## 2026-09-23 (later) — Saas.one: the reviewer's report, with the camera frames inside it

**Every attempt now has a one-page report — score, every answer, the full proctoring log, and the flagged camera frames embedded in the page itself — that prints or saves as a PDF without losing its evidence.**

- **Why:** "The AI flagged something" is worth little to a reviewer who cannot see what it saw. And a report that is forwarded or filed has to still make sense a month later.
- **Structural decisions:**
  - Frames are **embedded in the report as data URIs, not linked.** A signed storage link expires in an hour, so a saved or printed report would lose its evidence exactly when someone comes back to check it. That costs a few hundred KB per report and keeps it true on its own. Up to 40 frames per report.
  - The report is built by one function (`backend/lib/proctor/report.ts`) that the route wraps with the author check. That separation is what let it be tested against live data without a login.
  - A clean camera check never appears in the log. Only flags, voice notes and the reason the test ended.
- **What works now:** In Results, each attempt has a **Report** link. It opens the full report: outcome, score with a bar per section, the frames the camera kept with what the model saw, the proctoring log, and every question with what the candidate chose against the right answer. "Print / Save as PDF" gives a clean copy with the images inside it.
- **Verified against live data today:**
  - **The case that mattered is settled: a real person at a laptop is not flagged.** Six checks in a row on a live webcam came back "one person, facing the camera, no devices" — no false alarms on the candidate themselves.
  - **A second person is caught.** Four checks flagged "a second person partially visible at the right edge" while someone else was in the room.
  - **A phone is caught.** "Holding up a smartphone and looking down at it instead of the screen" was flagged as a phone and as looking away.
  - Both ways of leaving worked: switching tab closed one attempt, switching app closed the other.
  - The report itself was built end to end against the live database and the private bucket: the frame came back as an embedded image, the section scores and the right/wrong answer review were correct. The rows used for that check were deleted afterwards.
- **Fixed because that run exposed it:** a camera check that was still running when the attempt closed was recorded four seconds *after* the end. The check now re-reads the attempt before recording, so the log stops when the test does.
- **Left undone, deliberately:**
  - The earlier runs happened before the evidence bucket existed, so those phone and second-person flags have no frames saved. New attempts will have them.
  - Reports are per attempt. There is no comparison across candidates, and no shortlist view.
  - The print layout is the browser's; it has not been tuned past page breaks on the sections that matter.
- **Open questions for the founder:** unchanged from the entry below — how long camera frames are kept and who may open them, whether the public link should expire, and whether a closed attempt should keep costing a chance.

## 2026-09-23 — Saas.one: Assessments get a public link, AI-written questions, and a sharper camera

**HR can now describe a test and have AI draft it, read it as the candidate will, and send one link that works without any login — while the camera keeps evidence of a phone or a second person for the reviewer.**

- **Why:** The test only reached people who already had an account, which rules out the outside candidates it is mostly meant for. Writing 20 fair questions by hand is slow. And "the AI flagged something" is not worth much to a reviewer who cannot see what it saw.
- **Structural decisions:**
  - **A public link, `/t/<token>`.** No sign-in, no account. The candidate types their name and email, and from that moment the attempt is identified by a secret the server issues (`attempt_token`) rather than by a session. The same routes serve both kinds of taker: a signed-in member is recognised by their login, a candidate by that token. Chances for a candidate are counted per email address. Someone can type a different email to get another go — that is the honest price of no sign-in, and every attempt is still listed for the reviewer.
  - **Sections are now the author's**, like the sections of a form: title, description, and questions under it. A test starts with the four standard ones and they can be renamed, described, removed, or added to.
  - **Two different responses to what the camera sees**, deliberately. Not looking at the screen is a mistake worth correcting, so the candidate is told, and after three warnings (the author sets the number) the attempt closes. A phone or a second face is not a mistake, so **nothing is shown** — the frame is saved to a private bucket for the reviewer. Telling the candidate would only teach them what the camera catches.
  - **The microphone is on** and the page watches the sound level. A sustained voice is recorded for the reviewer, at most one note every 30 seconds. It cannot tell who spoke, so it reports "a voice was picked up", not "someone else was there".
  - **Evidence frames are private.** The bucket has no policies at all; the reviewer sees them through links that expire in an hour.
  - **AI drafts, a person decides.** "Draft with AI" fills the form and saves nothing. The author reads every question and presses Save, so a wrong question costs an edit, not a bad hire.
  - A standing line at the top of the test says the camera, microphone and screen activity go to the reviewer, so nobody is recorded without being told.
- **What works now:** HR describes the test in a sentence, presses Draft with AI, edits what came back, saves, opens **Preview** to read it exactly as the candidate will (with the answers marked), then **Copy link** and sends it. The candidate opens it on any laptop, types their name and email, allows camera and microphone, and takes the test in fullscreen. Results show the score by section, who came in from the public link, the camera warnings, the frames kept, and when a voice was heard.
- **Left undone, deliberately:**
  - The migration (`supabase/migrations/20260923000001_proctor_public_link_and_evidence.sql`) has not been applied.
  - Still not run end to end in a browser by a real candidate with a working camera. Type check, lint and the SQL linter pass, and the vision call is verified against live ENGY.
  - **Anyone with the link can start an attempt.** There is no per-candidate invite and no rate limit, so a leaked link could be used by strangers, or spammed. Every attempt is recorded with the name and email typed, which is the only check today.
  - Voice detection is a loudness threshold, not speech recognition. A noisy room, a fan or the candidate reading aloud will read the same as a second person talking. The measured level is stored so the threshold can be tuned.
  - A saved test still cannot be edited; make a new one.
  - Evidence frames are kept indefinitely. There is no deletion schedule, and no consent text beyond the notice on the test.
- **Open questions for the founder:**
  - How long should camera frames of a candidate be kept, and who besides HR may open them? This is personal data of people who may never join.
  - Should the public link expire, or be one link per candidate so it cannot be passed around?
  - Should a failed attempt (closed for looking away) count as one of the two chances, as it does today?

## 2026-09-22 — Saas.one: AI proctored assessments, inside the HR module

**HR can now give a candidate or employee a sectioned multiple-choice test on a locked page (camera on, fullscreen) with two chances, starting from a ready-made Ops Manager test.**

- **Why:** There was no way to check what someone knows or how they think (reasoning, job arithmetic, values, judgement on the floor) and trust that they answered alone. A form link can be answered with a second tab open or a colleague helping.
- **Structural decisions:**
  - It lives in the HR module as an **Assessments** tab (HR sidebar → Assessments), next to Requests & Grievances and the Employee Directory. There is no separate module. People without the HR sidebar see the tests open to them at `/proctor`, and the test link opens a standalone locked page, so fullscreen works cleanly.
  - Three tables (`proctor_tests`, `proctor_attempts`, `proctor_events`). Questions sit inside the test row as a list, each tagged with a section, instead of in a separate questions table.
  - **Four sections:** cognitive ability, aptitude, workplace culture, and situational judgement (plus "general"). Each attempt stores its score per section, so results show where someone is strong or weak, not just one number.
  - **Two chances by default** (HR can set 1–5 per test). Leaving the page uses a chance: switching tabs or apps, pressing Esc, exiting fullscreen, closing or refreshing, or turning the camera off. Opening the link again mid-test also counts. Submitting ends the test, so nobody retakes it to improve a score.
  - The AI camera check (one webcam frame every ~20 seconds) runs through the vision helper the document OCR already uses, so it rides the same provider the rest of the system is configured for — today ENGY (api.engy.ai, `glm-5.3-flash`) — rather than a second AI account with its own key. It only **flags** an attempt for the reviewer. It never uses up a chance, because a vision model can be wrong and a false alarm should not cost someone their attempt.
  - **Templates are code, not database rows.** The Ops Manager test loads into the New test form, HR edits it and saves it as their own. Nothing is seeded into any organisation's data.
- **What works now:** HR opens Assessments, clicks New test → Ops Manager template (20 questions, 5 per section, 30 minutes, 2 chances), adjusts anything, saves, and copies the link. The person opens the link, turns on the camera, presses Start, and answers section by section in fullscreen. If they leave, they see how many chances remain. HR sees each attempt: outcome, reason if closed, total score, score per section, and the AI flags with reasons.
- **Left undone, deliberately:**
  - The second migration (`supabase/migrations/20260922000002_proctor_attempts_and_sections.sql`: chances and section scores) has not been applied. The founder applied the first one on 2026-09-22. Until the second is applied, the new code will fail.
  - Nothing has been tested in a browser yet. It needs both migrations and a signed-in account. Code checks (type check, lint, SQL linter) pass.
  - The AI camera check is only half tested. It now runs live against ENGY: four stills were read correctly (a logo, a cartoon face and an empty building all came back "no face"; a building full of people came back as 12 faces, which is the "more than one person" flag), taking 2–4 seconds and about 500 tokens a frame — roughly ₹0.80 of AI for a 30-minute test. **The case that matters most is still untested: one real person at a laptop, who must NOT be flagged.** That needs a webcam and a real attempt.
  - The two Groq keys in the local `.env` are rejected by Groq ("Invalid API Key"), which also breaks SOP photo scoring locally. The proctor no longer depends on them, but that is worth fixing separately.
  - A saved test cannot be edited. To change one, start a new test (from the template or from scratch) and close the old one.
  - Questions appear in the same order on both chances, and the second chance shows the same questions.
  - In the culture and situational sections, the right answer is often the obviously sensible one. Real psychometric tests score every option and compare against a benchmark group. This template is a starting point for the team, not a validated instrument.
  - Camera frames are not saved, only the AI's verdict.
  - This is a deterrent, not a lockdown. A web page cannot see a second device or stop someone who disables its scripts.
  - Laptop or desktop only. Safari on iOS cannot lock the screen to one page.
  - Only HR users get the Assessments sidebar item. Org admins can author too, but reach it via `/proctor`.
- **Open questions for the founder:**
  - **Who takes the Ops Manager test: outside candidates or current staff?** Today it needs a login, so an outside candidate would first need an account (for example through the existing invite link). A no-login candidate link is a bigger change.
  - Should there be a pass mark (overall or per section), or does HR judge from the scores?
  - Should questions be shuffled, or should the second chance get different questions?
  - Should repeated AI flags ever end an attempt, and should flagged camera frames be kept as evidence?
