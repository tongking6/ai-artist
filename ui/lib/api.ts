import { getRuntimeConfig } from "@/lib/runtime-config";
import { DemoApiError, demoRequest } from "@/lib/demo-api";

export type TaskStatus = "draft" | "uploading" | "ready";
export type AttemptStatus = "queued" | "generating" | "ready" | "failed";
export type UploadStatus = "pending" | "uploaded";

export interface PhotoView {
  asset_id: string;
  client_file_id: string;
  filename: string;
  media_type: "image/jpeg" | "image/png";
  size_bytes: number;
  upload_status: UploadStatus;
  created_at: string;
}

export interface ArtifactView {
  artifact_id: string;
  artifact_type: "postcard";
  filename: string;
  mime_type: "image/png";
  width: 1800;
  height: 1200;
  size_bytes: number;
  created_at: string;
}

export interface AttemptView {
  attempt_id: string;
  attempt_number: number;
  status: AttemptStatus;
  refinement_note: string | null;
  failure_code: string | null;
  artifact: ArtifactView | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface TaskView {
  task_id: string;
  status: TaskStatus;
  title: string | null;
  note: string | null;
  style: "warm_handmade" | null;
  photos: PhotoView[];
  upload_summary: {
    uploaded_count: number;
    pending_count: number;
    max_count: 5;
  };
  current_attempt: AttemptView | null;
  created_at: string;
  updated_at: string;
}

export interface TaskSummaryView {
  task_id: string;
  status: TaskStatus;
  title: string | null;
  style: "warm_handmade" | null;
  photo_count: number;
  attempt_count: number;
  current_attempt: Pick<
    AttemptView,
    | "attempt_id"
    | "attempt_number"
    | "status"
    | "created_at"
    | "started_at"
    | "completed_at"
  > | null;
  created_at: string;
  updated_at: string;
}

export interface TaskListResponse {
  tasks: TaskSummaryView[];
  next_cursor: string | null;
}

export interface UploadManifestItem {
  client_file_id: string;
  filename: string;
  media_type: "image/jpeg" | "image/png";
  size_bytes: number;
}

export interface UploadSlot {
  slot_id: string;
  asset_id: string;
  client_file_id: string;
  upload_method: "presigned_post";
  upload_url: string;
  expires_at: string;
  fields: Record<string, string>;
  constraints: {
    accepted_media_types: Array<"image/jpeg" | "image/png">;
    max_bytes: number;
  };
}

export interface ApiErrorBody {
  code: string;
  message: string;
  retryable: boolean;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.retryable = body.retryable;
  }
}

function endpoint(path: string): string {
  return `${getRuntimeConfig().apiBaseUrl}${path}`;
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (getRuntimeConfig().demoMode) {
    try {
      return (await demoRequest(path, init)) as T;
    } catch (error) {
      if (error instanceof DemoApiError) {
        throw new ApiError(error.status, {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        });
      }
      throw error;
    }
  }

  const headers = new Headers(init.headers);
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(endpoint(path), {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, {
      code: "network_error",
      message: "The private studio could not be reached.",
      retryable: true,
    });
  }

  if (!response.ok) {
    let body: ApiErrorBody = {
      code: "request_failed",
      message: "The request could not be completed.",
      retryable: response.status >= 500,
    };
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Keep the safe fallback and never surface raw upstream content.
    }
    throw new ApiError(response.status, body);
  }

  return (await response.json()) as T;
}

export function createTask(): Promise<{ task_id: string; status: "draft" }> {
  return requestJson("/v1/tasks", { method: "POST" });
}

export function listTasks(input: {
  cursor?: string;
  limit?: number;
} = {}): Promise<TaskListResponse> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return requestJson(`/v1/tasks${suffix}`);
}

export function getTask(taskId: string): Promise<TaskView> {
  return requestJson(`/v1/tasks/${encodeURIComponent(taskId)}`);
}

export function updateTask(
  taskId: string,
  input: Partial<Pick<TaskView, "title" | "note" | "style">>,
): Promise<TaskView> {
  return requestJson(`/v1/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function createUploadSlots(
  taskId: string,
  files: UploadManifestItem[],
  idempotencyKey: string,
): Promise<{ slots: UploadSlot[] }> {
  return requestJson(`/v1/tasks/${encodeURIComponent(taskId)}/upload-slots`, {
    method: "POST",
    body: JSON.stringify({ files, idempotency_key: idempotencyKey }),
  });
}

export function completeAsset(
  taskId: string,
  assetId: string,
): Promise<PhotoView> {
  return requestJson(
    `/v1/tasks/${encodeURIComponent(taskId)}/assets/${encodeURIComponent(assetId)}/complete`,
    { method: "POST" },
  );
}

export function completeIntake(taskId: string): Promise<TaskView> {
  return requestJson(`/v1/tasks/${encodeURIComponent(taskId)}/complete-intake`, {
    method: "POST",
  });
}

export function createAttempt(
  taskId: string,
  input: { refinement_note?: string },
): Promise<AttemptView> {
  return requestJson(`/v1/tasks/${encodeURIComponent(taskId)}/attempts`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listAttempts(
  taskId: string,
): Promise<{ attempts: AttemptView[] }> {
  return requestJson(`/v1/tasks/${encodeURIComponent(taskId)}/attempts`);
}

export function createDownload(
  taskId: string,
  artifactId: string,
): Promise<{ artifact_id: string; download_url: string; expires_at: string }> {
  return requestJson(
    `/v1/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/download`,
    { method: "POST" },
  );
}

export function getCustomerSafeError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Something went wrong. Please try again.";
  }

  switch (error.code) {
    case "network_error":
      return "We could not reach the private studio. Check your Tailscale connection and try again.";
    case "task_not_found":
      return "This postcard project could not be found.";
    case "invalid_task_metadata":
      return "Check the title and memory note, then try again.";
    case "invalid_upload_manifest":
      return "Choose 1 to 5 JPEG or PNG photos, each no larger than 20 MB.";
    case "upload_batch_expired":
    case "upload_slot_expired":
      return "The private upload pass expired. Choose retry to request a fresh pass.";
    case "uploaded_asset_invalid":
      return "That photo could not be verified. Choose a JPEG or PNG and try again.";
    case "pending_uploads_exist":
      return "Wait for every photo to finish uploading before continuing.";
    case "intake_not_complete":
      return "Add a title, memory note, and at least one uploaded photo before continuing.";
    case "attempt_in_progress":
      return "A postcard is already being created for this project.";
    case "invalid_refinement_note":
    case "refinement_note_required":
      return "Add a refinement note between 1 and 1000 characters.";
    case "artifact_not_found":
      return "That postcard is not available for download.";
    default:
      return error.retryable
        ? "The request did not finish. Please try again."
        : "The request could not be completed. Review your inputs and try again.";
  }
}
