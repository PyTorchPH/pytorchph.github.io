# Events

One file per event. The Community page groups them by `type` and shows upcoming events only.

```yaml
---
title: "Event name"
type: workshop        # workshop | hackathon | study-group | talk (see _data/event_groups.yml)
date: 2026-11-14 09:00:00 +0800
location: "Manila"    # a city, or "Online"
format: "In person"   # In person | Online | Hybrid
summary: "One sentence on what people will do."
link: "https://..."   # optional registration page
sample: true          # only for placeholder events; remove the file when real events exist
---
```

Files with `sample: true` are placeholders. The page labels each one "Sample" and shows a notice.
Delete them once real events are listed.
