import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCandidateRemark } from "../../backend/lib/candidates/remark-format";

test("formats candidate remarks with the configured model and keeps a fallback for unusable replies", async () => {
  const note = "Salary 42inhand\n52 inhand exp\nNotice period - immedidate";
  const bullets = [
    { label: "Current Salary", value: "₹42,000/month (in-hand)" },
    { label: "Expected Salary", value: "₹52,000/month (in-hand)" },
    { label: "Notice Period", value: "Immediate availability" },
  ];
  assert.deepEqual(await formatCandidateRemark(note, async request => {
    assert.equal(request.user, note);
    assert.equal(request.accept?.(JSON.stringify({ bullets })), true);
    return { text: JSON.stringify({ bullets }), model: "test-model" };
  }), bullets);
  assert.deepEqual(await formatCandidateRemark(note, async () => ({ text: '{"bullets":[{"label":"Missing value"}]}', model: "test-model" })), []);
  assert.deepEqual(await formatCandidateRemark(note, async () => { throw new Error("offline"); }), []);
});
