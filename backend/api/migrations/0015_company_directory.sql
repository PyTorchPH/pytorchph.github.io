-- Companies become a searchable directory like schools. Verified rows come from the bundled seed
-- (seeds/reference/companies.tsv.gz: Wikidata, GLEIF, PSE, and the curated list); companies
-- members add stay searchable but are marked origin = 'member' (unverified). Unknown text is ''.
ALTER TABLE companies ADD COLUMN aliases TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN industry TEXT NOT NULL DEFAULT '';
-- LEI or SEC number when a source publishes it.
ALTER TABLE companies ADD COLUMN registration TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN origin TEXT NOT NULL DEFAULT 'member' CHECK (origin IN ('directory', 'curated', 'member'));

-- The hand-picked companies from migration 0011 have short slug ids; member-added ones are UUIDs.
UPDATE companies SET origin = 'curated' WHERE id LIKE 'co-%' AND length(id) < 36;

CREATE VIRTUAL TABLE company_search USING fts5(
  name, aliases, city,
  content = 'companies',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);

-- Keep the index in step with every insert, update, and delete (members add companies live).
CREATE TRIGGER companies_search_insert AFTER INSERT ON companies BEGIN
  INSERT INTO company_search(rowid, name, aliases, city) VALUES (new.rowid, new.name, new.aliases, new.city);
END;
CREATE TRIGGER companies_search_delete AFTER DELETE ON companies BEGIN
  INSERT INTO company_search(company_search, rowid, name, aliases, city) VALUES ('delete', old.rowid, old.name, old.aliases, old.city);
END;
CREATE TRIGGER companies_search_update AFTER UPDATE ON companies BEGIN
  INSERT INTO company_search(company_search, rowid, name, aliases, city) VALUES ('delete', old.rowid, old.name, old.aliases, old.city);
  INSERT INTO company_search(rowid, name, aliases, city) VALUES (new.rowid, new.name, new.aliases, new.city);
END;

INSERT INTO company_search(company_search) VALUES ('rebuild');
