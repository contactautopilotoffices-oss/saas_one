# AI model settings

**Owner rule, 2026-11-15:** every time an AI model (LLM, vision, speech, embedding) is added anywhere in this
software, or an existing feature starts calling a new model, it must also be added to the Tech console. Use
**HR Configs → HR AI models** for Otto and Recruitment and **Brain → AI models** for other jobs. A change that adds a model call
without doing this is not finished.

The screen reads everything from code. Nothing on it is typed in by hand, so a model that is not registered in code
simply does not appear. The checklist below is how a model gets registered.

## Checklist for a new model call

Do every step in the same change as the model call itself.

1. **Register the job** in [task-manager/ai/aiCatalog.ts](../task-manager/ai/aiCatalog.ts).
   - Add its key to `AiJob` and a row to `AI_JOBS`, with these fields:
     - `label`, `hint` (what it does, in plain words) and `group` (the area of the app).
     - `needs`: `chat` or `vision`.
     - `providers`: only the providers this code can really call.
     - `defaults`: today's model or chain, exactly as the code has it.
   - Set `single: true` when the code calls one model with no backups.
   - Set `defaultEnv` / `defaultPrefix` when an environment variable can already change the model.
   - **No key of its own** (owner rule, 2026-11-15): every job uses the provider's shared keys. Groq:
     `GROQ_API_KEY` → `_2` → `_3`. Gemini: `GEMINI_API_KEY` → `_2` → `_3`. Read them only through
     [backend/lib/llm/providerKeys.ts](../backend/lib/llm/providerKeys.ts): `fetchWithKeys` for a plain fetch,
     `withProviderKeys` for an SDK call. These move on to the next key when one is used up or rejected. Never read a
     provider key straight from `process.env` at the call site.
   - If the model id is not in `AI_MODELS` yet, add it there with the provider and what it can do. Only add `vision`
     where reading images has been proven in this repo.

2. **Defaults**: if the job's default does not follow the general rule, handle it in `defaultsFor` in
   [task-manager/ai/AiModelSettings.ts](../task-manager/ai/AiModelSettings.ts). A new provider gets its key names
   in `keyNames` there, one shared set for the whole application.

3. **Allow the job in the database.** The `task_manager_ai_models.job` column only accepts known job names.
   - Write a NEW migration that replaces `task_manager_ai_models_job_check` with the full list: every name the latest
     migration allows, plus the new one. Follow the pattern of
     `supabase/migrations/20261115000001_ai_models_all_jobs.sql`.
   - Never edit an applied migration.
   - Migrations are applied by a person, never by an agent (CLAUDE.md).
   - Until that person applies it, the screen shows the job and says a choice cannot be saved yet. The feature keeps
     its default model.

4. **Read the choice at the call site** with [task-manager/ai/modelFor.ts](../task-manager/ai/modelFor.ts).
   - Keep computing today's model exactly as before, and pass it in:
     - `modelFor(job, today)`: one model.
     - `runWithModel(job, today, model => call(model))`: one model, retried once on today's model if the chosen one
       fails.
     - `chosenModels(job)`: a chain.
     - `markFailed(job)`: a hand-written retry.
   - With nothing saved, the behaviour must be identical to before.
   - A chosen model that fails must fall back to today's model.
   - Store and log the model that really answered, not the constant.

5. **List it in the inventory**: add a row to
   [task-manager/ai/aiInventory.ts](../task-manager/ai/aiInventory.ts) with `where` (file:line), `models`, `keys`,
   `kind`, the new `job`, and `chosen: 'Brain → AI models'`.

6. **Test it.** In [task-manager/tests/test_ai_models_2026_10_28.ts](../task-manager/tests/test_ai_models_2026_10_28.ts),
   add the file to `SITES` with a pattern proving it reads its choice and sends the model it was handed. Then run
   `npx tsx task-manager/tests/test_ai_models_2026_10_28.ts`.

## When a model truly cannot be configurable

Some models must stay fixed, for example:
- a safety filter that runs on a model made for that purpose;
- a search index built with one embedding model;
- a voice service that only runs its own models;
- a separate program that does not read these settings.

It still gets an inventory row (step 5), but without `job`. Give it a `why` that says in plain words why it is fixed;
the screen shows that reason. "Not wired yet" is not a reason. Wire it instead.

## For a new AI agent

An agent built under [AGENT_DOCTRINE.md](AGENT_DOCTRINE.md) follows the same checklist for every model it calls. Its
Agent Spec Block (item 3, the model tier) should name the job key it registered.
