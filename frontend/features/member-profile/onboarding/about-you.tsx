"use client";

// "About you" section: gender, exact age, region, and current status.
// Module map:
//   AboutYouSection   the section; shows the self-describe box only when that gender is chosen
//   AgeField          typed age (1–120) with a "Prefer not to say" checkbox beside it

import { InfoPopover } from "@pytorch-ph/design-system/info-popover";
import { SELF_DESCRIBE, type ProfileOptions } from "@pytorch-ph/domain-protocol/identity";
import { Input, Label } from "@pytorch-ph/design-system/input";
import { FormSection, OptionSelect, TextField } from "./form-fields";
import { MAX_AGE, MIN_AGE, type ProfileDraft } from "./form-state";

type AboutYouProps = { draft: ProfileDraft; options: ProfileOptions; update: (changes: Partial<ProfileDraft>) => void };

export function AboutYouSection({ draft, options, update }: AboutYouProps) {
  return <FormSection hint={<SensitiveDataHint />} title="About you">
    <div className="grid gap-4 sm:grid-cols-2">
      <OptionSelect id="profile-gender" label="Gender" onChange={(gender) => update({ gender })} options={options.genders} value={draft.gender} />
      <AgeField draft={draft} update={update} />
      {draft.gender === SELF_DESCRIBE && <TextField id="profile-gender-text" label="Describe your gender" maxLength={60} onChange={(genderDescription) => update({ genderDescription })} value={draft.genderDescription} />}
      <OptionSelect id="profile-region" label="Region" onChange={(regionCode) => update({ regionCode })} options={options.regions} value={draft.regionCode} />
      <OptionSelect id="profile-status" label="Current status" onChange={(status) => update({ status })} options={options.statuses} value={draft.status} />
    </div>
  </FormSection>;
}

// Choosing "Prefer not to say" clears and disables the number, so only one answer is ever sent.
function AgeField({ draft, update }: Pick<AboutYouProps, "draft" | "update">) {
  return <div className="space-y-1.5">
    <Label htmlFor="profile-age">Age</Label>
    <div className="flex items-center gap-3">
      <Input className="w-28" disabled={draft.agePreferNotToSay} id="profile-age" inputMode="numeric" max={MAX_AGE} min={MIN_AGE} onChange={(event) => update({ age: event.target.value.replace(/\D/g, "").slice(0, 3) })} placeholder="e.g. 21" required={!draft.agePreferNotToSay} type="number" value={draft.age} />
      <label className="flex items-center gap-2 text-sm text-muted"><input checked={draft.agePreferNotToSay} className="accent-accent" onChange={(event) => update({ agePreferNotToSay: event.target.checked, age: "" })} type="checkbox" />Prefer not to say</label>
    </div>
  </div>;
}

function SensitiveDataHint() {
  return <InfoPopover label="Why we ask" title="Why we ask">
    <p className="text-sm leading-6">Age and education are sensitive personal information under RA 10173. Every question has a “prefer not to say” style answer, and nothing here is shown to other members.</p>
  </InfoPopover>;
}
