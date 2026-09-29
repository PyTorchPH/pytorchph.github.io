from __future__ import annotations

import json

from ..core.models import Resume
from .base import Renderer
from . import brand_icons


class JsonRenderer(Renderer):
    extension = "json"

    def render(self, resume: Resume) -> str:
        # Parse pydantic's JSON (handles date serialisation) then inject contact_links.
        data: dict = json.loads(resume.model_dump_json(indent=None))

        contact = resume.contact
        contact_links = []
        for provider, url_val in [
            ("github", contact.github),
            ("linkedin", contact.linkedin),
            ("website", contact.website),
        ]:
            if url_val:
                prov, handle = brand_icons.declutter(url_val, provider)
                contact_links.append(
                    {"provider": prov or provider, "handle": handle, "url": url_val}
                )

        data["contact_links"] = contact_links
        return json.dumps(data, indent=2)
