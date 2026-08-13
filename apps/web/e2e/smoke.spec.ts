import { expect, test } from "@playwright/test";

test("home page renders the browse UI", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /TF2 configs/i })).toBeVisible();
  await expect(page.getByPlaceholder("Search configs…")).toBeVisible();
  await expect(page.getByAltText("Sign in through Steam")).toBeVisible();
});

test("footer carries the required Steam attribution", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Powered by Steam")).toBeVisible();
  await expect(page.getByText("not affiliated with Valve")).toBeVisible();
});

test("upload page gates on sign-in", async ({ page }) => {
  await page.goto("/upload");
  await expect(page.getByRole("heading", { name: /sign in to upload/i })).toBeVisible();
});

test("install guide and legal pages render", async ({ page }) => {
  await page.goto("/install-guide");
  await expect(page.getByRole("heading", { name: /installing configs/i })).toBeVisible();
  await page.goto("/legal");
  await expect(page.getByText(/not affiliated/i).first()).toBeVisible();
});

test("mod page 404s for anonymous visitors", async ({ page }) => {
  const response = await page.goto("/mod");
  expect(response?.status()).toBe(404);
});
