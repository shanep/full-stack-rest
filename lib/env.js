// Minimal .env loader.
//
// A real project would use the `dotenv` package, but doing it by hand here keeps
// the dependency list short and makes it obvious that a .env file is nothing
// more than a plain text file of KEY=VALUE lines that we copy into process.env.
import { readFileSync } from "node:fs";

/**
 * Read a .env file and copy its values into process.env.
 * Values already present in the real environment always win, which is how
 * hosting providers (Heroku, Render, GitHub Actions, ...) inject secrets.
 *
 * @param {string} path Path to the .env file.
 */
export function loadEnv(path = ".env") {
  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    // A missing .env is not fatal: the values may come from the real
    // environment instead. Anything else (permissions, a directory, ...) is.
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    // Strip one optional layer of surrounding quotes: TOKEN="abc" -> abc
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");

    if (!(key in process.env)) process.env[key] = value;
  }
}
