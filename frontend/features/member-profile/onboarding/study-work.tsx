"use client";

// "Study / Work" section: a school block for students, an employment block for professionals.
// Module map:
//   StudyWorkSection   shows the blocks the chosen status needs (both for student_professional)
//   ├─ SchoolBlock      school combobox + "My school isn't listed", level, program, grade/year
//   │   └─ ProgramField  catalog program/strand: dropdown (junior/senior high) or search (college+)
//   └─ EmploymentBlock  company combobox + "Add my company", industry, role, experience
//   FallbackToggle     the "not listed" switch under each combobox

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Combobox, type ComboboxOption } from "@pytorch-ph/design-system/combobox";
import { UNLISTED_PROGRAM, UNLISTED_SCHOOL, needsEmployment, needsSchool, schoolLevelRule, type CompanyOption, type ProfileOptions, type ProgramOption } from "@pytorch-ph/domain-protocol/identity";
import { SEARCH_LIMIT, fetchPrograms, searchCompanies, searchSchools } from "../api";
import { FormSection, OptionSelect, TextField, useReferenceSearch } from "./form-fields";
import type { EmploymentDraft, ProfileDraft, SchoolDraft } from "./form-state";
import type { SchoolOption } from "@pytorch-ph/domain-protocol/identity";

// The words the server searches for a school: its name (with campus), acronym, city, and province.
const schoolWords = (school: SchoolOption) => [school.label, school.acronym, school.city, school.province].join(" ");

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
  const { items, loading } = useReferenceSearch("schools", query, { search: searchSchools, limit: SEARCH_LIMIT, wordsOf: schoolWords });
  const unlisted = school.code === UNLISTED_SCHOOL;
  const rule = schoolLevelRule(school.level);
  const options: ComboboxOption[] = items.map((item) => ({ value: item.code, label: item.label, detail: item.detail }));
  return <div className="space-y-4">
    {unlisted
      ? <TextField id="profile-school-name" label="School name" maxLength={120} onChange={(unlistedName) => onChange({ unlistedName })} value={school.unlistedName} />
      : <div className="space-y-1.5">
          <label className="text-sm font-semibold" htmlFor="profile-school">School</label>
          <Combobox id="profile-school" label="Search schools" loading={loading} onQueryChange={(next) => { setQuery(next); onChange({ code: "", label: "" }); }} onSelect={(option) => { setQuery(option.label); onChange({ code: option.value, label: option.label }); }} options={options} placeholder="Start typing your school" query={query} />
        </div>}
    <FallbackToggle active={unlisted} label="My school isn't listed" onToggle={(next) => onChange({ code: next ? UNLISTED_SCHOOL : "", label: "" })} />
    <div className="grid gap-4 sm:grid-cols-3">
      {/* Changing the level clears answers that belong to another level's grade range or program. */}
      <OptionSelect id="profile-school-level" label="Level" onChange={(level) => onChange({ level, yearLevel: "", programCode: "", programLabel: "", unlistedProgram: "" })} options={levels} value={school.level} />
      {rule.programLabel && <ProgramField key={school.level} label={rule.programLabel} onChange={onChange} school={school} wholeList={rule.wholeList} />}
      {rule.yearLabel === "Grade"
        ? <TextField id="profile-year" label={`Grade (${rule.min}–${rule.max})`} max={rule.max} min={rule.min} onChange={(yearLevel) => onChange({ yearLevel })} type="number" value={school.yearLevel} />
        : <OptionSelect id="profile-year" label="Year" onChange={(yearLevel) => onChange({ yearLevel })} options={yearOptions(rule.min, rule.max)} value={school.yearLevel} />}
    </div>
  </div>;
}

// The words the server searches for a program: its name, acronym (BSCS, STEM), and field group.
const programWords = (program: ProgramOption) => [program.label, program.shortName, program.group].join(" ");

type ProgramFieldProps = { school: SchoolDraft; label: string; wholeList: boolean; onChange: (changes: Partial<SchoolDraft>) => void };

// Mental model: short catalogs (junior/senior high) are one grouped dropdown; long ones (college,
// graduate, tech-voc) are searched like schools. Either way "not listed" keeps a typed name apart.
function ProgramField({ school, label, wholeList, onChange }: ProgramFieldProps) {
  const unlisted = school.programCode === UNLISTED_PROGRAM;
  return <div className="space-y-1.5 sm:col-span-2">
    {unlisted
      ? <TextField id="profile-program-name" label={`${label} (not listed)`} maxLength={120} onChange={(unlistedProgram) => onChange({ unlistedProgram })} value={school.unlistedProgram} />
      : wholeList ? <ProgramDropdown label={label} level={school.level} onChange={onChange} value={school.programCode} /> : <ProgramSearch label={label} level={school.level} onChange={onChange} school={school} />}
    <FallbackToggle active={unlisted} label={`My ${label.toLowerCase()} isn't listed`} onToggle={(next) => onChange({ programCode: next ? UNLISTED_PROGRAM : "", programLabel: "", unlistedProgram: "" })} />
  </div>;
}

