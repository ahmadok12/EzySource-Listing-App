import { z } from "zod";

/**
 * Shop photos, PDFs and voice notes (specs/04 "Media collection" and "Upload protocol").
 * The web client checks these limits before choosing files; the API enforces them.
 */

export const mediaKinds = ["image", "pdf", "audio"] as const;
export type MediaKind = (typeof mediaKinds)[number];

/** Only these types are accepted, so active content such as HTML or SVG never gets in (specs/12). */
export const mediaTypes = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "application/pdf": "pdf",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/webm": "audio",
  "audio/ogg": "audio",
} as const satisfies Record<string, MediaKind>;
export type MediaType = keyof typeof mediaTypes;

/** Lower-cases a MIME type, drops parameters such as `;codecs=opus` and maps common aliases. */
export function normalizeMediaType(type: string): string {
  const base = type.split(";")[0]!.trim().toLowerCase();
  const aliases: Record<string, string> = {
    "image/jpg": "image/jpeg",
    "audio/x-m4a": "audio/mp4",
    "audio/m4a": "audio/mp4",
    "audio/aac": "audio/mp4",
    "audio/mp3": "audio/mpeg",
  };
  return aliases[base] ?? base;
}

export function mediaKindOf(type: string): MediaKind | null {
  return (mediaTypes as Record<string, MediaKind>)[normalizeMediaType(type)] ?? null;
}

const MB = 1024 * 1024;

/** Initial limits from specs/04. */
export const mediaLimits = {
  image: { maxBytes: 15 * MB },
  pdf: { maxBytes: 25 * MB },
  audio: { maxBytes: 20 * MB, maxDurationMs: 5 * 60_000 },
} as const;

/** Files one shop draft can hold, so a stuck camera loop can't fill storage. */
export const MAX_MEDIA_PER_DRAFT = 300;

/**
 * Where a file goes on the shop. Cards and chat QR codes belong to one contact.
 * `section` is product photos and PDFs.
 */
export const mediaPurposes = [
  "sign",
  "overview",
  "section",
  "voice",
  "card_front",
  "card_back",
  "wechat_qr",
  "whatsapp_qr",
] as const;
export const mediaPurposeSchema = z.enum(mediaPurposes);
export type MediaPurpose = z.infer<typeof mediaPurposeSchema>;

export const contactMediaPurposes: readonly MediaPurpose[] = ["card_front", "card_back", "wechat_qr", "whatsapp_qr"];

/** Which kinds each purpose accepts. */
export const purposeKinds: Record<MediaPurpose, readonly MediaKind[]> = {
  sign: ["image"],
  overview: ["image"],
  section: ["image", "pdf"],
  voice: ["audio"],
  card_front: ["image"],
  card_back: ["image"],
  wechat_qr: ["image"],
  whatsapp_qr: ["image"],
};

export const mediaVisibilities = ["subscriber", "staff", "internal"] as const;
export type MediaVisibility = (typeof mediaVisibilities)[number];

/**
 * Default visibility (specs/04): shop photos are subscriber content, cards and QR codes
 * need contact access, voice notes are always internal.
 */
export const purposeVisibility: Record<MediaPurpose, MediaVisibility> = {
  sign: "subscriber",
  overview: "subscriber",
  section: "subscriber",
  voice: "internal",
  card_front: "staff",
  card_back: "staff",
  wechat_qr: "staff",
  whatsapp_qr: "staff",
};

const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Send the file's SHA-256 checksum as 64 lower-case hex characters.");

/** POST /api/uploads/intents. `id` is made on the phone and reused on every retry. */
export const uploadIntentSchema = z
  .object({
    id: z.uuid(),
    revisionId: z.uuid(),
    purpose: mediaPurposeSchema,
    contactId: z.uuid().nullable().optional(),
    caption: z
      .string()
      .trim()
      .max(200)
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    mimeType: z.string().max(100).transform(normalizeMediaType),
    sizeBytes: z.int().positive(),
    sha256: sha256Schema,
    width: z.int().positive().max(20_000).nullable().optional(),
    height: z.int().positive().max(20_000).nullable().optional(),
    durationMs: z.int().positive().nullable().optional(),
  })
  .superRefine((intent, ctx) => {
    const kind = mediaKindOf(intent.mimeType);
    if (!kind) {
      ctx.addIssue({
        code: "custom",
        path: ["mimeType"],
        message: "Upload a JPEG, PNG or WebP photo, a PDF, or an MP3, M4A, WebM or Ogg recording.",
      });
      return;
    }
    if (!purposeKinds[intent.purpose].includes(kind)) {
      ctx.addIssue({ code: "custom", path: ["mimeType"], message: "That type of file can't go in this section." });
    }
    if (intent.sizeBytes > mediaLimits[kind].maxBytes) {
      ctx.addIssue({
        code: "custom",
        path: ["sizeBytes"],
        message: `This file is too big. The limit is ${mediaLimits[kind].maxBytes / MB} MB.`,
      });
    }
    if (kind === "audio" && intent.durationMs && intent.durationMs > mediaLimits.audio.maxDurationMs + 2_000) {
      ctx.addIssue({ code: "custom", path: ["durationMs"], message: "Voice notes can be up to 5 minutes long." });
    }
    const needsContact = contactMediaPurposes.includes(intent.purpose);
    if (needsContact && !intent.contactId) {
      ctx.addIssue({ code: "custom", path: ["contactId"], message: "Choose which contact this belongs to." });
    }
    if (!needsContact && intent.contactId) {
      ctx.addIssue({ code: "custom", path: ["contactId"], message: "Only cards and QR codes belong to a contact." });
    }
  });
export type UploadIntentInput = z.infer<typeof uploadIntentSchema>;

export const mediaStates = ["staged", "uploaded", "validated", "rejected", "removed"] as const;
export type MediaState = (typeof mediaStates)[number];

/** A file on a shop draft. Only `validated` files have content to show. */
export const draftMediaSchema = z.object({
  id: z.uuid(),
  purpose: mediaPurposeSchema,
  contactId: z.uuid().nullable(),
  caption: z.string().nullable(),
  visibility: z.enum(mediaVisibilities),
  orderIndex: z.int(),
  kind: z.enum(mediaKinds),
  mimeType: z.string(),
  sizeBytes: z.int(),
  width: z.int().nullable(),
  height: z.int().nullable(),
  durationMs: z.int().nullable(),
  state: z.enum(mediaStates),
  createdAt: z.iso.datetime({ offset: true }),
});
export type DraftMedia = z.infer<typeof draftMediaSchema>;

export const uploadResponseSchema = z.object({ media: draftMediaSchema });
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

/** PATCH /api/drafts/:id/media/:mediaId. Moving to position 0 of the shop photos makes it the cover. */
export const updateMediaSchema = z
  .object({
    caption: z
      .string()
      .trim()
      .max(200)
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    orderIndex: z.int().min(0).max(MAX_MEDIA_PER_DRAFT).optional(),
  })
  .refine((v) => v.caption !== undefined || v.orderIndex !== undefined, "Send a caption or a new position.");
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>;
