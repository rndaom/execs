import { lint } from "@execs/cfglint";
import { describe, expect, it } from "vitest";

describe("cfglint workspace link", () => {
  it("lints a safe fov line", () => {
    const result = lint([{ path: "autoexec.cfg", text: "fov_desired 90" }]);
    expect(result.ok).toBe(true);
    expect(result.effective.get("fov_desired")?.value).toBe("90");
  });

  it("blocks unbindall", () => {
    const result = lint([{ path: "autoexec.cfg", text: "unbindall" }]);
    expect(result.ok).toBe(false);
    expect(result.findings.some((finding) => finding.ruleId === "unbindall")).toBe(true);
  });
});
