// Transform raw Canvas assignment JSON into the small, predictable shape the
// templates render. Keeping this separate from both the HTTP client and the
// route handlers means it is pure data-in/data-out and trivial to unit test.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @typedef {object} AssignmentView
 * @property {number}  id
 * @property {string}  name
 * @property {Date|null} dueAt
 * @property {string}  dueLabel     Human readable due date ("Fri, Sep 12, 11:59 PM").
 * @property {string}  relativeDue  "in 3 days", "today", "5 days ago", "no due date".
 * @property {string}  urgency      overdue | today | soon | upcoming | none
 * @property {number|null} points
 * @property {boolean} submitted
 * @property {string}  htmlUrl
 */

/**
 * @param {object[]} rawAssignments Assignment objects straight from Canvas.
 * @param {Date}     now            Injected so tests can pin "today".
 * @returns {AssignmentView[]} Sorted: dated assignments first (earliest first),
 *                             undated ones last.
 */
export function toAssignmentViews(rawAssignments, now = new Date()) {
  return rawAssignments
    .map((assignment) => {
      const dueAt = assignment.due_at ? new Date(assignment.due_at) : null;

      return {
        id: assignment.id,
        name: assignment.name ?? "(untitled assignment)",
        dueAt,
        dueLabel: formatDueDate(dueAt),
        relativeDue: describeRelativeDue(dueAt, now),
        urgency: classifyUrgency(dueAt, now),
        points: typeof assignment.points_possible === "number" ? assignment.points_possible : null,
        // `submission` is only present when the caller asked for it; treat a
        // missing submission as "not submitted" rather than crashing.
        submitted: Boolean(assignment.submission?.submitted_at),
        htmlUrl: assignment.html_url ?? "",
      };
    })
    .sort(compareByDueDate);
}

/** Undated assignments sort to the bottom; everything else is earliest-first. */
function compareByDueDate(a, b) {
  if (a.dueAt === null && b.dueAt === null) return a.name.localeCompare(b.name);
  if (a.dueAt === null) return 1;
  if (b.dueAt === null) return -1;
  return a.dueAt - b.dueAt;
}

/**
 * Bucket an assignment so the template can color-code it.
 * @returns {"overdue"|"today"|"soon"|"upcoming"|"none"}
 */
export function classifyUrgency(dueAt, now = new Date()) {
  if (dueAt === null) return "none";

  const daysAway = (dueAt - now) / MS_PER_DAY;
  if (daysAway < 0) return "overdue";
  if (daysAway < 1) return "today";
  if (daysAway < 3) return "soon";
  return "upcoming";
}

/** "Fri, Sep 12, 11:59 PM", or a placeholder when Canvas gave us no date. */
function formatDueDate(dueAt) {
  if (dueAt === null) return "No due date";

  return dueAt.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "in 3 days", "today", "5 days ago". */
function describeRelativeDue(dueAt, now) {
  if (dueAt === null) return "unscheduled";

  const days = Math.round((dueAt - now) / MS_PER_DAY);
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days === -1) return "1 day late";
  if (days > 0) return `in ${days} days`;
  return `${Math.abs(days)} days late`;
}

/**
 * Summary counts for the header strip.
 * @param {AssignmentView[]} assignments
 */
export function summarize(assignments) {
  const counts = { overdue: 0, today: 0, soon: 0, upcoming: 0, none: 0 };
  for (const assignment of assignments) counts[assignment.urgency] += 1;
  return { total: assignments.length, ...counts };
}
