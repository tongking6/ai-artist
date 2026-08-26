"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { BrandMark } from "@/components/BrandMark";
import {
  CheckIcon,
  DownloadIcon,
  ImageIcon,
  LockIcon,
  RefreshIcon,
  SparkIcon,
  UploadIcon,
} from "@/components/Icons";
import { PostcardPreview } from "@/components/PostcardPreview";
import { useDemoMode } from "@/components/RuntimeModeBadge";
import {
  ApiError,
  type ArtifactView,
  type AttemptStatus,
  type AttemptView,
  completeAsset,
  completeIntake,
  createAttempt,
  createDownload,
  createUploadSlots,
  getCustomerSafeError,
  getTask,
  listAttempts,
  type TaskStatus,
  type TaskView,
  type UploadManifestItem,
  type UploadSlot,
  updateTask,
} from "@/lib/api";
import {
  createOpaqueId,
  uploadToPresignedPost,
  validatePhotoSelection,
} from "@/lib/uploads";

type LocalUploadStatus =
  | "reserving"
  | "uploading"
  | "confirming"
  | "uploaded"
  | "failed"
  | "expired";

interface LocalUpload {
  localId: string;
  file: File;
  manifest: UploadManifestItem;
  idempotencyKey: string;
  status: LocalUploadStatus;
  progress: number;
  slot?: UploadSlot;
  error?: string;
}

const TASK_STATUS_CONTENT: Record<
  TaskStatus,
  { label: string; description: string; tone: string }
> = {
  draft: {
    label: "Draft",
    description: "Add your memory details and at least one photo.",
    tone: "neutral",
  },
  uploading: {
    label: "Adding photos",
    description: "Your input stays open until you finish the intake.",
    tone: "progress",
  },
  ready: {
    label: "Input ready",
    description: "Your base inputs are complete and locked.",
    tone: "success",
  },
};

const ATTEMPT_STATUS_CONTENT: Record<
  AttemptStatus,
  { label: string; description: string; tone: string }
> = {
  queued: {
    label: "Waiting to begin",
    description: "Your postcard is in the studio queue.",
    tone: "progress",
  },
  generating: {
    label: "Creating postcard",
    description: "The scene is taking shape. This page refreshes automatically.",
    tone: "progress",
  },
  ready: {
    label: "Postcard ready",
    description: "This version is available to download.",
    tone: "success",
  },
  failed: {
    label: "Attempt did not finish",
    description: "This attempt is closed. Add a refinement to create a new one.",
    tone: "warning",
  },
};

