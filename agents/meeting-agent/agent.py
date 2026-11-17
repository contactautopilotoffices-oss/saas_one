"""
FMS meeting agent — one LiveKit worker that sits in FMS meeting rooms.

How a room works
----------------
1. Someone joins a meeting in FMS. Their token asks LiveKit to dispatch this
   worker (agent name MEETING_AGENT_NAME) into the room.
2. The worker asks FMS which meeting the room is, which of our agents runs it
   (Ira, …) and what the agenda is — GET /api/meetings/agent?room=…
3. Every person is transcribed SEPARATELY from their own microphone track, so
   "who said what" comes from their FMS login, not from guessing voices.
   LiveKit's built-in voice session listens to one person; a meeting has many,
   so the session's own audio input is switched off and this file does the
   listening.
4. By default (MEETING_AGENT_MODE=listen) the agent never speaks: it writes
   decisions silently. In "speak" mode it speaks only when the room has gone quiet for a moment, or when it
   is spoken over it stops. It may also decide to stay quiet.
5. Decisions, item progress, stated rules and the transcript are sent to FMS
   (POST /api/meetings/agent). Nothing here writes to the database directly
   and nothing here can approve or cancel anything in Zoho.

Run locally:  python agent.py dev      Deploy:  see README.md
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Literal

import aiohttp
from livekit import rtc
from openai import AsyncOpenAI
from livekit.agents import Agent, AgentSession, AutoSubscribe, JobContext, WorkerOptions, cli, function_tool, room_io
from livekit.agents import stt as lkstt
from livekit.plugins import openai, sarvam

from prompts import describe, instructions_for, opening_line, persona_for

log = logging.getLogger("meeting-agent")

AGENT_NAME = os.environ.get("MEETING_AGENT_NAME", "fms-meeting-agent")
FMS_BASE_URL = os.environ.get("FMS_BASE_URL", "").rstrip("/")
AGENT_SECRET = os.environ.get("MEETING_AGENT_SECRET", "")
# How long the room must be quiet before the agent takes its turn.
SILENCE_S = float(os.environ.get("MEETING_AGENT_SILENCE_S", "1.2"))
# Words of someone else's speech that make the agent stop talking.
INTERRUPT_WORDS = int(os.environ.get("MEETING_AGENT_INTERRUPT_WORDS", "3"))
# "listen" (default): the agent never speaks — it transcribes and writes decisions
# silently while people run the meeting themselves. "speak": it chairs the meeting aloud.
LISTEN_ONLY = os.environ.get("MEETING_AGENT_MODE", "listen").strip().lower() != "speak"

# Sarvam end to end — ears (Saaras), brain and voice (Bulbul) — the stack Meera
# already runs on, with Hinglish built in and one key. Any OpenAI-compatible
# endpoint can replace the brain through these three settings.
LLM_BASE_URL = os.environ.get("MEETING_AGENT_LLM_BASE_URL", "https://api.sarvam.ai/v1")
LLM_MODEL = os.environ.get("MEETING_AGENT_LLM_MODEL", "sarvam-105b-conversations")
LLM_API_KEY = os.environ.get("MEETING_AGENT_LLM_API_KEY") or os.environ.get("SARVAM_API_KEY", "")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Fms:
    """The one door to FMS. Never raises: a failed call comes back as {"error": …}."""

    def __init__(self, room: str) -> None:
        self.room = room
        self._http: aiohttp.ClientSession | None = None

    def _client(self) -> aiohttp.ClientSession:
        if self._http is None or self._http.closed:
            self._http = aiohttp.ClientSession(
                headers={"Authorization": f"Bearer {AGENT_SECRET}"},
                timeout=aiohttp.ClientTimeout(total=15),
            )
        return self._http

    async def get_meeting(self) -> dict:
        try:
            async with self._client().get(f"{FMS_BASE_URL}/api/meetings/agent", params={"room": self.room}) as r:
                body = await r.json(content_type=None)
                return body if r.status == 200 else {"error": body.get("error") or f"HTTP {r.status}"}
        except Exception as e:  # noqa: BLE001 — reported, never raised
            return {"error": str(e)}

    async def post(self, payload: dict) -> dict:
        try:
            async with self._client().post(f"{FMS_BASE_URL}/api/meetings/agent", json={"room": self.room, **payload}) as r:
                body = await r.json(content_type=None)
                if r.status >= 400:
                    log.warning("FMS refused %s: %s", payload.get("type"), body)
                    return {"error": body.get("error") or f"HTTP {r.status}"}
                return body
        except Exception as e:  # noqa: BLE001
            log.warning("FMS unreachable for %s: %s", payload.get("type"), e)
            return {"error": str(e)}

    async def aclose(self) -> None:
        if self._http and not self._http.closed:
            await self._http.close()


class Transcript:
    """Buffers spoken lines and sends them to FMS every few seconds."""

    def __init__(self, fms: Fms) -> None:
        self.fms = fms
        self.buf: list[dict] = []

    def add(self, identity: str, name: str, text: str, is_agent: bool) -> None:
        self.buf.append({"identity": identity, "name": name, "text": text, "is_agent": is_agent, "at": now_iso()})

    async def flush(self) -> None:
        if not self.buf:
            return
        batch, self.buf = self.buf, []
        r = await self.fms.post({"type": "lines", "lines": batch})
        if r.get("error"):
            self.buf = batch + self.buf  # keep it for the next flush


class Floor:
    """Who is talking right now, and what the agent has not answered yet."""

    def __init__(self) -> None:
        self.pending: list[tuple[str, str]] = []
        self.speaking: set[str] = set()
        self.last = time.monotonic()

    def heard(self, name: str, text: str) -> None:
        self.pending.append((name, text))
        self.last = time.monotonic()

    def touch(self) -> None:
        self.last = time.monotonic()

    def ready(self) -> bool:
        return bool(self.pending) and not self.speaking and time.monotonic() - self.last >= SILENCE_S

    def take(self) -> str:
        text = "\n".join(f"{name}: {words}" for name, words in self.pending)
        self.pending = []
        return text


class MeetingAgent(Agent):
    """Runs the agenda. Its tools are the only way anything gets written."""

    def __init__(self, meeting: dict, items: list[dict], fms: Fms) -> None:
        self.meeting = meeting
        self.items = items
        self.fms = fms
        self.decided = {i["id"] for i in items if i.get("status") == "discussed"}
        self.parked = {i["id"] for i in items if i.get("status") == "parked"}
        done = self.decided | self.parked
        self.idx = next((n for n, i in enumerate(items) if i["id"] not in done), len(items))
        super().__init__(instructions=instructions_for(meeting, items, listen=LISTEN_ONLY))

    def current(self) -> dict | None:
        return self.items[self.idx] if self.idx < len(self.items) else None

    def remaining(self) -> int:
        return len(self.items) - self.idx

    async def _advance(self) -> str:
        self.idx += 1
        item = self.current()
        if not item:
            if LISTEN_ONLY:
                return f"Agenda finished: {len(self.decided)} decided, {len(self.parked)} parked. Call stay_quiet from now on."
            return (f"Agenda finished: {len(self.decided)} decided, {len(self.parked)} parked. "
                    "Thank everyone, say those two numbers, say the host will confirm the decision sheet, then stay quiet.")
        await self.fms.post({"type": "item", "item_id": item["id"], "status": "current"})
        if LISTEN_ONLY:
            return f"Current item is now {item['position']} of {len(self.items)}: {describe(item)}. Write nothing."
        return f"Next is item {item['position']} of {len(self.items)}: {describe(item)}. Present it and ask your one question."

    @function_tool
    async def record_decision(
        self,
        decision: Literal["approve", "cancel", "needs_info", "hold", "reassign"],
        owner_name: str,
        said_by: str,
        due: str = "",
        note: str = "",
    ) -> str:
        """Write down what the room decided for the CURRENT agenda item.

        Use only when someone in the room has clearly said what should happen. Do not use it
        for your own suggestion, for something nobody agreed to, or for any item other than
        the current one. If the room corrects you, call it again; the earlier one is replaced.

        Args:
            decision: approve (the approver agrees), cancel (the PO is no longer needed),
                needs_info (something is missing before anyone can approve), hold (still needed,
                wait), reassign (someone else should own it).
            owner_name: the person who will act on it, as said in the room.
            said_by: who gave the decision, exactly as their name appears in the messages.
            due: when, in the room's own words ("Friday", "month end"); empty if nobody said.
            note: one short line with the reason given.
        """
        item = self.current()
        if not item:
            return "There is no current item: the agenda is finished."
        r = await self.fms.post({
            "type": "decision", "item_id": item["id"], "decision": decision,
            "owner_name": owner_name, "said_by": said_by, "due_text": due, "note": note,
        })
        if r.get("error"):
            return f"Not saved ({r['error']}). Tell the room it could not be saved, then carry on."
        self.decided.add(item["id"])
        self.parked.discard(item["id"])
        if LISTEN_ONLY:
            return f"Saved for {item['label']}. Write nothing."
        # The model often reads the decision back in the same breath as this call;
        # asking it to read back again here is what made it say "सही है?" twice.
        return (f"Saved for {item['label']}. If you have not read it back yet, do it now in one short "
                "sentence ending with \"सही है?\". If you already did, output nothing.")

    @function_tool
    async def next_item(self) -> str:
        """Move on once the current item's decision is confirmed, or nobody objects.

        Do not use it when no decision was recorded for the current item: use park_item.
        """
        item = self.current()
        if not item:
            return "The agenda is already finished. Stay quiet."
        if item["id"] not in self.decided:
            return f"{item['label']} has no decision yet. Call record_decision, or park_item with the reason."
        await self.fms.post({"type": "item", "item_id": item["id"], "status": "discussed"})
        return await self._advance()

    @function_tool
    async def park_item(self, reason: str) -> str:
        """Set the current item aside without a decision and move to the next one.

        Use when the room cannot decide after about two exchanges, or nobody present owns it.
        Do not use it when a decision was given: record that instead.

        Args:
            reason: one short line, for example "Saniel not here" or "vendor status unknown".
        """
        item = self.current()
        if not item:
            return "The agenda is already finished. Stay quiet."
        await self.fms.post({"type": "item", "item_id": item["id"], "status": "parked", "reason": reason})
        self.parked.add(item["id"])
        return await self._advance()

    @function_tool
    async def note_rule(self, rule: str, said_by: str) -> str:
        """Write down a standing business rule someone stated, for an approver to confirm later.

        Use only for a rule that applies beyond this one PO, such as "anything under 25 thousand,
        Saniel approves directly". Do not use it for a decision on the current item.

        Args:
            rule: the rule in one sentence, in the words the room used.
            said_by: who stated it, exactly as their name appears in the messages.
        """
        r = await self.fms.post({"type": "rule", "note": rule, "said_by": said_by})
        if r.get("error"):
            return f"Not saved ({r['error']}). Say so in a few words and carry on."
        if LISTEN_ONLY:
            return "Noted. Write nothing."
        return "Noted. Acknowledge in three words or fewer and carry on with the current item."

    @function_tool
    async def focus_item(self, position: int) -> str:
        """Switch to the agenda item the room is now talking about, by its agenda number.

        Use only when people have clearly moved to a different PO than the current one, for
        example by naming its PO number or vendor. Do not use it for the item already current.

        Args:
            position: the item's number on the agenda (1, 2, 3 …).
        """
        target = next((n for n, i in enumerate(self.items) if i["position"] == position), None)
        if target is None:
            return f"There is no item {position} on the agenda."
        if target == self.idx:
            return "That item is already current."
        old = self.current()
        # An item left without a decision goes back to the queue; one with a decision is done.
        if old and old["id"] not in self.decided and old["id"] not in self.parked:
            await self.fms.post({"type": "item", "item_id": old["id"], "status": "pending"})
        elif old and old["id"] in self.decided:
            await self.fms.post({"type": "item", "item_id": old["id"], "status": "discussed"})
        self.idx = target
        item = self.items[target]
        await self.fms.post({"type": "item", "item_id": item["id"], "status": "current"})
        return f"Current item is now {describe(item)}." + (" Write nothing." if LISTEN_ONLY else "")

    @function_tool
    async def stay_quiet(self) -> str:
        """Say nothing this turn.

        Use when people are talking among themselves, thinking aloud, or have not answered
        yet. Do not use it when someone has asked you something directly.
        """
        # The model API rejects a tool result with zero characters, so this returns a
        # short acknowledgement rather than None.
        return "Stayed quiet."


def _llm() -> openai.LLM:
    # Sarvam reads its own header; sending both keeps any OpenAI-compatible endpoint working.
    client = AsyncOpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY,
                         default_headers={"api-subscription-key": LLM_API_KEY}, max_retries=1)
    return openai.LLM(model=LLM_MODEL, client=client, temperature=0.3)


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    fms = Fms(ctx.room.name)
    ctx.add_shutdown_callback(fms.aclose)

    data = await fms.get_meeting()
    if data.get("error"):
        # Unknown room, or a meeting the host already ended: do not stay.
        log.error("FMS refused room %s (%s); leaving", ctx.room.name, data["error"])
        ctx.shutdown(reason=f"FMS refused the room: {data['error']}")
        return
    meeting, items = data["meeting"], data["items"]
    persona = persona_for(meeting.get("agent_slug") or "ira")

    agent = MeetingAgent(meeting, items, fms)
    transcript = Transcript(fms)
    floor = Floor()
    ctx.add_shutdown_callback(transcript.flush)

    # Listen-only: no voice at all, and nothing the model writes reaches the room.
    session = AgentSession(llm=_llm()) if LISTEN_ONLY else AgentSession(
        llm=_llm(),
        tts=sarvam.TTS(target_language_code="hi-IN", model="bulbul:v3", speaker=persona["voice"], enable_preprocessing=True),
    )

    @session.on("conversation_item_added")
    def _said(ev) -> None:  # the agent's own words, for the transcript
        item = ev.item
        if LISTEN_ONLY:
            return  # it said nothing; its text is discarded
        if getattr(item, "role", None) == "assistant" and getattr(item, "text_content", None):
            transcript.add("agent", persona["name"], item.text_content, True)

    # The session's own microphone input is off: it would hear only one person.
    await session.start(
        agent=agent,
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=False, text_input=False, close_on_disconnect=False,
            audio_output=not LISTEN_ONLY, text_output=not LISTEN_ONLY,
        ),
    )
    await fms.post({"type": "joined"})

    stt_engine = sarvam.STT(language=os.environ.get("MEETING_AGENT_STT_LANGUAGE", "hi-IN"), model="saaras:v3", mode="codemix")
    listeners: dict[str, asyncio.Task] = {}

    async def listen(track: rtc.Track, participant: rtc.RemoteParticipant) -> None:
        name = participant.name or participant.identity
        audio = rtc.AudioStream(track, sample_rate=16000, num_channels=1)
        stream = stt_engine.stream()

        async def pump() -> None:
            async for frame_event in audio:
                stream.push_frame(frame_event.frame)

        pumping = asyncio.create_task(pump())
        try:
            async for ev in stream:
                words = ev.alternatives[0].text.strip() if ev.alternatives else ""
                if ev.type == lkstt.SpeechEventType.START_OF_SPEECH:
                    floor.speaking.add(participant.identity)
                    floor.touch()
                elif ev.type == lkstt.SpeechEventType.INTERIM_TRANSCRIPT:
                    floor.touch()
                    # Being talked over: stop and let them finish.
                    if not LISTEN_ONLY and session.agent_state == "speaking" and len(words.split()) >= INTERRUPT_WORDS:
                        session.interrupt()
                elif ev.type == lkstt.SpeechEventType.FINAL_TRANSCRIPT and words:
                    floor.heard(name, words)
                    transcript.add(participant.identity, name, words, False)
                elif ev.type == lkstt.SpeechEventType.END_OF_SPEECH:
                    floor.speaking.discard(participant.identity)
                    floor.touch()
        except asyncio.CancelledError:
            pass
        except Exception as e:  # noqa: BLE001 — one person's stream failing must not end the meeting
            log.warning("transcription stopped for %s: %s", name, e)
        finally:
            floor.speaking.discard(participant.identity)
            pumping.cancel()
            await stream.aclose()
            await audio.aclose()

    def start_listening(track: rtc.Track, participant: rtc.RemoteParticipant) -> None:
        if track.kind != rtc.TrackKind.KIND_AUDIO or participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
            return
        if participant.identity in listeners and not listeners[participant.identity].done():
            return
        listeners[participant.identity] = asyncio.create_task(listen(track, participant))

    @ctx.room.on("track_subscribed")
    def _on_track(track: rtc.Track, _pub: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant) -> None:
        start_listening(track, participant)

    @ctx.room.on("participant_disconnected")
    def _on_left(participant: rtc.RemoteParticipant) -> None:
        task = listeners.pop(participant.identity, None)
        if task:
            task.cancel()
        floor.speaking.discard(participant.identity)

    for p in ctx.room.remote_participants.values():
        for pub in p.track_publications.values():
            if pub.track:
                start_listening(pub.track, p)

    async def take_turns() -> None:
        while True:
            await asyncio.sleep(0.25)
            if session.agent_state in ("speaking", "thinking"):
                continue
            if floor.ready():
                session.generate_reply(user_input=floor.take())

    async def flush_transcript() -> None:
        while True:
            await asyncio.sleep(3)
            await transcript.flush()

    turns = asyncio.create_task(take_turns())
    flusher = asyncio.create_task(flush_transcript())

    async def _stop() -> None:
        turns.cancel()
        flusher.cancel()
        for t in listeners.values():
            t.cancel()
    ctx.add_shutdown_callback(_stop)

    await ctx.wait_for_participant()
    first = agent.current()
    resuming = len(agent.decided | agent.parked) > 0
    if LISTEN_ONLY:
        # No spoken notice: the meeting page tells everyone it is transcribed before they join.
        if first:
            await fms.post({"type": "item", "item_id": first["id"], "status": "current"})
        return
    if first:
        await fms.post({"type": "item", "item_id": first["id"], "status": "current"})
        session.say(opening_line(meeting, agent.remaining(), resuming), allow_interruptions=False)
        session.generate_reply(instructions="Present the current agenda item and ask your one question.")
    else:
        session.say("आज के agenda के सारे items हो चुके हैं। Host decision sheet confirm कर सकते हैं।")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name=AGENT_NAME))
