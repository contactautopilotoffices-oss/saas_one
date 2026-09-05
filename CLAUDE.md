# CLAUDE.md

## AI agents — binding doctrine

Before designing, building, or modifying **any AI agent** in this repo, read
[docs/AGENT_DOCTRINE.md](docs/AGENT_DOCTRINE.md).

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
