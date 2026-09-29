-- Organization structure and member profiles. No column is nullable: an answer that was not
-- given is a missing row, never a NULL. Codes such as region, industry, interest and school
-- point into the JSON catalogs in seeds/reference/ (validated by the API); everything a member
-- owns cascades with the member.

-- ---------------------------------------------------------------------------------------------
-- Organization: departments, positions, who reports to whom, and who holds each position.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE departments (
  slug TEXT PRIMARY KEY CHECK (length(slug) BETWEEN 2 AND 40),
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE positions (
  slug TEXT PRIMARY KEY CHECK (length(slug) BETWEEN 2 AND 60),
  title TEXT NOT NULL UNIQUE,
  department_slug TEXT NOT NULL REFERENCES departments(slug) ON DELETE CASCADE,
  -- 1 = head of the organization; larger numbers sit lower in the chart.
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 9)
);
CREATE INDEX positions_department_idx ON positions(department_slug);

-- Every position except the head reports to exactly one other position.
CREATE TABLE position_reports_to (
  position_slug TEXT PRIMARY KEY REFERENCES positions(slug) ON DELETE CASCADE,
  reports_to_slug TEXT NOT NULL REFERENCES positions(slug) ON DELETE CASCADE,
  CHECK (position_slug != reports_to_slug)
);
CREATE INDEX position_reports_to_parent_idx ON position_reports_to(reports_to_slug);

-- Positions that approve mail in the existing officer_roles routing.
CREATE TABLE position_approval_roles (
  position_slug TEXT PRIMARY KEY REFERENCES positions(slug) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('ambassador','secretariat','treasurer','external_relations','academics','executive','campus_lead'))
);

CREATE TABLE member_positions (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  position_slug TEXT NOT NULL REFERENCES positions(slug) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (member_id, position_slug)
);
CREATE INDEX member_positions_position_idx ON member_positions(position_slug);

-- Positions waiting for an email that has not signed in yet; claimed at first sign-in.
CREATE TABLE position_reservations (
  email TEXT NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  position_slug TEXT NOT NULL REFERENCES positions(slug) ON DELETE CASCADE,
  PRIMARY KEY (email, position_slug)
);

INSERT INTO departments(slug, name) VALUES
  ('executive', 'Executive Office'),
  ('technology', 'Technology'),
  ('operations', 'Operations'),
  ('secretariat', 'Secretariat'),
  ('finance', 'Finance'),
  ('marketing', 'Marketing and Communications'),
  ('outreach', 'Community and Outreach'),
  ('academics', 'Academics');

INSERT INTO positions(slug, title, department_slug, rank) VALUES
  ('president', 'President', 'executive', 1),
  ('vice_president', 'Vice President', 'executive', 2),
  ('foundation_ambassador', 'Foundation Ambassador', 'executive', 2),
  ('cto', 'Chief Technology Officer', 'technology', 2),
  ('coo', 'Chief Operating Officer', 'operations', 2),
  ('secretary_general', 'Secretary General', 'secretariat', 2),
  ('treasurer', 'Treasurer', 'finance', 2),
  ('cmo', 'Chief Marketing Officer', 'marketing', 2),
  ('head_partnerships_outreach', 'Head of Partnerships and Outreach', 'outreach', 2),
  ('head_learning_programs', 'Head of Learning Programs', 'academics', 2),
  ('engineering_lead', 'Engineering Lead', 'technology', 3),
  ('research_development_lead', 'Research and Development Lead', 'technology', 3),
  ('campus_labs_lead', 'Campus Labs Lead', 'technology', 3),
  ('operations_officer', 'Operations Officer', 'operations', 4),
  ('communications_officer', 'Communications Officer', 'marketing', 4),
  ('community_outreach_officer', 'Community Outreach Officer', 'outreach', 4),
  ('learning_programs_officer', 'Learning Programs Officer', 'academics', 4);

INSERT INTO position_reports_to(position_slug, reports_to_slug) VALUES
  ('vice_president', 'president'),
  ('foundation_ambassador', 'president'),
  ('cto', 'president'),
  ('coo', 'president'),
  ('secretary_general', 'president'),
  ('treasurer', 'president'),
  ('cmo', 'president'),
  ('head_partnerships_outreach', 'president'),
  ('head_learning_programs', 'president'),
  ('engineering_lead', 'cto'),
  ('research_development_lead', 'cto'),
  ('campus_labs_lead', 'cto'),
  ('operations_officer', 'coo'),
  ('communications_officer', 'cmo'),
  ('community_outreach_officer', 'head_partnerships_outreach'),
  ('learning_programs_officer', 'head_learning_programs');

