CREATE TABLE campus_chapters (
 id TEXT PRIMARY KEY,
 university TEXT NOT NULL CHECK(length(university) BETWEEN 1 AND 200),
 chapter TEXT NOT NULL CHECK(length(chapter) BETWEEN 1 AND 200),
 island TEXT NOT NULL CHECK(island IN ('Luzon','Visayas','Mindanao')),
 status TEXT NOT NULL CHECK(status IN ('active','forming','paused')),
 updated_at TEXT NOT NULL
);
CREATE TABLE campus_chapter_leads (
 chapter_id TEXT PRIMARY KEY REFERENCES campus_chapters(id) ON DELETE CASCADE,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE
);
CREATE INDEX campus_chapter_leads_member ON campus_chapter_leads(member_id);
