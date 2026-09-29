// Editable draft of the profile form and its conversion to/from the API shape.
// Module map:
//   ProfileDraft       string-only form state (selects and text inputs)
//   emptyDraft         a blank draft
//   draftFromProfile   prefill from GET /api/member/profile
//   findDraftProblem   first client-side rule the draft breaks (mirrors the server 422 rules)
//   toProfileInput     PUT body; drops blocks the chosen status does not need

import { SELF_DESCRIBE, UNLISTED_PROGRAM, UNLISTED_SCHOOL, schoolLevelRule, needsEmployment, needsSchool, type ProfileInput, type ProfileStatus } from "@pytorch-ph/domain-protocol/identity";

// programCode: a catalog code or UNLISTED_PROGRAM (then unlistedProgram holds the typed name).
export type SchoolDraft = { code: string; label: string; unlistedName: string; level: string; programCode: string; programLabel: string; unlistedProgram: string; yearLevel: string };
export type EmploymentDraft = { companyId: string; companyLabel: string; newCompanyName: string; isNewCompany: boolean; industry: string; jobRole: string; experienceRange: string };

export type ProfileDraft = {
  gender: string;
  genderDescription: string;
  age: string;
  agePreferNotToSay: boolean;
  regionCode: string;
  status: string;
  channel: string;
  interests: string[];
  analyticsConsent: boolean;
  school: SchoolDraft;
  employment: EmploymentDraft;
};

const MAX_INTERESTS = 10;
const MAX_TEXT = 120;
const MAX_GENDER_TEXT = 60;
// Every age may join; the bounds only catch typos (the API uses the same).
export const MIN_AGE = 1;
export const MAX_AGE = 120;

export const emptyDraft = (): ProfileDraft => ({
  gender: "", genderDescription: "", age: "", agePreferNotToSay: false, regionCode: "", status: "", channel: "", interests: [], analyticsConsent: false,
  school: { code: "", label: "", unlistedName: "", level: "", programCode: "", programLabel: "", unlistedProgram: "", yearLevel: "" },
  employment: { companyId: "", companyLabel: "", newCompanyName: "", isNewCompany: false, industry: "", jobRole: "", experienceRange: "" },
});

export function draftFromProfile(profile: ProfileStatus["profile"]): ProfileDraft {
  const blank = emptyDraft();
  if (!profile) return blank;
  const { school, employment } = profile;
  return {
    ...blank,
    gender: profile.gender, genderDescription: profile.genderDescription ?? "", age: profile.age ? String(profile.age) : "", agePreferNotToSay: Boolean(profile.agePreferNotToSay), regionCode: profile.regionCode,
    status: profile.status, channel: profile.channel, interests: [...profile.interests], analyticsConsent: profile.analyticsConsent,
    school: school ? { code: school.code, label: profile.schoolLabel ?? "", unlistedName: school.unlistedName ?? "", level: school.level, programCode: school.programCode ?? "", programLabel: profile.programLabel ?? "", unlistedProgram: school.unlistedProgram ?? "", yearLevel: String(school.yearLevel) } : blank.school,
    employment: employment ? {
      companyId: employment.companyId ?? "", companyLabel: profile.companyLabel ?? "", newCompanyName: employment.newCompanyName ?? "",
      isNewCompany: Boolean(employment.newCompanyName), industry: employment.industry, jobRole: employment.jobRole, experienceRange: employment.experienceRange,
    } : blank.employment,
  };
}

// Returns a message for the first broken rule, or null when the draft can be sent.
export function findDraftProblem(draft: ProfileDraft): string | null {
  if (!draft.gender || !draft.regionCode || !draft.status || !draft.channel) return "Please answer every question in About you.";
  if (!draft.agePreferNotToSay && !isAcceptedAge(draft.age)) return `Enter your age (${MIN_AGE}–${MAX_AGE}) or choose “Prefer not to say”.`;
  if (draft.gender === SELF_DESCRIBE && !isBoundedText(draft.genderDescription, MAX_GENDER_TEXT)) return `Describe your gender in 1–${MAX_GENDER_TEXT} characters.`;
  if (draft.interests.length > MAX_INTERESTS) return `Pick at most ${MAX_INTERESTS} interests.`;
  const schoolProblem = needsSchool(draft.status) ? findSchoolProblem(draft.school) : null;
  if (schoolProblem) return schoolProblem;
  return needsEmployment(draft.status) ? findEmploymentProblem(draft.employment) : null;
}

function findSchoolProblem(school: SchoolDraft): string | null {
  if (!school.code) return "Choose your school, or pick “My school isn't listed”.";
  if (school.code === UNLISTED_SCHOOL && !isBoundedText(school.unlistedName, MAX_TEXT)) return "Type your school's name.";
  if (!school.level) return "Choose your school level.";
  const rule = schoolLevelRule(school.level);
  if (rule.programLabel && !school.programCode) return `Choose your ${rule.programLabel.toLowerCase()}, or pick "not listed".`;
  if (rule.programLabel && school.programCode === UNLISTED_PROGRAM && !isBoundedText(school.unlistedProgram, MAX_TEXT)) return `Type your ${rule.programLabel.toLowerCase()}.`;
  const year = Number(school.yearLevel);
  if (!Number.isInteger(year) || year < rule.min || year > rule.max) return `${rule.yearLabel} must be ${rule.min}–${rule.max}.`;
  return null;
}

function findEmploymentProblem(employment: EmploymentDraft): string | null {
  const hasCompany = employment.isNewCompany ? isBoundedText(employment.newCompanyName, MAX_TEXT) : Boolean(employment.companyId);
  if (!hasCompany) return "Choose your company, or add it.";
  if (!employment.industry || !employment.experienceRange || !isBoundedText(employment.jobRole, MAX_TEXT)) return "Add your industry, role, and experience.";
  return null;
}

export function toProfileInput(draft: ProfileDraft): ProfileInput {
  const { school, employment } = draft;
  return {
    gender: draft.gender,
    genderDescription: draft.gender === SELF_DESCRIBE ? draft.genderDescription.trim() : undefined,
    ...(draft.agePreferNotToSay ? { agePreferNotToSay: true } : { age: Number(draft.age) }),
    regionCode: draft.regionCode, status: draft.status, channel: draft.channel,
    interests: draft.interests, analyticsConsent: draft.analyticsConsent,
    school: needsSchool(draft.status) ? {
      code: school.code, unlistedName: school.code === UNLISTED_SCHOOL ? school.unlistedName.trim() : undefined,
      level: school.level, ...programInput(school), yearLevel: Number(school.yearLevel),
    } : undefined,
    employment: needsEmployment(draft.status) ? {
      companyId: employment.isNewCompany ? undefined : employment.companyId,
      newCompanyName: employment.isNewCompany ? employment.newCompanyName.trim() : undefined,
      industry: employment.industry, jobRole: employment.jobRole.trim(), experienceRange: employment.experienceRange,
    } : undefined,
  };
}

// Only levels with a program send one; an unlisted program carries its typed name.
function programInput(school: SchoolDraft): { programCode?: string; unlistedProgram?: string } {
  if (!schoolLevelRule(school.level).programLabel) return {};
  if (school.programCode === UNLISTED_PROGRAM) return { programCode: UNLISTED_PROGRAM, unlistedProgram: school.unlistedProgram.trim() };
  return { programCode: school.programCode };
}

const isAcceptedAge = (value: string) => /^\d{1,3}$/.test(value.trim()) && Number(value) >= MIN_AGE && Number(value) <= MAX_AGE;

const isBoundedText = (value: string, max: number) => value.trim().length >= 1 && value.trim().length <= max;
