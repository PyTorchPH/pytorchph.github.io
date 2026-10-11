import assert from "node:assert/strict";
import test from "node:test";
import { resumeFromProfilePackage, resumeWithPrivateProfile } from "@pytorch-ph/domain-client/resumes";
import type { ProfilePackage } from "@pytorch-ph/domain-client/member-profile";

test("a saved profile creates a resume without achievements", () => {
  const data: ProfilePackage = {
    private: { displayName: "Sample Member", phoneNumber: "+639123456789" },
    public: {
      complete: true,
      profile: {
        gender: "prefer_not_to_say", regionCode: "NCR", status: "student", channel: "other",
        interests: [], analyticsConsent: true,
        school: { code: "UNLISTED_SCHOOL", unlistedName: "Sample School", level: "undergraduate", yearLevel: 2 },
      },
    },
    achievements: [],
    consents: {
      realNameVisible: false, photoVisible: false, analyticsOptOut: false,
      hideGoogleIdentity: true, automaticErrorReports: false, shareAchievements: false,
    },
  };
  const resume = resumeFromProfilePackage(data);
  assert.equal(resume.fullName, "Sample Member");
  assert.equal(resume.phone, "+639123456789");
  assert.equal(resume.education[0]?.school, "Sample School");
  assert.deepEqual(resume.projects, []);
  assert.deepEqual(resume.experience, []);
  const merged = resumeWithPrivateProfile({ ...resume, fullName: "Old name", phone: "000", projects: [{ title: "Verified project", summary: "", bullets: [] }] }, data);
  assert.equal(merged.fullName, "Sample Member");
  assert.equal(merged.phone, "+639123456789");
  assert.equal(merged.projects[0]?.title, "Verified project");
});
