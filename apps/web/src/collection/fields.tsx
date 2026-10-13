import { useState } from "react";
import type { CollectionReference } from "@ezysource/domain";
import { ChipGroup } from "../components/ChipGroup";
import { TextArea } from "../components/TextArea";
import { TextField } from "../components/TextField";
import type { ContactForm, FieldErrors, ShopForm } from "./form";

type Location = { districtId: string; floorId: string; categoryId: string };

/** District, floor and main category as chips. Changing district clears the floor. */
export function LocationPicker({
  reference,
  value,
  onChange,
  categoryLabel = "Main category",
}: {
  reference: CollectionReference;
  value: Location;
  onChange: (next: Location) => void;
  categoryLabel?: string;
}) {
  const districts = reference.markets.flatMap((m) => m.districts);
  const district = districts.find((d) => d.id === value.districtId);
  return (
    <>
      <ChipGroup
        label="District"
        options={districts.map((d) => ({ value: d.id, label: d.code }))}
        value={value.districtId}
        onChange={(districtId) => onChange({ ...value, districtId, floorId: "" })}
        allowClear
      />
      {district ? (
        <ChipGroup
          label="Floor"
          options={district.floors.map((f) => ({ value: f.id, label: f.label }))}
          value={value.floorId}
          onChange={(floorId) => onChange({ ...value, floorId })}
          allowClear
        />
      ) : null}
      <ChipGroup
        label={categoryLabel}
        options={reference.categories
          .filter((c) => c.parentId === null)
          .map((c) => ({ value: c.id, label: c.nameEn }))}
        value={value.categoryId}
        onChange={(categoryId) => onChange({ ...value, categoryId })}
        allowClear
        collapseAfter={8}
      />
    </>
  );
}

type SetField<F> = <K extends keyof F>(key: K, value: F[K]) => void;

export function ContactFields({
  form,
  set,
  errors,
}: {
  form: ContactForm;
  set: SetField<ContactForm>;
  errors: FieldErrors;
}) {
  return (
    <>
      <TextField
        label="Contact name"
        value={form.contactName}
        onChange={(e) => set("contactName", e.target.value)}
        autoComplete="off"
      />
      <TextField
        label="Role"
        hint="For example Owner or Sales"
        value={form.contactTitle}
        onChange={(e) => set("contactTitle", e.target.value)}
        autoComplete="off"
      />
      <TextField
        label="Phone"
        type="tel"
        inputMode="tel"
        value={form.phone}
        onChange={(e) => set("phone", e.target.value)}
        error={errors.phone}
        autoComplete="off"
      />
      <TextField
        label="WeChat ID"
        value={form.wechat}
        onChange={(e) => set("wechat", e.target.value)}
        autoComplete="off"
      />
      <TextField
        label="WhatsApp"
        type="tel"
        inputMode="tel"
        hint="Only if they said they use WhatsApp"
        value={form.whatsapp}
        onChange={(e) => set("whatsapp", e.target.value)}
        error={errors.whatsapp}
        autoComplete="off"
      />
      <TextField
        label="Email"
        type="email"
        inputMode="email"
        value={form.email}
        onChange={(e) => set("email", e.target.value)}
        error={errors.email}
        autoComplete="off"
      />
    </>
  );
}

/** The shop part of the quick form (specs/04 "Initial review fields"). */
export function ShopFields({
  form,
  set,
  errors,
  reference,
  withContact,
}: {
  form: ShopForm;
  set: SetField<ShopForm>;
  errors: FieldErrors;
  reference: CollectionReference;
  withContact: boolean;
}) {
  const [more, setMore] = useState(
    Boolean(form.companyName || form.description || form.website || errors.website),
  );
  return (
    <>
      <fieldset className="collect__group glass">
        <legend className="collect__legend">Shop</legend>
        <TextField label="Chinese name" lang="zh" value={form.nameZh} onChange={(e) => set("nameZh", e.target.value)} autoComplete="off" />
        <TextField label="English name" value={form.nameEn} onChange={(e) => set("nameEn", e.target.value)} autoComplete="off" />
        <TextField
          label="Booth number"
          inputMode="text"
          value={form.boothNumber}
          onChange={(e) => set("boothNumber", e.target.value)}
          autoComplete="off"
        />
        <LocationPicker
          reference={reference}
          value={form}
          onChange={(next) => {
            set("districtId", next.districtId);
            set("floorId", next.floorId);
            set("categoryId", next.categoryId);
          }}
        />
        <TextField
          label="Products"
          hint="Separate with commas, for example plush toys, 毛绒玩具"
          value={form.keywords}
          onChange={(e) => set("keywords", e.target.value)}
          autoComplete="off"
        />
      </fieldset>

      {withContact ? (
        <fieldset className="collect__group glass">
          <legend className="collect__legend">First contact</legend>
          <ContactFields form={form} set={set as SetField<ContactForm>} errors={errors} />
        </fieldset>
      ) : null}

      {more ? (
        <fieldset className="collect__group glass">
          <legend className="collect__legend">More information</legend>
          <TextField label="Registered company" value={form.companyName} onChange={(e) => set("companyName", e.target.value)} autoComplete="off" />
          <TextField
            label="Website or online store"
            type="url"
            inputMode="url"
            value={form.website}
            onChange={(e) => set("website", e.target.value)}
            error={errors.website}
            autoComplete="off"
          />
          <TextArea label="Description" value={form.description} onChange={(e) => set("description", e.target.value)} />
        </fieldset>
      ) : (
        <button type="button" className="collect__link" onClick={() => setMore(true)}>
          Add more information
        </button>
      )}
    </>
  );
}
