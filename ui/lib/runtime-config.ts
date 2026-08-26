export interface RuntimeConfig {
  stage: string;
  apiBaseUrl: string;
  assetBaseUrl: string;
  maxPhotos: number;
  demoMode: boolean;
}

declare global {
  interface Window {
    __AI_ARTIST_CONFIG__?: Partial<RuntimeConfig>;
  }
}

const DEFAULT_CONFIG: RuntimeConfig = {
  stage: "home",
  apiBaseUrl: "",
  assetBaseUrl: "",
  maxPhotos: 5,
  demoMode: false,
};

export function getRuntimeConfig(): RuntimeConfig {
  if (typeof window === "undefined") {
    return DEFAULT_CONFIG;
  }

  const runtime = window.__AI_ARTIST_CONFIG__ ?? {};
  return {
    stage: runtime.stage ?? DEFAULT_CONFIG.stage,
    apiBaseUrl: normalizeBaseUrl(
      runtime.apiBaseUrl ?? DEFAULT_CONFIG.apiBaseUrl,
    ),
    assetBaseUrl: normalizeBaseUrl(
      runtime.assetBaseUrl ?? DEFAULT_CONFIG.assetBaseUrl,
    ),
    maxPhotos: runtime.maxPhotos === 5 ? 5 : DEFAULT_CONFIG.maxPhotos,
    demoMode:
      typeof runtime.demoMode === "boolean"
        ? runtime.demoMode
        : isLoopbackHostname(window.location.hostname),
  };
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
