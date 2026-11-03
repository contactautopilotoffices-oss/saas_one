---
title: voice-id
sdk: docker
app_port: 7860
pinned: false
---

<!-- The block above is required by Hugging Face Spaces (it tells the Space to build the Dockerfile). Keep it. -->

# voice-id: speaker identification for Meeting Assistant

Makes voiceprints when a person sets up their voice, and works out which person each "Speaker 1", "Speaker 2" is
after a meeting. Plan: [docs/LIVEVOICE_ID_PLAN.md](../../docs/LIVEVOICE_ID_PLAN.md).

- Model: SpeechBrain ECAPA-TDNN (`speechbrain/spkrec-ecapa-voxceleb`), CPU only.
- Keeps nothing: no audio and no voiceprints are stored here. Voiceprints are returned to our server, which saves them
  in Supabase.
- Runs anywhere Docker or Python 3.11 runs: on a computer with a tunnel link (testing), or a container host.

| Endpoint | What it does |
|---|---|
| `GET /health` | `{"ok": true}` once the model is loaded. No secret needed. |
| `POST /embed` | `{"clips": [base64 audio, 2 to 5 clips of one person, 2 to 15 s each]}` → `{"ok", "voiceprint": [192 numbers], "clip_agreement", "clips": [{seconds, rms, problem}]}`. `problem` is one of `too_short`, `too_long`, `too_quiet`, `too_loud`, `too_much_silence`. `reason: clips_disagree` = the clips do not sound like the same person. |
| `POST /identify` | `{"files": [{"urls": [signed links to the pieces of one recording, in order]}], "segments": [{"file", "start", "end", "speaker"}], "candidates": [{"id", "voiceprint"}], "threshold"?, "margin"?}` → per speaker: `match` (candidate id or null), `score`, `second`, `seconds_used`, `reason` (`matched`, `below_threshold`, `too_close`, `no_candidate`, `not_enough_speech`). |

Every call except `/health` needs the header `X-Voice-Id-Secret: <VOICE_ID_SECRET>`.

## Test on your own computer, with a tunnel link (free, no card)

For testing. The server runs on your computer; a free Cloudflare "quick tunnel" gives it a public `https://` link that
our app calls. Your computer must stay on (and not sleep) while you test. Commands are for Windows PowerShell.

1. **Install the tools** (once). Close and reopen PowerShell afterwards.
   ```powershell
   winget install Python.Python.3.11
   winget install Gyan.FFmpeg
   winget install Cloudflare.cloudflared
   ```
2. **Install the server's packages** (once, about 5 minutes). From the repo folder, on branch `feature/livevoice-speaker-id`:
   ```powershell
   py -3.11 -m venv $HOME\voice-id-venv
   & $HOME\voice-id-venv\Scripts\Activate.ps1      # if Windows blocks it: Set-ExecutionPolicy -Scope Process Bypass
   pip install torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cpu
   pip install -r services\voice-id\requirements.txt
   ```
3. **Start the server** (window 1, keep it open):
   ```powershell
   & $HOME\voice-id-venv\Scripts\Activate.ps1
   cd services\voice-id
   $env:VOICE_ID_SECRET = "<a long random password>"
   $env:ALLOWED_AUDIO_HOSTS = "<your-project>.supabase.co"
   uvicorn app:app --host 127.0.0.1 --port 7860
   ```
   The first start downloads the voice model (~80 MB) into `%USERPROFILE%\.cache\voice-id`, outside the repo. It is ready
   when it prints `model loaded`. Check in a browser: http://localhost:7860/health shows `"ok": true`.
4. **Open the tunnel** (window 2, keep it open):
   ```powershell
   cloudflared tunnel --url http://localhost:7860
   ```
   It prints a link like `https://random-words.trycloudflare.com`. Open `<that link>/health` to check it works.
5. **Give the app the link.** Vercel → Project → Settings → Environment Variables (or `.env.local` if you run the app on
   your computer): `VOICE_ID_URL` = the tunnel link, `VOICE_ID_SECRET` = the same password as step 3.
   `VOICE_ID_HF_TOKEN` is not needed. Redeploy (or restart the app).

