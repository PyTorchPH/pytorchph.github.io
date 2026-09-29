// Member profile ("Complete your profile") and officer demographics contracts.
// Module map:
//   ProfileOption / ProfileOptions   reference choices served by GET /reference/profile-options
//   SchoolOption / CompanyOption     searchable reference rows (GET /reference/schools, /reference/companies)
//   ProfileInput                     PUT /api/member/profile body; also the saved profile shape
//   ProfileStatus                    GET /api/member/profile reply
//   Demographics                     GET /api/officer/demographics reply
//   needsSchool / needsEmployment    which conditional blocks a status requires

export type ProfileOption = { code: string; label: string };

export type ProfileOptions = {
  genders: ProfileOption[];
  ageRanges: ProfileOption[];
  statuses: ProfileOption[];
  schoolLevels: ProfileOption[];
  experienceRanges: ProfileOption[];
  industries: ProfileOption[];
  interests: ProfileOption[];
  channels: ProfileOption[];
  regions: ProfileOption[];
};

export type SchoolOption = { code: string; label: string; type: string; region: string };
export type CompanyOption = { id: string; label: string };

export type SchoolInput = {
  code: string;
  unlistedName?: string;
  level: string;
  program: string;
  yearLevel: number;
};

export type EmploymentInput = {
  companyId?: string;
  newCompanyName?: string;
  industry: string;
  jobRole: string;
  experienceRange: string;
};

export type ProfileInput = {
  gender: string;
  genderDescription?: string;
  ageRange: string;
  regionCode: string;
  status: string;
  channel: string;
  interests: string[];
  analyticsConsent: boolean;
  school?: SchoolInput;
  employment?: EmploymentInput;
};

export type ProfileStatus = { complete: boolean; profile: (ProfileInput & { companyLabel?: string; schoolLabel?: string }) | null };

export type DemographicCount = { label: string; count: number };

export type DemographicBreakdown =
  | "gender" | "ageRange" | "region" | "status" | "school" | "company" | "industry" | "interest" | "channel";

export type Demographics = {
  respondents: number;
  consented: number;
  minimumGroupSize: number;
  breakdowns: Record<DemographicBreakdown, DemographicCount[]>;
};

export const SELF_DESCRIBE = "self_describe";
export const UNLISTED_SCHOOL = "unlisted";

export const needsSchool = (status: string) => status === "student" || status === "student_professional";
export const needsEmployment = (status: string) => status === "professional" || status === "student_professional";
