# Officer event schedules

Saklaw: public learning-calendar schedules sa runtime database, hindi scored competitions o repository seed data.

- MCP: event_schedule_list (optional after cursor), event_schedule_create.
- CLI: schedule-list; schedule-create --file FILE --write --confirm.
- Create fields: id, title, startsAt, series, modules, confirm=true. Walang caller-controlled author, publication grant, o consent fields.
- YYYY-MM-DD: confirmed day, walang iniimbentong oras.
- YYYY-MM: tentative month; ipinapakita hanggang katapusan ng buwan, walang iniimbentong araw.
- ID: 1–80 lowercase ASCII letters, digits, hyphen o underscore. Title/series: hanggang 200 UTF-8 bytes; modules: hanggang 1000 bytes.
- Parehong ID at content: created=false. Ibang content, inactive ID o scored-event ID collision: 409; walang overwrite.
- Kailangan ang officer session, completed onboarding, publication grant, current officer_assistant consent, write opt-in at confirmation.
- Tinitingnan ang grant at consent sa write transaction. New insert lang ang may audit row.
- List: hanggang 20 active/public rows bawat page; nextCursor=null kapag wala nang kasunod.
- Ang purpose-bound AI projection ay public calendar fields lang; walang member identity, email, creator, private drafts o scoring data.
- Ginagamit ang existing featured_learning_events table. Walang bagong schema migration o hardcoded event insertion.
- Hindi auto-granted ang permissions/consent. Hindi ginagamit ang human-raw bypass.
- Live verification: MCP identity → list lahat ng pages → create missing schedules → list/read-back. Itala ang created IDs; hiwalay na approval ang deletion.

Reference: [MCP annotations are hints, not authorization](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/).
