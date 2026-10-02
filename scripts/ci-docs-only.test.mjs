import assert from "node:assert/strict";
import test from "node:test";
import { docsOnlyFromCheckout } from "./ci-docs-only.mjs";

const base = "a".repeat(40);
const head = "b".repeat(40);
const merge = "c".repeat(40);

function gitWithDiff(diff) {
  return (args) => (args[0] === "rev-list" ? Buffer.from(`${merge} ${base} ${head}\n`) : diff);
}

function classify(paths, overrides = {}) {
  const git = overrides.git ?? gitWithDiff(Buffer.from(paths.map((path) => `${path}\0`).join("")));
  return docsOnlyFromCheckout({
    eventName: "pull_request",
    event: { pull_request: { base: { sha: base }, head: { sha: head } } },
    checkoutSha: merge,
    git,
    ...overrides,
  });
}

test("only Markdown changes below docs/guide use the fast path", () => {
  assert.equal(classify(["docs/guide/README.md", "docs/guide/plan/review.md"]), true);
  assert.equal(classify(["docs/guide/review.png"]), false);
  assert.equal(classify(["docs/guide/profile-export.zip"]), false);
  assert.equal(classify(["docs/RELEASE.md"]), false);
  assert.equal(classify(["docs/guide/review.md", "apps/desktop/src/main.tsx"]), false);
  assert.equal(classify(["docs/guide/review.md", ".github/workflows/ci.yml"]), false);
  assert.equal(classify(["apps/desktop/src/main.tsx", "docs/guide/review.md"]), false);
});

test("a code rename or deletion cannot be hidden by a new Markdown path", () => {
  let diffArgs;
  assert.equal(
    classify(["apps/desktop/src/old.ts", "docs/guide/new.md"], {
      git: (args) => {
        if (args[0] === "rev-list") return Buffer.from(`${merge} ${base} ${head}\n`);
        diffArgs = args;
        return Buffer.from("apps/desktop/src/old.ts\0docs/guide/new.md\0");
      },
    }),
    false,
  );
  assert.ok(diffArgs.includes("--no-renames"));
});

test("empty, malformed and uncertain diffs run full CI", () => {
  assert.equal(classify([]), false);
  assert.equal(classify([], { git: gitWithDiff(Buffer.from("not NUL terminated")) }), false);
  assert.equal(classify([], { git: gitWithDiff(Buffer.from([0xff, 0])) }), false);
  assert.equal(classify(["docs/guide/review.md"], { checkoutSha: base }), false);
  assert.equal(
    classify(["docs/guide/review.md"], {
      git: () => Buffer.from(`${merge}\n`),
    }),
    false,
  );
  assert.equal(
    classify(["docs/guide/review.md"], {
      git: (args) =>
        args[0] === "rev-list"
          ? Buffer.from(`${merge} ${head} ${base}\n`)
          : Buffer.from("docs/guide/review.md\0"),
    }),
    false,
  );
  assert.equal(
    classify(["docs/guide/review.md"], {
      git: () => {
        throw new Error("git unavailable");
      },
    }),
    false,
  );
});

test("push, dispatch and reusable release calls always run full CI", () => {
  for (const eventName of ["push", "workflow_dispatch", "workflow_call"]) {
    assert.equal(
      classify(["docs/guide/review.md"], {
        eventName,
        git: () => {
          throw new Error("Git should not run for this event");
        },
      }),
      false,
    );
  }
});
