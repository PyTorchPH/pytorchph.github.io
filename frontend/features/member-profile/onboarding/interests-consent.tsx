"use client";

// "Interests" and "Consent" sections of the profile form.
// Module map:
//   InterestsSection   toggle chips (max 10) + how-you-found-us channel
//   ConsentSection     analytics consent checkbox with a small ⓘ popover
//   toggleInterest     adds or removes one chip code (new array)

import { InfoPopover } from "@pytorch-ph/design-system/info-popover";
import { cn } from "@pytorch-ph/design-system/merge-classes";
import type { ProfileOptions } from "@pytorch-ph/domain-protocol/identity";
import { LegalLink } from "../../identity/legal";
import { FormSection, OptionSelect } from "./form-fields";
import type { ProfileDraft } from "./form-state";

const MAX_INTERESTS = 10;

type SectionProps = { draft: ProfileDraft; options: ProfileOptions; update: (changes: Partial<ProfileDraft>) => void };

export function InterestsSection({ draft, options, update }: SectionProps) {
  const full = draft.interests.length >= MAX_INTERESTS;
  return <FormSection title="Interests">
    <div aria-label="Interests" className="flex flex-wrap gap-2" role="group">
      {options.interests.map((interest) => {
        const selected = draft.interests.includes(interest.code);
        return <button
          aria-pressed={selected}
          className={cn("focus-ring border px-3 py-1.5 text-sm transition-colors", selected ? "border-accent bg-accentSoft text-accent" : "border-border bg-elevated text-ink hover:border-accent", !selected && full && "opacity-50")}
          disabled={!selected && full}
          key={interest.code}
          onClick={() => update({ interests: toggleInterest(draft.interests, interest.code) })}
          type="button"
        >{interest.label}</button>;
      })}
    </div>
    <p className="text-xs text-muted">{draft.interests.length}/{MAX_INTERESTS} selected</p>
    <div className="sm:max-w-sm">
      <OptionSelect id="profile-channel" label="How did you find PyTorch PH?" onChange={(channel) => update({ channel })} options={options.channels} value={draft.channel} />
    </div>
  </FormSection>;
}

export function ConsentSection({ draft, update }: Omit<SectionProps, "options">) {
  return <FormSection title="Consent">
    <div className="flex items-start gap-2">
      <input checked={draft.analyticsConsent} className="mt-1 h-4 w-4 accent-accent" id="profile-consent" onChange={(event) => update({ analyticsConsent: event.target.checked })} type="checkbox" />
      <label className="text-sm leading-6" htmlFor="profile-consent">Include my answers in community demographics (optional). See the <LegalLink document="privacy" />.</label>
      <InfoPopover label="How demographics are used" title="How demographics are used">
        <p className="text-sm leading-6">Only aggregated counts are shown to officers; groups under 5 are hidden; you can delete everything by leaving PyTorch PH.</p>
      </InfoPopover>
    </div>
  </FormSection>;
}

const toggleInterest = (current: string[], code: string) =>
  current.includes(code) ? current.filter((item) => item !== code) : [...current, code];
