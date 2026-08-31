import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SwitchProgressList } from "./App";

describe("profile switch progress chrome", () => {
  it("shows the current real stage with a step-driven bar and no invented percent label", () => {
    const markup = renderToStaticMarkup(
      createElement(SwitchProgressList, {
        switchStep: "write",
        active: true,
        visible: true,
      }),
    );

    expect(markup).toContain("Current stage — Write files");
    // The fill bar is driven by revealed real stages (4 of 6 here)…
    expect(markup).toContain('data-testid="switch-progress-bar"');
    expect(markup).toContain('data-fraction="0.667"');
    // …and no numeric percentage is ever shown as text.
    expect(markup).not.toMatch(/>\s*\d+%/);
    expect(markup).not.toContain('role="progressbar"');
  });

  it("keeps a completed checklist visible without reporting the operation busy", () => {
    const markup = renderToStaticMarkup(
      createElement(SwitchProgressList, {
        switchStep: "done",
        active: false,
        visible: true,
      }),
    );

    expect(markup).toContain("All profile steps completed.");
    expect(markup).toContain('aria-busy="false"');
    expect(markup).toContain('data-fraction="1.000"');
    expect(markup.match(/data-done="true"/g)).toHaveLength(6);
  });
});
