# Invoice Control

Vendors upload an invoice through a one-time link. The system reads it, checks it against the PO and its lines, and routes it. Urgent payments with no invoice go through an explicit approval. Product requirements: the "Invoice Collection & PO Matching" PRD (pasted into the session of 2026-10-20; not stored in the repo).

| File | Role |
|---|---|
| `match.ts` | The matching engine. Pure function: PO + lines + invoice + history + policy → rule outcomes. No database, no model |
| `extract.ts` | Reads a PDF or image into structured fields. The **only** model call in the module |
| `process.ts` | Stores the reading, then runs the engine and writes the results |
| `submission.ts`, `links.ts`, `storage.ts` | Upload links, private storage, atomic submission |
| `fasttrack.ts`, `docState.ts` | Fast-track exceptions; the invoice-chase state, kept apart from the payment state |
| `access.ts` | Who may do what. Built on the Payment Tracker's access check |
| `supabase/migrations/20261020000001_invoice_control.sql` | Tables, the two atomic functions, RLS (on, no policies) |

## Agent Spec — Invoice reader

**1. Workflow or agent?** Workflow. `[BAA p.104]`

- The path is fixed: pick the route by file type, make one extraction call, hand the result to deterministic code. Nothing is left for a model to decide, so neither justification for an agent applies `[BAA p.115]`.
- The decision that matters (does this invoice agree with the PO?) is **not** made by the model. It is made by `match.ts` from numbers.

**2. Context** `[BAA p.112]`

The model receives the invoice text or page images and a fixed schema prompt. It receives no PO data, so it cannot be steered towards "making the invoice match".

**3. Cost of a false positive** `[BAA p.112]`

A misread figure could make a wrong invoice look right, so the design assumes the reader can be wrong:

- Every field comes back with a confidence. Anything below the policy floor (default 70) makes the invoice `needs_review`.
- A field the model cannot read is `null`, scored 0, and treated as UNKNOWN downstream. It is never zero and never a pass.
- A person can correct any value; the original reading is kept in `invoices.extracted`.
- A person must click Accept. No invoice reaches `accepted` by itself.

Text path model: `deepseek-v4-flash-0731` (the fast tier measured for the wiki, same reasoning), overridable with `INVOICE_EXTRACT_MODEL`. Vision path: `qwen3.8-27b` through `visionExtract`, as Document Bank does. **Neither has been run on a real invoice yet** (see 8).

**4. Tools**

None. No tool calls; the files are fetched before the model is called.

**5. Prompt** `[BAA pp.105, 114]`

`SCHEMA_PROMPT` in `extract.ts`: numbered rules, explicit "NEVER calculate, estimate or invent", per-field honest confidence that must vary. No single-shot example yet.

**6. Memory** `[BAA pp.100–103]`

None. Each invoice is read cold.

**7. Multi-agent?** `[BAA p.116]`

No.

**8. Evaluation, four axes** `[BAA pp.118–119]`

- **System:** provider, model and read path are stored per invoice (`extraction_provider`, `extraction_model`, `extracted.path`). Latency is not recorded.
- **Quality assurance:** **no rubric and no real-invoice test yet** `[BAA pp.96–98]`. `normalise()` is unit-tested, and the matching engine has 17 tests, but the model's reading accuracy on this org's invoices is unmeasured. First follow-up: run 30 real invoices, compare field by field with a person's reading.
- **Tool interaction:** N/A, no tools.
- **Agent efficiency:** one call per invoice (text path) or one call with up to 4 page images (scan path).

**9. Trace**

Audit events `invoice_extracted`, `invoice_extraction_failed` and `invoice_validated` record each step with a correlation id. `withAgentRun` is **not** used: there is no `agents` row for this workflow.

**10. Laws knowingly deferred, and why**

- **L6 (rubric):** deferred until real invoices exist to grade (see 8).
- **L2 (A/B against an existing path):** there is no existing automated path to compare against.
- **Run telemetry (`withAgentRun`):** skipped to avoid inventing an agent row for a one-call workflow; the audit trail above covers the steps.
