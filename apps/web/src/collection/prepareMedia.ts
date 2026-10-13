import {
  contactMediaPurposes,
  mediaKindOf,
  mediaLimits,
  normalizeMediaType,
  purposeKinds,
  type MediaPurpose,
} from "@ezysource/domain";

/**
 * Gets a chosen or captured file ready to queue: photos are resized and re-saved as
 * JPEG (which also drops hidden location data), and every file is checked against the
 * limits and fingerprinted so the server can confirm it arrived intact.
 */
export type PreparedFile = {
  blob: Blob;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

export class MediaFileError extends Error {}

const MB = 1024 * 1024;

/** Display photos stay sharp on a phone; cards and QR codes keep more detail to stay readable. */
function maxSide(purpose: MediaPurpose) {
  return contactMediaPurposes.includes(purpose) ? 3000 : 2048;
}

export async function sha256Hex(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function guessType(file: Blob & { name?: string }) {
  if (file.type) return normalizeMediaType(file.type);
  const name = file.name?.toLowerCase() ?? "";
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".m4a")) return "audio/mp4";
  if (name.endsWith(".mp3")) return "audio/mpeg";
  return "";
}

async function resizePhoto(file: Blob, purpose: MediaPurpose) {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  const scale = Math.min(1, maxSide(purpose) / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const quality = contactMediaPurposes.includes(purpose) ? 0.92 : 0.85;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  return blob ? { blob, width, height } : null;
}

/** Reads a recording's length when the phone didn't record it here. Unknown stays null. */
function probeDuration(blob: Blob): Promise<number | null> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(blob);
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 3000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      clearTimeout(timer);
      done(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : null);
    };
    audio.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    audio.src = url;
  });
}

export async function prepareFile(
  file: Blob & { name?: string },
  purpose: MediaPurpose,
  { durationMs }: { durationMs?: number | undefined } = {},
): Promise<PreparedFile> {
  const type = guessType(file);
  const kind = mediaKindOf(type);
  const allowed = purposeKinds[purpose];

  if (allowed.includes("image") && (kind === "image" || type.startsWith("image/"))) {
    const resized = await resizePhoto(file, purpose);
    if (!resized && kind !== "image") {
      throw new MediaFileError("This photo format isn't supported. Use the camera button, or a JPEG or PNG photo.");
    }
    const blob = resized?.blob ?? file;
    return finish(blob, resized ? "image/jpeg" : type, "image", {
      width: resized?.width ?? null,
      height: resized?.height ?? null,
      durationMs: null,
    });
  }

  if (!kind || !allowed.includes(kind)) {
    throw new MediaFileError(
      allowed.includes("audio")
        ? "Choose an MP3, M4A, WebM or Ogg recording."
        : allowed.includes("pdf")
          ? "Choose a photo or a PDF."
          : "Choose a photo.",
    );
  }
  const duration = kind === "audio" ? (durationMs ?? (await probeDuration(file))) : null;
  if (duration && duration > mediaLimits.audio.maxDurationMs + 2000) {
    throw new MediaFileError("Voice notes can be up to 5 minutes long.");
  }
  return finish(file, type, kind, { width: null, height: null, durationMs: duration });
}

async function finish(
  blob: Blob,
  mimeType: string,
  kind: "image" | "pdf" | "audio",
  dims: { width: number | null; height: number | null; durationMs: number | null },
): Promise<PreparedFile> {
  const limit = mediaLimits[kind].maxBytes;
  if (blob.size === 0) throw new MediaFileError("This file is empty.");
  if (blob.size > limit) throw new MediaFileError(`This file is too big. The limit is ${limit / MB} MB.`);
  return { blob, mimeType, sizeBytes: blob.size, sha256: await sha256Hex(blob), ...dims };
}

/** Shown before choosing files (specs/04 "Show limit before choosing files"). */
export function limitHint(purpose: MediaPurpose) {
  const kinds = purposeKinds[purpose];
  if (kinds.includes("audio")) return "Up to 5 minutes or 20 MB.";
  if (kinds.includes("pdf")) return "Photos up to 15 MB, PDFs up to 25 MB.";
  return "Photos up to 15 MB.";
}
