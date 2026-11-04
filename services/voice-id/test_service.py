"""
Offline tests for voice-id. The real SpeechBrain model is replaced by a fake that turns pitch into a vector, and
"people" are tones at different pitches, so the whole path (auth, download rules, ffmpeg decoding, segment picking,
matching) runs without PyTorch or the internet. Needs ffmpeg on PATH.

    VOICE_ID_SKIP_MODEL=1 python -m unittest test_service -v
"""

from __future__ import annotations

import base64
import os
import subprocess
import unittest

os.environ["VOICE_ID_SKIP_MODEL"] = "1"
os.environ["VOICE_ID_SECRET"] = "test-secret"
os.environ["ALLOWED_AUDIO_HOSTS"] = "store.example.com"

import httpx  # noqa: E402
import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app as service  # noqa: E402
import audio  # noqa: E402
import matching  # noqa: E402

SR = audio.SAMPLE_RATE
H = {"X-Voice-Id-Secret": "test-secret"}


class PitchEncoder:
    """Fake voiceprint: 192 spectrum bands (60 to 1000 Hz). Same pitch -> same vector."""

    dim = 192

    def embed(self, wave: np.ndarray) -> np.ndarray:
        spec = np.abs(np.fft.rfft(wave * np.hanning(wave.size)))
        freqs = np.fft.rfftfreq(wave.size, 1 / SR)
        edges = np.linspace(60, 1000, self.dim + 1)
        idx = np.digitize(freqs, edges) - 1
        out = np.zeros(self.dim)
        ok = (idx >= 0) & (idx < self.dim)
        np.add.at(out, idx[ok], spec[ok])
        return out


def tone(freq: float, seconds: float, amp: float = 0.3) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    # a little vibrato and noise so it is not a perfectly pure tone
    w = amp * np.sin(2 * np.pi * freq * t + 0.3 * np.sin(2 * np.pi * 5 * t))
    return (w + 0.002 * np.random.default_rng(int(freq)).standard_normal(t.size)).astype(np.float32)


def encode(wave: np.ndarray, fmt: str = "webm") -> bytes:
    """float wave -> real compressed audio bytes, like the browser recorder makes."""
    pcm = (np.clip(wave, -1, 1) * 32767).astype(np.int16).tobytes()
    codec = {"webm": ["-c:a", "libopus", "-f", "webm"], "wav": ["-f", "wav"]}[fmt]
    p = subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "pipe:0",
                        *codec, "pipe:1"], input=pcm, capture_output=True, check=True)
    return p.stdout


class Base(unittest.TestCase):
    def setUp(self):
        self._orig_client = service.make_client
        service._state["encoder"] = PitchEncoder()
        service._state["error"] = None
        self.client = TestClient(service.app)

    def tearDown(self):
        service._state["encoder"] = None
        service.make_client = self._orig_client

    def serve(self, files: dict[str, bytes]):
        """Pretend storage: https://store.example.com/<name> returns files[name]."""
        def handler(req: httpx.Request) -> httpx.Response:
            name = req.url.path.lstrip("/")
            return httpx.Response(200, content=files[name]) if name in files else httpx.Response(404)
        service.make_client = lambda: httpx.Client(transport=httpx.MockTransport(handler))


class TestAuth(Base):
    def test_health_needs_no_secret(self):
        r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ok"])

    def test_wrong_secret_refused(self):
        r = self.client.post("/embed", json={"clips": []}, headers={"X-Voice-Id-Secret": "nope"})
        self.assertEqual(r.status_code, 401)

    def test_no_secret_configured_fails_closed(self):
        old = os.environ.pop("VOICE_ID_SECRET")
        try:
            r = self.client.post("/embed", json={"clips": []}, headers=H)
            self.assertEqual(r.status_code, 503)
            self.assertEqual(r.json()["reason"], "not_configured")
        finally:
            os.environ["VOICE_ID_SECRET"] = old

    def test_model_not_loaded(self):
        service._state["encoder"] = None
        r = self.client.post("/embed", json={"clips": ["a", "b"]}, headers=H)
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["reason"], "model_not_loaded")


