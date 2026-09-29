"use client";

// "About you" section: gender, age range, region, and current status.
// Module map:
//   AboutYouSection   the section; shows the self-describe box only when that gender is chosen

import { InfoPopover } from "@pytorch-ph/design-system/info-popover";
import { SELF_DESCRIBE, type ProfileOptions } from "@pytorch-ph/domain-protocol/identity";
import { FormSection, OptionSelect, TextField } from "./form-fields";
import type { ProfileDraft } from "./form-state";

type AboutYouProps = { draft: ProfileDraft; options: ProfileOptions; update: (changes: Partial<ProfileDraft>) => void };

export function AboutYouSection({ draft, options, update }: AboutYouProps) {
  return <FormSection hint={<SensitiveDataHint />} title="About you">
    <div className="grid gap-4 sm:grid-cols-2">
      <OptionSelect id="profile-gender" label="Gender" onChange={(gender) => update({ gender })} options={options.genders} value={draft.gender} />
      <OptionSelect id="profile-age" label="Age range" onChange={(ageRange) => update({ ageRange })} options={options.ageRanges} value={draft.ageRange} />
      {draft.gender === SELF_DESCRIBE && <TextField id="profile-gender-text" label="Describe your gender" maxLength={60} onChange={(genderDescription) => update({ genderDescription })} value={draft.genderDescription} />}
      <OptionSelect id="profile-region" label="Region" onChange={(regionCode) => update({ regionCode })} options={options.regions} value={draft.regionCode} />
      <OptionSelect id="profile-status" label="Current status" onChange={(status) => update({ status })} options={options.statuses} value={draft.status} />
    </div>
  </FormSection>;
}

function SensitiveDataHint() {
  return <InfoPopover label="Why we ask" title="Why we ask">
    <p className="text-sm leading-6">Age and education are sensitive personal information under RA 10173. Every question has a “prefer not to say” style answer, and nothing here is shown to other members.</p>
  </InfoPopover>;
}
