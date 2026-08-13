import { expect, test } from "@playwright/test";
import { readOpfsFile, stubTf2Picker } from "./helpers";

// These tests need at least one published config with a detail page. They use
// whatever the local dev database holds; when empty they skip (CI seeds later).
async function firstConfigHref(page: import("@playwright/test").Page): Promise<string | null> {
  await page.goto("/");
  const card = page.locator('a[href^="/configs/"]').first();
  if ((await card.count()) === 0) return null;
  return card.getAttribute("href");
}

test("direct install writes files and manifest through real FS handles", async ({ page }) => {
  await stubTf2Picker(page);
  const href = await firstConfigHref(page);
  test.skip(!href, "no configs in local db");

  await page.goto(href as string);
  const installButton = page.getByRole("button", { name: /install to tf2/i });
  await expect(installButton).toBeVisible();
  await installButton.click();

  await expect(page.getByRole("button", { name: /installed — restart tf2/i })).toBeVisible({
    timeout: 15_000,
  });

  const manifestText = await readOpfsFile(page, "tf/custom/execs-custom/execs-manifest.json");
  expect(manifestText).not.toBeNull();
  const manifest = JSON.parse(manifestText as string);
  expect(manifest.schema).toBe(1);
  expect(manifest.installed).toHaveLength(1);
  const entry = manifest.installed[0];
  expect(entry.files.length).toBeGreaterThan(0);

  for (const filePath of entry.files) {
    const content = await readOpfsFile(page, filePath);
    expect(content, filePath).not.toBeNull();
    expect((content as string).length).toBeGreaterThan(0);
  }
});

test("installed page lists and cleanly uninstalls", async ({ page }) => {
  await stubTf2Picker(page);
  const href = await firstConfigHref(page);
  test.skip(!href, "no configs in local db");

  // Install first.
  await page.goto(href as string);
  await page.getByRole("button", { name: /install to tf2/i }).click();
  await expect(page.getByRole("button", { name: /installed — restart tf2/i })).toBeVisible({
    timeout: 15_000,
  });

  // The stored handle persists in IndexedDB within this context.
  await page.goto("/installed");
  await page.getByRole("button", { name: /connect tf2 folder/i }).click();
  await expect(page.getByRole("button", { name: /uninstall/i })).toBeVisible();

  const manifestBefore = JSON.parse(
    (await readOpfsFile(page, "tf/custom/execs-custom/execs-manifest.json")) as string,
  );
  const installedFiles: string[] = manifestBefore.installed[0].files;

  await page.getByRole("button", { name: /uninstall/i }).click();
  await expect(page.getByText(/removed “/i)).toBeVisible();

  for (const filePath of installedFiles) {
    expect(await readOpfsFile(page, filePath), filePath).toBeNull();
  }
  const manifestAfter = JSON.parse(
    (await readOpfsFile(page, "tf/custom/execs-custom/execs-manifest.json")) as string,
  );
  expect(manifestAfter.installed).toHaveLength(0);

  // gameinfo.txt (user file) untouched.
  expect(await readOpfsFile(page, "tf/gameinfo.txt")).toBe('"GameInfo" {}');
});
