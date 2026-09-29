from __future__ import annotations

from resume_builder.extraction.models import CleanedSource
from resume_builder.interpretation.middleman import RetrievalMiddleman
from resume_builder.interpretation.models import RetrievedSource
from resume_builder.core.models import DocumentType, RawDocument


def test_gather_normalizes_all_kinds():
    projects = [CleanedSource(source_id="owner/repo:README.md", kind="github_readme",
                              title="README.md", text="Builds a PyTorch model.")]
    documents = [RawDocument(path="/cv.pdf", filename="cv.pdf", doc_type=DocumentType.PDF,
                             text="John — AI engineer.")]
    posts = [RetrievedSource(source_id="fb:1", kind="post", text="Won a hackathon.", origin="facebook")]

    out = RetrievalMiddleman().gather(projects=projects, documents=documents, posts=posts)
    kinds = {s.kind for s in out}
    assert kinds == {"project", "document", "post"}
    proj = next(s for s in out if s.kind == "project")
    assert proj.origin == "github" and "PyTorch" in proj.text
    doc = next(s for s in out if s.kind == "document")
    assert doc.origin == "upload" and doc.source_id == "cv.pdf"


def test_gather_skips_empty_text():
    projects = [CleanedSource(source_id="x", kind="github_readme", text="   ")]
    assert RetrievalMiddleman().gather(projects=projects) == []


def test_gather_skips_empty_document():
    docs = [RawDocument(path="/x.pdf", filename="x.pdf", doc_type=DocumentType.PDF, text="\n")]
    assert RetrievalMiddleman().gather(documents=docs) == []


def test_gather_skips_empty_post():
    posts = [RetrievedSource(source_id="x", kind="post", text="  ", origin="twitter")]
    assert RetrievalMiddleman().gather(posts=posts) == []
