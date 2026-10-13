import {
  channelInputSchema,
  createDraftSchema,
  type ChannelInput,
  type ChannelType,
  type CollectionReference,
  type CollectionSession,
  type CreateDraftInput,
  type Draft,
  type UpdateDraftInput,
} from "@ezysource/domain";

/** The quick shop form as typed. Every field is a plain string so it can be stored as-is. */
export type ShopForm = {
  nameZh: string;
  nameEn: string;
  boothNumber: string;
  districtId: string;
  floorId: string;
  categoryId: string;
  keywords: string;
  contactName: string;
  contactTitle: string;
  phone: string;
  wechat: string;
  whatsapp: string;
  email: string;
  companyName: string;
  description: string;
  website: string;
};

export type ContactForm = Pick<
  ShopForm,
  "contactName" | "contactTitle" | "phone" | "wechat" | "whatsapp" | "email"
>;

export const emptyContact: ContactForm = {
  contactName: "",
  contactTitle: "",
  phone: "",
  wechat: "",
  whatsapp: "",
  email: "",
};

/** A new form starts from the session's location and category. */
export function emptyShopForm(session: CollectionSession | null): ShopForm {
  return {
    nameZh: "",
    nameEn: "",
    boothNumber: "",
    districtId: session?.districtId ?? "",
    floorId: session?.floorId ?? "",
    categoryId: session?.defaultCategoryId ?? "",
    keywords: "",
    ...emptyContact,
    companyName: "",
    description: "",
    website: "",
  };
}

/** True when the collector has typed something beyond the session defaults. */
export function hasTyped(form: ShopForm, session: CollectionSession | null) {
  const blank = emptyShopForm(session);
  return (Object.keys(form) as (keyof ShopForm)[]).some((k) => form[k] !== blank[k]);
}

const CONTACT_CHANNELS: Array<[keyof ContactForm, ChannelType]> = [
  ["phone", "phone"],
  ["wechat", "wechat"],
  ["whatsapp", "whatsapp"],
  ["email", "email"],
];

export type FieldErrors = Partial<Record<keyof ShopForm | "_form", string>>;

/** Checks each channel field on its own so errors land next to the right input. */
function channelErrors(form: ContactForm & Partial<Pick<ShopForm, "website">>): FieldErrors {
  const errors: FieldErrors = {};
  const fields: Array<[keyof ShopForm, ChannelType]> = [...CONTACT_CHANNELS, ["website", "website"]];
  for (const [field, type] of fields) {
    const value = (form as Partial<ShopForm>)[field]?.trim();
    if (!value) continue;
    const parsed = channelInputSchema.safeParse({ type, value });
    if (!parsed.success) errors[field] = parsed.error.issues[0]!.message;
  }
  return errors;
}

function channels(form: ContactForm): ChannelInput[] {
  return CONTACT_CHANNELS.flatMap(([field, type]) => {
    const value = form[field].trim();
    return value ? [{ type, value }] : [];
  });
}

export function contactHasContent(form: ContactForm) {
  return Object.values(form).some((v) => v.trim() !== "");
}

/** Splits "plush, 毛绒、toys" into keywords. */
export function parseKeywords(text: string) {
  const seen = new Set<string>();
  return text
    .split(/[,，、;；\n]/)
    .map((k) => k.trim())
    .filter((k) => k && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()))
    .slice(0, 50)
    .map((keyword) => ({ keyword, language: /\p{Script=Han}/u.test(keyword) ? "zh" : "und" }));
}

export type Validated<T> = { ok: true; input: T } | { ok: false; errors: FieldErrors };

export function toCreateInput(form: ShopForm, sessionId: string | null): Validated<CreateDraftInput> {
  const errors = channelErrors(form);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const contact = {
    displayName: form.contactName,
    title: form.contactTitle,
    channels: channels(form),
  };
  const parsed = createDraftSchema.safeParse({
    nameZh: form.nameZh,
    nameEn: form.nameEn,
    companyName: form.companyName,
    description: form.description,
    boothNumber: form.boothNumber,
    districtId: form.districtId || null,
    floorId: form.floorId || null,
    categoryIds: form.categoryId ? [form.categoryId] : [],
    keywords: parseKeywords(form.keywords),
    contacts: contactHasContent(form) ? [contact] : [],
    sharedChannels: form.website.trim() ? [{ type: "website", value: form.website }] : [],
    ...(sessionId ? { sessionId } : {}),
  });
  if (!parsed.success) {
    return { ok: false, errors: { _form: parsed.error.issues[0]?.message ?? "Check the form." } };
  }
  return { ok: true, input: parsed.data };
}

/** The shop fields of a saved draft, for editing. Contacts are edited separately. */
export function formFromDraft(draft: Draft): ShopForm {
  const website = draft.sharedChannels.find((c) => c.type === "website");
  return {
    ...emptyShopForm(null),
    nameZh: draft.nameZh ?? "",
    nameEn: draft.nameEn ?? "",
    boothNumber: draft.boothNumber ?? "",
    districtId: draft.districtId ?? "",
    floorId: draft.floorId ?? "",
    categoryId: draft.categories.find((c) => c.isPrimary)?.id ?? "",
    keywords: draft.keywords.map((k) => k.keyword).join(", "),
    companyName: draft.companyName ?? "",
    description: draft.description ?? "",
    website: website?.value ?? "",
  };
}

export function toUpdateInput(form: ShopForm, draft: Draft): Validated<UpdateDraftInput> {
  const errors = channelErrors({ ...emptyContact, website: form.website });
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  // Keep shared channels other than the website, which this form edits.
  const otherShared = draft.sharedChannels
    .filter((c) => c.type !== "website")
    .map(({ type, value, label }) => ({ type, value, label }));
  const extraCategories = draft.categories.filter((c) => !c.isPrimary && c.id !== form.categoryId).map((c) => c.id);
  return {
    ok: true,
    input: {
      expectedVersion: draft.version,
      nameZh: form.nameZh.trim() || null,
      nameEn: form.nameEn.trim() || null,
      boothNumber: form.boothNumber.trim() || null,
      companyName: form.companyName.trim() || null,
      description: form.description.trim() || null,
      districtId: form.districtId || null,
      floorId: form.floorId || null,
      categoryIds: form.categoryId ? [form.categoryId, ...extraCategories] : extraCategories,
      keywords: parseKeywords(form.keywords),
      sharedChannels: [
        ...otherShared,
        ...(form.website.trim() ? [{ type: "website" as const, value: form.website.trim(), label: null }] : []),
      ],
    },
  };
}

export function contactInput(form: ContactForm): Validated<{
  displayName: string | null;
  title: string | null;
  channels: ChannelInput[];
}> {
  const errors = channelErrors(form);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (!contactHasContent(form)) return { ok: false, errors: { _form: "Add a name or a contact method." } };
  return {
    ok: true,
    input: {
      displayName: form.contactName.trim() || null,
      title: form.contactTitle.trim() || null,
      channels: channels(form),
    },
  };
}

/** "D2 · F3" style location label. */
export function locationLabel(
  ref: CollectionReference | undefined,
  districtId: string | null | undefined,
  floorId: string | null | undefined,
) {
  const districts = ref?.markets.flatMap((m) => m.districts) ?? [];
  const district = districts.find((d) => d.id === districtId);
  const floor = district?.floors.find((f) => f.id === floorId);
  return [district?.code, floor?.label].filter(Boolean).join(" · ");
}

export function categoryName(ref: CollectionReference | undefined, id: string | null | undefined) {
  return ref?.categories.find((c) => c.id === id)?.nameEn ?? "";
}
