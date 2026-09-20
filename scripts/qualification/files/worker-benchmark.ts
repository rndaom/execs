import { analyzeFilesSnapshot } from "../../../apps/desktop/src/lib/files-analysis";

/** Invoked only by the isolated native qualification entry, never the product. */
export async function runWorkerBenchmark() {
  const mib = 1024 * 1024;
  const commentFile = (bytes: number) => `//${"x".repeat(bytes - 3)}\n`;
  const mixedFile = (bytes: number) => {
    const line = 'sensitivity 2; fov_desired 90; bind "v" "voicemenu 0 0"\n';
    const body = line.repeat(Math.floor((bytes - 3) / line.length));
    return body + commentFile(bytes - body.length);
  };
  const cases = [
    {
      name: "representative-10k-lines",
      files: [
        {
          path: "tf/cfg/autoexec.cfg",
          text: [
            "// Representative authoring fixture",
            "sensitivity 2",
            "fov_desired 90",
            'bind "w" "+forward"',
            'bind "v" "voicemenu 0 0"',
            'alias +qual_zoom "fov_desired 75"',
            'alias -qual_zoom "fov_desired 90"',
            'echo "quoted;semicolon"',
            'echo "literal\\path"',
            "cl_crosshair_scale 24",
            "",
          ]
            .join("\n")
            .repeat(1000),
        },
      ],
    },
    { name: "one-mib", files: [{ path: "tf/cfg/autoexec.cfg", text: commentFile(mib) }] },
    { name: "one-mib-high-token", files: [{ path: "tf/cfg/autoexec.cfg", text: mixedFile(mib) }] },
    {
      name: "eight-mib-high-token",
      files: Array.from({ length: 8 }, (_, n) => ({
        path: `tf/cfg/dense${n}.cfg`,
        text: mixedFile(mib),
      })),
    },
    {
      name: "eight-mib",
      files: Array.from({ length: 8 }, (_, n) => ({
        path: `tf/cfg/helper${n}.cfg`,
        text: commentFile(mib),
      })),
    },
    {
      name: "256-files",
      files: Array.from({ length: 256 }, (_, n) => ({
        path: `tf/cfg/helper${n}.cfg`,
        text: "// fixture\n",
      })),
    },
    {
      name: "over-one-mib",
      files: [{ path: "tf/cfg/autoexec.cfg", text: commentFile(mib + 1) }],
      refused: true,
    },
    {
      name: "over-eight-mib",
      files: [
        ...Array.from({ length: 8 }, (_, n) => ({
          path: `tf/cfg/helper${n}.cfg`,
          text: commentFile(mib),
        })),
        { path: "tf/cfg/extra.cfg", text: "x" },
      ],
      refused: true,
    },
    {
      name: "257-files",
      files: Array.from({ length: 257 }, (_, n) => ({
        path: `tf/cfg/helper${n}.cfg`,
        text: "// fixture\n",
      })),
      refused: true,
    },
  ];
  const results = [];
  const repeated = Array.from({ length: 20 }, (_, n) => ({
    ...cases[0],
    name: `representative-repeat-${n + 1}`,
  }));
  for (const fixture of [...cases, ...repeated]) {
    const encoded = new TextEncoder().encode(JSON.stringify(fixture.files));
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", encoded)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    let lastBeat = performance.now();
    let maximumHeartbeatGap = 0;
    const heartbeat = setInterval(() => {
      const now = performance.now();
      maximumHeartbeatGap = Math.max(maximumHeartbeatGap, now - lastBeat);
      lastBeat = now;
    }, 16);
    const started = performance.now();
    let error: string | null = null;
    let findingCount: number | null = null;
    let budgetRefusal = false;
    try {
      const result = await analyzeFilesSnapshot({
        profile: "qualification",
        files: fixture.files,
        identity: fixture.name,
      });
      findingCount = result.result.findings.length;
      budgetRefusal =
        !result.result.safetyComplete &&
        result.result.findings.some((finding) => finding.ruleId === "analysis-budget");
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    const durationMs = performance.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 25));
    clearInterval(heartbeat);
    results.push({
      name: fixture.name,
      fixtureSha256: hash,
      files: fixture.files.length,
      sourceBytes: fixture.files.reduce(
        (sum, file) => sum + new TextEncoder().encode(file.text).length,
        0,
      ),
      durationMs,
      maximumHeartbeatGap,
      findingCount,
      budgetRefusal,
      error,
      expectedRefusal: fixture.refused ?? false,
      expectationMet: fixture.refused
        ? error !== null
        : error === null && (!fixture.name.includes("high-token") || budgetRefusal),
    });
  }
  return {
    repeatedLint: (() => {
      const values = results
        .filter((row) => row.name.startsWith("representative-repeat-"))
        .map((row) => row.durationMs)
        .sort((a, b) => a - b);
      return { samples: values.length, p95ms: values[Math.ceil(values.length * 0.95) - 1], values };
    })(),
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    measurement:
      "Cold worker startup plus bounded snapshot validation, serialization and analysis; heartbeat includes synchronous preflight",
    results,
  };
}
