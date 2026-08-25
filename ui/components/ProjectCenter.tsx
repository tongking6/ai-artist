"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BrandMark } from "@/components/BrandMark";
import { CreateTaskButton } from "@/components/CreateTaskButton";
import {
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  RefreshIcon,
} from "@/components/Icons";
import { RuntimeModeBadge } from "@/components/RuntimeModeBadge";
import {
  type ArtifactView,
  type AttemptStatus,
  type AttemptView,
  createDownload,
  getCustomerSafeError,
  getTask,
  listAttempts,
  listTasks,
  type TaskStatus,
  type TaskSummaryView,
} from "@/lib/api";

const PAGE_SIZE = 25;

const TASK_LABELS: Record<TaskStatus, string> = {
  draft: "Draft",
  uploading: "Adding photos",
  ready: "Input ready",
};

const ATTEMPT_LABELS: Record<AttemptStatus, string> = {
  queued: "Waiting",
  generating: "Creating",
  ready: "Ready",
  failed: "Failed",
};

interface AttemptHistoryState {
  attempts: AttemptView[];
  error: string | null;
  loading: boolean;
}

export function ProjectCenter() {
  const [tasks, setTasks] = useState<TaskSummaryView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [historyByTask, setHistoryByTask] = useState<Record<string, AttemptHistoryState>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<string | null>(null);

  const loadFirstPage = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const response = await listTasks({ limit: PAGE_SIZE });
      setTasks(response.tasks);
      setNextCursor(response.next_cursor);
      setPageError(null);
    } catch (error) {
      if (!silent) setPageError(getCustomerSafeError(error));
    } finally {
      if (!silent) setIsRefreshing(false);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadFirstPage(), 0);
    return () => window.clearTimeout(timer);
  }, [loadFirstPage]);

  const activeTaskIds = useMemo(
    () => tasks
      .filter((task) => ["queued", "generating"].includes(task.current_attempt?.status ?? ""))
      .map((task) => task.task_id),
    [tasks],
  );

  useEffect(() => {
    if (activeTaskIds.length === 0) return;
    const timer = window.setInterval(() => {
      void Promise.all(activeTaskIds.map(async (taskId) => {
        const task = await getTask(taskId);
        setTasks((current) => current.map((summary) =>
          summary.task_id === taskId
            ? {
                ...summary,
                status: task.status,
                title: task.title,
                style: task.style,
                photo_count: task.upload_summary.uploaded_count,
                current_attempt: task.current_attempt,
                updated_at: task.updated_at,
              }
            : summary,
        ));
        if (expandedTaskIds.has(taskId)) await loadAttemptHistory(taskId, true);
      })).catch(() => {
        // Preserve the last known customer-safe state until the next poll or manual refresh.
      });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [activeTaskIds, expandedTaskIds]);

  async function loadMore() {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const response = await listTasks({ cursor: nextCursor, limit: PAGE_SIZE });
      setTasks((current) => {
        const known = new Set(current.map((task) => task.task_id));
        return [...current, ...response.tasks.filter((task) => !known.has(task.task_id))];
      });
      setNextCursor(response.next_cursor);
      setPageError(null);
    } catch (error) {
      setPageError(getCustomerSafeError(error));
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function loadAttemptHistory(taskId: string, silent = false) {
    if (!silent) {
      setHistoryByTask((current) => ({
        ...current,
        [taskId]: {
          attempts: current[taskId]?.attempts ?? [],
          error: null,
          loading: true,
        },
      }));
    }
    try {
      const response = await listAttempts(taskId);
      setHistoryByTask((current) => ({
        ...current,
        [taskId]: { attempts: response.attempts, error: null, loading: false },
      }));
    } catch (error) {
      if (!silent) {
        setHistoryByTask((current) => ({
          ...current,
          [taskId]: {
            attempts: current[taskId]?.attempts ?? [],
            error: getCustomerSafeError(error),
            loading: false,
          },
        }));
      }
    }
  }

  function toggleTask(taskId: string) {
    const opening = !expandedTaskIds.has(taskId);
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (opening) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
    if (opening && !historyByTask[taskId]) void loadAttemptHistory(taskId);
  }

  async function handleDownload(taskId: string, artifact: ArtifactView) {
    setDownloadingArtifactId(artifact.artifact_id);
    try {
      const response = await createDownload(taskId, artifact.artifact_id);
      const anchor = document.createElement("a");
      anchor.href = response.download_url;
      anchor.download = artifact.filename;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      setPageError(getCustomerSafeError(error));
    } finally {
      setDownloadingArtifactId(null);
    }
  }

  const activeCount = activeTaskIds.length;
  const readyCount = tasks.filter((task) => task.current_attempt?.status === "ready").length;

  return (
    <main className="task-page projects-page">
      <header className="site-header shell task-header">
        <BrandMark />
        <div className="header-actions">
          <Link className="header-link" href="/">Studio home</Link>
          <RuntimeModeBadge />
        </div>
      </header>

      <div className="shell projects-shell">
        <section className="projects-hero">
          <div>
            <p className="eyebrow"><span /> Studio activity</p>
            <h1>Every memory in motion.</h1>
            <p>
              See every postcard task in the private studio, follow generation in
              progress, and reopen the full history of any project.
            </p>
          </div>
          <CreateTaskButton />
        </section>

        <section className="projects-toolbar" aria-label="Project overview">
          <div className="project-stat"><strong>{tasks.length}</strong><span>Tasks shown</span></div>
          <div className="project-stat"><strong>{activeCount}</strong><span>In progress</span></div>
          <div className="project-stat"><strong>{readyCount}</strong><span>Ready</span></div>
          <p>{activeCount > 0 ? "Active attempts refresh automatically." : "Sorted by latest activity."}</p>
          <button
            aria-label="Refresh all projects"
            className="icon-button"
            disabled={isRefreshing}
            onClick={() => void loadFirstPage()}
            type="button"
          >
            <RefreshIcon />
          </button>
        </section>

        {pageError && <p className="projects-error" role="alert">{pageError}</p>}

        {isLoading ? (
          <div className="project-loading" aria-label="Loading all projects">
            <div className="loading-line wide" />
            <div className="loading-card" />
          </div>
        ) : tasks.length === 0 ? (
          <section className="projects-empty">
            <span className="empty-state-mark">✦</span>
            <h2>Your first memory starts here.</h2>
            <p>Create a postcard and its task and attempt history will appear here.</p>
          </section>
        ) : (
          <ol className="project-list">
            {tasks.map((task) => {
              const expanded = expandedTaskIds.has(task.task_id);
              const history = historyByTask[task.task_id];
              return (
                <li className="project-card" key={task.task_id}>
                  <div className="project-card-main">
                    <span className={`project-swatch ${task.current_attempt?.status ?? task.status}`} aria-hidden="true">
                      <i /><i /><i />
                    </span>
                    <div className="project-identity">
                      <code>{shortId(task.task_id)}</code>
                      <h2>{task.title ?? "Untitled postcard"}</h2>
                      <p>
                        {task.photo_count} {task.photo_count === 1 ? "photo" : "photos"}
                        <span>·</span>
                        {task.attempt_count} {task.attempt_count === 1 ? "attempt" : "attempts"}
                        <span>·</span>
                        Updated {formatDate(task.updated_at)}
                      </p>
                    </div>
                    <div className="project-statuses">
                      <StatusChip label={TASK_LABELS[task.status]} tone="neutral" />
                      <StatusChip
                        label={task.current_attempt
                          ? `Attempt ${task.current_attempt.attempt_number} · ${ATTEMPT_LABELS[task.current_attempt.status]}`
                          : "Not started"}
                        tone={attemptTone(task.current_attempt?.status)}
                      />
                    </div>
                    <Link className="button button-secondary project-open" href={`/tasks/${encodeURIComponent(task.task_id)}`}>
                      Open project
                    </Link>
                    <button
                      aria-expanded={expanded}
                      className={`project-expand ${expanded ? "expanded" : ""}`}
                      onClick={() => toggleTask(task.task_id)}
                      type="button"
                    >
                      {expanded ? "Hide attempts" : "View attempts"}
                      <ChevronDownIcon />
                    </button>
                  </div>

                  {expanded && (
                    <section className="project-history" aria-label={`${task.title ?? "Untitled postcard"} attempts`}>
                      {history?.loading ? (
                        <p className="history-message">Loading attempt history…</p>
                      ) : history?.error ? (
                        <div className="history-message error">
                          <p>{history.error}</p>
                          <button className="text-button" onClick={() => void loadAttemptHistory(task.task_id)} type="button">Try again</button>
                        </div>
                      ) : (history?.attempts.length ?? 0) === 0 ? (
                        <p className="history-message">No generation attempts yet.</p>
                      ) : (
                        <ol className="attempt-list project-attempt-list">
                          {history?.attempts.map((attempt) => (
                            <li key={attempt.attempt_id}>
                              <div className={`attempt-number ${attempt.status}`}>
                                {attempt.status === "ready" ? <CheckIcon /> : attempt.attempt_number}
                              </div>
                              <div className="attempt-copy">
                                <strong>Version {attempt.attempt_number}</strong>
                                <small>{attempt.refinement_note ?? "Original memory direction"}</small>
                                <time dateTime={attempt.created_at}>{formatDate(attempt.created_at)}</time>
                              </div>
                              <StatusChip label={ATTEMPT_LABELS[attempt.status]} tone={attemptTone(attempt.status)} />
                              {attempt.status === "ready" && attempt.artifact && (
                                <button
                                  aria-label={`Download ${task.title ?? "postcard"} version ${attempt.attempt_number}`}
                                  className="icon-button history-download"
                                  disabled={downloadingArtifactId === attempt.artifact.artifact_id}
                                  onClick={() => void handleDownload(task.task_id, attempt.artifact as ArtifactView)}
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
                </li>
              );
            })}
          </ol>
        )}

        {nextCursor && (
          <button className="button button-secondary load-more" disabled={isLoadingMore} onClick={() => void loadMore()} type="button">
            {isLoadingMore ? "Loading…" : "Load more projects"}
          </button>
        )}
      </div>
    </main>
  );
}

function StatusChip({ label, tone }: { label: string; tone: string }) {
  return <span className={`status-chip ${tone}`}>{label}</span>;
}

function attemptTone(status?: AttemptStatus): string {
  switch (status) {
    case "ready": return "success";
    case "queued":
    case "generating": return "progress";
    case "failed": return "warning";
    default: return "neutral";
  }
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