INSERT INTO position_approval_roles(position_slug, role) VALUES
  ('president', 'executive'),
  ('vice_president', 'executive'),
  ('cto', 'executive'),
  ('coo', 'executive'),
  ('foundation_ambassador', 'ambassador'),
  ('secretary_general', 'secretariat'),
  ('treasurer', 'treasurer'),
  ('head_partnerships_outreach', 'external_relations'),
  ('head_learning_programs', 'academics'),
  ('campus_labs_lead', 'campus_lead');

-- Initial officers (claimed when each email first signs in).
INSERT INTO position_reservations(email, position_slug) VALUES
  ('alpharomercoma@proton.me', 'president'),
  ('alpharomercoma@proton.me', 'foundation_ambassador'),
  ('jbalbarosa15@gmail.com', 'cto'),
  ('lacapxyniljhed@gmail.com', 'community_outreach_officer');

-- ---------------------------------------------------------------------------------------------
-- Member profiles for demographics. Required answers live in member_profiles (each has a
-- "prefer not to say" choice, so nothing is NULL); conditional answers are their own tables.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE member_profiles (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  gender TEXT NOT NULL CHECK (gender IN ('female','male','non_binary','self_describe','prefer_not_to_say')),
  age_range TEXT NOT NULL CHECK (age_range IN ('under_18','18_24','25_34','35_44','45_plus','prefer_not_to_say')),
  region_code TEXT NOT NULL CHECK (length(region_code) BETWEEN 2 AND 12),
  status TEXT NOT NULL CHECK (status IN ('student','professional','student_professional','seeking','other')),
  channel TEXT NOT NULL CHECK (length(channel) BETWEEN 2 AND 40),
  completed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE member_gender_descriptions (
  member_id TEXT PRIMARY KEY REFERENCES member_profiles(member_id) ON DELETE CASCADE,
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 60)
);

-- A row exists only while the member agrees to anonymized analytics.
CREATE TABLE member_analytics_consents (
  member_id TEXT PRIMARY KEY REFERENCES member_profiles(member_id) ON DELETE CASCADE,
  consented_at TEXT NOT NULL
);

CREATE TABLE member_interests (
  member_id TEXT NOT NULL REFERENCES member_profiles(member_id) ON DELETE CASCADE,
  interest_code TEXT NOT NULL CHECK (length(interest_code) BETWEEN 2 AND 40),
  PRIMARY KEY (member_id, interest_code)
);
CREATE INDEX member_interests_code_idx ON member_interests(interest_code);

CREATE TABLE member_education (
  member_id TEXT PRIMARY KEY REFERENCES member_profiles(member_id) ON DELETE CASCADE,
  -- A CHED HEI code from seeds/reference/schools.json, or 'unlisted'.
  school_code TEXT NOT NULL CHECK (length(school_code) BETWEEN 3 AND 40),
  level TEXT NOT NULL CHECK (level IN ('senior_high','undergraduate','graduate','technical_vocational')),
  program TEXT NOT NULL CHECK (length(trim(program)) BETWEEN 1 AND 120),
  year_level INTEGER NOT NULL CHECK (year_level BETWEEN 1 AND 8)
);
CREATE INDEX member_education_school_idx ON member_education(school_code);

CREATE TABLE member_unlisted_schools (
  member_id TEXT PRIMARY KEY REFERENCES member_education(member_id) ON DELETE CASCADE,
  school_name TEXT NOT NULL CHECK (length(trim(school_name)) BETWEEN 2 AND 160)
);

-- Employers grow with the members: a curated start list plus companies members add.
CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(name)) BETWEEN 2 AND 120),
  created_at TEXT NOT NULL
);

