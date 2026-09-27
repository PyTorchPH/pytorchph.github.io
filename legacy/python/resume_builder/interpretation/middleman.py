from __future__ import annotations

from ..extraction.models import CleanedSource
from ..core.models import RawDocument
from .models import RetrievedSource


class RetrievalMiddleman:
    """The single entry that gathers every source type into RetrievedSource envelopes."""

    def gather(
        self,
        projects: list[CleanedSource] | None = None,
        documents: list[RawDocument] | None = None,
        posts: list[RetrievedSource] | None = None,
    ) -> list[RetrievedSource]:
        out: list[RetrievedSource] = []
        for cs in projects or []:
            if cs.text.strip():
                out.append(RetrievedSource(
                    source_id=cs.source_id, kind="project", title=cs.title,
                    text=cs.text, origin="github",
                ))
        for doc in documents or []:
            if doc.text.strip():
                out.append(RetrievedSource(
                    source_id=doc.filename, kind="document", title=doc.filename,
                    text=doc.text, origin="upload",
                ))
        for post in posts or []:
            if post.text.strip():
                out.append(post if post.kind == "post" else post.model_copy(update={"kind": "post"}))
        return out
