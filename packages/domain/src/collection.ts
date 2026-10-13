import { z } from "zod";

/**
 * Shop collection contracts (specs/04 "Initial review fields", specs/08 API table).
 * The API validates every request with these schemas; the web client reuses them.
 */

/** Trims, caps length and turns an empty string into null ("cleared"). */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();

export const channelTypes = ["phone", "email", "wechat", "whatsapp", "website", "social"] as const;
export const channelTypeSchema = z.enum(channelTypes);
export type ChannelType = z.infer<typeof channelTypeSchema>;

/** Light format checks only. A phone number is never treated as proof of WhatsApp. */
export const channelInputSchema = z
  .object({
    type: channelTypeSchema,
    value: z.string().trim().min(1, "Enter a value.").max(300),
    label: text(60).optional(),
  })
  .superRefine((channel, ctx) => {
    if (channel.type === "email" && !/^[^\s@]+@[^\s@]+$/.test(channel.value)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a valid email address." });
    }
    if (
      (channel.type === "phone" || channel.type === "whatsapp") &&
      !/^\+?[\d\s()-]{5,40}$/.test(channel.value)
    ) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a valid phone number." });
    }
  });
export type ChannelInput = z.infer<typeof channelInputSchema>;

export const contactInputSchema = z.object({
  displayName: text(120).optional(),
  title: text(120).optional(),
  isPrimary: z.boolean().optional(),
  channels: z.array(channelInputSchema).max(20).default([]),
});
export type ContactInput = z.infer<typeof contactInputSchema>;

export const keywordInputSchema = z.object({
  keyword: z.string().trim().min(1).max(80),
  language: z.string().trim().min(2).max(16).default("und"),
});

/** Fields a draft save may set. Lists replace the whole set when present. */
const draftFields = {
  nameZh: text(200).optional(),
  nameEn: text(200).optional(),
  companyName: text(200).optional(),
  description: text(4000).optional(),
  districtId: z.uuid().nullable().optional(),
  floorId: z.uuid().nullable().optional(),
  boothNumber: text(40).optional(),
  /** First entry is the main category. */
  categoryIds: z.array(z.uuid()).max(10).optional(),
  keywords: z.array(keywordInputSchema).max(50).optional(),
  /** Channels that belong to the shop rather than a person. */
  sharedChannels: z.array(channelInputSchema).max(20).optional(),
};

export const createDraftSchema = z
  .object({
    ...draftFields,
    /** The collector's own open session. Defaults to their current one. */
    sessionId: z.uuid().optional(),
    contacts: z.array(contactInputSchema).max(10).optional(),
  })
  .refine(
    (d) =>
      Boolean(d.nameZh || d.nameEn || d.companyName || d.boothNumber) ||
      (d.sharedChannels?.length ?? 0) > 0 ||
      (d.contacts ?? []).some((c) => c.displayName || c.channels.length > 0),
    { message: "Add a name, booth number or contact before saving." },
  )
  .refine((d) => (d.contacts ?? []).filter((c) => c.isPrimary).length <= 1, {
    message: "Only one contact can be the main contact.",
    path: ["contacts"],
  });
export type CreateDraftInput = z.infer<typeof createDraftSchema>;

export const updateDraftSchema = z.object({
  expectedVersion: z.int().positive(),
  ...draftFields,
});
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;

export const addContactSchema = contactInputSchema.extend({
  expectedVersion: z.int().positive(),
});
export type AddContactInput = z.infer<typeof addContactSchema>;

export const updateContactSchema = z.object({
  expectedVersion: z.int().positive(),
  displayName: text(120).optional(),
  title: text(120).optional(),
  /** Only `true` is accepted: pick another main contact instead of unsetting one. */
  isPrimary: z.literal(true).optional(),
  channels: z.array(channelInputSchema).max(20).optional(),
});
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export const revisionStates = ["draft", "submitted", "returned", "approved", "archived"] as const;
export const revisionStateSchema = z.enum(revisionStates);
export type RevisionState = z.infer<typeof revisionStateSchema>;

export const channelSchema = z.object({
  id: z.uuid(),
  type: channelTypeSchema,
  value: z.string(),
  label: z.string().nullable(),
});
export type Channel = z.infer<typeof channelSchema>;

