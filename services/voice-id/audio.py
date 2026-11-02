"""
Audio helpers: decode any recorder format to 16 kHz mono with ffmpeg, simple quality checks.

Nothing here writes audio to disk except a temporary file that is deleted straight after decoding.
"""

from __future__ import annotations

import os
import subprocess
import tempfile

import numpy as np

SAMPLE_RATE = 16_000
FFMPEG_TIMEOUT_S = 240


class AudioError(Exception):
    def __init__(self, reason: str, detail: str = ""):
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason
        self.detail = detail


def decode(data: bytes) -> np.ndarray:
    """Any format ffmpeg reads (webm/opus, ogg, m4a, mp3, wav) -> float32 mono 16 kHz in [-1, 1]."""
    if not data:
        raise AudioError("empty_audio")
    fd, path = tempfile.mkstemp(prefix="vid-", suffix=".bin")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        # A file is used instead of stdin: webm/m4a need seeking to be read reliably.
        proc = subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path,
             "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"],
            capture_output=True, timeout=FFMPEG_TIMEOUT_S, check=False,
        )
    except subprocess.TimeoutExpired as e:
        raise AudioError("decode_failed", "timed out") from e
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
    if proc.returncode != 0 or not proc.stdout:
        # ffmpeg's message names the format problem; it never contains what was said
        raise AudioError("decode_failed", proc.stderr.decode("utf-8", "replace").strip()[:200])
    pcm = np.frombuffer(proc.stdout, dtype=np.int16)
    return (pcm.astype(np.float32) / 32768.0)


def rms(wave: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(wave, dtype=np.float64)))) if wave.size else 0.0


def clipped_fraction(wave: np.ndarray) -> float:
    return float(np.mean(np.abs(wave) >= 0.99)) if wave.size else 0.0


def voiced_fraction(wave: np.ndarray, frame_s: float = 0.03) -> float:
    """
    Share of 30 ms frames that are within 20 dB of the loud part of the clip (a rough speech check).
    Measured against the LOUD part, so someone talking without pauses is not mistaken for silence.
    """
    n = int(SAMPLE_RATE * frame_s)
    if wave.size < n * 5:
        return 0.0
    frames = wave[: wave.size // n * n].reshape(-1, n)
    energy = np.sqrt(np.mean(np.square(frames, dtype=np.float64), axis=1))
    loud = np.percentile(energy, 95)
    return float(np.mean(energy > max(loud * 0.1, 0.005)))


def check_clip(wave: np.ndarray, min_s: float, max_s: float) -> str | None:
    """None when the clip is usable, else a short reason the screen can show."""
    seconds = wave.size / SAMPLE_RATE
    if seconds < min_s:
        return "too_short"
    if seconds > max_s:
        return "too_long"
    if rms(wave) < 0.005:
        return "too_quiet"
    if clipped_fraction(wave) > 0.01:
        return "too_loud"
    if voiced_fraction(wave) < 0.35:
        return "too_much_silence"
    return None


def cut(wave: np.ndarray, start: float, end: float) -> np.ndarray:
    a = max(0, int(start * SAMPLE_RATE))
    b = min(wave.size, int(end * SAMPLE_RATE))
    return wave[a:b] if b > a else wave[0:0]
