import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectCenter } from "@/components/ProjectCenter";
import type { AttemptView, TaskSummaryView } from "@/lib/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const readyAttempt: AttemptView = {
  attempt_id: "att_01JDEMO",
  attempt_number: 2,
  status: "ready",
  refinement_note: "Use softer colors.",
  failure_code: null,
  artifact: {
    artifact_id: "artifact_01JDEMO",
    artifact_type: "postcard",
    filename: "kyoto-v2.png",
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

const task: TaskSummaryView = {
  task_id: "task_01JDEMO",
  status: "ready",
  title: "Spring Walk in Kyoto",
  style: "warm_handmade",
  photo_count: 3,
  attempt_count: 2,
  current_attempt: readyAttempt,
  created_at: "2026-08-25T13:55:00Z",
  updated_at: "2026-08-25T14:10:00Z",
};

describe("ProjectCenter", () => {
  beforeEach(() => {
    window.__AI_ARTIST_CONFIG__ = { apiBaseUrl: "", maxPhotos: 5, demoMode: false };
    vi.restoreAllMocks();
  });

  it("shows every task summary and loads attempts only when expanded", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const payload = url.includes("/attempts")
        ? { attempts: [readyAttempt] }
        : { tasks: [task], next_cursor: null };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    render(<ProjectCenter />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Spring Walk in Kyoto" })).toBeInTheDocument());
    expect(screen.getByText("Attempt 2 · Ready")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "View attempts" }));

    await waitFor(() => expect(screen.getByText("Version 2")).toBeInTheDocument());
    expect(screen.getByText("Use softer colors.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download Spring Walk in Kyoto version 2" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