**The quick-tunnel link changes every time `cloudflared` is restarted**: put the new link in `VOICE_ID_URL` and redeploy
again. Settings → My voice in the app shows "Voice server online" when everything is connected.

Or with Docker Desktop instead of steps 1 to 3: `docker build -t voice-id services/voice-id` then
`docker run --rm -p 7860:7860 -e VOICE_ID_SECRET=... -e ALLOWED_AUDIO_HOSTS=... voice-id`.

## Setup on Hugging Face Spaces (now needs a paid plan)

Hugging Face changed this: Docker Spaces now need a PRO plan (personal account) or Team/Enterprise (organization).
The steps below still work on a paid account. For a free option, see the section above or move the same Docker image
to a host such as Google Cloud Run.

1. **Create a free account** at https://huggingface.co/join (no card needed).
2. **Create the Space**: https://huggingface.co/new-space
   - Space name: `voice-id`
   - SDK: **Docker**, template **Blank**
   - Hardware: **CPU basic (free)**
   - Visibility: **Private**
3. **Add the settings** (Space → Settings → Variables and secrets):
   - Secret `VOICE_ID_SECRET`: a long random password. Make one with `openssl rand -hex 32`. Keep a copy, our server
     needs the same value.
   - Variable `ALLOWED_AUDIO_HOSTS`: the host of your Supabase project, e.g. `abcdefgh.supabase.co` (the part after
     `https://` in `NEXT_PUBLIC_SUPABASE_URL`). The service only downloads audio from this host.
   - Optional variables, defaults are fine for the first test: `MATCH_THRESHOLD` (0.60), `MATCH_MARGIN` (0.08),
     `MIN_CLIP_AGREEMENT` (0.45), `MAX_AUDIO_MB` (120). These get tuned after the Tech test meetings.
4. **Upload the files** in this folder to the Space: `Dockerfile`, `requirements.txt`, `app.py`, `audio.py`,
   `matching.py`, `README.md` (the README header is required).
   - Easiest: Space → Files → "Add file" → "Upload files", drag them in, commit.
   - Or with git (use a Hugging Face **write** token as the password):
     ```bash
     git clone https://huggingface.co/spaces/<your-hf-username>/voice-id hf-voice-id
     cp services/voice-id/{Dockerfile,requirements.txt,app.py,audio.py,matching.py,README.md} hf-voice-id/
     cd hf-voice-id && git add . && git commit -m "voice-id" && git push
     ```
5. **Wait for the build** (about 5 to 10 minutes the first time; watch the "Logs" tab). It is ready when the logs
   show `model loaded`.
6. **Check it works.** Because the Space is private, calls need a Hugging Face **read** token
   (Settings → Access Tokens → New token → Read):
   ```bash
   curl -H "Authorization: Bearer <hf-read-token>" https://<your-hf-username>-voice-id.hf.space/health
   # → {"ok":true,"model":"speechbrain/spkrec-ecapa-voxceleb",...}
   ```
7. **Give our app the three values** (added by the owner in Vercel → Project → Settings → Environment Variables; we
   never edit `.env` files):
   - `VOICE_ID_URL` = `https://<your-hf-username>-voice-id.hf.space`
   - `VOICE_ID_SECRET` = the same value as step 3
   - `VOICE_ID_HF_TOKEN` = the read token from step 6

## Things to know about the free Space

- It **sleeps after 48 hours with no calls** and wakes on the next call, which takes 1 to 2 minutes. Meeting
  Assistant processes meetings after they end and retries on the next poll, so a sleeping Space only delays the
  first meeting after a quiet weekend.
- One request uses the CPU at a time. A 1-hour meeting needs about a minute of speech per person, which takes
  seconds on 2 vCPU.
- Free hardware has no uptime promise. If the whole company starts using it, move the same Docker image to a paid
  or self-managed host; nothing else changes.

## Run the tests (no model or internet needed)

The tests replace the model with a fake one, so they check everything except the real voice model: secret, download
rules, decoding real browser audio (webm/opus) with ffmpeg, segment picking and matching.

```bash
cd services/voice-id
pip install -r requirements.txt          # torch is NOT needed for the tests
VOICE_ID_SKIP_MODEL=1 python -m unittest test_service -v
```
