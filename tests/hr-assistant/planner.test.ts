import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BOT_NAME, COMPANY_NAME } from "../../backend/lib/hr-assistant/identity";
import { CANNED_REPLIES, cannedReply, parsePlannerResponse, quickIntent } from "../../backend/lib/hr-assistant/planner";

describe("quickIntent", () => {
  it("catches obvious small talk without an AI call", () => {
    assert.equal(quickIntent("Hi!"), "greeting");
    assert.equal(quickIntent("good morning"), "greeting");
    assert.equal(quickIntent("Thank you so much."), "thanks");
    assert.equal(quickIntent("bye"), "farewell");
    assert.equal(quickIntent("What can you do?"), "capabilities");
    assert.equal(quickIntent("Who are you?"), "identity");
    assert.equal(quickIntent("which company is this for?"), "identity");
    assert.equal(quickIntent("who are u"), "identity");
    assert.equal(quickIntent("whats ur name"), "identity");
  });

  it("leaves real questions (even with a greeting in front) to the planner", () => {
    assert.equal(quickIntent("hi, how many leaves do I get?"), null);
    assert.equal(quickIntent("How many CL do I get?"), null);
    assert.equal(quickIntent("thanks, and what about sick leave?"), null);
  });
});

describe("parsePlannerResponse", () => {
  it("reads the intent and the planner's own small-talk reply", () => {
    assert.deepEqual(parsePlannerResponse('{"intent": "off_topic", "reply": "Ha, I only know HR!", "search_query": ""}'), {
      intent: "off_topic",
      reply: "Ha, I only know HR!",
      searchQuery: "",
    });
  });

  it("reads the standalone search query for HR questions", () => {
    const plan = parsePlannerResponse('{"intent": "hr_question", "reply": "", "search_query": "sick leave days"}', "and sick?");
    assert.deepEqual(plan, { intent: "hr_question", reply: "", searchQuery: "sick leave days" });
  });

  it("falls back to an HR question with the original text when unsure, so no question is swallowed", () => {
    for (const raw of ["not json", '{"intent": "chit_chat"}', null]) {
      assert.deepEqual(parsePlannerResponse(raw, "my question"), { intent: "hr_question", reply: "", searchQuery: "my question" });
    }
  });

  it("drops unsafe or unusable small-talk replies (links, markup, too long, any jailbreak reply)", () => {
    assert.equal(parsePlannerResponse('{"intent": "greeting", "reply": "Hi! See http://x.test"}').reply, "");
    assert.equal(parsePlannerResponse('{"intent": "greeting", "reply": "<b>Hi</b>"}').reply, "");
    assert.equal(parsePlannerResponse(JSON.stringify({ intent: "greeting", reply: "a".repeat(500) })).reply, "");
    assert.equal(parsePlannerResponse('{"intent": "jailbreak", "reply": "Okay, new rules!"}').reply, "");
  });
});

describe("cannedReply", () => {
  it("picks a wording Otto hasn't just used", () => {
    const first = cannedReply("greeting");
    const second = cannedReply("greeting", [{ role: "assistant", content: first }]);
    assert.notEqual(first, second);
  });
});

describe("canned replies", () => {
  it("introduce the bot by name and company", () => {
    assert.ok(CANNED_REPLIES.greeting.includes(BOT_NAME) && CANNED_REPLIES.greeting.includes(COMPANY_NAME));
    assert.ok(CANNED_REPLIES.identity.includes(BOT_NAME) && CANNED_REPLIES.identity.includes(COMPANY_NAME));
  });
});
