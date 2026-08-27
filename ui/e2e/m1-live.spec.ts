import { expect, test } from "@playwright/test";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("runs the real M1 workflow against the Linux server", async ({ page }, testInfo) => {
  const uniqueSuffix = Date.now().toString(36);
  const title = `Server Memory ${uniqueSuffix}`;

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /turn your photos into a postcard/i })).toBeVisible();
  await page.getByRole("button", { name: /create a postcard/i }).click();
  await expect(page).toHaveURL(/\/tasks\/task_[0-9A-Z]+$/i);

  await page.getByLabel("Postcard title").fill(title);
  await page.getByLabel("Memory note").fill("A real end-to-end check through the Linux server.");
  const ownedFixturePath = process.env.AI_ARTIST_E2E_IMAGE;
  await page.locator('input[type="file"]').setInputFiles(
    ownedFixturePath ?? {
      name: "server-check.png",
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    },
  );

  await expect(page.getByText("Uploaded", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done adding photos" }).click();
  await expect(page.getByText("Input ready")).toBeVisible();

  await page.getByRole("button", { name: /create postcard/i }).click();
  await expect(page.getByText("Postcard ready").first()).toBeVisible();
  await expect(page.getByText(`${title.toLowerCase().replaceAll(" ", "-")}.png`).first()).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /download png/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${title.toLowerCase().replaceAll(" ", "-")}.png`);

  await page.getByLabel(/Refinement note/).fill("Use softer colors in the refined version.");
  await page.getByRole("button", { name: "Create refined version" }).click();
  await expect(page.getByText("Version 2").first()).toBeVisible();
  await expect(page.getByText("Postcard ready").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("server-ready.png"), fullPage: true });

  await page.getByRole("link", { name: "My projects" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Attempt 2 · Ready")).toBeVisible();
});
