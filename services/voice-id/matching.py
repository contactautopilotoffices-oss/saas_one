"""
Speaker matching maths. No PyTorch here, so it can be tested without the model.

Plan: docs/LIVEVOICE_ID_PLAN.md (section 3.2).

1. For each diarized speaker ("Speaker 1", ...) pick their clearest stretches of speech.
2. One voiceprint per speaker = average of the voiceprints of those stretches.
3. Compare each speaker only with the people picked as present in the meeting.
4. One-to-one assignment (two voices can never both become the same person).
5. Accept a match only above a threshold AND with a clear gap to the next-best person.
   When unsure, the answer is "no match" (a wrong name is worse than no name).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import linear_sum_assignment

# Lines shorter than this are skipped: too short for a reliable voiceprint.
MIN_SEGMENT_S = 1.5
# Per speaker, use at most this much speech (longest stretches first). Enough for a stable voiceprint, fast on CPU.
MAX_SPEECH_PER_SPEAKER_S = 60.0
# Cut this much off both ends of each stretch: diarization edges often hold the previous speaker's last word.
EDGE_TRIM_S = 0.15
# A speaker needs at least this much usable speech to be matched at all.
MIN_SPEECH_PER_SPEAKER_S = 3.0


@dataclass(frozen=True)
class Segment:
    file: int
    start: float
    end: float
    speaker: str


@dataclass
class SpeakerResult:
    speaker: str
    match: str | None
    score: float | None
    second: float | None
    seconds_used: float
    segments_used: int
    reason: str
    scores: dict[str, float] = field(default_factory=dict)


def normalise(v: np.ndarray) -> np.ndarray:
    v = np.asarray(v, dtype=np.float64).reshape(-1)
    n = float(np.linalg.norm(v))
    return v / n if n > 0 else v


def overlaps(segments: list[Segment]) -> set[int]:
    """Indexes of segments that overlap a segment of ANOTHER speaker in the same file (cross-talk)."""
    bad: set[int] = set()
    by_file: dict[int, list[tuple[int, Segment]]] = {}
    for i, s in enumerate(segments):
        by_file.setdefault(s.file, []).append((i, s))
    for items in by_file.values():
        items.sort(key=lambda x: x[1].start)
        for a in range(len(items)):
            ia, sa = items[a]
            for b in range(a + 1, len(items)):
                ib, sb = items[b]
                if sb.start >= sa.end:
                    break
                if sa.speaker != sb.speaker:
                    bad.add(ia)
                    bad.add(ib)
    return bad


def pick_segments(segments: list[Segment]) -> dict[str, list[Segment]]:
    """Per speaker: the longest clean stretches, trimmed, up to MAX_SPEECH_PER_SPEAKER_S in total."""
    crosstalk = overlaps(segments)
    by_speaker: dict[str, list[Segment]] = {}
    for i, s in enumerate(segments):
        if i in crosstalk:
            continue
        start, end = s.start + EDGE_TRIM_S, s.end - EDGE_TRIM_S
        if end - start < MIN_SEGMENT_S:
            continue
        by_speaker.setdefault(s.speaker, []).append(Segment(s.file, start, end, s.speaker))
    picked: dict[str, list[Segment]] = {}
    for speaker, segs in by_speaker.items():
        segs.sort(key=lambda x: x.end - x.start, reverse=True)
        out: list[Segment] = []
        total = 0.0
        for s in segs:
            if total >= MAX_SPEECH_PER_SPEAKER_S:
                break
            room = MAX_SPEECH_PER_SPEAKER_S - total
            if s.end - s.start > room:
                if room < MIN_SEGMENT_S:
                    break
                s = Segment(s.file, s.start, s.start + room, s.speaker)
            out.append(s)
            total += s.end - s.start
        picked[speaker] = out
    return picked


def speaker_voiceprint(embeddings: list[np.ndarray], durations: list[float]) -> np.ndarray:
    """Duration-weighted average of normalised segment voiceprints, normalised again."""
    if not embeddings:
        raise ValueError("no embeddings")
    w = np.asarray(durations, dtype=np.float64)
    stacked = np.stack([normalise(e) for e in embeddings])
    return normalise((stacked * w[:, None]).sum(axis=0))


def assign(
    speakers: dict[str, np.ndarray],
    candidates: dict[str, np.ndarray],
    threshold: float,
    margin: float,
) -> dict[str, tuple[str | None, float | None, float | None, str, dict[str, float]]]:
    """
    Returns, per speaker: (matched candidate id or None, score, second-best score, reason, all scores).
    reason: matched | below_threshold | too_close | no_candidate
    """
    sp_names = list(speakers)
    cand_ids = list(candidates)
    out: dict[str, tuple[str | None, float | None, float | None, str, dict[str, float]]] = {}
    if not cand_ids:
        for s in sp_names:
            out[s] = (None, None, None, "no_candidate", {})
        return out
    if not sp_names:
        return out

    S = np.stack([normalise(speakers[s]) for s in sp_names])
    C = np.stack([normalise(candidates[c]) for c in cand_ids])
    sim = S @ C.T  # cosine similarity, speakers x candidates

    rows, cols = linear_sum_assignment(-sim)
    chosen = {int(r): int(c) for r, c in zip(rows, cols)}

    for r, name in enumerate(sp_names):
        scores = {cand_ids[c]: round(float(sim[r, c]), 4) for c in range(len(cand_ids))}
        if r not in chosen:
            # More speakers than candidates: this voice got nobody
            best = float(sim[r].max())
            out[name] = (None, round(best, 4), None, "no_candidate", scores)
            continue
        c = chosen[r]
        score = float(sim[r, c])
        others = [float(sim[r, k]) for k in range(len(cand_ids)) if k != c]
        second = max(others) if others else None
        # A different voice that sounds MORE like this person also makes the match unsure
        rival_voice = max((float(sim[k, c]) for k in range(len(sp_names)) if k != r), default=None)
        if score < threshold:
            reason = "below_threshold"
        elif second is not None and score - second < margin:
            reason = "too_close"
        elif rival_voice is not None and rival_voice >= threshold and score - rival_voice < margin:
            reason = "too_close"
        else:
            reason = "matched"
        out[name] = (
            cand_ids[c] if reason == "matched" else None,
            round(score, 4),
            round(second, 4) if second is not None else None,
            reason,
            scores,
        )
    return out
