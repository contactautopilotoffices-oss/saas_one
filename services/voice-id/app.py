"""
voice-id: makes voiceprints and names the speakers of a recorded meeting. Plan: docs/LIVEVOICE_ID_PLAN.md

Runs on Hugging Face Spaces (free CPU). Only our Next.js server calls it, with a shared secret.

  GET  /health     is the model loaded? (no secret needed, says nothing private)
  POST /embed      3 short clips of ONE person -> one voiceprint (192 numbers) + how well the clips agree
  POST /identify   meeting audio links + who-spoke-when from Sarvam + voiceprints of the people present
                   -> which person each "Speaker N" is, or no match

Rules (same as the rest of Meeting Assistant):
  * Keeps NOTHING. Audio is held in memory only for the request; voiceprints are returned, never stored here.
  * Never logs what was said, names, or ids. Only counts, timings and reasons.
  * Fails closed: no VOICE_ID_SECRET configured = every call refused. Audio is fetched only over https and only from
    the hosts in ALLOWED_AUDIO_HOSTS (our Supabase storage), so it cannot be used to fetch anything else.
"""

from __future__ import annotations

import base64
import binascii
import hmac
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Protocol
from urllib.parse import urlparse

import httpx
import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import audio
import matching

log = logging.getLogger("voice-id")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

MODEL_ID = os.environ.get("MODEL_ID", "speechbrain/spkrec-ecapa-voxceleb")
MODEL_DIR = os.environ.get("MODEL_DIR", "model")
MODEL_REVISION = os.environ.get("MODEL_REVISION", "unknown")

MAX_CLIP_BYTES = 2 * 1024 * 1024
CLIP_MIN_S, CLIP_MAX_S = 2.0, 15.0
MAX_FILES = 20
MAX_PIECES_PER_FILE = 400          # 30 s pieces: 400 = more than 3 hours
MAX_AUDIO_BYTES = int(os.environ.get("MAX_AUDIO_MB", "120")) * 1024 * 1024
MAX_SEGMENTS = 5000
MAX_SPEAKERS = 20
MAX_CANDIDATES = 50
DOWNLOAD_TIMEOUT_S = 60.0

# Starting points only; Phase 0 tunes them on real meetings (plan section 6). The caller may pass its own.
DEFAULT_THRESHOLD = float(os.environ.get("MATCH_THRESHOLD", "0.60"))
DEFAULT_MARGIN = float(os.environ.get("MATCH_MARGIN", "0.08"))
MIN_CLIP_AGREEMENT = float(os.environ.get("MIN_CLIP_AGREEMENT", "0.45"))


class Encoder(Protocol):
    dim: int

    def embed(self, wave: np.ndarray) -> np.ndarray: ...


class SpeechBrainEncoder:
    """ECAPA-TDNN from SpeechBrain, loaded from the copy downloaded when the image was built."""

    dim = 192

    def __init__(self) -> None:
        import torch
        from speechbrain.inference.speaker import EncoderClassifier

        torch.set_num_threads(int(os.environ.get("TORCH_THREADS", "2")))
        self._torch = torch
        self._model = EncoderClassifier.from_hparams(
            source=MODEL_DIR, savedir=os.environ.get("MODEL_RUN_DIR", "model_run"), run_opts={"device": "cpu"},
        )

    def embed(self, wave: np.ndarray) -> np.ndarray:
        with self._torch.inference_mode():
            t = self._torch.from_numpy(np.ascontiguousarray(wave, dtype=np.float32)).unsqueeze(0)
            return self._model.encode_batch(t).squeeze().cpu().numpy().astype(np.float64)


_state: dict[str, object] = {"encoder": None, "error": None}
_lock = threading.Lock()  # one request uses the CPU at a time (free Space has 2 vCPU)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if _state["encoder"] is None and os.environ.get("VOICE_ID_SKIP_MODEL") != "1":
        try:
            t0 = time.time()
            _state["encoder"] = SpeechBrainEncoder()
            log.info("model loaded in %.1fs", time.time() - t0)
        except Exception as e:  # keep the server up so /health can say what is wrong
            _state["error"] = type(e).__name__
            log.error("model failed to load: %s", type(e).__name__)
    yield


