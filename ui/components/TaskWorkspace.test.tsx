import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const draftTask: TaskView = {
  ...readyTask,
  status: "draft",
  title: null,
  note: null,
  photos: [],
  upload_summary: { uploaded_count: 0, pending_count: 0, max_count: 5 },
  current_attempt: null,
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

  it("keeps task detail available when attempt history temporarily fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/attempts")) {
        return new Response(JSON.stringify({
          code: "history_unavailable",
          message: "Internal history service detail",
          retryable: true,
        }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(readyTask), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    render(<TaskWorkspace taskId="task_01JDEMO" />);

    await waitFor(() => expect(screen.getByText("Input ready")).toBeInTheDocument());
    expect(screen.getByLabelText(/Postcard title/)).toHaveValue("Spring Walk in Kyoto");
    expect(screen.queryByText(/project is unavailable/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Attempt history" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The request did not finish. Please try again.",
    );
    expect(screen.getByRole("button", { name: "Retry history" })).toBeInTheDocument();
    expect(screen.queryByText(/Internal history service detail/)).not.toBeInTheDocument();
  });

  it("renews every upload batch identifier after upload_batch_expired", async () => {
    const reservationBodies: Array<{
      idempotency_key: string;
      files: Array<{ client_file_id: string }>;
    }> = [];
    let reservationCall = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/attempts")) {
        return new Response(JSON.stringify({ attempts: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/upload-slots")) {
        reservationCall += 1;
        reservationBodies.push(JSON.parse(String(init?.body)));
        if (reservationCall === 1) throw new TypeError("response lost");
        const code = reservationCall === 2
          ? "upload_batch_expired"
          : "reservation_stopped_for_test";
        return new Response(JSON.stringify({
          code,
          message: "Reservation stopped for test",
          retryable: false,
        }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(draftTask), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    render(<TaskWorkspace taskId="task_01JDEMO" />);
    await waitFor(() => expect(screen.getByText("Draft")).toBeInTheDocument());

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [
          new File(["one"], "one.jpg", { type: "image/jpeg" }),
          new File(["two"], "two.png", { type: "image/png" }),
        ],
      },
    });

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(2));
    fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]);
    await waitFor(() => expect(reservationBodies).toHaveLength(3));

    expect(reservationBodies[1].idempotency_key).toBe(
      reservationBodies[0].idempotency_key,
    );
    expect(reservationBodies[2].idempotency_key).not.toBe(
      reservationBodies[1].idempotency_key,
    );
    expect(reservationBodies[2].files).toHaveLength(2);
    expect(reservationBodies[2].files.map((file) => file.client_file_id)).not.toEqual(
      reservationBodies[1].files.map((file) => file.client_file_id),
    );
  });
});
