// Canvas Assignment Tracker -- Express web app.
//
// Route map:
//   GET /                 Form: pick a course       (Canvas endpoint 1)
//   GET /assignments      Assignments for a course  (Canvas endpoints 1 + 2)
//
// Start with:  npm start
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import { loadEnv } from "./lib/env.js";
import { CanvasClient, CanvasError } from "./lib/canvas.js";
import { toAssignmentViews, summarize } from "./lib/assignments.js";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Read .env before touching process.env anywhere else.
loadEnv(path.join(projectRoot, ".env"));

const PORT = Number(process.env.PORT ?? 3000);
const CANVAS_BASE_URL = process.env.CANVAS_BASE_URL ?? "https://boisestatecanvas.instructure.com";

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(projectRoot, "views"));
app.use(express.static(path.join(projectRoot, "public")));

/**
 * Build a client per request so that a token added to .env after startup is
 * picked up on the next restart, and so a missing token surfaces as a friendly
 * page instead of a crash at boot.
 */
function canvas() {
  return new CanvasClient({
    token: process.env.CANVAS_API_TOKEN,
    baseUrl: CANVAS_BASE_URL,
  });
}

// GET / -- the form. Populating the <select> is our first Canvas endpoint.
app.get("/", async (req, res, next) => {
  try {
    const courses = await canvas().listCourses();
    res.render("index", { courses, selectedCourseId: null });
  } catch (error) {
    next(error);
  }
});

// GET /assignments?courseId=123&hide_submitted=on -- user input drives this page.
app.get("/assignments", async (req, res, next) => {
  const courseId = String(req.query.courseId ?? "").trim();
  const hideSubmitted = req.query.hide_submitted === "on";

  if (!/^\d+$/.test(courseId)) {
    // Validate before spending a network round trip on a value we know is bad.
    return res.status(400).render("error", {
      title: "Pick a course",
      message: "No valid course was selected. Choose a course from the list and try again.",
      status: 400,
    });
  }

  try {
    const client = canvas();

    // Two distinct endpoints, requested concurrently: the course list gives us
    // the course name for the heading, the assignment list gives us the rows.
    const [courses, rawAssignments] = await Promise.all([
      client.listCourses(),
      client.listAssignments(courseId),
    ]);

    const course = courses.find((c) => String(c.id) === courseId);
    let assignments = toAssignmentViews(rawAssignments);
    if (hideSubmitted) assignments = assignments.filter((a) => !a.submitted);

    res.render("assignments", {
      courses,
      selectedCourseId: courseId,
      courseName: course?.name ?? `Course ${courseId}`,
      assignments,
      summary: summarize(assignments),
      hideSubmitted,
    });
  } catch (error) {
    next(error);
  }
});

// 404 for anything else.
app.use((req, res) => {
  res.status(404).render("error", {
    title: "Page not found",
    message: `There is no page at ${req.originalUrl}.`,
    status: 404,
  });
});

// Central error handler: every route above forwards failures here, so error
// rendering lives in exactly one place.
// eslint-disable-next-line no-unused-vars -- Express needs all four parameters.
app.use((error, req, res, next) => {
  const isCanvasError = error instanceof CanvasError;
  if (!isCanvasError) console.error(error);

  const status = isCanvasError && error.status ? error.status : 500;
  res.status(status).render("error", {
    title: isCanvasError ? "Canvas request failed" : "Something went wrong",
    message: isCanvasError ? error.message : "An unexpected error occurred. Check the server log.",
    status,
  });
});

app.listen(PORT, () => {
  console.log(`Canvas Assignment Tracker running at http://localhost:${PORT}`);
  console.log(`Talking to ${CANVAS_BASE_URL}`);
  if (!process.env.CANVAS_API_TOKEN) {
    console.warn("Warning: CANVAS_API_TOKEN is not set. Copy .env.example to .env first.");
  }
});