app = FastAPI(title="voice-id", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


def fail(status: int, reason: str, detail: str = "") -> HTTPException:
    return HTTPException(status_code=status, detail={"ok": False, "reason": reason, "detail": detail[:200]})


@app.exception_handler(HTTPException)
async def _http_error(_, exc: HTTPException):
    body = exc.detail if isinstance(exc.detail, dict) else {"ok": False, "reason": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content=body)


def authorised(x_voice_id_secret: str | None = Header(default=None)) -> None:
    # The secret travels in its own header so a private Space can still use "Authorization" for its HF token.
    secret = os.environ.get("VOICE_ID_SECRET", "").strip()
    if not secret:
        raise fail(503, "not_configured", "VOICE_ID_SECRET is not set")
    given = (x_voice_id_secret or "").strip()
    if not hmac.compare_digest(given.encode(), secret.encode()):
        raise fail(401, "unauthorized")


def encoder() -> Encoder:
    enc = _state["encoder"]
    if enc is None:
        raise fail(503, "model_not_loaded", str(_state["error"] or "loading"))
    return enc  # type: ignore[return-value]


def allowed_hosts() -> set[str]:
    return {h.strip().lower() for h in os.environ.get("ALLOWED_AUDIO_HOSTS", "").split(",") if h.strip()}


# ── health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": _state["encoder"] is not None, "model": MODEL_ID, "revision": MODEL_REVISION,
            "error": _state["error"]}


# ── enrollment ────────────────────────────────────────────────────────────────

class EmbedRequest(BaseModel):
    clips: list[str] = Field(..., description="2 to 5 base64 audio clips of the same person")


@app.post("/embed", dependencies=[Depends(authorised)])
def embed(req: EmbedRequest, enc: Encoder = Depends(encoder)):
    if not 2 <= len(req.clips) <= 5:
        raise fail(400, "bad_clip_count", "send 2 to 5 clips")
    waves: list[np.ndarray] = []
    report = []
    for i, b64 in enumerate(req.clips):
        try:
            raw = base64.b64decode(b64, validate=True)
        except (binascii.Error, ValueError):
            raise fail(400, "bad_clip", f"clip {i + 1} is not base64")
        if len(raw) > MAX_CLIP_BYTES:
            raise fail(400, "clip_too_large", f"clip {i + 1}")
        try:
            wave = audio.decode(raw)
        except audio.AudioError as e:
            raise fail(400, e.reason, f"clip {i + 1}")
        problem = audio.check_clip(wave, CLIP_MIN_S, CLIP_MAX_S)
        report.append({"seconds": round(wave.size / audio.SAMPLE_RATE, 2), "rms": round(audio.rms(wave), 4),
                       "problem": problem})
        waves.append(wave)
    if any(c["problem"] for c in report):
        return {"ok": False, "reason": "clip_quality", "clips": report}

    t0 = time.time()
    with _lock:
        vecs = [matching.normalise(enc.embed(w)) for w in waves]
    pair = [float(vecs[a] @ vecs[b]) for a in range(len(vecs)) for b in range(a + 1, len(vecs))]
    agreement = min(pair)
    voiceprint = matching.normalise(np.mean(np.stack(vecs), axis=0))
    log.info("embed: %d clips, agreement %.3f, %.0f ms", len(vecs), agreement, (time.time() - t0) * 1000)
    if agreement < MIN_CLIP_AGREEMENT:
        return {"ok": False, "reason": "clips_disagree", "clip_agreement": round(agreement, 4), "clips": report}
    return {"ok": True, "model": MODEL_ID, "revision": MODEL_REVISION, "voiceprint": [round(float(x), 6) for x in voiceprint],
            "clip_agreement": round(agreement, 4), "clips": report}


# ── meeting identification ────────────────────────────────────────────────────

class AudioFile(BaseModel):
    urls: list[str] = Field(..., description="signed links to the pieces of ONE recording, in order")


class SegmentIn(BaseModel):
    file: int
    start: float
    end: float
    speaker: str


class Candidate(BaseModel):
    id: str
    voiceprint: list[float]


class IdentifyRequest(BaseModel):
    files: list[AudioFile]
    segments: list[SegmentIn]
    candidates: list[Candidate]
    threshold: float | None = None
    margin: float | None = None


def make_client() -> httpx.Client:
    """No redirects: a link may only lead to an allowed host. Replaced in tests."""
    return httpx.Client(timeout=DOWNLOAD_TIMEOUT_S, follow_redirects=False)


