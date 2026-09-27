"""Shared Harvard Resume philosophy fragment, injected into every generation
system prompt so the builder *produces* resumes that already embody these
principles rather than relying solely on the post-hoc review auditor."""

from __future__ import annotations

HARVARD_PRINCIPLES = """\
HARVARD RESUME PHILOSOPHY (apply to everything you write):
A recruiter spends only seconds per resume, so make it easy to see clear
evidence that this candidate creates value for the organization.
1. Optimize for rapid scanning: short, concrete phrasing; no walls of text.
2. Sell value, not activity: lead with strong action verbs and quantified,
   measurable results (e.g. "Coordinated 5 events for 1,000+ attendees",
   not "Helped organize events").
3. Be specific, not generic: concrete, evidenced statements beat self-praise
   (e.g. "Builds web apps with Laravel and MySQL", not "Hardworking team player").
4. It is a marketing document, not a biography: relevance beats completeness —
   omit weak or off-target content rather than padding.
5. Minimize cognitive load: concise bullets, plain wording, short links.
6. Demonstrate skills, don't claim them: support every claim with evidence
   ("Led a 6-member team to deliver the capstone 2 weeks early" shows leadership).
"""
