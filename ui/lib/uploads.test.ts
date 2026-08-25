import { describe, expect, it, vi } from "vitest";

import { MAX_PHOTO_BYTES, validatePhotoSelection } from "@/lib/uploads";

describe("photo selection validation", () => {
  it("builds a manifest with one stable client id per selected file", () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002");
    const files = [
      new File(["kyoto"], "kyoto.jpg", { type: "image/jpeg" }),
      new File(["osaka"], "osaka.png", { type: "image/png" }),
    ];

    const result = validatePhotoSelection(files, 2);

    expect(result.error).toBeNull();
    expect(result.valid.map((item) => item.manifest)).toEqual([
      {
        client_file_id: "file_00000000-0000-4000-8000-000000000001",
        filename: "kyoto.jpg",
        media_type: "image/jpeg",
        size_bytes: 5,
      },
      {
        client_file_id: "file_00000000-0000-4000-8000-000000000002",
        filename: "osaka.png",
        media_type: "image/png",
        size_bytes: 5,
      },
    ]);
  });

  it("rejects unsupported media, oversized files, and capacity overflow", () => {
    const unsupported = new File(["x"], "notes.txt", { type: "text/plain" });
    expect(validatePhotoSelection([unsupported], 1).error).toContain("not a JPEG or PNG");

    const oversized = new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], "large.png", {
      type: "image/png",
    });
    expect(validatePhotoSelection([oversized], 1).error).toContain("20 MB");

    const photo = new File(["x"], "one.png", { type: "image/png" });
    expect(validatePhotoSelection([photo, photo], 1).error).toContain("1 more photo");
  });
});
