// @vitest-environment jsdom
import { act, type ComponentProps, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProfileLibraryState } from "../hooks/useProfileLibrary";
import { ProfileImportDialog } from "./ProfileImportDialog";

function fixture(stage: ProfileLibraryState["importStage"], creator = true, needsRepair = false) {
  return {
    importStage: stage,
    importReview: {
      token: "review",
      name: "Creator",
      files: 236,
      skippedFiles: 16,
      creator,
      warnings: ["config.cfg contains 'password'."],
      notes: [],
    },
    importedProfile:
      stage === "done"
        ? {
            id: "new",
            name: "Creator",
            createdAt: "",
            updatedAt: "",
            unsafeCustomFolders: needsRepair ? ["materials"] : [],
          }
        : null,
    dismissImport: () => {},
    cancelImport: async () => {},
    confirmImport: async () => {},
    switchProfile: async () => {},
    reviewFolderRepair: async () => {},
  } satisfies ComponentProps<typeof ProfileImportDialog>["profiles"];
}

function render(stage: ProfileLibraryState["importStage"], running = false, creator = true) {
  const profiles = fixture(stage, creator);
  return renderToStaticMarkup(createElement(ProfileImportDialog, { profiles, running }));
}

describe("profile import dialog", () => {
  it("shows counts, trust consequences and disclosed findings before confirmation", () => {
    const markup = render("review");
    expect(markup).toContain("236 files to import");
    expect(markup).toContain("16 left out");
    expect(markup).toContain("Trust and import");
    expect(markup).toContain("Saved server credentials are kept");
    expect(markup).toContain("<details");
    expect(markup).toContain("config.cfg contains");
  });

  it("keeps saving non-dismissible and marks reading as indeterminate", () => {
    expect(render("reading")).not.toContain("aria-valuenow");
    const saving = render("saving");
    expect(saving).toContain('aria-busy="true"');
    expect(saving).not.toContain("<button");
    expect(saving).not.toContain("Profile imported");
  });

  it("blocks trust and switching while TF2 runs but keeps cancellation available", () => {
    expect(render("review", true)).toMatch(/disabled=""[^>]*>Trust and import/);
    expect(render("review", true)).toContain(">Cancel</button>");
    expect(render("done", true)).toMatch(/disabled=""[^>]*>Switch to profile/);
  });

  it("only offers switching after saving and does not ask for creator trust on native exports", () => {
    expect(render("review", false, false)).not.toContain("Trust and import");
    expect(render("done")).toContain("Switch to profile");
    expect(render("done")).toContain('aria-valuenow="3"');
    expect(render("done")).toContain('aria-busy="false"');
    expect(render("selecting")).toBe("");
  });

  it("routes an imported unsafe profile to its repair review after TF2 closes", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const box = document.createElement("div");
    document.body.append(box);
    const root = createRoot(box);
    const profiles = {
      ...fixture("done", true, true),
      dismissImport: vi.fn(),
      switchProfile: vi.fn(async () => {}),
      reviewFolderRepair: vi.fn(async () => {}),
    };
    try {
      await act(async () =>
        root.render(createElement(ProfileImportDialog, { profiles, running: true })),
      );
      const primary = () => box.querySelector<HTMLButtonElement>(".btn-primary");
      expect(primary()?.textContent).toBe("Repair folder names");
      expect(primary()?.disabled).toBe(true);
      expect(box.textContent).toContain("needs folder repair before switching");
      await act(async () => primary()?.click());
      expect(profiles.reviewFolderRepair).not.toHaveBeenCalled();
      await act(async () =>
        root.render(createElement(ProfileImportDialog, { profiles, running: false })),
      );
      await act(async () => primary()?.click());
      expect(profiles.dismissImport).toHaveBeenCalledOnce();
      expect(profiles.reviewFolderRepair).toHaveBeenCalledWith("new");
      expect(profiles.switchProfile).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      box.remove();
      vi.unstubAllGlobals();
    }
  });
});
