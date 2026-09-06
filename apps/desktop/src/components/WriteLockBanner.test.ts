import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WriteLockBanner } from "./WriteLockBanner";

describe("WriteLockBanner", () => {
  it("explains that editable settings become deferred drafts", () => {
    const markup = renderToStaticMarkup(
      createElement(WriteLockBanner, { running: true, degraded: null, maintenance: null }),
    );

    expect(markup).toContain("editable settings stay as drafts and save when it closes");
    expect(markup).not.toContain("read-only");
  });
});