export const draftSchema = z.object({
  id: z.uuid(),
  shopId: z.uuid(),
  version: z.int(),
  state: revisionStateSchema,
  nameZh: z.string().nullable(),
  nameEn: z.string().nullable(),
  companyName: z.string().nullable(),
  description: z.string().nullable(),
  districtId: z.uuid().nullable(),
  floorId: z.uuid().nullable(),
  boothNumber: z.string().nullable(),
  categories: z.array(z.object({ id: z.uuid(), isPrimary: z.boolean() })),
  keywords: z.array(z.object({ keyword: z.string(), language: z.string() })),
  contacts: z.array(
    z.object({
      id: z.uuid(),
      displayName: z.string().nullable(),
      title: z.string().nullable(),
      isPrimary: z.boolean(),
      channels: z.array(channelSchema),
    }),
  ),
  sharedChannels: z.array(channelSchema),
  sessionId: z.uuid().nullable(),
  collectorId: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Draft = z.infer<typeof draftSchema>;

export const draftSummarySchema = draftSchema.pick({
  id: true,
  shopId: true,
  version: true,
  state: true,
  nameZh: true,
  nameEn: true,
  districtId: true,
  floorId: true,
  boothNumber: true,
  updatedAt: true,
});
export type DraftSummary = z.infer<typeof draftSummarySchema>;

export const draftListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Opaque cursor from the previous page. */
  cursor: z.string().max(200).optional(),
});

export const draftListResponseSchema = z.object({
  drafts: z.array(draftSummarySchema),
  nextCursor: z.string().nullable(),
});
export type DraftListResponse = z.infer<typeof draftListResponseSchema>;

// Sessions and collector policy ------------------------------------------------

export const collectorModes = [
  "own_until_revoked",
  "temporary",
  "review_then_submit",
  "immediate_handoff",
] as const;
export const collectorModeSchema = z.enum(collectorModes);
export type CollectorMode = z.infer<typeof collectorModeSchema>;

export const sessionDefaultsSchema = z.object({
  districtId: z.uuid().nullable().optional(),
  floorId: z.uuid().nullable().optional(),
  defaultCategoryId: z.uuid().nullable().optional(),
});
export type SessionDefaults = z.infer<typeof sessionDefaultsSchema>;

export const collectionSessionSchema = z.object({
  id: z.uuid(),
  districtId: z.uuid().nullable(),
  floorId: z.uuid().nullable(),
  defaultCategoryId: z.uuid().nullable(),
  startedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type CollectionSession = z.infer<typeof collectionSessionSchema>;

/** GET /api/collection/context — what the collector screens need on open. */
export const collectionContextSchema = z.object({
  policy: z.object({
    mode: collectorModeSchema,
    allowOfflineCapture: z.boolean(),
    /** Absolute deadline for this collector's drafts, if any. */
    grantDeadline: z.iso.datetime({ offset: true }).nullable(),
  }),
  session: collectionSessionSchema.nullable(),
});
export type CollectionContext = z.infer<typeof collectionContextSchema>;

// Reference data ----------------------------------------------------------------

export const collectionReferenceSchema = z.object({
  markets: z.array(
    z.object({
      id: z.uuid(),
      nameEn: z.string(),
      nameZh: z.string().nullable(),
      districts: z.array(
        z.object({
          id: z.uuid(),
          code: z.string(),
          nameEn: z.string(),
          nameZh: z.string().nullable(),
          floors: z.array(z.object({ id: z.uuid(), label: z.string() })),
        }),
      ),
    }),
  ),
  categories: z.array(
    z.object({
      id: z.uuid(),
      parentId: z.uuid().nullable(),
      slug: z.string(),
      nameEn: z.string(),
      nameZh: z.string().nullable(),
    }),
  ),
});
export type CollectionReference = z.infer<typeof collectionReferenceSchema>;

export const draftResponseSchema = z.object({ draft: draftSchema });
export type DraftResponse = z.infer<typeof draftResponseSchema>;

export const sessionResponseSchema = z.object({ session: collectionSessionSchema });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** Idempotency-Key header for creating records. Generate once per user action and reuse on retry. */
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{8,128}$/, "Send an Idempotency-Key header of 8-128 letters, digits or ._:-");
