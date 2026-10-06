# FMS meeting agent

One LiveKit worker that sits in FMS meeting rooms. A meeting names which of our
agents runs it (Ira today) and its topic (PO approvals today). See `AGENT_SPEC.md`
for what it does and why; this file is how to run it.

## Settings

| Name | What it is |
|---|---|
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | The LiveKit project. Provided automatically when the agent runs on LiveKit Cloud. |
| `SARVAM_API_KEY` | Listening, thinking and speaking all run on Sarvam. The same key Meera uses. |
| `FMS_BASE_URL` | Where FMS is, e.g. `https://fms-dev-saas-one.vercel.app`. |
| `MEETING_AGENT_SECRET` | Shared with FMS (Vercel). Must be the same string in both places. |
| `MEETING_AGENT_NAME` | Optional. Default `fms-meeting-agent`; must match FMS's `MEETING_AGENT_NAME`. |
| `MEETING_AGENT_LLM_BASE_URL`, `MEETING_AGENT_LLM_MODEL`, `MEETING_AGENT_LLM_API_KEY` | Optional. Swap the model for any OpenAI-compatible one. Default: Sarvam `sarvam-105b-conversations`. |
| `MEETING_AGENT_SILENCE_S` | Optional. How long the room must be quiet before the agent speaks. Default 1.2 s. |

## Deploy to LiveKit Cloud (once)

```bash
brew install livekit-cli
```

```bash
lk cloud auth
```

In this folder, create a file `.env.secrets` (it is git-ignored) with three lines:
`SARVAM_API_KEY=…`, `FMS_BASE_URL=…` and `MEETING_AGENT_SECRET=…`. LiveKit Cloud
supplies `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` itself. Then, from this folder:

```bash
lk agent create --secrets-file=.env.secrets
```

To change a secret later:

```bash
lk agent update-secrets --secrets-file=.env.secrets
```

After a code change:

```bash
lk agent deploy
```

## Run locally against a local LiveKit server

```bash
brew install livekit
```

```bash
livekit-server --dev
```

In another terminal, from this folder, with a Python 3.12+ virtual environment:

```bash
pip install -r requirements.txt
```

```bash
LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret python agent.py dev
```

FMS (`npm run dev`) must have the same three `LIVEKIT_*` values and `MEETING_AGENT_SECRET`.

## Adding an agent or a topic

- A new persona (name, role, Bulbul voice): an entry in `PERSONAS` in `prompts.py`.
- A new topic: a prompt function in `TOPICS` in `prompts.py`, an agenda builder in
  `backend/lib/meetings/`, and the topic added to the `meetings.topic` check in a migration.
