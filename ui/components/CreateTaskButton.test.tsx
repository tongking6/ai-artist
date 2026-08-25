import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateTaskButton } from "@/components/CreateTaskButton";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("CreateTaskButton", () => {
  beforeEach(() => {
    push.mockReset();
    window.__AI_ARTIST_CONFIG__ = { apiBaseUrl: "", maxPhotos: 5, demoMode: false };
    vi.restoreAllMocks();
  });

  it("creates the draft before navigating to intake", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ task_id: "task_01JDEMO", status: "draft" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<CreateTaskButton />);
    fireEvent.click(screen.getByRole("button", { name: /create a postcard/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/tasks/task_01JDEMO"));
  });
});
