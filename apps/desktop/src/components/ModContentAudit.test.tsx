// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PREVIEW_MODS_STATUS } from "../lib/mods-ui";
import { ModContentAudit } from "./ModContentAudit";

it("shows the file check on the page, keeps an incomplete scan visible and never invents winners", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  try {
    await act(async () =>
      root.render(
        <ModContentAudit
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
    expect(box.querySelector("details")).toBeNull();
    expect(box.querySelector("h2")?.textContent).toBe("File check");
    expect(box.textContent).toContain("1 shared file · 0 mixed models");
    expect(box.textContent).toContain("Some files could not be checked");
    expect(box.textContent).toContain("Can't tell which one TF2 uses: a, b");
    expect(box.textContent).toContain("2 more results are not shown");
    expect(box.textContent).not.toContain("TF2 uses a.");
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.unstubAllGlobals();
  }
});