class TestEmbed(Base):
    def clips(self, *waves, fmt="wav"):
        return {"clips": [base64.b64encode(encode(w, fmt)).decode() for w in waves]}

    def test_three_good_clips_make_a_voiceprint(self):
        r = self.client.post("/embed", json=self.clips(tone(200, 5), tone(200, 5), tone(200, 5)), headers=H)
        j = r.json()
        self.assertEqual(r.status_code, 200, j)
        self.assertTrue(j["ok"], j)
        self.assertEqual(len(j["voiceprint"]), 192)
        self.assertAlmostEqual(float(np.linalg.norm(j["voiceprint"])), 1.0, places=3)
        self.assertGreater(j["clip_agreement"], 0.9)

    def test_browser_webm_clips_decode(self):
        j = self.client.post("/embed", json=self.clips(tone(250, 5), tone(250, 5), fmt="webm"), headers=H).json()
        self.assertTrue(j["ok"], j)

    def test_different_voices_rejected(self):
        j = self.client.post("/embed", json=self.clips(tone(150, 5), tone(600, 5), tone(150, 5)), headers=H).json()
        self.assertFalse(j["ok"])
        self.assertEqual(j["reason"], "clips_disagree")

    def test_quiet_and_short_clips_flagged(self):
        j = self.client.post("/embed", json=self.clips(tone(200, 5, amp=0.001), tone(200, 1)), headers=H).json()
        self.assertFalse(j["ok"])
        self.assertEqual([c["problem"] for c in j["clips"]], ["too_quiet", "too_short"])

    def test_mostly_silent_clip_flagged(self):
        wave = np.concatenate([tone(200, 1.0), np.zeros(int(4 * SR), dtype=np.float32)])
        j = self.client.post("/embed", json=self.clips(wave, tone(200, 5)), headers=H).json()
        self.assertEqual(j["clips"][0]["problem"], "too_much_silence")
        self.assertIsNone(j["clips"][1]["problem"])

    def test_not_base64(self):
        r = self.client.post("/embed", json={"clips": ["***", "***"]}, headers=H)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["reason"], "bad_clip")

    def test_clip_count(self):
        r = self.client.post("/embed", json={"clips": ["a"]}, headers=H)
        self.assertEqual(r.json()["reason"], "bad_clip_count")


def voiceprint(freq: float) -> list[float]:
    return list(matching.normalise(PitchEncoder().embed(tone(freq, 5))))


def meeting(turns: list[tuple[float, float]]) -> tuple[np.ndarray, list[dict]]:
    """turns = [(pitch, seconds)], spoken one after another. Speaker label = the pitch."""
    waves, segs, t = [], [], 0.0
    for freq, secs in turns:
        waves.append(tone(freq, secs))
        segs.append({"file": 0, "start": t, "end": t + secs, "speaker": f"Speaker {int(freq)}"})
        t += secs
    return np.concatenate(waves), segs


