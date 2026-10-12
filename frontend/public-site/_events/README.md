# Public event listings

Published upcoming events and learning programs are managed in the officer portal at `/portal/admin/website/`, linked from Event Workflow. They are delivered by `/public/site-content`; the homepage does not read these legacy sample files.

- Enter title, topic, event/program type, venue/platform, registration URL and date status.
- Use `confirmed` only with a valid date; unconfirmed dates use `tentative` or `coming_soon`.
- Public listings sort known upcoming dates chronologically; undated items follow them.
- Publication requires the configured number of distinct current presidents (default 2).
- The existing dated sample Markdown files are retained for provenance with `published: false`; they are not real community schedules.
- Operational competition/scoring events remain in Event Workflow. Public training listings use the content editor so an announcement does not create synthetic competition records.
