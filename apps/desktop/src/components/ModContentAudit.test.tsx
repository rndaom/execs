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
    expect(fold?.previousElementSibling?.textContent).toContain("Some files could not be checked");
    expect(box.textContent).toContain("Can't tell which one TF2 uses: a, b");
    expect(box.textContent).toContain("2 more results are not shown");
    expect(box.textContent).not.toContain("TF2 uses a.");
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.unstubAllGlobals();
  }
});
