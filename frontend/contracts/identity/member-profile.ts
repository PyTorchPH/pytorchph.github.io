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

// label: name with campus ("Sacred Heart College - Lucena"); detail: "SHC · Lucena City, Quezon · College / university".
export type SchoolOption = { code: string; label: string; detail: string; acronym: string; level: string; sector: string; city: string; province: string };
// verified: from the company directory (Wikidata, GLEIF, PSE, curated); false when added by a member.
export type CompanyOption = { id: string; label: string; detail: string; aliases: string; city: string; verified: boolean };
export type ProgramOption = { code: string; label: string; shortName: string; group: string };

export type SchoolInput = {
  code: string;
  unlistedName?: string;
  level: string;
  /** Catalog program/strand code (GET /reference/programs), or UNLISTED_PROGRAM; omitted for elementary. */
  programCode?: string;
  /** The typed name when programCode is UNLISTED_PROGRAM. */
  unlistedProgram?: string;
  /** Grade for basic education, year level after it; see SCHOOL_LEVEL_RULES. */
  yearLevel: number;
};

// programLabel null: the level has no program. wholeList: its programs fit a dropdown (else search).
export type SchoolLevelRule = { yearLabel: string; min: number; max: number; programLabel: string | null; wholeList: boolean };

// Mirrors the API (member_profile/input.rs level_rule) and the member_education CHECK.
export const SCHOOL_LEVEL_RULES: Record<string, SchoolLevelRule> = {
  elementary: { yearLabel: "Grade", min: 1, max: 6, programLabel: null, wholeList: false },
  junior_high: { yearLabel: "Grade", min: 7, max: 10, programLabel: "Program", wholeList: true },
  senior_high: { yearLabel: "Grade", min: 11, max: 12, programLabel: "Strand", wholeList: true },
  undergraduate: { yearLabel: "Year level", min: 1, max: 8, programLabel: "Program / course", wholeList: false },
  graduate: { yearLabel: "Year level", min: 1, max: 8, programLabel: "Program", wholeList: false },
  technical_vocational: { yearLabel: "Year level", min: 1, max: 8, programLabel: "Qualification", wholeList: false },
};

export const schoolLevelRule = (level: string): SchoolLevelRule => SCHOOL_LEVEL_RULES[level] ?? SCHOOL_LEVEL_RULES.undergraduate;

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
  /** Exact age in years (13–100); omitted when agePreferNotToSay is true. */
  age?: number;
  agePreferNotToSay?: boolean;
  regionCode: string;
  status: string;
  channel: string;
  interests: string[];
  analyticsConsent: boolean;
  school?: SchoolInput;
  employment?: EmploymentInput;
};

export type ProfileStatus = { complete: boolean; profile: (ProfileInput & { companyLabel?: string; schoolLabel?: string; programLabel?: string }) | null };

export type DemographicCount = { label: string; count: number };

export type DemographicBreakdown =
  | "gender" | "ageRange" | "region" | "status" | "school" | "program" | "company" | "industry" | "interest" | "channel";

export type Demographics = {
  respondents: number;
  consented: number;
  minimumGroupSize: number;
  breakdowns: Record<DemographicBreakdown, DemographicCount[]>;
};

export const SELF_DESCRIBE = "self_describe";
export const UNLISTED_SCHOOL = "unlisted";
export const UNLISTED_PROGRAM = "unlisted";

export const needsSchool = (status: string) => status === "student" || status === "student_professional";
export const needsEmployment = (status: string) => status === "professional" || status === "student_professional";
