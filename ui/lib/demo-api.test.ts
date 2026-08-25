import { beforeEach, describe, expect, it } from "vitest";

import { createTask, getTask, listTasks } from "@/lib/api";

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
});
