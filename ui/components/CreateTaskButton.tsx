"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ArrowUpRightIcon } from "@/components/Icons";
import { createTask, getCustomerSafeError } from "@/lib/api";

export function CreateTaskButton() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setIsCreating(true);
    setError(null);
    try {
      const task = await createTask();
      router.push(`/tasks/${encodeURIComponent(task.task_id)}`);
    } catch (requestError) {
      setError(getCustomerSafeError(requestError));
      setIsCreating(false);
    }
  }

  return (
    <div className="start-action">
      <button
        className="button button-primary button-large"
        disabled={isCreating}
        onClick={handleCreate}
        type="button"
      >
        <span>{isCreating ? "Opening your studio…" : "Create a postcard"}</span>
        <ArrowUpRightIcon />
      </button>
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