def fetch_file(client: httpx.Client, urls: list[str], budget: list[int]) -> bytes:
    hosts = allowed_hosts()
    if not hosts:
        raise fail(503, "not_configured", "ALLOWED_AUDIO_HOSTS is not set")
    out = bytearray()
    for u in urls:
        p = urlparse(u)
        if p.scheme != "https" or (p.hostname or "").lower() not in hosts:
            raise fail(400, "url_not_allowed")
        with client.stream("GET", u) as r:
            if r.status_code != 200:
                raise fail(502, "download_failed", f"HTTP {r.status_code}")
            for chunk in r.iter_bytes():
                budget[0] -= len(chunk)
                if budget[0] < 0:
                    raise fail(400, "audio_too_large")
                out.extend(chunk)
    return bytes(out)


@app.post("/identify", dependencies=[Depends(authorised)])
def identify(req: IdentifyRequest, enc: Encoder = Depends(encoder)):
    t0 = time.time()
    if not 1 <= len(req.files) <= MAX_FILES:
        raise fail(400, "bad_file_count")
    if any(not 1 <= len(f.urls) <= MAX_PIECES_PER_FILE for f in req.files):
        raise fail(400, "bad_piece_count")
    if len(req.segments) > MAX_SEGMENTS:
        raise fail(400, "too_many_segments")
    if len(req.candidates) > MAX_CANDIDATES:
        raise fail(400, "too_many_candidates")
    speakers_seen = {s.speaker for s in req.segments}
    if len(speakers_seen) > MAX_SPEAKERS:
        raise fail(400, "too_many_speakers")
    for s in req.segments:
        if not (0 <= s.file < len(req.files)) or not (0 <= s.start < s.end) or len(s.speaker) > 40:
            raise fail(400, "bad_segment")
    cands: dict[str, np.ndarray] = {}
    for c in req.candidates:
        if len(c.voiceprint) != enc.dim or len(c.id) > 64:
            raise fail(400, "bad_candidate")
        v = np.asarray(c.voiceprint, dtype=np.float64)
        if not np.all(np.isfinite(v)):
            raise fail(400, "bad_candidate")
        cands[c.id] = v
    threshold = DEFAULT_THRESHOLD if req.threshold is None else float(req.threshold)
    margin = DEFAULT_MARGIN if req.margin is None else float(req.margin)

    segments = [matching.Segment(s.file, s.start, s.end, s.speaker) for s in req.segments]
    picked = matching.pick_segments(segments)
    needed_files = sorted({s.file for segs in picked.values() for s in segs})

    # Download and decode only the recordings that hold usable speech
    waves: dict[int, np.ndarray] = {}
    budget = [MAX_AUDIO_BYTES]
    with make_client() as client:
        for fi in needed_files:
            data = fetch_file(client, req.files[fi].urls, budget)
            try:
                waves[fi] = audio.decode(data)
            except audio.AudioError as e:
                raise fail(400, e.reason, f"file {fi}")
            del data
    t_audio = time.time()

    results: list[matching.SpeakerResult] = []
    voiceprints: dict[str, np.ndarray] = {}
    used: dict[str, tuple[float, int]] = {}
    with _lock:
        for speaker in sorted(speakers_seen):
            embs, durs = [], []
            for s in picked.get(speaker, []):
                piece = audio.cut(waves[s.file], s.start, s.end)
                if piece.size < int(matching.MIN_SEGMENT_S * audio.SAMPLE_RATE):
                    continue  # the line's times run past the end of the audio
                embs.append(enc.embed(piece))
                durs.append(piece.size / audio.SAMPLE_RATE)
            used[speaker] = (round(sum(durs), 2), len(durs))
            if sum(durs) >= matching.MIN_SPEECH_PER_SPEAKER_S:
                voiceprints[speaker] = matching.speaker_voiceprint(embs, durs)
    waves.clear()

    assigned = matching.assign(voiceprints, cands, threshold, margin)
    for speaker in sorted(speakers_seen):
        secs, n = used.get(speaker, (0.0, 0))
        if speaker not in assigned:
            results.append(matching.SpeakerResult(speaker, None, None, None, secs, n, "not_enough_speech"))
            continue
        m, score, second, reason, scores = assigned[speaker]
        results.append(matching.SpeakerResult(speaker, m, score, second, secs, n, reason, scores))

    matched = sum(1 for r in results if r.match)
    log.info("identify: %d speakers, %d candidates, %d matched, audio %.0f ms, total %.0f ms",
             len(results), len(cands), matched, (t_audio - t0) * 1000, (time.time() - t0) * 1000)
    return {
        "ok": True,
        "model": MODEL_ID,
        "revision": MODEL_REVISION,
        "threshold": threshold,
        "margin": margin,
        "speakers": [r.__dict__ for r in results],
        "timing_ms": round((time.time() - t0) * 1000),
    }
