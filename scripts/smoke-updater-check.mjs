import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "execs-update-check-"));
const probe = resolve(
  "apps/desktop/src-tauri/target/debug/examples",
  process.platform === "win32" ? "updater_check_probe.exe" : "updater_check_probe",
);
let advertised = "0.1.3+1";
let artifactRequests = 0;
const server = createServer((request, response) => {
  if (request.url !== "/latest.json") {
    artifactRequests++;
    response.writeHead(404).end();
    return;
  }
  response.setHeader("Content-Type", "application/json");
  const artifact = {
    url: `http://127.0.0.1:${server.address().port}/must-not-download`,
    signature: "check-only-no-signature-required",
  };
  response.end(
    JSON.stringify({
      version: advertised,
      notes: "0.1.3 hotfix comparison probe",
      platforms: { "windows-x86_64": artifact, "linux-x86_64": artifact },
    }),
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
try {
  for (const [installed, remote, expected] of [
    ["0.1.3", "0.1.3+1", "0.1.3+1"],
    ["0.1.3+1", "0.1.3+1", "none"],
    ["0.1.3+1", "0.1.3", "none"],
    ["0.1.3+1", "0.1.3+2", "0.1.3+2"],
    ["0.1.3+9", "0.1.3+10", "0.1.3+10"],
    ["0.1.3+10", "0.1.4", "0.1.4"],
  ]) {
    advertised = remote;
    await new Promise((done, fail) => {
      const child = spawn(
        probe,
        [`http://127.0.0.1:${server.address().port}/latest.json`, installed, expected],
        {
          stdio: "inherit",
          windowsHide: true,
          env: {
            ...process.env,
            APPDATA: join(scratch, "roaming"),
            LOCALAPPDATA: join(scratch, "local"),
            XDG_DATA_HOME: join(scratch, "data"),
            XDG_CONFIG_HOME: join(scratch, "config"),
          },
        },
      );
      const timer = setTimeout(() => {
        child.kill();
        fail(new Error("Updater check timed out"));
      }, 30000);
      child.on("error", (error) => {
        clearTimeout(timer);
        fail(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        code === 0 ? done() : fail(new Error(`Updater check exited ${code}`));
      });
    });
  }
  assert.equal(artifactRequests, 0, "Version checks must never download an installer");
} finally {
  await new Promise((done) => server.close(done));
  assert.equal(dirname(resolve(scratch)), resolve(tmpdir()));
  assert.ok(basename(scratch).startsWith("execs-update-check-"));
  rmSync(scratch, { recursive: true, force: true });
}
