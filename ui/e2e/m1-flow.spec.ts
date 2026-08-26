import { expect, test, type Page } from "@playwright/test";

test("create, upload, generate, and reach a ready postcard", async ({ page }, testInfo) => {
  await installFakeBackend(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /turn your photos into a postcard/i })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("start-page.png"), fullPage: true });
  await page.getByRole("button", { name: /create a postcard/i }).click();
  await expect(page).toHaveURL(/\/tasks\/task_demo$/);

  await page.getByLabel("Postcard title").fill("Spring Walk in Kyoto");
  await page.getByLabel("Memory note").fill("A quiet spring afternoon after the rain.");
  await page.locator('input[type="file"]').setInputFiles({
    name: "kyoto.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });

  await expect(page.getByText("Uploaded", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done adding photos" }).click();
  await expect(page.getByText("Input ready")).toBeVisible();

  await page.getByRole("button", { name: /create postcard/i }).click();
  await expect(page.getByText("Postcard ready").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("spring-walk-in-kyoto.png").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /download png/i })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /download png/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("spring-walk-in-kyoto.png");

  await page.getByLabel(/Refinement note/).fill("Use softer colors and make the garden more prominent.");
  await page.getByRole("button", { name: "Create refined version" }).click();
  await expect(page.getByText("Version 2").first()).toBeVisible();
  await expect(page.getByText("Postcard ready").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Attempt history" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("ready-project.png"), fullPage: true });

  await page.getByRole("link", { name: "My projects" }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("heading", { name: "Every memory in motion." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spring Walk in Kyoto" })).toBeVisible();
  await expect(page.getByText("Attempt 2 · Ready")).toBeVisible();
  await page.getByRole("button", { name: "View attempts" }).click();
  await expect(page.getByText("Version 2")).toBeVisible();
  await expect(page.getByText("Version 1")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("my-projects.png"), fullPage: true });
});

async function installFakeBackend(page: Page) {
  await page.route("**/app-config.js", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `window.__AI_ARTIST_CONFIG__ = Object.freeze({
        stage: "test",
        apiBaseUrl: "",
        assetBaseUrl: "",
        maxPhotos: 5,
        demoMode: false
      });`,
    });
  });

  const now = "2026-08-25T14:00:00Z";
  const photo = {
    asset_id: "asset_demo",
    client_file_id: "file_demo",
    filename: "kyoto.png",
    media_type: "image/png",
    size_bytes: 68,
    upload_status: "uploaded",
    created_at: now,
  };
  const artifact = {
    artifact_id: "artifact_demo",
    artifact_type: "postcard",
    filename: "spring-walk-in-kyoto.png",
    mime_type: "image/png",
    width: 1800,
    height: 1200,
    size_bytes: 1248290,
    created_at: now,
  };
  let taskStatus: "draft" | "uploading" | "ready" = "draft";
  let title: string | null = null;
  let note: string | null = null;
  let photos: typeof photo[] = [];
  const attempts: Array<{
    attemptNumber: number;
    refinementNote: string | null;
    createdAtEpoch: number;
  }> = [];

  function attemptView(record: (typeof attempts)[number]) {
    const ready = Date.now() - record.createdAtEpoch > 250;
    return {
      attempt_id: `att_demo_${record.attemptNumber}`,
      attempt_number: record.attemptNumber,
      status: ready ? "ready" : "queued",
      refinement_note: record.refinementNote,
      failure_code: null,
      artifact: ready
        ? { ...artifact, artifact_id: `artifact_demo_${record.attemptNumber}` }
        : null,
      created_at: now,
      started_at: ready ? now : null,
      completed_at: ready ? now : null,
    };
  }

  function currentAttempt() {
    const current = attempts.at(-1);
    return current ? attemptView(current) : null;
  }

  function taskView() {
    return {
      task_id: "task_demo",
      status: taskStatus,
      title,
      note,
      style: title ? "warm_handmade" : null,
      photos,
      upload_summary: {
        uploaded_count: photos.length,
        pending_count: 0,
        max_count: 5,
      },
      current_attempt: currentAttempt(),
      created_at: now,
      updated_at: now,
    };
  }

  await page.route("**/ai-artist-private", async (route) => {
    await route.fulfill({ status: 204 });
  });

  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === "POST" && path === "/v1/tasks") {
      return route.fulfill({ status: 201, json: { task_id: "task_demo", status: "draft" } });
    }
    if (method === "GET" && path === "/v1/tasks") {
      const current = currentAttempt();
      return route.fulfill({
        json: {
          tasks: [{
            task_id: "task_demo",
            status: taskStatus,
            title,
            style: title ? "warm_handmade" : null,
            photo_count: photos.length,
            attempt_count: attempts.length,
            current_attempt: current
              ? {
                  attempt_id: current.attempt_id,
                  attempt_number: current.attempt_number,
                  status: current.status,
                  created_at: current.created_at,
                  started_at: current.started_at,
                  completed_at: current.completed_at,
                }
              : null,
            created_at: now,
            updated_at: now,
          }],
          next_cursor: null,
        },
      });
    }
    if (method === "GET" && path === "/v1/tasks/task_demo") {
      return route.fulfill({ json: taskView() });
    }
    if (method === "GET" && path === "/v1/tasks/task_demo/attempts") {
      return route.fulfill({
        json: { attempts: attempts.toReversed().map(attemptView) },
      });
    }
    if (method === "PATCH" && path === "/v1/tasks/task_demo") {
      const body = request.postDataJSON() as { title: string; note: string };
      title = body.title;
      note = body.note;
      return route.fulfill({ json: taskView() });
    }
    if (method === "POST" && path.endsWith("/upload-slots")) {
      const body = request.postDataJSON() as {
        files: Array<{ client_file_id: string }>;
      };
      taskStatus = "uploading";
      return route.fulfill({
        json: {
          slots: body.files.map((file) => ({
            slot_id: "slot_demo",
            asset_id: "asset_demo",
            client_file_id: file.client_file_id,
            upload_method: "presigned_post",
            upload_url: "http://127.0.0.1:3100/ai-artist-private",
            expires_at: "2099-08-25T14:15:00Z",
            fields: {},
            constraints: {
              accepted_media_types: ["image/jpeg", "image/png"],
              max_bytes: 20971520,
            },
          })),
        },
      });
    }
    if (method === "POST" && path.endsWith("/assets/asset_demo/complete")) {
      photos = [photo];
      return route.fulfill({ json: photo });
    }
    if (method === "POST" && path.endsWith("/complete-intake")) {
      taskStatus = "ready";
      return route.fulfill({ json: taskView() });
    }
    if (method === "POST" && path.endsWith("/attempts")) {
      const body = request.postDataJSON() as { refinement_note?: string };
      attempts.push({
        attemptNumber: attempts.length + 1,
        refinementNote: body.refinement_note ?? null,
        createdAtEpoch: Date.now(),
      });
      return route.fulfill({ status: 202, json: currentAttempt() });
    }
    if (method === "POST" && path.includes("/artifacts/") && path.endsWith("/download")) {
      return route.fulfill({
        json: {
          artifact_id: path.split("/").at(-2),
          download_url:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          expires_at: "2099-08-25T14:15:00Z",
        },
      });
    }

    return route.fulfill({
      status: 404,
      json: { code: "not_found", message: "Not found", retryable: false },
    });
  });
}
