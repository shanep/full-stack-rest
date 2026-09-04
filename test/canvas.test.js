// Run with: npm test
//
// These tests cover the two pieces of logic that are easy to get wrong --
// parsing the pagination Link header and classifying due-date urgency -- without
// ever calling Canvas. Pure functions are cheap to test; network code is not.
import test from "node:test";
import assert from "node:assert/strict";

import { parseNextLink } from "../lib/canvas.js";
import { toAssignmentViews, classifyUrgency, summarize } from "../lib/assignments.js";

test("parseNextLink finds the next page URL", () => {
  const header =
    '<https://canvas.test/api/v1/courses?page=1>; rel="current",' +
    '<https://canvas.test/api/v1/courses?page=2>; rel="next",' +
    '<https://canvas.test/api/v1/courses?page=9>; rel="last"';

  assert.equal(parseNextLink(header), "https://canvas.test/api/v1/courses?page=2");
});

test("parseNextLink returns null on the last page", () => {
  const header = '<https://canvas.test/api/v1/courses?page=9>; rel="last"';

  assert.equal(parseNextLink(header), null);
  assert.equal(parseNextLink(null), null);
});

test("classifyUrgency buckets by how far away the due date is", () => {
  const now = new Date("2026-09-04T12:00:00Z");
  const at = (iso) => classifyUrgency(new Date(iso), now);

  assert.equal(at("2026-09-03T12:00:00Z"), "overdue");
  assert.equal(at("2026-09-04T20:00:00Z"), "today");
  assert.equal(at("2026-09-06T12:00:00Z"), "soon");
  assert.equal(at("2026-09-20T12:00:00Z"), "upcoming");
  assert.equal(classifyUrgency(null, now), "none");
});

test("toAssignmentViews sorts by due date and pushes undated work to the end", () => {
  const now = new Date("2026-09-04T12:00:00Z");
  const raw = [
    { id: 1, name: "Later", due_at: "2026-09-20T23:59:00Z", points_possible: 50 },
    { id: 2, name: "Someday", due_at: null },
    { id: 3, name: "Soonest", due_at: "2026-09-05T23:59:00Z", points_possible: 10 },
  ];

  const views = toAssignmentViews(raw, now);

  assert.deepEqual(
    views.map((a) => a.name),
    ["Soonest", "Later", "Someday"]
  );
  assert.equal(views[0].urgency, "soon");
  assert.equal(views[2].dueLabel, "No due date");
  assert.equal(views[2].points, null);
});

test("summarize counts each urgency bucket", () => {
  const now = new Date("2026-09-04T12:00:00Z");
  const views = toAssignmentViews(
    [
      { id: 1, name: "Late", due_at: "2026-09-01T23:59:00Z" },
      { id: 2, name: "Also late", due_at: "2026-09-02T23:59:00Z" },
      { id: 3, name: "Far off", due_at: "2026-10-01T23:59:00Z" },
    ],
    now
  );

  assert.deepEqual(summarize(views), {
    total: 3,
    overdue: 2,
    today: 0,
    soon: 0,
    upcoming: 1,
    none: 0,
  });
});
