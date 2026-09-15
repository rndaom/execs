// Child-process measurement: never allow a regression to freeze the parent.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lint } from "../../../packages/cfglint/src/index.ts";
import {
  ALIAS_FANOUT,
  ALIAS_FANOUT_WIDTH,
} from "../../../packages/cfglint/test/fixtures/alias-fanout.ts";

if (process.argv[2] === "child") {
  const kind = process.argv[3] === "alias" ? "alias" : "exec";
  const fanout = kind === "alias" ? ALIAS_FANOUT_WIDTH : Number(process.argv[3]);
  const files =
    kind === "alias"
      ? [{ path: "autoexec.cfg", text: ALIAS_FANOUT }]
      : Array.from({ length: 5 }, (_, level) => ({
          path: `tf/cfg/${level === 0 ? "autoexec" : `level${level}`}.cfg`,
          text: level === 4 ? "r_drawviewmodel 1\n" : `exec level${level + 1}\n`.repeat(fanout),
        }));
  const started = performance.now();
  const result = lint(files, { trust: "self" });
  console.log(
    JSON.stringify({
      kind,
      fanout,
      files: files.length,
      bytes: files.reduce((sum, file) => sum + Buffer.byteLength(file.text), 0),
      elapsedMs: performance.now() - started,
      executionComplete: result.executionComplete,
      findings: result.findings.map((finding) => finding.ruleId),
    }),
  );
} else {
  // Five fresh processes keep cold alias timings visible without a flaky unit-test SLO.
  for (const fanout of [10, 30, 100, ...Array(5).fill("alias")]) {
    process.stdout.write(
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), "child", String(fanout)], {
        timeout: 2500,
        encoding: "utf8",
      }),
    );
  }
}