export function TaskWorkspace({ taskId }: { taskId: string }) {
  const demoMode = useDemoMode();
  const [task, setTask] = useState<TaskView | null>(null);
  const [attempts, setAttempts] = useState<AttemptView[]>([]);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [localUploads, setLocalUploads] = useState<LocalUpload[]>([]);
  const [refinementNote, setRefinementNote] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isCreatingAttempt, setIsCreatingAttempt] = useState(false);
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const hydratedTaskRef = useRef<string | null>(null);

  const refreshAttemptHistory = useCallback(async () => {
    try {
      const history = await listAttempts(taskId);
      setAttempts(history.attempts);
      setHistoryError(null);
    } catch (error) {
      setHistoryError(getCustomerSafeError(error));
    }
  }, [taskId]);

  const refreshAll = useCallback(async () => {
    void refreshAttemptHistory();
    const nextTask = await getTask(taskId);
    setTask(nextTask);
    return nextTask;
  }, [refreshAttemptHistory, taskId]);

  useEffect(() => {
    let active = true;

    const loadTimer = window.setTimeout(() => {
      refreshAll()
        .then((nextTask) => {
          if (!active) return;
          if (hydratedTaskRef.current !== nextTask.task_id) {
            setTitle(nextTask.title ?? "");
            setNote(nextTask.note ?? "");
            hydratedTaskRef.current = nextTask.task_id;
          }
        })
        .catch((error) => {
          if (active) setPageError(getCustomerSafeError(error));
        })
        .finally(() => {
          if (active) setIsLoading(false);
        });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(loadTimer);
    };
  }, [refreshAll]);

  const attemptIsActive =
    task?.current_attempt?.status === "queued" ||
    task?.current_attempt?.status === "generating";

  useEffect(() => {
    if (!attemptIsActive) return;
    const timer = window.setInterval(() => {
      refreshAll().catch(() => {
        // Keep the last customer-safe state; a manual refresh remains available.
      });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [attemptIsActive, refreshAll]);

  const visibleRemotePhotos = useMemo(() => {
    const localAssetIds = new Set(
      localUploads.map((item) => item.slot?.asset_id).filter(Boolean),
    );
    return task?.photos.filter((photo) => !localAssetIds.has(photo.asset_id)) ?? [];
  }, [localUploads, task]);

  const availablePhotoCount = useMemo(() => {
    if (!task) return 0;
    const remoteAssetIds = new Set(task.photos.map((photo) => photo.asset_id));
    const localOnlyCount = localUploads.filter(
      (item) => !item.slot || !remoteAssetIds.has(item.slot.asset_id),
    ).length;
    return Math.max(
      0,
      task.upload_summary.max_count -
        task.upload_summary.uploaded_count -
        task.upload_summary.pending_count -
        localOnlyCount,
    );
  }, [localUploads, task]);

  function updateLocalUpload(
    localId: string,
    patch: Partial<Omit<LocalUpload, "localId">>,
  ) {
    setLocalUploads((current) =>
      current.map((item) =>
        item.localId === localId ? { ...item, ...patch } : item,
      ),
    );
  }

  async function uploadOne(item: LocalUpload): Promise<void> {
    if (!item.slot) return;
    updateLocalUpload(item.localId, {
      status: "uploading",
      progress: 0,
      error: undefined,
    });
    try {
      await uploadToPresignedPost(item.slot, item.file, (progress) => {
        updateLocalUpload(item.localId, { progress });
      });
      updateLocalUpload(item.localId, { status: "confirming", progress: 100 });
      await completeAsset(taskId, item.slot.asset_id);
      updateLocalUpload(item.localId, { status: "uploaded", progress: 100 });
    } catch (error) {
      const expired = error instanceof ApiError && error.code === "upload_slot_expired";
      updateLocalUpload(item.localId, {
        status: expired ? "expired" : "failed",
        error: getCustomerSafeError(error),
      });
    }
  }

  async function reserveAndUpload(items: LocalUpload[]): Promise<unknown | null> {
    if (items.length === 0) return null;
    setActionMessage(null);
    items.forEach((item) => {
      updateLocalUpload(item.localId, {
        status: "reserving",
        progress: 0,
        error: undefined,
      });
    });

    try {
      const result = await createUploadSlots(
        taskId,
        items.map((item) => item.manifest),
        items[0].idempotencyKey,
      );
      const slotsByClientId = new Map(
        result.slots.map((slot) => [slot.client_file_id, slot]),
      );
      const slottedItems = items.map((item) => {
        const slot = slotsByClientId.get(item.manifest.client_file_id);
        if (!slot) {
          throw new Error("The upload response did not match the selected photo.");
        }
        const nextItem = { ...item, slot, status: "uploading" as const };
        updateLocalUpload(item.localId, { slot, status: "uploading" });
        return nextItem;
      });

      await Promise.allSettled(slottedItems.map(uploadOne));
      await refreshAll();
      setLocalUploads((current) =>
        current.filter((item) => item.status !== "uploaded"),
      );
      return null;
    } catch (error) {
      const message = getCustomerSafeError(error);
      items.forEach((item) => {
        updateLocalUpload(item.localId, { status: "failed", error: message });
      });
      setActionMessage(message);
      return error;
    }
  }

  function renewUploadBatch(items: LocalUpload[]): LocalUpload[] {
    const idempotencyKey = createOpaqueId("upload_batch");
    return items.map((item) => ({
      ...item,
      localId: createOpaqueId("local"),
      manifest: {
        ...item.manifest,
        client_file_id: createOpaqueId("file"),
      },
      idempotencyKey,
      status: "reserving",
      progress: 0,
      slot: undefined,
      error: undefined,
    }));
  }

  async function handlePhotoSelection(files: File[]) {
    if (!task || task.status === "ready") return;
    const { valid, error } = validatePhotoSelection(files, availablePhotoCount);
    if (error) {
      setActionMessage(error);
      return;
    }
    if (valid.length === 0) return;

    const idempotencyKey = createOpaqueId("upload_batch");
    const items: LocalUpload[] = valid.map(({ file, manifest }) => ({
      localId: createOpaqueId("local"),
      file,
      manifest,
      idempotencyKey,
      status: "reserving",
      progress: 0,
    }));
    setLocalUploads((current) => [...current, ...items]);
    await reserveAndUpload(items);
  }

  async function retryUpload(item: LocalUpload) {
    setActionMessage(null);
    const slotIsLive =
      item.slot && isFutureTimestamp(item.slot.expires_at);

    if (slotIsLive) {
      await uploadOne(item);
      await refreshAll();
      setLocalUploads((current) =>
        current.filter((candidate) => candidate.status !== "uploaded"),
      );
      return;
    }

    if (!item.slot) {
      const originalBatch = localUploads.filter(
        (candidate) => candidate.idempotencyKey === item.idempotencyKey,
      );
      const reservationError = await reserveAndUpload(originalBatch);
      if (
        reservationError instanceof ApiError &&
        reservationError.code === "upload_batch_expired"
      ) {
        const renewedBatch = renewUploadBatch(originalBatch);
        const originalLocalIds = new Set(
          originalBatch.map((candidate) => candidate.localId),
        );
        setLocalUploads((current) => [
          ...current.filter((candidate) => !originalLocalIds.has(candidate.localId)),
          ...renewedBatch,
        ]);
        await reserveAndUpload(renewedBatch);
      }
      return;
    }

    const replacementManifest: UploadManifestItem = {
      ...item.manifest,
      client_file_id: createOpaqueId("file"),
    };
    const replacement: LocalUpload = {
      ...item,
      localId: createOpaqueId("local"),
      manifest: replacementManifest,
      idempotencyKey: createOpaqueId("upload_batch"),
      status: "reserving",
      progress: 0,
      slot: undefined,
      error: undefined,
    };
    setLocalUploads((current) => [
      ...current.filter((candidate) => candidate.localId !== item.localId),
      replacement,
    ]);
    await reserveAndUpload([replacement]);
  }

  function validateDetails(): string | null {
    const trimmedTitle = title.trim();
    const trimmedNote = note.trim();
    if (trimmedTitle.length < 1 || trimmedTitle.length > 120) {
      return "Add a title between 1 and 120 characters.";
    }
    if (trimmedNote.length < 1 || trimmedNote.length > 1000) {
      return "Add a memory note between 1 and 1000 characters.";
    }
    return null;
  }

  async function saveDetails(showConfirmation = true): Promise<TaskView | null> {
    const validationError = validateDetails();
    if (validationError) {
      setActionMessage(validationError);
      return null;
    }
    setIsSaving(true);
    setActionMessage(null);
    try {
      const nextTask = await updateTask(taskId, {
        title: title.trim(),
        note: note.trim(),
        style: "warm_handmade",
      });
      setTask(nextTask);
      if (showConfirmation) setActionMessage("Memory details saved.");
      return nextTask;
    } catch (error) {
      setActionMessage(getCustomerSafeError(error));
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCompleteIntake() {
    if (!task) return;
    const busyUploads = localUploads.some((item) =>
      ["reserving", "uploading", "confirming"].includes(item.status),
    );
    if (busyUploads || task.upload_summary.pending_count > 0) {
      setActionMessage("Wait for every photo to finish uploading before continuing.");
      return;
    }
    if (task.upload_summary.uploaded_count < 1) {
      setActionMessage("Add at least one uploaded photo before continuing.");
      return;
    }

    setIsCompleting(true);
    setActionMessage(null);
    try {
      const saved = await saveDetails(false);
      if (!saved) return;
      const nextTask = await completeIntake(taskId);
      setTask(nextTask);
      setActionMessage("Your memory input is ready. You can create the postcard now.");
    } catch (error) {
      setActionMessage(getCustomerSafeError(error));
    } finally {
      setIsCompleting(false);
    }
  }

  async function reconcileAttemptCreation(previousAttemptId: string | null) {
    const nextTask = await getTask(taskId);
    setTask(nextTask);
    if (nextTask.current_attempt?.attempt_id !== previousAttemptId) {
      void refreshAttemptHistory();
      return true;
    }
    return false;
  }

  async function submitAttempt(input: { refinement_note?: string }) {
    const previousAttemptId = task?.current_attempt?.attempt_id ?? null;
    setIsCreatingAttempt(true);
    setActionMessage(null);
    try {
      const attempt = await createAttempt(taskId, input);
      setTask((current) =>
        current ? { ...current, current_attempt: attempt } : current,
      );
      setAttempts((current) => [
        attempt,
        ...current.filter((item) => item.attempt_id !== attempt.attempt_id),
      ]);
      setRefinementNote("");
    } catch (error) {
      if (error instanceof ApiError && error.code === "network_error") {
        try {
          const reconciled = await reconcileAttemptCreation(previousAttemptId);
          if (reconciled) return;
        } catch {
          // The safe network message below still applies.
        }
      }
      setActionMessage(getCustomerSafeError(error));
    } finally {
      setIsCreatingAttempt(false);
    }
  }

  async function handleRefine() {
    const trimmed = refinementNote.trim();
    if (trimmed.length < 1 || trimmed.length > 1000) {
      setActionMessage("Add a refinement note between 1 and 1000 characters.");
      return;
    }
    await submitAttempt({ refinement_note: trimmed });
  }

  async function handleDownload(artifact: ArtifactView) {
    setDownloadingArtifactId(artifact.artifact_id);
    setActionMessage(null);
    try {
      const result = await createDownload(taskId, artifact.artifact_id);
      const anchor = document.createElement("a");
      anchor.href = result.download_url;
      anchor.download = artifact.filename;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      setActionMessage(getCustomerSafeError(error));
    } finally {
      setDownloadingArtifactId(null);
    }
  }

  if (isLoading) {
    return <WorkspaceLoading />;
  }

  if (!task || pageError) {
    return (
      <main className="task-page">
        <header className="site-header shell"><BrandMark /></header>
        <section className="empty-state shell">
          <span className="empty-state-mark">!</span>
          <p className="eyebrow"><span /> Studio unavailable</p>
          <h1>We could not open this postcard project.</h1>
          <p>{pageError ?? "The project is unavailable."}</p>
          <Link className="button button-secondary" href="/">Return to the studio</Link>
        </section>
      </main>
    );
  }

  const currentAttempt = task.current_attempt;
  const currentAttemptContent = currentAttempt
    ? ATTEMPT_STATUS_CONTENT[currentAttempt.status]
    : null;
  const taskContent = TASK_STATUS_CONTENT[task.status];
  const inputsLocked = task.status === "ready";
  const isUploadBusy = localUploads.some((item) =>
    ["reserving", "uploading", "confirming"].includes(item.status),
  );
  const canFinishIntake =
    !inputsLocked &&
    !isUploadBusy &&
    task.upload_summary.pending_count === 0 &&
    task.upload_summary.uploaded_count > 0 &&
    title.trim().length >= 1 &&
    note.trim().length >= 1;

  return (
    <main className="task-page">
      <header className="site-header shell task-header">
        <BrandMark />
        <div className="header-actions">
          <Link className="header-link" href="/tasks">My projects</Link>
          <div className="task-route-meta">
            <span>{demoMode ? "Local demo project" : "Private project"}</span>
            <code>{shortId(task.task_id)}</code>
          </div>
        </div>
      </header>

      <div className="shell task-shell">
        <nav className="stepper" aria-label="Postcard creation progress">
          <Step number="1" label="Memory input" state={inputsLocked ? "done" : "active"} />
          <Step
            number="2"
            label="Create"
            state={currentAttempt ? "done" : inputsLocked ? "active" : "upcoming"}
          />
          <Step
            number="3"
            label="Postcard"
            state={currentAttempt?.status === "ready" ? "done" : currentAttempt ? "active" : "upcoming"}
          />
        </nav>

        <section className="status-rail" aria-label="Project status">
          <StatusSummary
            kicker="Input status"
            label={taskContent.label}
            description={taskContent.description}
            tone={taskContent.tone}
          />
          <div className="status-divider" />
          <StatusSummary
            kicker="Current attempt"
            label={currentAttemptContent?.label ?? "Not started"}
            description={
              currentAttemptContent?.description ??
              "Finish your memory input before creating the first postcard."
            }
            tone={currentAttemptContent?.tone ?? "neutral"}
            animated={attemptIsActive}
          />
          <button
            className="icon-button"
            type="button"
            aria-label="Refresh project status"
            onClick={() => refreshAll().catch((error) => setActionMessage(getCustomerSafeError(error)))}
          >
            <RefreshIcon />
          </button>
        </section>

        <div className="workspace-grid">
          <div className="workspace-main">
            <section className="workspace-card" aria-labelledby="memory-heading">
              <div className="card-heading">
                <div>
                  <p className="eyebrow"><span /> Step one</p>
                  <h1 id="memory-heading">Shape the memory.</h1>
                </div>
                {inputsLocked && <span className="locked-label"><LockIcon /> Inputs locked</span>}
              </div>

              <div className="form-grid">
                <label className="field full-field">
                  <span className="field-label">
                    Postcard title <small>{title.length}/120</small>
                  </span>
                  <input
                    disabled={inputsLocked}
                    maxLength={120}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Spring walk in Kyoto"
                    type="text"
                    value={title}
                  />
                  <small>A name for this project; it guides the artwork but is not printed on it.</small>
                </label>

                <label className="field full-field">
                  <span className="field-label">
                    Memory note <small>{note.length}/1000</small>
                  </span>
                  <textarea
                    disabled={inputsLocked}
                    maxLength={1000}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="A quiet spring afternoon, soft light, and the garden we found after the rain."
                    rows={5}
                    value={note}
                  />
                  <small>Describe the people, place, mood, and scene anchors that matter most.</small>
                </label>

                <fieldset className="style-fieldset full-field" disabled={inputsLocked}>
                  <legend>Visual direction</legend>
                  <label className="style-option selected">
                    <input checked readOnly type="radio" value="warm_handmade" />
                    <span className="style-swatch" aria-hidden="true">
                      <i /><i /><i />
                    </span>
                    <span>
                      <strong>Warm handmade</strong>
                      <small>Natural color, paper texture, soft brush detail, nostalgic mood.</small>
                    </span>
                    <CheckIcon className="style-check" />
                  </label>
                </fieldset>
              </div>

              {!inputsLocked && (
                <div className="inline-actions">
                  <button
                    className="button button-secondary"
                    disabled={isSaving || isCompleting}
                    onClick={() => saveDetails()}
                    type="button"
                  >
                    {isSaving ? "Saving…" : "Save details"}
                  </button>
                </div>
              )}
            </section>

            <section className="workspace-card" aria-labelledby="photos-heading">
              <div className="card-heading compact-heading">
                <div>
                  <p className="eyebrow"><span /> Source photos</p>
                  <h2 id="photos-heading">Add the views that hold the memory.</h2>
                </div>
                <span className="count-pill">
                  {task.upload_summary.uploaded_count + task.upload_summary.pending_count}
                  /{task.upload_summary.max_count}
                </span>
              </div>

              {!inputsLocked && availablePhotoCount > 0 && (
                <label className="upload-dropzone">
                  <input
                    accept="image/jpeg,image/png"
                    multiple
                    onChange={(event) => {
                      void handlePhotoSelection(Array.from(event.target.files ?? []));
                      event.target.value = "";
                    }}
                    type="file"
                  />
                  <span className="upload-icon"><UploadIcon /></span>
                  <span>
                    <strong>Choose a photo or a small batch</strong>
                    <small>JPEG or PNG · 20 MB each · {availablePhotoCount} remaining</small>
                  </span>
                </label>
              )}

              <div className="photo-list" aria-live="polite">
                {visibleRemotePhotos.map((photo) => (
                  <div className="photo-row" key={photo.asset_id}>
                    <span className="photo-thumb"><ImageIcon /></span>
                    <div className="photo-details">
                      <strong>{photo.filename}</strong>
                      <small>{formatBytes(photo.size_bytes)}</small>
                    </div>
                    <span className={`upload-state ${photo.upload_status}`}>
                      {photo.upload_status === "uploaded" ? <CheckIcon /> : null}
                      {photo.upload_status === "uploaded" ? "Uploaded" : "Upload pending"}
                    </span>
                  </div>
                ))}

                {localUploads.map((upload) => (
                  <div className="photo-row local-photo" key={upload.localId}>
                    <span className="photo-thumb"><ImageIcon /></span>
                    <div className="photo-details">
                      <strong>{upload.file.name}</strong>
                      <small>{uploadLabel(upload)}</small>
                      {upload.status === "uploading" && (
                        <progress max={100} value={upload.progress}>
                          {upload.progress}%
                        </progress>
                      )}
                      {upload.error && <small className="row-error">{upload.error}</small>}
                    </div>
                    {(upload.status === "failed" || upload.status === "expired") && (
                      <button
                        className="text-button"
                        onClick={() => void retryUpload(upload)}
                        type="button"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ))}

                {task.photos.length === 0 && localUploads.length === 0 && (
                  <p className="photo-empty">No photos added yet. Start with the image that best anchors the moment.</p>
                )}
              </div>

              {!inputsLocked && (
                <div className="complete-intake-panel">
                  <div>
                    <strong>Finished choosing photos?</strong>
                    <p>This locks your title, note, style, and uploaded photo set.</p>
                  </div>
                  <button
                    className="button button-primary"
                    disabled={!canFinishIntake || isCompleting || isSaving}
                    onClick={handleCompleteIntake}
                    type="button"
                  >
                    {isCompleting ? "Finishing…" : "Done adding photos"}
                  </button>
                </div>
              )}
            </section>

            {inputsLocked && (
              <section className="workspace-card generation-card" aria-labelledby="generation-heading">
                <div className="card-heading compact-heading">
                  <div>
                    <p className="eyebrow"><span /> Step two</p>
                    <h2 id="generation-heading">
                      {currentAttempt ? "Your postcard studio" : "Ready to create your postcard."}
                    </h2>
                  </div>
                  <SparkIcon className="heading-icon" />
                </div>

                {!currentAttempt ? (
                  <div className="generate-summary">
                    <div className="summary-facts">
                      <span><strong>{task.upload_summary.uploaded_count}</strong> source photo{task.upload_summary.uploaded_count === 1 ? "" : "s"}</span>
                      <span><strong>Warm handmade</strong> style</span>
                      <span><strong>1800 × 1200</strong> PNG</span>
                    </div>
                    <button
                      className="button button-primary button-large"
                      disabled={isCreatingAttempt}
                      onClick={() => void submitAttempt({})}
                      type="button"
                    >
                      {isCreatingAttempt ? "Starting…" : "Create postcard"}
                      <SparkIcon />
                    </button>
                  </div>
                ) : (
                  <>
                    <AttemptPanel
                      attempt={currentAttempt}
                      downloadingArtifactId={downloadingArtifactId}
                      onDownload={handleDownload}
                    />

                    {(currentAttempt.status === "ready" || currentAttempt.status === "failed") && (
                      <div className="refine-panel">
                        <div>
                          <p className="eyebrow"><span /> Create another version</p>
                          <h3>What should feel different?</h3>
                          <p>
                            Add one focused direction. The original photos, title, note,
                            and warm-handmade recipe stay the same.
                          </p>
                        </div>
                        <label className="field">
                          <span className="field-label">
                            Refinement note <small>{refinementNote.length}/1000</small>
                          </span>
                          <textarea
                            maxLength={1000}
                            onChange={(event) => setRefinementNote(event.target.value)}
                            placeholder="Use softer colors and make the garden more prominent."
                            rows={4}
                            value={refinementNote}
                          />
                        </label>
                        <button
                          className="button button-secondary"
                          disabled={isCreatingAttempt || refinementNote.trim().length === 0}
                          onClick={() => void handleRefine()}
                          type="button"
                        >
                          {isCreatingAttempt ? "Starting…" : "Create refined version"}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            {(attempts.length > 0 || historyError) && (
              <section className="workspace-card history-card" aria-labelledby="history-heading">
                <div className="card-heading compact-heading">
                  <div>
                    <p className="eyebrow"><span /> Version shelf</p>
                    <h2 id="history-heading">Attempt history</h2>
                  </div>
                  <span className="count-pill">{attempts.length}</span>
                </div>
                {historyError && (
                  <div className="history-error" role="alert">
                    <p>{historyError}</p>
                    <button
                      className="text-button"
                      onClick={() => void refreshAttemptHistory()}
                      type="button"
                    >
                      Retry history
                    </button>
                  </div>
                )}
                {attempts.length > 0 && (
                  <ol className="attempt-list">
                    {attempts.map((attempt) => (
                      <li key={attempt.attempt_id}>
                        <div className={`attempt-number ${attempt.status}`}>
                          {attempt.status === "ready" ? <CheckIcon /> : attempt.attempt_number}
                        </div>
                        <div className="attempt-copy">
                          <strong>Version {attempt.attempt_number}</strong>
                          <small>
                            {attempt.refinement_note ?? "Original memory direction"}
                          </small>
                          <time dateTime={attempt.created_at}>{formatDate(attempt.created_at)}</time>
                        </div>
                        <span className={`status-chip ${ATTEMPT_STATUS_CONTENT[attempt.status].tone}`}>
                          {ATTEMPT_STATUS_CONTENT[attempt.status].label}
                        </span>
                        {attempt.status === "ready" && attempt.artifact && (
                          <button
                            className="icon-button history-download"
                            aria-label={`Download version ${attempt.attempt_number}`}
                            disabled={downloadingArtifactId === attempt.artifact.artifact_id}
                            onClick={() => void handleDownload(attempt.artifact as ArtifactView)}
                            type="button"
                          >
                            <DownloadIcon />
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}
          </div>

          <aside className="workspace-aside">
            <div className="aside-preview">
              <PostcardPreview compact />
              <div className="output-label">
                <span>Output</span>
                <strong>Landscape postcard</strong>
                <small>PNG · 1800 × 1200 px</small>
              </div>
            </div>

            <div className="aside-card">
              <p className="eyebrow"><span /> Your fixed inputs</p>
              <dl className="input-summary">
                <div><dt>Title</dt><dd>{task.title ?? "Not saved"}</dd></div>
                <div><dt>Style</dt><dd>Warm handmade</dd></div>
                <div><dt>Photos</dt><dd>{task.upload_summary.uploaded_count} of 5</dd></div>
              </dl>
            </div>

            <div className="aside-card provider-note">
              <LockIcon />
              <div>
                <strong>Before you generate</strong>
                {demoMode ? (
                  <p>This demo simulates generation locally and does not send your photos to an AI provider.</p>
                ) : (
                  <p>
                    Selected photos and creative guidance leave the home network for
                    the configured external AI provider. Use approved photos and keep
                    your originals.
                  </p>
                )}
              </div>
            </div>
          </aside>
        </div>

        {actionMessage && (
          <div className="toast-message" role="status" aria-live="polite">
            <span>{actionMessage}</span>
            <button type="button" onClick={() => setActionMessage(null)} aria-label="Dismiss message">×</button>
          </div>
        )}
      </div>
    </main>
  );
}

function Step({
  number,
  label,
  state,
}: {
  number: string;
  label: string;
  state: "done" | "active" | "upcoming";
}) {
  return (
    <div className={`step ${state}`} aria-current={state === "active" ? "step" : undefined}>
      <span>{state === "done" ? <CheckIcon /> : number}</span>
      <strong>{label}</strong>
    </div>
  );
}

function StatusSummary({
  kicker,
  label,
  description,
  tone,
  animated = false,
}: {
  kicker: string;
  label: string;
  description: string;
  tone: string;
  animated?: boolean;
}) {
  return (
    <div className="status-summary">
      <span className={`status-dot ${tone} ${animated ? "pulse" : ""}`} />
      <div>
        <small>{kicker}</small>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}

function AttemptPanel({
  attempt,
  downloadingArtifactId,
  onDownload,
}: {
  attempt: AttemptView;
  downloadingArtifactId: string | null;
  onDownload: (artifact: ArtifactView) => Promise<void>;
}) {
  const content = ATTEMPT_STATUS_CONTENT[attempt.status];
  return (
    <div className={`attempt-panel ${attempt.status}`}>
      <div className="attempt-panel-mark">
        {attempt.status === "ready" ? <CheckIcon /> : attempt.status === "failed" ? "!" : <span />}
      </div>
      <div className="attempt-panel-copy">
        <span>Version {attempt.attempt_number}</span>
        <h3>{content.label}</h3>
        <p>{content.description}</p>
        {attempt.status === "failed" && (
          <small>The technical details stay private; your source inputs remain available for a new version.</small>
        )}
        {attempt.status === "ready" && attempt.artifact && (
          <dl className="artifact-facts">
            <div><dt>File</dt><dd>{attempt.artifact.filename}</dd></div>
            <div><dt>Size</dt><dd>{formatBytes(attempt.artifact.size_bytes)}</dd></div>
            <div><dt>Canvas</dt><dd>{attempt.artifact.width} × {attempt.artifact.height}</dd></div>
          </dl>
        )}
      </div>
      {attempt.status === "ready" && attempt.artifact && (
        <button
          className="button button-primary"
          disabled={downloadingArtifactId === attempt.artifact.artifact_id}
          onClick={() => void onDownload(attempt.artifact as ArtifactView)}
          type="button"
        >
          <DownloadIcon />
          {downloadingArtifactId === attempt.artifact.artifact_id ? "Preparing…" : "Download PNG"}
        </button>
      )}
    </div>
  );
}

function WorkspaceLoading() {
  return (
    <main className="task-page">
      <header className="site-header shell"><BrandMark /></header>
      <div className="shell loading-layout" aria-label="Loading postcard project">
        <div className="loading-line short" />
        <div className="loading-line wide" />
        <div className="loading-card" />
      </div>
    </main>
  );
}

function uploadLabel(upload: LocalUpload): string {
  switch (upload.status) {
    case "reserving":
      return "Requesting a private upload pass…";
    case "uploading":
      return `Uploading · ${upload.progress}%`;
    case "confirming":
      return "Verifying the uploaded photo…";
    case "uploaded":
      return "Uploaded";
    case "expired":
      return "Upload pass expired";
    case "failed":
      return "Upload paused";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function shortId(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}…${value.slice(-5)}`;
}

function isFutureTimestamp(value: string): boolean {
  return new Date(value).getTime() > Date.now();
}
