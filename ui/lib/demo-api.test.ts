import { beforeEach, describe, expect, it } from "vitest";

import {
  completeAsset,
  completeIntake,
  createTask,
  createUploadSlots,
  getTask,
  listTasks,
  updateTask,
} from "@/lib/api";

describe("localhost demo API", () => {
  beforeEach(() => {
    localStorage.clear();
    window.__AI_ARTIST_CONFIG__ = {
      stage: "local",
      apiBaseUrl: "",
      maxPhotos: 5,
      demoMode: true,
    };
  });

  it("creates a durable local draft that opens on the task route", async () => {
    const created = await createTask();

    expect(created.task_id).toMatch(/^task_demo_/);
    await expect(getTask(created.task_id)).resolves.toMatchObject({
      task_id: created.task_id,
      status: "draft",
      photos: [],
      current_attempt: null,
    });
  });

  it("lists every local demo task through the system collection contract", async () => {
    const first = await createTask();
    const second = await createTask();

    const firstPage = await listTasks({ limit: 1 });
    const secondPage = await listTasks({ cursor: "demo_1", limit: 1 });

    expect(firstPage).toMatchObject({
      tasks: [{ attempt_count: 0, photo_count: 0 }],
      next_cursor: "demo_1",
    });
    expect(secondPage.next_cursor).toBeNull();
    expect(new Set([...firstPage.tasks, ...secondPage.tasks].map((task) => task.task_id)))
      .toEqual(new Set([first.task_id, second.task_id]));
  });

  it("releases expired upload reservations while preserving the old batch tombstone", async () => {
    const created = await createTask();
    const originalFiles = Array.from({ length: 5 }, (_, index) => ({
      client_file_id: `file_original_${index}`,
      filename: `original-${index}.jpg`,
      media_type: "image/jpeg" as const,
      size_bytes: 1024 + index,
    }));
    const originalReservation = await createUploadSlots(
      created.task_id,
      originalFiles,
      "batch_original",
    );
    const uploadingTask = await getTask(created.task_id);
    expect(uploadingTask.status).toBe("uploading");
    expirePendingAssets(created.task_id);

    const expiredTask = await getTask(created.task_id);
    const taskList = await listTasks();
    expect(expiredTask).toMatchObject({
      status: "draft",
      photos: [],
      upload_summary: { uploaded_count: 0, pending_count: 0, max_count: 5 },
    });
    expect(expiredTask.updated_at).not.toBe(uploadingTask.updated_at);
    expect(
      taskList.tasks.find((task) => task.task_id === created.task_id),
    ).toMatchObject({ status: "draft", photo_count: 0 });
    expect(readStoredAssets(created.task_id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "expired" })]),
    );
    await expect(
      completeAsset(created.task_id, originalReservation.slots[0].asset_id),
    ).rejects.toMatchObject({ code: "upload_slot_expired", status: 409 });
    const replacementFiles = originalFiles.map((file, index) => ({
      ...file,
      client_file_id: `file_replacement_${index}`,
      filename: `replacement-${index}.jpg`,
    }));
    await expect(
      createUploadSlots(created.task_id, replacementFiles, "batch_replacement"),
    ).resolves.toMatchObject({ slots: expect.arrayContaining([
      expect.objectContaining({ client_file_id: "file_replacement_0" }),
    ]) });
    await expect(
      createUploadSlots(created.task_id, originalFiles, "batch_original"),
    ).rejects.toMatchObject({ code: "upload_batch_expired", status: 409 });
  });

  it("does not let an expired pending slot block complete-intake", async () => {
    const created = await createTask();
    await updateTask(created.task_id, {
      title: "Rain garden",
      note: "A quiet walk after the rain.",
      style: "warm_handmade",
    });
    const reservation = await createUploadSlots(created.task_id, [
      {
        client_file_id: "file_uploaded",
        filename: "uploaded.jpg",
        media_type: "image/jpeg",
        size_bytes: 1024,
      },
      {
        client_file_id: "file_abandoned",
        filename: "abandoned.png",
        media_type: "image/png",
        size_bytes: 2048,
      },
    ], "batch_partial");
    await completeAsset(created.task_id, reservation.slots[0].asset_id);
    expirePendingAssets(created.task_id);

    await expect(getTask(created.task_id)).resolves.toMatchObject({
      status: "uploading",
      photos: [expect.objectContaining({ client_file_id: "file_uploaded" })],
      upload_summary: { uploaded_count: 1, pending_count: 0, max_count: 5 },
    });
    await expect(completeIntake(created.task_id)).resolves.toMatchObject({
      status: "ready",
      upload_summary: { uploaded_count: 1, pending_count: 0, max_count: 5 },
    });
  });
});

function expirePendingAssets(taskId: string) {
  const stored = readStoredTask(taskId);
  for (const asset of stored.assets) {
    if (asset.status === "pending") {
      asset.expiresAt = new Date(Date.now() - 1).toISOString();
    }
  }
  localStorage.setItem(`ai-artist:local-demo:${taskId}`, JSON.stringify(stored));
}

function readStoredAssets(taskId: string) {
  return readStoredTask(taskId).assets;
}

function readStoredTask(taskId: string) {
  return JSON.parse(String(localStorage.getItem(`ai-artist:local-demo:${taskId}`))) as {
    assets: Array<{ expiresAt: string; status: string }>;
  };
}
