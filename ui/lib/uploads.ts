import type { UploadManifestItem, UploadSlot } from "@/lib/api";

export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png"] as const;

export interface ValidatedPhoto {
  file: File;
  manifest: UploadManifestItem;
}

export function createOpaqueId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) {
    throw new Error("This browser cannot create a secure upload identifier.");
  }
  return `${prefix}_${uuid}`;
}

export function validatePhotoSelection(
  selected: File[],
  availableCount: number,
): { valid: ValidatedPhoto[]; error: string | null } {
  if (selected.length === 0) {
    return { valid: [], error: null };
  }
  if (selected.length > availableCount) {
    return {
      valid: [],
      error: `You can add ${availableCount} more photo${availableCount === 1 ? "" : "s"}.`,
    };
  }

  const valid: ValidatedPhoto[] = [];
  for (const file of selected) {
    if (!ACCEPTED_PHOTO_TYPES.includes(file.type as (typeof ACCEPTED_PHOTO_TYPES)[number])) {
      return {
        valid: [],
        error: `${file.name} is not a JPEG or PNG photo.`,
      };
    }
    if (file.size < 1 || file.size > MAX_PHOTO_BYTES) {
      return {
        valid: [],
        error: `${file.name} must be no larger than 20 MB.`,
      };
    }

    valid.push({
      file,
      manifest: {
        client_file_id: createOpaqueId("file"),
        filename: file.name,
        media_type: file.type as "image/jpeg" | "image/png",
        size_bytes: file.size,
      },
    });
  }

  return { valid, error: null };
}

export class UploadTransportError extends Error {
  readonly retryable: boolean;

  constructor(retryable: boolean) {
    super("The photo upload did not finish.");
    this.name = "UploadTransportError";
    this.retryable = retryable;
  }
}

export function uploadToPresignedPost(
  slot: UploadSlot,
  file: File,
  onProgress: (percentage: number) => void,
): Promise<void> {
  if (slot.upload_url.startsWith("demo-upload://")) {
    return simulateDemoUpload(onProgress);
  }

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const form = new FormData();
    for (const [name, value] of Object.entries(slot.fields)) {
      form.append(name, value);
    }
    form.append("file", file);

    request.open("POST", slot.upload_url);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      if ([200, 201, 204].includes(request.status)) {
        onProgress(100);
        resolve();
      } else {
        reject(new UploadTransportError(request.status >= 500));
      }
    });
    request.addEventListener("error", () => {
      reject(new UploadTransportError(true));
    });
    request.addEventListener("abort", () => {
      reject(new UploadTransportError(true));
    });
    request.send(form);
  });
}

async function simulateDemoUpload(onProgress: (percentage: number) => void) {
  for (const progress of [18, 46, 73, 100]) {
    await new Promise((resolve) => window.setTimeout(resolve, 85));
    onProgress(progress);
  }
}
