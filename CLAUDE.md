# CLAUDE.md

## AI agents — binding doctrine

Before designing, building, or modifying **any AI agent** in this repo, read
[docs/AGENT_DOCTRINE.md](docs/AGENT_DOCTRINE.md).
## General Development Rules

- Before making changes, inspect the existing codebase and understand the current implementation. Do not rewrite or restructure working code unnecessarily.
- Prefer small, targeted changes over large refactors.
- Do not introduce new libraries, frameworks, services, or architectural patterns unless explicitly requested.
- Reuse existing components, utilities, APIs, database tables, and patterns whenever possible.
- Do not change existing functionality that is unrelated to the requested task.
- Preserve the existing project architecture unless the task explicitly requires an architectural change.
- Before modifying a file, check how it is currently used elsewhere in the project.
- Do not create duplicate components, utilities, API routes, or database logic when an existing implementation can be reused.
- Keep naming and coding conventions consistent with the existing codebase.

## Safety Rules

- Do not modify authentication, authorization, permissions, security rules, or access-control logic unless explicitly requested.
- Do not expose, print, log, or commit secrets, API keys, tokens, passwords, or environment variables.
- Do not modify `.env` files.
- Do not modify production configuration or deployment settings unless explicitly requested.
- Do not make destructive changes to data, storage, APIs, or infrastructure.
- Do not run database write operations, migrations, seed scripts, DELETE, UPDATE, INSERT, DROP, TRUNCATE, or ALTER commands.
- Database access is read-only unless a human explicitly performs the required write operation.

## Before Implementation

- First identify the relevant files and existing implementation.
- Explain the intended change briefly before making a significant modification.
- If requirements are ambiguous, ask for clarification instead of making a risky assumption.
- If the requested change conflicts with these instructions, stop and ask for human intervention.

## After Implementation

- Review all modified files for unintended changes.
- Run the relevant tests, type checks, lint checks, or build checks when available.
- Do not fix unrelated errors unless explicitly requested.
- Report exactly what was changed and what was tested.
- Clearly mention any remaining errors, warnings, assumptions, or limitations.
- Do not claim that something works unless it has been verified.

## Git Rules

- Do not create commits unless explicitly requested.
- Do not push to GitHub or any remote repository unless explicitly requested.
- Do not create, delete, rename, or rewrite branches unless explicitly requested.
- Do not reset, revert, rebase, or force-push without explicit human approval.
- Do not modify `.gitignore` unless explicitly requested.

## Scope Control

- Only modify files necessary to complete the requested task.
- Do not perform opportunistic cleanup, formatting, refactoring, or dependency upgrades.
- Do not change UI, API behavior, database schema, or business logic outside the requested scope.
- When a task can be completed without changing the architecture, do not change the architecture.



It distills *Building Agentic AI* (Sinan Ozdemir, Pearson 2026) — local copy at
`AI Agents Handbook .pdf` — into 15 binding laws with page citations.

Two hard requirements:

1. **Every new or modified agent ships with the Agent Spec Block** (doctrine §3),
   with a `[BAA p.N]` citation on every line. No spec block, no merge.
2. **Cite the law you are following, and name any law you knowingly break**, with the
   reason. Silent deviation is the only thing the doctrine forbids outright.

For the practical sequence — provisioning, composer, executor, shadow, promote —
see [docs/AGENT_RUNBOOK.md](docs/AGENT_RUNBOOK.md).

The two axes our runtime does *not* yet measure — tool interaction and response
quality — are the two the book weights heaviest. See doctrine §2 before claiming an
agent is "evaluated."
