/**
 * View issues (owner 2026-11-12): flagged rows are grouped by the kind of problem, so one kind can be handled at once.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { issueKind, issueKinds } from "../../frontend/components/candidates/issue-kind";

describe("kinds of issue", () => {
  it("leaves out the row's own values, so the same problem on two rows is one kind", () => {
    const a = issueKind('Expected in-hand "0.3" read as thousands; it may mean lakh per year');
    const b = issueKind('Expected in-hand "12.5" read as thousands; it may mean lakh per year');
    assert.equal(a, b);
    assert.equal(a, 'Expected in-hand "..." read as thousands; it may mean lakh per year');
    assert.equal(issueKind("Notice period of 45 days   looks long"), "Notice period of # days looks long");
    assert.equal(issueKind("Relevant experience is more than total experience"), "Relevant experience is more than total experience");
  });

  it("counts rows per kind, most rows first, a row once per kind", () => {
    const rows = [
      { issues: ['Email "a@@x" is not a valid address', 'Email "b@@x" is not a valid address'] },
      { issues: ["Relevant experience is more than total experience"] },
      { issues: ['Email "c@@x" is not a valid address', "Relevant experience is more than total experience"] },
      { issues: ["Relevant experience is more than total experience"] },
    ];
    assert.deepEqual(issueKinds(rows), [
      ["Relevant experience is more than total experience", 3],
      ['Email "..." is not a valid address', 2],
    ]);
  });
});