CREATE TABLE member_employment (
  member_id TEXT PRIMARY KEY REFERENCES member_profiles(member_id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  industry_code TEXT NOT NULL CHECK (length(industry_code) BETWEEN 2 AND 40),
  job_role TEXT NOT NULL CHECK (length(trim(job_role)) BETWEEN 1 AND 120),
  experience_range TEXT NOT NULL CHECK (experience_range IN ('under_1','1_3','3_5','5_10','10_plus'))
);
CREATE INDEX member_employment_company_idx ON member_employment(company_id);

INSERT INTO companies(id, name, created_at) VALUES
  ('co-accenture', 'Accenture Philippines', '2026-09-30T00:00:00Z'),
  ('co-aboitiz', 'Aboitiz Group', '2026-09-30T00:00:00Z'),
  ('co-ayala', 'Ayala Corporation', '2026-09-30T00:00:00Z'),
  ('co-bdo', 'BDO Unibank', '2026-09-30T00:00:00Z'),
  ('co-bpi', 'Bank of the Philippine Islands (BPI)', '2026-09-30T00:00:00Z'),
  ('co-canva', 'Canva Philippines', '2026-09-30T00:00:00Z'),
  ('co-cebu-pacific', 'Cebu Pacific', '2026-09-30T00:00:00Z'),
  ('co-concentrix', 'Concentrix', '2026-09-30T00:00:00Z'),
  ('co-converge', 'Converge ICT Solutions', '2026-09-30T00:00:00Z'),
  ('co-deloitte', 'Deloitte Philippines (Navarro Amper & Co.)', '2026-09-30T00:00:00Z'),
  ('co-dito', 'DITO Telecommunity', '2026-09-30T00:00:00Z'),
  ('co-dost', 'Department of Science and Technology (DOST)', '2026-09-30T00:00:00Z'),
  ('co-dict', 'Department of Information and Communications Technology (DICT)', '2026-09-30T00:00:00Z'),
  ('co-exist', 'Exist Software Labs', '2026-09-30T00:00:00Z'),
  ('co-gcash', 'GCash (Mynt)', '2026-09-30T00:00:00Z'),
  ('co-globe', 'Globe Telecom', '2026-09-30T00:00:00Z'),
  ('co-grab', 'Grab Philippines', '2026-09-30T00:00:00Z'),
  ('co-ibm', 'IBM Philippines', '2026-09-30T00:00:00Z'),
  ('co-jg-summit', 'JG Summit Holdings', '2026-09-30T00:00:00Z'),
  ('co-jollibee', 'Jollibee Foods Corporation', '2026-09-30T00:00:00Z'),
  ('co-kalibrr', 'Kalibrr', '2026-09-30T00:00:00Z'),
  ('co-kpmg', 'KPMG Philippines (R.G. Manabat & Co.)', '2026-09-30T00:00:00Z'),
  ('co-lazada', 'Lazada Philippines', '2026-09-30T00:00:00Z'),
  ('co-maya', 'Maya', '2026-09-30T00:00:00Z'),
  ('co-meralco', 'Meralco', '2026-09-30T00:00:00Z'),
  ('co-metrobank', 'Metrobank', '2026-09-30T00:00:00Z'),
  ('co-microsoft', 'Microsoft Philippines', '2026-09-30T00:00:00Z'),
  ('co-pldt', 'PLDT', '2026-09-30T00:00:00Z'),
  ('co-pointwest', 'Pointwest', '2026-09-30T00:00:00Z'),
  ('co-pwc', 'PwC Philippines (Isla Lipana & Co.)', '2026-09-30T00:00:00Z'),
  ('co-san-miguel', 'San Miguel Corporation', '2026-09-30T00:00:00Z'),
  ('co-security-bank', 'Security Bank', '2026-09-30T00:00:00Z'),
  ('co-sgv', 'SGV & Co. (EY Philippines)', '2026-09-30T00:00:00Z'),
  ('co-shopee', 'Shopee Philippines', '2026-09-30T00:00:00Z'),
  ('co-sm', 'SM Investments Corporation', '2026-09-30T00:00:00Z'),
  ('co-smart', 'Smart Communications', '2026-09-30T00:00:00Z'),
  ('co-sprout', 'Sprout Solutions', '2026-09-30T00:00:00Z'),
  ('co-stratpoint', 'Stratpoint Technologies', '2026-09-30T00:00:00Z'),
  ('co-teleperformance', 'Teleperformance Philippines', '2026-09-30T00:00:00Z'),
  ('co-thinking-machines', 'Thinking Machines Data Science', '2026-09-30T00:00:00Z'),
  ('co-unionbank', 'UnionBank of the Philippines', '2026-09-30T00:00:00Z'),
  ('co-voyager', 'Voyager Innovations', '2026-09-30T00:00:00Z'),
  ('co-freelance', 'Freelance / self-employed', '2026-09-30T00:00:00Z'),
  ('co-government-other', 'Government agency (other)', '2026-09-30T00:00:00Z'),
  ('co-academe', 'University or school (as employer)', '2026-09-30T00:00:00Z');
