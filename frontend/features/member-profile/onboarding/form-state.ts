// Editable draft of the profile form and its conversion to/from the API shape.
// Module map:
//   ProfileDraft       string-only form state (selects and text inputs)
//   emptyDraft         a blank draft
//   draftFromProfile   prefill from GET /api/member/profile
//   findDraftProblem   first client-side rule the draft breaks (mirrors the server 422 rules)
//   toProfileInput     PUT body; drops blocks the chosen status does not need

import { SELF_DESCRIBE, UNLISTED_SCHOOL, needsEmployment, needsSchool, type ProfileInput, type ProfileStatus } from "@pytorch-ph/domain-protocol/identity";

export type SchoolDraft = { code: string; label: string; unlistedName: string; level: string; program: string; yearLevel: string };
export type EmploymentDraft = { companyId: string; companyLabel: string; newCompanyName: string; isNewCompany: boolean; industry: string; jobRole: string; experienceRange: string };

export type ProfileDraft = {
  gender: string;
  genderDescription: string;
  ageRange: string;
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
const MAX_YEAR_LEVEL = 8;

export const emptyDraft = (): ProfileDraft => ({
  gender: "", genderDescription: "", ageRange: "", regionCode: "", status: "", channel: "", interests: [], analyticsConsent: false,
  school: { code: "", label: "", unlistedName: "", level: "", program: "", yearLevel: "" },
  employment: { companyId: "", companyLabel: "", newCompanyName: "", isNewCompany: false, industry: "", jobRole: "", experienceRange: "" },
});

export function draftFromProfile(profile: ProfileStatus["profile"]): ProfileDraft {
  const blank = emptyDraft();
  if (!profile) return blank;
  const { school, employment } = profile;
  return {
    ...blank,
    gender: profile.gender, genderDescription: profile.genderDescription ?? "", ageRange: profile.ageRange, regionCode: profile.regionCode,
    status: profile.status, channel: profile.channel, interests: [...profile.interests], analyticsConsent: profile.analyticsConsent,
    school: school ? { code: school.code, label: profile.schoolLabel ?? "", unlistedName: school.unlistedName ?? "", level: school.level, program: school.program, yearLevel: String(school.yearLevel) } : blank.school,
    employment: employment ? {
      companyId: employment.companyId ?? "", companyLabel: profile.companyLabel ?? "", newCompanyName: employment.newCompanyName ?? "",
      isNewCompany: Boolean(employment.newCompanyName), industry: employment.industry, jobRole: employment.jobRole, experienceRange: employment.experienceRange,
    } : blank.employment,
  };
}

// Returns a message for the first broken rule, or null when the draft can be sent.
export function findDraftProblem(draft: ProfileDraft): string | null {
  if (!draft.gender || !draft.ageRange || !draft.regionCode || !draft.status || !draft.channel) return "Please answer every question in About you.";
  if (draft.gender === SELF_DESCRIBE && !isBoundedText(draft.genderDescription, MAX_GENDER_TEXT)) return `Describe your gender in 1–${MAX_GENDER_TEXT} characters.`;
  if (draft.interests.length > MAX_INTERESTS) return `Pick at most ${MAX_INTERESTS} interests.`;
  const schoolProblem = needsSchool(draft.status) ? findSchoolProblem(draft.school) : null;
  if (schoolProblem) return schoolProblem;
  return needsEmployment(draft.status) ? findEmploymentProblem(draft.employment) : null;
}

function findSchoolProblem(school: SchoolDraft): string | null {
  if (!school.code) return "Choose your school, or pick “My school isn't listed”.";
  if (school.code === UNLISTED_SCHOOL && !isBoundedText(school.unlistedName, MAX_TEXT)) return "Type your school's name.";
  if (!school.level || !isBoundedText(school.program, MAX_TEXT)) return "Add your school level and program.";
  const year = Number(school.yearLevel);
  if (!Number.isInteger(year) || year < 1 || year > MAX_YEAR_LEVEL) return `Year level must be 1–${MAX_YEAR_LEVEL}.`;
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
    ageRange: draft.ageRange, regionCode: draft.regionCode, status: draft.status, channel: draft.channel,
    interests: draft.interests, analyticsConsent: draft.analyticsConsent,
    school: needsSchool(draft.status) ? {
      code: school.code, unlistedName: school.code === UNLISTED_SCHOOL ? school.unlistedName.trim() : undefined,
      level: school.level, program: school.program.trim(), yearLevel: Number(school.yearLevel),
    } : undefined,
    employment: needsEmployment(draft.status) ? {
      companyId: employment.isNewCompany ? undefined : employment.companyId,
      newCompanyName: employment.isNewCompany ? employment.newCompanyName.trim() : undefined,
      industry: employment.industry, jobRole: employment.jobRole.trim(), experienceRange: employment.experienceRange,
    } : undefined,
  };
}

const isBoundedText = (value: string, max: number) => value.trim().length >= 1 && value.trim().length <= max;
