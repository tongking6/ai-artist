"use client";

import { useSyncExternalStore } from "react";

import { LockIcon } from "@/components/Icons";
import { getRuntimeConfig } from "@/lib/runtime-config";

const subscribe = () => () => {};

export function RuntimeModeBadge() {
  const demoMode = useDemoMode();

  return (
    <div className="privacy-pill">
      <LockIcon />
      <span>{demoMode ? "Local demo studio" : "Private tailnet studio"}</span>
    </div>
  );
}

export function RuntimePrivacyCopy() {
  const demoMode = useDemoMode();

  if (demoMode) {
    return (
      <p>
        This localhost demo keeps its sample project state in this browser and
        does not call an image provider. Use it to explore intake, upload,
        generation status, refinement, and delivery before the backend is connected.
      </p>
    );
  }

  return (
    <p>
      AI Artist is available only to approved Tailscale devices. When you
      generate, your selected photos and creative guidance are sent to the
      configured external AI provider. Start with approved or fixture photos,
      and keep your originals outside this studio.
    </p>
  );
}

export function useDemoMode() {
  return useSyncExternalStore(
    subscribe,
    () => getRuntimeConfig().demoMode,
    () => false,
  );
}
