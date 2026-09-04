# Canvas Assignment Tracker

A small Node.js web app that logs into the Canvas LMS REST API with your personal
access token, lets you pick one of your courses from a dropdown, and shows every
assignment in that course as a color-coded table sorted by how soon it is due.
It answers the question "what is actually due next?" in one page, instead of
clicking through Canvas course by course.

> **This is the instructor's reference implementation for the Canvas REST API
> mini-lab.** Read it, run it, take ideas from it — but build your own tool.

---

## Setup Instructions

These steps assume you have never used `npm` before. `npm` is the package manager
that ships with Node.js; it reads `package.json` and downloads the libraries the
project depends on into a local `node_modules/` folder.

### 1. Install Node.js

You need **Node.js 18 or newer** (this app uses the built-in `fetch`, which older
versions do not have). Check what you have:

```bash
node --version
```

If that prints `v18.x` or higher, you are set. If the command is not found,
install Node from [nodejs.org](https://nodejs.org/) (the "LTS" download) or with a
package manager:

```bash
brew install node        # macOS
sudo apt install nodejs  # Debian / Ubuntu
```

### 2. Clone the repository

```bash
git clone https://github.com/<your-username>/full-stack-rest.git
cd full-stack-rest
```

### 3. Install the dependencies

```bash
npm install
```

This creates `node_modules/`. You only need to run it once (and again whenever
`package.json` changes). `node_modules/` is git-ignored — never commit it.

### 4. Create your `.env` file

Copy the template and open it in your editor:

```bash
cp .env.example .env
```

Then paste in the token you generated in Canvas
(**Account → Settings → Approved Integrations → + New Access Token**):

```
CANVAS_API_TOKEN=13~yourReallyLongTokenGoesHere
CANVAS_BASE_URL=https://boisestatecanvas.instructure.com
PORT=3000
```

> **Your token is a password.** It grants full access to your Canvas account.
> `.env` is listed in [`.gitignore`](.gitignore) so git will not track it. If you
> ever push a token by accident, delete it in Canvas *immediately* and generate a
> new one — rewriting git history is not enough, because the old value is already
> in someone's clone.

### 5. Run it

```bash
npm start
```

Then open <http://localhost:3000>. Stop the server with `Ctrl+C`.

During development, `npm run dev` restarts the server automatically whenever you
save a file.

### 6. Run the tests (optional)

```bash
npm test
```

Five tests cover the pagination parser and the due-date logic. They use Node's
built-in test runner and never touch the network.

---

## Usage

1. Open <http://localhost:3000>. The dropdown is populated from your real Canvas
   enrollments.
2. Pick a course and click **Show assignments**.
3. Optionally check **Hide assignments I already submitted** to see only what is
   still outstanding.

Each row is color-coded by urgency:

| Badge | Meaning |
| --- | --- |
| **overdue** (red) | Due date has passed |
| **due today** (orange) | Due in the next 24 hours |
| **in N days** (amber) | Due within 3 days |
| **in N days** (green) | Due later than that |
| **unscheduled** (grey) | Canvas has no due date for it |

---

## API Endpoints Used

| Method | Endpoint | What we use it for |
| --- | --- | --- |
| `GET` | `/api/v1/courses?enrollment_state=active&include[]=term` | Fills the course dropdown on the home page, and supplies the course name for the assignments heading. |
| `GET` | `/api/v1/courses/:id/assignments?order_by=due_at` | The assignment rows: name, `due_at`, `points_possible`, `html_url`, and submission state. |

Both are called with an `Authorization: Bearer <token>` header. See
[`lib/canvas.js`](lib/canvas.js).

### Pagination

Both endpoints are paginated by Canvas, so `getPaginated()` in
[`lib/canvas.js`](lib/canvas.js) requests `per_page=100` and then follows the
`Link` response header until there is no `rel="next"` left:

```
Link: <https://.../courses?page=2&per_page=100>; rel="next",
      <https://.../courses?page=5&per_page=100>; rel="last"
```

`parseNextLink()` pulls the `rel="next"` URL out of that header; the loop stops
when it returns `null`. A hard cap of 50 pages guards against a malformed `Link`
chain looping forever.

### Error handling

Every failure ends up on the same error page with a message a human can act on:

| Situation | What you see |
| --- | --- |
| `CANVAS_API_TOKEN` missing | "CANVAS_API_TOKEN is not set. Copy .env.example to .env..." |
| Token expired or wrong (`401`) | "Canvas rejected the token. It may be expired, revoked, or copied incorrectly." |
| Not allowed to read a course (`403`) | "The token is valid but is not allowed to read this resource." |
| Course does not exist (`404`) | "Canvas has no such course or assignment. Check the ID." |
| Rate limited (`429`) | "You are being rate limited by Canvas. Wait a moment and try again." |
| Canvas unreachable / offline | "Could not reach Canvas at ... Check your network connection and CANVAS_BASE_URL." |

Note that `fetch()` **only** rejects for network-level problems — a `401` or
`500` is a perfectly successful promise. Checking `response.ok` is not optional.

---

## Project Structure

```
.
├── server.js              Express routes and the central error handler
├── lib/
│   ├── canvas.js          Canvas HTTP client: auth, pagination, error messages
│   ├── assignments.js     Raw Canvas JSON -> the shape the templates render
│   └── env.js             Tiny .env parser (what `dotenv` does, in 30 lines)
├── views/                 EJS templates: index, assignments, error, partials
├── public/styles.css      All styling
├── test/canvas.test.js    Unit tests for the pure functions
├── .env.example           Template -- committed
└── .env                   Your real token -- git-ignored, never committed
```

The split is deliberate: `lib/canvas.js` is the only file that knows about HTTP,
`lib/assignments.js` is the only file that knows about dates and urgency, and
`server.js` just wires them to URLs. Each piece can be understood — and tested —
without the other two.

---

## Reflection

The part that surprised me most was pagination. My first version called
`/api/v1/courses`, got back a tidy array, and looked finished — but Canvas had
quietly returned only the first ten items and put the rest behind a `Link`
header. Nothing in the JSON body hints that anything is missing, which is exactly
what makes this bug dangerous: the app is confidently wrong rather than visibly
broken. Setting `per_page=100` hides the problem for most students and hides it
badly, so I wrote `parseNextLink()` and a `while` loop instead, and tested it
against a fake Canvas that always returns two pages. The tests would have passed
either way with real data; they only catch the bug because the mock forces a
second page.

The second thing I got wrong was assuming `fetch()` throws on an HTTP error. It
does not. A `401` from an expired token resolves normally, and my early version
sailed past it and crashed later on `courses.filter is not a function` — an error
message that says nothing at all about the actual problem. Checking
`response.ok` immediately, and translating the status code into a sentence that
tells the user what to *do* ("the token may be expired, revoked, or copied
incorrectly") rather than what happened ("HTTP 401"), turned the worst failure
mode into the clearest one. Real Canvas data is messier than the docs suggest,
too: some courses come back with `name: null` because the enrollment is
restricted or concluded, and plenty of assignments have `due_at: null`, so the
sort has to decide where undated work goes rather than crash on `null - Date`.

With more time I would cache the course list — it changes once a semester but is
re-fetched on every page load — and add a cross-course view that fans out to
`/assignments` for every enrollment at once, which is the tool I actually want
each Sunday night. I would also move the token out of `.env` and into a proper
Canvas OAuth2 flow, so the app could be deployed for other students instead of
requiring each person to paste a personal token. That is a substantially bigger
project, though, and it would have crowded out the part of this lab that was
genuinely worth learning: reading an unfamiliar API's docs carefully enough to
notice what it does *not* put in the response body.
