import { describe, expect, it } from "vitest";
import { COPY_FEEDBACK_MS, copyButtonLabel } from "./copy-ui";

describe("copy feedback", () => {
  it("labels each feedback state", () => {
    expect(copyButtonLabel("idle")).toBe("Copy");
    expect(copyButtonLabel("idle", "Copy install path")).toBe("Copy install path");
    expect(copyButtonLabel("copied")).toBe("Copied");
    expect(copyButtonLabel("failed")).toBe("Copy failed");
  });

  it("holds the flash long enough to read", () => {
    expect(COPY_FEEDBACK_MS).toBeGreaterThanOrEqual(1_000);
  });
});
