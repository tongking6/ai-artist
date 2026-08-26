const DEMO_STORAGE_PREFIX = "ai-artist:local-demo:";
const DEMO_ARTIFACT_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

type DemoTaskStatus = "draft" | "uploading" | "ready";
type DemoAttemptStatus = "queued" | "ready";

interface DemoAsset {
  assetId: string;
  clientFileId: string;
  uploadBatchKey: string;
  filename: string;
  mediaType: "image/jpeg" | "image/png";
  sizeBytes: number;
  status: "pending" | "uploaded" | "expired";
  createdAt: string;
  expiresAt: string;
}

interface DemoAttempt {
  attemptId: string;
  attemptNumber: number;
  status: DemoAttemptStatus;
  refinementNote: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  readyAt: number;
}

interface DemoTask {
  taskId: string;
  status: DemoTaskStatus;
  title: string | null;
  note: string | null;
  style: "warm_handmade" | null;
  assets: DemoAsset[];
  attempts: DemoAttempt[];
  createdAt: string;
  updatedAt: string;
}

interface DemoUploadManifestItem {
  client_file_id: string;
  filename: string;
  media_type: "image/jpeg" | "image/png";
  size_bytes: number;
}

export class DemoApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, retryable = false) {
    super(message);
    this.name = "DemoApiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export async function demoRequest(path: string, init: RequestInit): Promise<unknown> {
  await delay(110);
  const method = init.method ?? "GET";
  const requestUrl = new URL(path, "http://local-demo.invalid");
  const segments = requestUrl.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (method === "GET" && segments.length === 2 && segments.join("/") === "v1/tasks") {
    const limit = clampListLimit(requestUrl.searchParams.get("limit"));
    const offset = parseDemoCursor(requestUrl.searchParams.get("cursor"));
    const tasks = loadAllTasks()
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || right.taskId.localeCompare(left.taskId),
      );
    const page = tasks.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return {
      tasks: page.map(taskSummaryView),
      next_cursor: nextOffset < tasks.length ? `demo_${nextOffset}` : null,
    };
  }

  if (method === "POST" && segments.length === 2 && segments.join("/") === "v1/tasks") {
    const now = new Date().toISOString();
    const task: DemoTask = {
      taskId: `task_demo_${crypto.randomUUID().slice(0, 8)}`,
      status: "draft",
      title: null,
      note: null,
      style: null,
      assets: [],
      attempts: [],
      createdAt: now,
      updatedAt: now,
    };
    saveTask(task);
    return { task_id: task.taskId, status: task.status };
  }

  if (segments[0] !== "v1" || segments[1] !== "tasks" || !segments[2]) {
    throw new DemoApiError(404, "task_not_found", "Demo project not found.");
  }

  const task = loadTask(segments[2]);
  materializeAttempts(task);
  materializeExpiredAssets(task);

  if (method === "GET" && segments.length === 3) {
    saveTask(task);
    return taskView(task);
  }

  if (method === "PATCH" && segments.length === 3) {
    if (task.status === "ready" || task.attempts.length > 0) {
      throw new DemoApiError(409, "task_immutable", "Demo inputs are locked.");
    }
    const body = parseBody<{
      title?: string;
      note?: string;
      style?: "warm_handmade";
    }>(init);
    if (body.title !== undefined) task.title = body.title.trim();
    if (body.note !== undefined) task.note = body.note.trim();
    if (body.style !== undefined) task.style = body.style;
    touch(task);
    saveTask(task);
    return taskView(task);
  }

  if (method === "POST" && segments[3] === "upload-slots") {
    if (task.status === "ready" || task.attempts.length > 0) {
      throw new DemoApiError(409, "task_immutable", "Demo inputs are locked.");
    }
    const body = parseBody<{
      files: DemoUploadManifestItem[];
      idempotency_key: string;
    }>(init);
    if (!body.files?.length) {
      throw new DemoApiError(400, "invalid_upload_manifest", "Invalid demo photo batch.");
    }

    const existingBatch = task.assets.filter(
      (asset) => asset.uploadBatchKey === body.idempotency_key,
    );
    if (existingBatch.length > 0) {
      const reservations = existingBatch.filter(
        (asset) => asset.status !== "uploaded",
      );
      if (
        reservations.length > 0 &&
        reservations.every((asset) => asset.status === "expired")
      ) {
        throw new DemoApiError(
          409,
          "upload_batch_expired",
          "Demo upload batch expired.",
        );
      }
      return { slots: existingBatch.map(uploadSlot) };
    }

    const uploadedOrPending = task.assets.filter(
      (asset) => asset.status !== "expired",
    ).length;
    if (uploadedOrPending + body.files.length > 5) {
      throw new DemoApiError(400, "invalid_upload_manifest", "Invalid demo photo batch.");
    }

    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const assets = body.files.map((file) => ({
      assetId: `asset_demo_${crypto.randomUUID().slice(0, 8)}`,
      clientFileId: file.client_file_id,
      uploadBatchKey: body.idempotency_key,
      filename: file.filename,
      mediaType: file.media_type,
      sizeBytes: file.size_bytes,
      status: "pending" as const,
      createdAt,
      expiresAt,
    }));
    task.assets.push(...assets);
    task.status = "uploading";
    touch(task);
    saveTask(task);
    return { slots: assets.map(uploadSlot) };
  }

  if (
    method === "POST" &&
    segments[3] === "assets" &&
    segments[4] &&
    segments[5] === "complete"
  ) {
    const asset = task.assets.find((candidate) => candidate.assetId === segments[4]);
    if (!asset) {
      throw new DemoApiError(404, "asset_not_found", "Demo photo not found.");
    }
    if (asset.status === "expired") {
      throw new DemoApiError(409, "upload_slot_expired", "Demo upload slot expired.");
    }
    asset.status = "uploaded";
    task.status = "uploading";
    touch(task);
    saveTask(task);
    return photoView(asset);
  }

  if (method === "POST" && segments[3] === "complete-intake") {
    const hasCompleteMetadata = Boolean(task.title && task.note && task.style);
    const uploadedCount = task.assets.filter((asset) => asset.status === "uploaded").length;
    const pendingCount = task.assets.filter((asset) => asset.status === "pending").length;
    if (!hasCompleteMetadata || uploadedCount < 1) {
      throw new DemoApiError(409, "intake_not_complete", "Demo intake is incomplete.");
    }
    if (pendingCount > 0) {
      throw new DemoApiError(409, "pending_uploads_exist", "Demo uploads are pending.", true);
    }
    task.status = "ready";
    touch(task);
    saveTask(task);
    return taskView(task);
  }

  if (segments[3] === "attempts" && method === "GET") {
    saveTask(task);
    return {
      attempts: task.attempts.toReversed().map((attempt) => attemptView(task, attempt)),
    };
  }

  if (segments[3] === "attempts" && method === "POST") {
    if (task.status !== "ready") {
      throw new DemoApiError(409, "task_not_ready", "Demo input is not ready.", true);
    }
    const activeAttempt = task.attempts.find((attempt) => attempt.status === "queued");
    if (activeAttempt) {
      throw new DemoApiError(409, "attempt_in_progress", "Demo generation is in progress.", true);
    }
    const body = parseBody<{ refinement_note?: string }>(init);
    const attemptNumber = task.attempts.length + 1;
    if (attemptNumber > 1 && !body.refinement_note?.trim()) {
      throw new DemoApiError(400, "refinement_note_required", "Demo refinement is required.");
    }
    const now = new Date().toISOString();
    const attempt: DemoAttempt = {
      attemptId: `att_demo_${crypto.randomUUID().slice(0, 8)}`,
      attemptNumber,
      status: "queued",
      refinementNote: body.refinement_note?.trim() ?? null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      readyAt: Date.now() + 1200,
    };
    task.attempts.push(attempt);
    touch(task);
    saveTask(task);
    return attemptView(task, attempt);
  }

  if (
    method === "POST" &&
    segments[3] === "artifacts" &&
    segments[4] &&
    segments[5] === "download"
  ) {
    const attempt = task.attempts.find(
      (candidate) => artifactId(candidate) === segments[4] && candidate.status === "ready",
    );
    if (!attempt) {
      throw new DemoApiError(404, "artifact_not_found", "Demo postcard not found.");
    }
    return {
      artifact_id: artifactId(attempt),
      download_url: `data:image/png;base64,${DEMO_ARTIFACT_PNG}`,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  throw new DemoApiError(404, "invalid_request", "Unsupported demo request.");
}

function loadTask(taskId: string): DemoTask {
  const stored = localStorage.getItem(`${DEMO_STORAGE_PREFIX}${taskId}`);
  if (!stored) {
    throw new DemoApiError(404, "task_not_found", "Demo project not found.");
  }
  return JSON.parse(stored) as DemoTask;
}

function saveTask(task: DemoTask) {
  localStorage.setItem(`${DEMO_STORAGE_PREFIX}${task.taskId}`, JSON.stringify(task));
}

function loadAllTasks(): DemoTask[] {
  const tasks: DemoTask[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(DEMO_STORAGE_PREFIX)) continue;
    const stored = localStorage.getItem(key);
    if (!stored) continue;
    const task = JSON.parse(stored) as DemoTask;
    materializeAttempts(task);
    materializeExpiredAssets(task);
    saveTask(task);
    tasks.push(task);
  }
  return tasks;
}

