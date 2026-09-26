import { describe, expect, it } from "vitest";
import { createPreviewApi } from "./preview-bridge";

describe("App settings failure preview", () => {
  it("keeps persisted preferences unchanged after the first failure and accepts Retry", async () => {
    const api = createPreviewApi("settings-app-failure");
    const original = await api.getAppSettings();
    const next = { ...original.preferences, motion: "reduce" as const };

    await expect(api.setAppPreferences(next)).rejects.toMatchObject({ code: "PreviewOnly" });
    await expect(api.getAppSettings()).resolves.toEqual(original);
    await expect(api.setAppPreferences(next)).resolves.toEqual({ ...original, preferences: next });
    await expect(api.getAppSettings()).resolves.toEqual({ ...original, preferences: next });
  });

  it("scopes the failure to each named fixture instance", async () => {
    const preferences = { motion: "reduce" as const, checkForUpdatesOnStartup: false };
    await expect(
      createPreviewApi("settings-comfig").setAppPreferences(preferences),
    ).resolves.toMatchObject({ preferences });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        createPreviewApi("settings-app-failure").setAppPreferences(preferences),
      ).rejects.toMatchObject({ code: "PreviewOnly" });
    }
  });
});
