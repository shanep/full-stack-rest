// A very small Canvas LMS REST API client.
//
// Everything the app knows about HTTP lives in this file. The rest of the app
// only ever sees plain JavaScript objects, which keeps the route handlers easy
// to read and makes this file easy to test on its own.

/**
 * Error type for anything that goes wrong talking to Canvas.
 * `status` is the HTTP status code when we got a response, or null when the
 * request never made it out (DNS failure, no network, timeout, ...).
 */
export class CanvasError extends Error {
  constructor(message, { status = null, cause = null } = {}) {
    super(message);
    this.name = "CanvasError";
    this.status = status;
    this.cause = cause;
  }
}

export class CanvasClient {
  /**
   * @param {object} options
   * @param {string} options.token   Canvas personal access token.
   * @param {string} options.baseUrl e.g. https://boisestatecanvas.instructure.com
   */
  constructor({ token, baseUrl }) {
    if (!token) {
      throw new CanvasError(
        "CANVAS_API_TOKEN is not set. Copy .env.example to .env and add your Canvas token."
      );
    }
    this.token = token;
    // A trailing slash would produce "//api/v1/..." URLs, so drop it.
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /**
   * Perform one authenticated GET and return the parsed body plus the raw
   * response, which the pagination helper needs for the Link header.
   *
   * @param {string} url Absolute URL to request.
   */
  async #get(url) {
    let response;
    try {
      response = await fetch(url, {
        headers: {
          // Token-based authentication: Canvas identifies us from this header.
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      // fetch() only rejects for network-level problems, never for 4xx/5xx.
      throw new CanvasError(
        `Could not reach Canvas at ${this.baseUrl}. Check your network connection and CANVAS_BASE_URL.`,
        { cause: error }
      );
    }

    if (!response.ok) {
      throw new CanvasError(await describeHttpError(response), { status: response.status });
    }

    return { body: await response.json(), response };
  }

  /**
   * GET a Canvas *list* endpoint and follow the `Link` header until every page
   * has been retrieved. Canvas caps per_page at 100, so a student with 30
   * assignments costs one request and a student with 250 costs three.
   *
   * @param {string} path         API path, e.g. "/api/v1/courses".
   * @param {object} searchParams Query string parameters.
   * @returns {Promise<object[]>} Every item from every page, concatenated.
   */
  async getPaginated(path, searchParams = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(searchParams)) {
      // Canvas expects repeated keys for arrays: ?include[]=a&include[]=b
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, item);
      } else {
        url.searchParams.set(key, value);
      }
    }
    url.searchParams.set("per_page", "100");

    const items = [];
    let nextUrl = url.toString();
    let pagesFetched = 0;

    while (nextUrl) {
      const { body, response } = await this.#get(nextUrl);
      if (!Array.isArray(body)) {
        throw new CanvasError(`Expected a list from ${path} but got a single object.`);
      }
      items.push(...body);

      // Guard against a pathological Link chain so a bug can never hang the app.
      if (++pagesFetched >= 50) break;
      nextUrl = parseNextLink(response.headers.get("link"));
    }

    return items;
  }

  /** Endpoint 1: every course the token's user is actively enrolled in. */
  async listCourses() {
    const courses = await this.getPaginated("/api/v1/courses", {
      enrollment_state: "active",
      "include[]": ["term"],
    });

    // Concluded or access-restricted courses come back without a name; skip them.
    return courses
      .filter((course) => typeof course.name === "string")
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Endpoint 2: every assignment in one course. */
  async listAssignments(courseId) {
    return this.getPaginated(`/api/v1/courses/${encodeURIComponent(courseId)}/assignments`, {
      order_by: "due_at",
    });
  }
}

/**
 * Pull the rel="next" URL out of a Canvas Link header, or return null on the
 * last page. The header looks like:
 *   <https://.../courses?page=2>; rel="next", <https://.../courses?page=5>; rel="last"
 *
 * @param {string|null} header
 * @returns {string|null}
 */
export function parseNextLink(header) {
  if (!header) return null;

  for (const section of header.split(",")) {
    const match = section.match(/<([^>]+)>\s*;\s*rel="?next"?/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Turn a failed response into a message a human can act on. Canvas usually
 * returns {"errors":[{"message":"..."}]}, but error pages are sometimes HTML.
 *
 * @param {Response} response
 */
async function describeHttpError(response) {
  let detail = "";
  try {
    const body = await response.json();
    if (Array.isArray(body?.errors)) {
      detail = body.errors.map((e) => e.message ?? String(e)).join("; ");
    } else if (typeof body?.message === "string") {
      detail = body.message;
    }
  } catch {
    // The body was not JSON, so the status code alone will have to do.
  }

  const hints = {
    401: "Canvas rejected the token. It may be expired, revoked, or copied incorrectly.",
    403: "The token is valid but is not allowed to read this resource.",
    404: "Canvas has no such course or assignment. Check the ID.",
    429: "You are being rate limited by Canvas. Wait a moment and try again.",
  };

  const hint = hints[response.status] ?? `Canvas returned HTTP ${response.status}.`;
  return detail ? `${hint} (${detail})` : hint;
}
