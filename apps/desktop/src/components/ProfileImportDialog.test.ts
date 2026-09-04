import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProfileLibraryState } from "../hooks/useProfileLibrary";
import { ProfileImportDialog } from "./ProfileImportDialog";

function render(stage: ProfileLibraryState["importStage"], running = false, creator = true) {
  const profiles = {
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
      stage === "done" ? { id: "new", name: "Creator", createdAt: "", updatedAt: "" } : null,
    dismissImport: () => {},
    cancelImport: async () => {},
    confirmImport: async () => {},
    switchProfile: async () => {},
  } satisfies ComponentProps<typeof ProfileImportDialog>["profiles"];
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
});