class TestIdentify(Base):
    def run_meeting(self, turns, candidates, pieces=3, **extra):
        wave, segs = meeting(turns)
        data = encode(wave, "webm")
        # cut the file into pieces the way storage holds them; joined in order they are the same bytes
        step = len(data) // pieces + 1
        parts = {f"m/s00/{i:04d}.webm": data[i * step:(i + 1) * step] for i in range(pieces)}
        self.serve(parts)
        body = {"files": [{"urls": [f"https://store.example.com/{k}" for k in sorted(parts)]}],
                "segments": segs, "candidates": candidates, **extra}
        r = self.client.post("/identify", json=body, headers=H)
        return r, {s["speaker"]: s for s in r.json().get("speakers", [])}

    def test_names_each_voice(self):
        r, out = self.run_meeting(
            [(200, 6), (450, 5), (200, 4), (700, 6), (450, 3)],
            [{"id": "ramesh", "voiceprint": voiceprint(200)}, {"id": "priya", "voiceprint": voiceprint(450)},
             {"id": "amit", "voiceprint": voiceprint(700)}],
        )
        self.assertEqual(r.status_code, 200, r.json())
        self.assertEqual(out["Speaker 200"]["match"], "ramesh")
        self.assertEqual(out["Speaker 450"]["match"], "priya")
        self.assertEqual(out["Speaker 700"]["match"], "amit")
        self.assertTrue(all(s["reason"] == "matched" for s in out.values()))

    def test_voice_not_enrolled_stays_unknown(self):
        _, out = self.run_meeting(
            [(200, 6), (900, 6)],
            [{"id": "ramesh", "voiceprint": voiceprint(200)}, {"id": "priya", "voiceprint": voiceprint(450)}],
        )
        self.assertEqual(out["Speaker 200"]["match"], "ramesh")
        self.assertIsNone(out["Speaker 900"]["match"])
        self.assertIn(out["Speaker 900"]["reason"], {"below_threshold", "no_candidate"})

    def test_two_voices_never_get_the_same_name(self):
        _, out = self.run_meeting([(200, 6), (210, 6)], [{"id": "ramesh", "voiceprint": voiceprint(205)}])
        named = [s["match"] for s in out.values() if s["match"]]
        self.assertLessEqual(len(named), 1)

    def test_too_little_speech(self):
        _, out = self.run_meeting([(200, 6), (450, 1.2)], [{"id": "ramesh", "voiceprint": voiceprint(200)}])
        self.assertEqual(out["Speaker 450"]["reason"], "not_enough_speech")

    def test_url_from_other_host_refused(self):
        body = {"files": [{"urls": ["https://evil.example.com/x.webm"]}],
                "segments": [{"file": 0, "start": 0, "end": 5, "speaker": "Speaker 1"}],
                "candidates": [{"id": "a", "voiceprint": voiceprint(200)}]}
        self.serve({})
        r = self.client.post("/identify", json=body, headers=H)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["reason"], "url_not_allowed")

    def test_plain_http_refused(self):
        body = {"files": [{"urls": ["http://store.example.com/x.webm"]}],
                "segments": [{"file": 0, "start": 0, "end": 5, "speaker": "Speaker 1"}], "candidates": []}
        self.serve({})
        self.assertEqual(self.client.post("/identify", json=body, headers=H).json()["reason"], "url_not_allowed")

    def test_bad_inputs(self):
        ok_file = [{"urls": ["https://store.example.com/x"]}]
        cases = [
            ({"files": [], "segments": [], "candidates": []}, "bad_file_count"),
            ({"files": ok_file, "segments": [{"file": 3, "start": 0, "end": 2, "speaker": "S"}], "candidates": []}, "bad_segment"),
            ({"files": ok_file, "segments": [{"file": 0, "start": 5, "end": 2, "speaker": "S"}], "candidates": []}, "bad_segment"),
            ({"files": ok_file, "segments": [], "candidates": [{"id": "a", "voiceprint": [0.1, 0.2]}]}, "bad_candidate"),
        ]
        for body, reason in cases:
            r = self.client.post("/identify", json=body, headers=H)
            self.assertEqual(r.status_code, 400, body)
            self.assertEqual(r.json()["reason"], reason)


class TestMatching(unittest.TestCase):
    def test_crosstalk_and_short_lines_skipped(self):
        segs = [matching.Segment(0, 0, 5, "A"), matching.Segment(0, 4, 8, "B"),
                matching.Segment(0, 10, 11, "A"), matching.Segment(0, 12, 20, "B")]
        picked = matching.pick_segments(segs)
        self.assertNotIn("A", picked)  # its long line overlaps B, its other line is too short
        self.assertEqual(len(picked["B"]), 1)
        self.assertAlmostEqual(picked["B"][0].start, 12.15)

    def test_speech_capped_per_speaker(self):
        segs = [matching.Segment(0, i * 10, i * 10 + 9, "A") for i in range(20)]
        total = sum(s.end - s.start for s in matching.pick_segments(segs)["A"])
        self.assertLessEqual(total, matching.MAX_SPEECH_PER_SPEAKER_S + 1e-6)

    def test_too_close_is_not_a_match(self):
        a = np.array([1.0, 0.0, 0.0])
        out = matching.assign({"S1": a}, {"x": np.array([0.9, 0.44, 0]), "y": np.array([0.9, 0.0, 0.44])}, 0.6, 0.08)
        self.assertEqual(out["S1"][3], "too_close")
        self.assertIsNone(out["S1"][0])


if __name__ == "__main__":
    unittest.main()
