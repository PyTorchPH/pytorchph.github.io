// Member profile domain: onboarding form, AppShell gate, and officer demographics.
// Module map:
//   api                                  network calls + react-query keys
//   use-profile-gate                     useMemberProfile / useProfileGate
//   onboarding/render-profile-form       CompleteProfile (/onboarding page body)
//   demographics/render-demographics     MemberDemographics (Command Center section)
export * from "./api";
export * from "./use-profile-gate";
export { CompleteProfile } from "./onboarding/render-profile-form";
export { MemberDemographics } from "./demographics/render-demographics";
