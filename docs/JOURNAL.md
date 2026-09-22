## 2026-09-22 — Saas.one: AI proctored tests (MVP)

**An employee can now take a short test on a locked page: camera on, fullscreen, and leaving the page ends the test.**

- **Why:** There was no way to check what an employee knows (an SOP, a safety rule, a process) and trust that they answered alone. A link to a form can be answered with a second tab open or a colleague helping.
- **Structural decisions:**
  - Three new tables (`proctor_tests`, `proctor_attempts`, `proctor_events`). Questions sit inside the test row as a list, instead of in a separate questions table. A test is a handful of multiple-choice questions, and one row keeps it simple.
  - Leaving the page ends the test: switching tabs, switching apps, pressing Esc, exiting fullscreen, closing or refreshing, or turning the camera off. These are certain signals from the browser, so they act on their own.
  - The AI camera check (one webcam frame every ~20 seconds, read by the Groq vision model already used for SOP photo scoring) only **flags** an attempt for a reviewer. It never ends a test. A vision model can be wrong, and closing someone's test on a false alarm is expensive. This follows the repo's agent doctrine: it is a fixed workflow, not an agent, and false alarms are cheap because a human decides.
  - One attempt per person per test. Reopening the link after leaving counts as leaving.
  - Questions are sent to the browser only after the camera and fullscreen are on, so nobody can read them without the lock running.
- **What works now:** Org admins, property admins and HR open `/proctor`, write a test (title, time limit, questions with the correct option marked) and copy its link. The employee opens the link, turns on the camera, presses Start, and answers in fullscreen with a countdown. The admin sees a Results page for each test: who passed, who was closed for leaving and why, their score, and how many AI checks flagged them, with the reasons.
- **Left undone, deliberately:**
  - The migration (`supabase/migrations/20260922000001_proctored_tests.sql`) has not been applied. Per standing instruction, the founder runs migrations.
  - Nothing has been tested in a browser yet. It needs the migration and a signed-in account. Code checks (type check and lint) pass.
  - The AI camera check could not be tested on this machine. Both Groq keys in the local `.env` are rejected by Groq ("Invalid API Key"). That means SOP photo scoring also fails locally. Production uses whatever key is set on Vercel, which I could not check. If the key is bad, the test still runs and each check is logged as "AI check failed".
  - Camera frames are not saved, only the AI's verdict. So a flag cannot be checked against the picture later.
  - This is a deterrent, not a lockdown. A web page cannot see a phone on the desk (the camera check partly covers that), a second laptop, or someone who disables the page's scripts. A real lockdown needs a dedicated exam browser.
  - No sidebar entry in the dashboards. The page is at `/proctor` and tests are shared by link. The five dashboard files already have uncommitted changes from the asset work, so they were left alone.
  - Phones and iPads cannot take the test, because Safari on iOS cannot lock the screen to one page. Laptop or desktop only.
  - No retake button. For a retake, the attempt row has to be deleted.
- **Open questions for the founder:**
  - Should AI flags ever end a test automatically (for example, three "no face" checks in a row), or stay flag-only as built?
  - Should flagged camera frames be kept as evidence? That needs a storage bucket and a decision on keeping employee images.
  - Should property admins see results only for their own property's staff? Today they see the whole organisation's.
  - Is this for tests only, or also for mandatory training sessions and meetings? The same lock would work for a "watch this and answer" page.
