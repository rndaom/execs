import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/;
const DOCS_PREFIX = "docs/design/";

function changedPaths(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.at(-1) !== 0) return null;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const paths = decoded.split("\0");
    if (paths.pop() !== "" || paths.some((path) => path.length === 0)) return null;
    return paths;
  } catch {
    return null;
  }
}

export function docsOnlyFromCheckout({ eventName, event, checkoutSha, git }) {
  if (eventName !== "pull_request") return false;
  const base = event?.pull_request?.base?.sha;
  const head = event?.pull_request?.head?.sha;
  if (![base, head, checkoutSha].every((sha) => typeof sha === "string" && SHA.test(sha))) {
    return false;
  }

  try {
    // A PR checkout is GitHub's merge commit. Bind the diff to both event SHAs;
    // a stale or incomplete checkout must run the full suite.
    const parents = git(["rev-list", "--parents", "-n", "1", "HEAD"])
      .toString("utf8")
      .trim()
      .split(/\s+/);
    if (
      parents.length !== 3 ||
      parents[0] !== checkoutSha ||
      parents[1] !== base ||
      parents[2] !== head
    ) {
      return false;
    }

    // No rename detection: moving a code file into docs lists both paths.
    const paths = changedPaths(
      git([
        "diff",
        "--name-only",
        "-z",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        base,
        head,
        "--",
      ]),
    );
    return (
      paths !== null &&
      paths.length > 0 &&
      paths.every((path) => path.startsWith(DOCS_PREFIX) && path.endsWith(".md"))
    );
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let docsOnly = false;
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    try {
      docsOnly = docsOnlyFromCheckout({
        eventName: process.env.GITHUB_EVENT_NAME,
        event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
        checkoutSha: process.env.GITHUB_SHA,
        git: (args) => execFileSync("git", args, { maxBuffer: 10 * 1024 * 1024 }),
      });
    } catch {
      docsOnly = false;
    }
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${docsOnly}\n`);
}