function touch(task: DemoTask) {
  task.updatedAt = new Date().toISOString();
}

function materializeAttempts(task: DemoTask) {
  let changed = false;
  for (const attempt of task.attempts) {
    if (attempt.status === "queued" && Date.now() >= attempt.readyAt) {
      const completedAt = new Date().toISOString();
      attempt.status = "ready";
      attempt.startedAt = attempt.createdAt;
      attempt.completedAt = completedAt;
      changed = true;
    }
  }
  if (changed) touch(task);
}

function materializeExpiredAssets(task: DemoTask) {
  for (const asset of task.assets) {
    if (
      asset.status === "pending" &&
      Date.now() >= Date.parse(asset.expiresAt)
    ) {
      asset.status = "expired";
    }
  }

  const hasActiveAsset = task.assets.some(
    (asset) => asset.status === "pending" || asset.status === "uploaded",
  );
  if (task.status === "uploading" && !hasActiveAsset) {
    task.status = "draft";
    touch(task);
  }
}

function taskView(task: DemoTask) {
  const uploadedCount = task.assets.filter((asset) => asset.status === "uploaded").length;
  const pendingCount = task.assets.filter((asset) => asset.status === "pending").length;
  const currentAttempt = task.attempts.at(-1);
  return {
    task_id: task.taskId,
    status: task.status,
    title: task.title,
    note: task.note,
    style: task.style,
    photos: task.assets
      .filter((asset) => asset.status !== "expired")
      .map(photoView),
    upload_summary: {
      uploaded_count: uploadedCount,
      pending_count: pendingCount,
      max_count: 5,
    },
    current_attempt: currentAttempt ? attemptView(task, currentAttempt) : null,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

function attemptSummaryView(attempt: DemoAttempt) {
  return {
    attempt_id: attempt.attemptId,
    attempt_number: attempt.attemptNumber,
    status: attempt.status,
    created_at: attempt.createdAt,
    started_at: attempt.startedAt,
    completed_at: attempt.completedAt,
  };
}

function taskSummaryView(task: DemoTask) {
  const currentAttempt = task.attempts.at(-1);
  return {
    task_id: task.taskId,
    status: task.status,
    title: task.title,
    style: task.style,
    photo_count: task.assets.filter((asset) => asset.status === "uploaded").length,
    attempt_count: task.attempts.length,
    current_attempt: currentAttempt ? attemptSummaryView(currentAttempt) : null,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

function clampListLimit(rawLimit: string | null): number {
  const parsed = rawLimit === null ? 25 : Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed < 1) return 25;
  return Math.min(parsed, 100);
}

function parseDemoCursor(cursor: string | null): number {
  if (!cursor) return 0;
  const parsed = Number(cursor.replace(/^demo_/, ""));
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new DemoApiError(400, "invalid_cursor", "Demo project cursor is invalid.");
  }
  return parsed;
}

function photoView(asset: DemoAsset) {
  return {
    asset_id: asset.assetId,
    client_file_id: asset.clientFileId,
    filename: asset.filename,
    media_type: asset.mediaType,
    size_bytes: asset.sizeBytes,
    upload_status: asset.status,
    created_at: asset.createdAt,
  };
}

function uploadSlot(asset: DemoAsset) {
  return {
    slot_id: `slot_${asset.assetId}`,
    asset_id: asset.assetId,
    client_file_id: asset.clientFileId,
    upload_method: "presigned_post",
    upload_url: `demo-upload://${asset.assetId}`,
    expires_at: asset.expiresAt,
    fields: {},
    constraints: {
      accepted_media_types: ["image/jpeg", "image/png"],
      max_bytes: 20 * 1024 * 1024,
    },
  };
}

function attemptView(task: DemoTask, attempt: DemoAttempt) {
  const artifact = attempt.status === "ready"
    ? {
        artifact_id: artifactId(attempt),
        artifact_type: "postcard",
        filename: `${slugify(task.title ?? "memory")}-v${attempt.attemptNumber}.png`,
        mime_type: "image/png",
        width: 1800,
        height: 1200,
        size_bytes: 1248290,
        created_at: attempt.completedAt,
      }
    : null;
  return {
    attempt_id: attempt.attemptId,
    attempt_number: attempt.attemptNumber,
    status: attempt.status,
    refinement_note: attempt.refinementNote,
    failure_code: null,
    artifact,
    created_at: attempt.createdAt,
    started_at: attempt.startedAt,
    completed_at: attempt.completedAt,
  };
}

function artifactId(attempt: DemoAttempt) {
  return `artifact_${attempt.attemptId}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "memory";
}

function parseBody<T>(init: RequestInit): T {
  return JSON.parse(String(init.body ?? "{}")) as T;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