function ProgramDropdown({ level, label, value, onChange }: { level: string; label: string; value: string; onChange: ProgramFieldProps["onChange"] }) {
  const programs = useQuery({ queryKey: ["reference", "programs", level], queryFn: () => fetchPrograms(level), staleTime: Infinity });
  const groups = groupPrograms(programs.data ?? []);
  return <>
    <label className="text-sm font-semibold" htmlFor="profile-program">{label}</label>
    <select className="focus-ring h-11 w-full border border-ink/40 bg-elevated px-3 text-sm text-ink" disabled={!programs.data} id="profile-program" onChange={(event) => onChange({ programCode: event.target.value, programLabel: event.target.selectedOptions[0]?.text ?? "" })} required value={value}>
      <option disabled value="">{programs.isError ? "Could not load the list" : programs.data ? "Choose…" : "Loading…"}</option>
      {groups.map(([group, items]) => <optgroup key={group} label={group}>
        {items.map((program) => <option key={program.code} value={program.code}>{program.shortName && program.shortName !== program.label ? `${program.shortName} — ${program.label}` : program.label}</option>)}
      </optgroup>)}
    </select>
  </>;
}

const groupPrograms = (programs: ProgramOption[]): Array<[string, ProgramOption[]]> =>
  [...programs.reduce((groups, program) => groups.set(program.group, [...(groups.get(program.group) ?? []), program]), new Map<string, ProgramOption[]>())];

function ProgramSearch({ level, label, school, onChange }: { level: string; label: string; school: SchoolDraft; onChange: ProgramFieldProps["onChange"] }) {
  const [query, setQuery] = useState(school.programLabel);
  const { items, loading } = useReferenceSearch(`programs-${level}`, query, { search: (text) => fetchPrograms(level, text), limit: SEARCH_LIMIT, wordsOf: programWords });
  const options: ComboboxOption[] = items.map((item) => ({ value: item.code, label: item.label, detail: [item.shortName, item.group].filter(Boolean).join(" · ") }));
  return <>
    <label className="text-sm font-semibold" htmlFor="profile-program">{label}</label>
    <Combobox id="profile-program" label={`Search ${label.toLowerCase()}`} loading={loading} onQueryChange={(next) => { setQuery(next); onChange({ programCode: "", programLabel: "" }); }} onSelect={(option) => { setQuery(option.label); onChange({ programCode: option.value, programLabel: option.label }); }} options={options} placeholder="e.g. BSCS, computer science, nursing" query={query} />
  </>;
}

// College and later years read "1st year", "2nd year", …; the stored value stays the number.
const ORDINAL_SUFFIX = ["th", "st", "nd", "rd"];
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ORDINAL_SUFFIX[n % 10] ?? "th"}`;
const yearOptions = (min: number, max: number) =>
  Array.from({ length: max - min + 1 }, (_, index) => ({ code: String(min + index), label: `${ordinal(min + index)} year` }));

type EmploymentBlockProps = { employment: EmploymentDraft; options: ProfileOptions; onChange: (changes: Partial<EmploymentDraft>) => void };

function EmploymentBlock({ employment, options, onChange }: EmploymentBlockProps) {
  const [query, setQuery] = useState(employment.companyLabel);
  const { items, loading } = useReferenceSearch("companies", query, { search: searchCompanies, limit: SEARCH_LIMIT, wordsOf: companyWords });
  const companies: ComboboxOption[] = items.map((item) => ({ value: item.id, label: item.label, detail: companyDetail(item) }));
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

// The words the server searches for a company: its name, aliases (acronyms, tickers), and city.
const companyWords = (company: CompanyOption) => [company.label, company.aliases.replaceAll("|", " "), company.city].join(" ");

// Member-added companies are shown, but marked, so the verified directory stays recognizable.
const companyDetail = (company: CompanyOption) => [company.detail, company.verified ? "" : "Added by members"].filter(Boolean).join(" · ");

function FallbackToggle({ active, label, onToggle }: { active: boolean; label: string; onToggle: (next: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm text-muted">
    <input checked={active} className="h-4 w-4 accent-accent" onChange={(event) => onToggle(event.target.checked)} type="checkbox" />
    {label}
  </label>;
}
