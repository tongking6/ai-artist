import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskWorkspace } from "@/components/TaskWorkspace";
import type { AttemptView, TaskView } from "@/lib/api";

const readyAttempt: AttemptView = {
  attempt_id: "att_01JDEMO",
  attempt_number: 1,
  status: "ready",
  refinement_note: null,
  failure_code: null,
  artifact: {
    artifact_id: "artifact_01JDEMO",
    artifact_type: "postcard",
    filename: "spring-walk-in-kyoto.png",
    mime_type: "image/png",
    width: 1800,
    height: 1200,
    size_bytes: 1248290,
    created_at: "2026-08-25T14:10:00Z",
  },
  created_at: "2026-08-25T14:02:00Z",
  started_at: "2026-08-25T14:02:02Z",
  completed_at: "2026-08-25T14:10:00Z",
};

const readyTask: TaskView = {
  task_id: "task_01JDEMO",
  status: "ready",
  title: "Spring Walk in Kyoto",
  note: "A quiet spring afternoon",
  style: "warm_handmade",
  photos: [
    {
      asset_id: "asset_01JDEMO",
      client_file_id: "file_01JDEMO",
      filename: "kyoto.jpg",
      media_type: "image/jpeg",
      size_bytes: 1248290,
      upload_status: "uploaded",
      created_at: "2026-08-25T14:00:00Z",
    },
  ],
  upload_summary: { uploaded_count: 1, pending_count: 0, max_count: 5 },
  current_attempt: readyAttempt,
  created_at: "2026-08-25T13:55:00Z",
  updated_at: "2026-08-25T14:10:00Z",
};

describe("TaskWorkspace", () => {
  beforeEach(() => {
    window.__AI_ARTIST_CONFIG__ = { apiBaseUrl: "", maxPhotos: 5, demoMode: false };
    vi.restoreAllMocks();
  });

  it("keeps task input and attempt generation statuses visibly separate", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const payload = url.endsWith("/attempts")
        ? { attempts: [readyAttempt] }
        : readyTask;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    render(<TaskWorkspace taskId="task_01JDEMO" />);

    await waitFor(() => expect(screen.getByText("Input ready")).toBeInTheDocument());
    expect(screen.getAllByText("Postcard ready").length).toBeGreaterThan(0);
    expect(screen.getByText("spring-walk-in-kyoto.png")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Attempt history" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Postcard title/)).toBeDisabled();
    expect(screen.getByRole("button", { name: /download png/i })).toBeInTheDocument();
  });

  it("keeps terminal failure copy customer-safe and offers a new attempt", async () => {
    const failedAttempt: AttemptView = {
      ...readyAttempt,
      status: "failed",
      failure_code: "generation_failed",
      artifact: null,
    };
    const failedTask: TaskView = {
      ...readyTask,
      current_attempt: failedAttempt,
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const payload = String(input).endsWith("/attempts")
        ? { attempts: [failedAttempt] }
        : failedTask;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    render(<TaskWorkspace taskId="task_01JDEMO" />);

    await waitFor(() =>
      expect(screen.getAllByText("Attempt did not finish").length).toBeGreaterThan(0),
    );
    expect(screen.getByText(/technical details stay private/i)).toBeInTheDocument();
    expect(screen.queryByText(/provider_failed/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create refined version" })).toBeDisabled();
  });
});
