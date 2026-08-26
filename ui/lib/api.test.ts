import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAttempt, createTask, getTask, listTasks } from "@/lib/api";

describe("customer API client", () => {
  beforeEach(() => {
    window.__AI_ARTIST_CONFIG__ = {
      stage: "test",
      apiBaseUrl: "https://studio.test",
      maxPhotos: 5,
      demoMode: false,
    };
    vi.restoreAllMocks();
  });

  it("creates a draft without an application auth header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ task_id: "task_demo", status: "draft" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(createTask()).resolves.toEqual({
      task_id: "task_demo",
      status: "draft",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://studio.test/v1/tasks");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    expect(init?.cache).toBe("no-store");
  });

  it("uses the common attempts endpoint with an empty initial body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ attempt_id: "att_demo", status: "queued" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await createAttempt("task_demo", {});

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://studio.test/v1/tasks/task_demo/attempts");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("{}");
  });

  it("lists the system task collection with cursor pagination", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ tasks: [], next_cursor: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await listTasks({ cursor: "cursor_demo", limit: 25 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://studio.test/v1/tasks?cursor=cursor_demo&limit=25");
    expect(init?.method).toBeUndefined();
    expect(init?.cache).toBe("no-store");
  });

  it("turns a transport failure into a safe retryable error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("secret host detail"));

    await expect(getTask("task_demo")).rejects.toMatchObject({
      code: "network_error",
      retryable: true,
      status: 0,
    });
  });
});
