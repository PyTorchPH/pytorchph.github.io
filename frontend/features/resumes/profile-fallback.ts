import type { ResumeProfile } from "@pytorch-ph/domain-protocol/career-evidence";
import type { ProfilePackage } from "@pytorch-ph/domain-client/member-profile";

// An empty evidence history still yields a truthful resume shell from the member's saved profile.
export function resumeFromProfilePackage(data: ProfilePackage): ResumeProfile {
  const profile = data.public.profile;
  const school = profile?.school;
  const schoolName = profile?.schoolLabel || school?.unlistedName || "";
  const programName = profile?.programLabel || school?.unlistedProgram || "";
  return {
    fullName: data.private.displayName,
    headline: "",
    email: "",
    location: profile?.regionCode || "",
    phone: data.private.phoneNumber || undefined,
    summary: "",
    experience: [],
    projects: [],
    skillGroups: [],
    education: schoolName ? [{ school: schoolName, program: programName, dateLabel: "" }] : [],
  };
}

export function resumeWithPrivateProfile(base: ResumeProfile, data: ProfilePackage): ResumeProfile {
  const fallback = resumeFromProfilePackage(data);
  return {
    ...base,
    fullName: data.private.displayName,
    phone: data.private.phoneNumber || undefined,
    education: base.education.length ? base.education : fallback.education,
  };
}
