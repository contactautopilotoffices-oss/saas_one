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
