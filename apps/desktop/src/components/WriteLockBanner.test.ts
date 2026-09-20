import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WriteLockBanner } from "./WriteLockBanner";

describe("WriteLockBanner", () => {
  it("explains that editable settings become deferred drafts", () => {
    const markup = renderToStaticMarkup(
      createElement(WriteLockBanner, { running: true, degraded: null, maintenance: null }),
    );

    expect(markup).toContain("settings keep drafts until it closes");
    expect(markup).toContain("Files requires Save after closing TF2");
    expect(markup).not.toContain("read-only");
  });
});
