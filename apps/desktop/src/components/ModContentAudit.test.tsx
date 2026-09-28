// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PREVIEW_MODS_STATUS } from "../lib/mods-ui";
import { ModContentAudit } from "./ModContentAudit";

it("keeps an incomplete scan visible outside the fold and never invents winners", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  try {
    await act(async () =>
      root.render(
        <ModContentAudit
          profileId="audit-test"
          mods={[]}
          payload={{
            ...PREVIEW_MODS_STATUS,
            contentAudit: {
              packs: [],
              overlaps: [{ path: "models/a.mdl", winner: null, packs: ["a", "b"] }],
              splitModels: [],
              incomplete: ["Unreadable VPK"],
              omittedDetails: 2,
            },
          }}
        />,
      ),
    );
    const fold = box.querySelector("details");
    expect(fold?.open).toBe(false);
    expect(fold?.previousElementSibling?.textContent).toContain("Content check incomplete");
    expect(box.textContent).toContain("Winner unknown. Candidates: a, b");
    expect(box.textContent).toContain("2 additional overlap or model details omitted");
    expect(box.textContent).not.toContain("Expected first:");
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.unstubAllGlobals();
  }
});
