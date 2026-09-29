"use client";

// "Study / Work" section: a school block for students, an employment block for professionals.
// Module map:
//   StudyWorkSection   shows the blocks the chosen status needs (both for student_professional)
//   ├─ SchoolBlock      school combobox + "My school isn't listed", level, program, year level
//   └─ EmploymentBlock  company combobox + "Add my company", industry, role, experience
//   FallbackToggle     the "not listed" switch under each combobox

import { useState } from "react";
import { Combobox, type ComboboxOption } from "@pytorch-ph/design-system/combobox";
import { UNLISTED_SCHOOL, needsEmployment, needsSchool, type ProfileOptions } from "@pytorch-ph/domain-protocol/identity";
import { searchCompanies, searchSchools } from "../api";
import { FormSection, OptionSelect, TextField, useReferenceSearch } from "./form-fields";
import type { EmploymentDraft, ProfileDraft, SchoolDraft } from "./form-state";

type StudyWorkProps = { draft: ProfileDraft; options: ProfileOptions; update: (changes: Partial<ProfileDraft>) => void };

export function StudyWorkSection({ draft, options, update }: StudyWorkProps) {
  const showSchool = needsSchool(draft.status);
  const showWork = needsEmployment(draft.status);
  if (!showSchool && !showWork) return null;
  return <FormSection title="Study & work">
    {showSchool && <SchoolBlock levels={options.schoolLevels} onChange={(changes) => update({ school: { ...draft.school, ...changes } })} school={draft.school} />}
    {showWork && <EmploymentBlock employment={draft.employment} onChange={(changes) => update({ employment: { ...draft.employment, ...changes } })} options={options} />}
  </FormSection>;
}

type SchoolBlockProps = { school: SchoolDraft; levels: ProfileOptions["schoolLevels"]; onChange: (changes: Partial<SchoolDraft>) => void };

function SchoolBlock({ school, levels, onChange }: SchoolBlockProps) {
  const [query, setQuery] = useState(school.label);
  const { items, loading } = useReferenceSearch("schools", query, searchSchools);
  const unlisted = school.code === UNLISTED_SCHOOL;
  const options: ComboboxOption[] = items.map((item) => ({ value: item.code, label: item.label, detail: item.region }));
  return <div className="space-y-4">
    {unlisted
      ? <TextField id="profile-school-name" label="School name" maxLength={120} onChange={(unlistedName) => onChange({ unlistedName })} value={school.unlistedName} />
      : <div className="space-y-1.5">
          <label className="text-sm font-semibold" htmlFor="profile-school">School</label>
          <Combobox id="profile-school" label="Search schools" loading={loading} onQueryChange={(next) => { setQuery(next); onChange({ code: "", label: "" }); }} onSelect={(option) => { setQuery(option.label); onChange({ code: option.value, label: option.label }); }} options={options} placeholder="Start typing your school" query={query} />
        </div>}
    <FallbackToggle active={unlisted} label="My school isn't listed" onToggle={(next) => onChange({ code: next ? UNLISTED_SCHOOL : "", label: "" })} />
    <div className="grid gap-4 sm:grid-cols-3">
      <OptionSelect id="profile-school-level" label="Level" onChange={(level) => onChange({ level })} options={levels} value={school.level} />
      <TextField id="profile-program" label="Program / strand" maxLength={120} onChange={(program) => onChange({ program })} value={school.program} />
      <TextField id="profile-year" label="Year level" max={8} min={1} onChange={(yearLevel) => onChange({ yearLevel })} type="number" value={school.yearLevel} />
    </div>
  </div>;
}

type EmploymentBlockProps = { employment: EmploymentDraft; options: ProfileOptions; onChange: (changes: Partial<EmploymentDraft>) => void };

function EmploymentBlock({ employment, options, onChange }: EmploymentBlockProps) {
  const [query, setQuery] = useState(employment.companyLabel);
  const { items, loading } = useReferenceSearch("companies", query, searchCompanies);
  const companies: ComboboxOption[] = items.map((item) => ({ value: item.id, label: item.label }));
  return <div className="space-y-4">
    {employment.isNewCompany
      ? <TextField id="profile-new-company" label="Company name" maxLength={120} onChange={(newCompanyName) => onChange({ newCompanyName })} value={employment.newCompanyName} />
      : <div className="space-y-1.5">
          <label className="text-sm font-semibold" htmlFor="profile-company">Company</label>
          <Combobox id="profile-company" label="Search companies" loading={loading} onQueryChange={(next) => { setQuery(next); onChange({ companyId: "", companyLabel: "" }); }} onSelect={(option) => { setQuery(option.label); onChange({ companyId: option.value, companyLabel: option.label }); }} options={companies} placeholder="Start typing your company" query={query} />
        </div>}
    <FallbackToggle active={employment.isNewCompany} label="Add my company" onToggle={(isNewCompany) => onChange({ isNewCompany, companyId: "", companyLabel: "" })} />
    <div className="grid gap-4 sm:grid-cols-3">
      <OptionSelect id="profile-industry" label="Industry" onChange={(industry) => onChange({ industry })} options={options.industries} value={employment.industry} />
      <TextField id="profile-role" label="Job role" maxLength={120} onChange={(jobRole) => onChange({ jobRole })} value={employment.jobRole} />
      <OptionSelect id="profile-experience" label="Experience" onChange={(experienceRange) => onChange({ experienceRange })} options={options.experienceRanges} value={employment.experienceRange} />
    </div>
  </div>;
}

function FallbackToggle({ active, label, onToggle }: { active: boolean; label: string; onToggle: (next: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm text-muted">
    <input checked={active} className="h-4 w-4 accent-accent" onChange={(event) => onToggle(event.target.checked)} type="checkbox" />
    {label}
  </label>;
}
