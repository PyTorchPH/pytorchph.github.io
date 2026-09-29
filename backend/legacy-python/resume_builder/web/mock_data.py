"""Mock data for the CareerLens AI prototype UI."""

from __future__ import annotations


PROTOTYPE_DATA = {
    "student": {
        "name": "Juan Dela Cruz",
        "program": "4th Year BS Computer Science",
        "school": "FEU Tech",
        "target_role": "Full-Stack Development Internship",
        "readiness_score": 82,
        "resume_version": "ATS Internship Resume",
    },
    "phase_summary": {
        "active": "Development and Testing",
        "scope": (
            "Current prototype work is limited to implementation and validation: "
            "source import, visible scraping, extraction, resume generation, and QA."
        ),
        "visual_command": "resume-build scrape --visual --delay-ms 900",
    },
    "auth": {
        "identity_providers": [
            {
                "id": "github",
                "name": "GitHub",
                "detail": "Fast developer identity for repos and prefilled social login email.",
            },
            {
                "id": "google",
                "name": "Google",
                "detail": "Student identity option for future Drive, certificate, and email imports.",
            },
            {
                "id": "microsoft",
                "name": "Microsoft",
                "detail": "School account option for future OneDrive and campus identity integrations.",
            },
        ],
        "social_vendors": [
            {
                "id": "facebook",
                "name": "Facebook",
                "detail": "Opens visible browser login, then stores Playwright session state.",
            },
            {
                "id": "linkedin",
                "name": "LinkedIn",
                "detail": "Uses the identity email as prefill, then reuses saved session for scraping.",
            },
        ],
    },
    "development_phase": [
        {
            "name": "Source connectors",
            "status": "In development",
            "detail": "GitHub API, resume upload, and authorized social session import.",
        },
        {
            "name": "Visible scraping workflow",
            "status": "Working path",
            "detail": "Headed Chromium, slow motion, highlighted selectors, scroll-to-load feed capture.",
        },
        {
            "name": "Career intelligence pipeline",
            "status": "Prototype",
            "detail": "Cleaning, deduplication, tagging, career graph nodes, and role-targeted resume output.",
        },
        {
            "name": "Advisor workspace",
            "status": "Prototype",
            "detail": "Readiness score, missing evidence, review queue, and student recommendation summary.",
        },
    ],
    "testing_phase": [
        {
            "name": "Scrape visibility QA",
            "status": "Manual + automated",
            "detail": "Tester must see navigation, scrolling, highlighted posts, captured count, and final JSON.",
        },
        {
            "name": "Extraction accuracy",
            "status": "In progress",
            "detail": "Compare extracted achievements against source posts, repos, certificates, and resumes.",
        },
        {
            "name": "Resume relevance checks",
            "status": "In progress",
            "detail": "Verify that generated sections match the selected role and omit unrelated evidence.",
        },
        {
            "name": "Privacy and consent",
            "status": "Required gate",
            "detail": "Only authorized imports are tested; sessions are local and user controlled.",
        },
    ],
    "sources": [
        {
            "name": "GitHub",
            "count": 12,
            "status": "API import",
            "signal": "Repositories, README files, languages, contribution evidence",
        },
        {
            "name": "LinkedIn",
            "count": 18,
            "status": "Authorized scrape",
            "signal": "Posts, profile milestones, leadership and project updates",
        },
        {
            "name": "Facebook",
            "count": 9,
            "status": "User-approved scrape",
            "signal": "Hackathon posts, event photos, project announcements",
        },
        {
            "name": "Certificates",
            "count": 6,
            "status": "Uploaded",
            "signal": "Coursework, badges, and verified learning records",
        },
        {
            "name": "Previous Resume",
            "count": 1,
            "status": "Parsed",
            "signal": "Education, contact details, and baseline work history",
        },
    ],
    "scraping": {
        "vendor": "LinkedIn and Facebook",
        "mode": "Visible Playwright run",
        "command": "resume-build scrape --visual --delay-ms 900",
        "current_url": "https://www.linkedin.com/feed/",
        "items_seen": 27,
        "items_kept": 18,
        "screenshots": 6,
        "browser_posts": [
            {
                "source": "LinkedIn",
                "title": "Hackathon finalist announcement",
                "body": "Built a campus event prototype with React, FastAPI, and PostgreSQL.",
                "tag": "Achievement",
            },
            {
                "source": "Facebook",
                "title": "Project demo post",
                "body": "Shared screenshots from the student organization workflow pilot.",
                "tag": "Leadership",
            },
            {
                "source": "GitHub",
                "title": "campus-event-platform",
                "body": "Repository README documents auth, event registration, and admin analytics.",
                "tag": "Project",
            },
        ],
        "steps": [
            {
                "name": "Open saved session",
                "detail": "Launches real Chrome with stored user-approved session state.",
                "artifact": "storage_state.json loaded",
            },
            {
                "name": "Navigate source feed",
                "detail": "Highlights the page body and waits for the authenticated feed to render.",
                "artifact": "loaded page screenshot",
            },
            {
                "name": "Scroll and collect batches",
                "detail": "Scrolls until post cards stop growing; each batch is highlighted before capture.",
                "artifact": "27 visible items inspected",
            },
            {
                "name": "Filter professional evidence",
                "detail": "Keeps achievements, project posts, leadership items, and certificates.",
                "artifact": "18 career signals retained",
            },
            {
                "name": "Save traceable output",
                "detail": "Stores JSON plus screenshots so testers can compare source screen to extracted text.",
                "artifact": "out/linkedin.json + screenshots",
            },
        ],
        "evidence": [
            {
                "source": "LinkedIn post",
                "captured": "Hackathon finalist, React/FastAPI project, team delivery",
                "mapped_to": "Achievements, Projects, Skills",
                "confidence": 96,
            },
            {
                "source": "GitHub repository",
                "captured": "README, language mix, API structure, database schema",
                "mapped_to": "Projects, Technical Skills",
                "confidence": 91,
            },
            {
                "source": "Facebook event post",
                "captured": "Student organization workflow pilot and deployment screenshots",
                "mapped_to": "Leadership, Experience",
                "confidence": 84,
            },
            {
                "source": "Certificate upload",
                "captured": "Cloud fundamentals completion record",
                "mapped_to": "Certifications, Skill gaps",
                "confidence": 78,
            },
        ],
    },
    "career_nodes": [
        {"label": "Hackathon Finalist", "type": "Achievement", "confidence": 96},
        {"label": "Campus Event Platform", "type": "Project", "confidence": 91},
        {"label": "React + FastAPI", "type": "Skill Cluster", "confidence": 89},
        {"label": "Student Org Tech Lead", "type": "Leadership", "confidence": 84},
        {"label": "Cloud Fundamentals", "type": "Certification", "confidence": 78},
    ],
    "resume_studio": {
        "format_controls": [
            {"label": "Template", "value": "ATS Compact"},
            {"label": "Section order", "value": "Summary, Skills, Projects, Experience"},
            {"label": "Emphasis mode", "value": "Full-stack internship"},
            {"label": "Export targets", "value": "HTML, JSON, Markdown, PDF, LaTeX"},
        ],
        "injection_slots": [
            {
                "key": "summary",
                "value": "Preview-only: inject role-targeted profile summary.",
            },
            {
                "key": "skills",
                "value": "Preview-only: inject normalized technical skill clusters.",
            },
            {
                "key": "projects",
                "value": "Preview-only: inject selected role-relevant project evidence.",
            },
            {
                "key": "advisor_tags",
                "value": "Preview-only: inject CDO Advisor competency tags.",
            },
        ],
    },
    "resume_sections": [
        {
            "name": "Profile Summary",
            "status": "Ready",
            "detail": "Positioned for internships with software delivery and leadership evidence.",
        },
        {
            "name": "Projects",
            "status": "Strong",
            "detail": "4 projects selected from 12 repositories based on role relevance.",
        },
        {
            "name": "Experience",
            "status": "Needs numbers",
            "detail": "Add metrics for event attendance, user count, or delivery timeline.",
        },
        {
            "name": "Skills",
            "status": "Ready",
            "detail": "Grouped by frontend, backend, database, and developer tooling.",
        },
    ],
    "recommendations": [
        {
            "title": "Add measurable project outcomes",
            "priority": "High",
            "detail": "Use deployment count, active users, performance gains, or team size.",
        },
        {
            "title": "Close the cloud deployment gap",
            "priority": "Medium",
            "detail": "Complete one cloud-hosted project and document CI/CD steps.",
        },
        {
            "title": "Prepare interview stories",
            "priority": "Medium",
            "detail": "Convert hackathon and org work into STAR-format examples.",
        },
    ],
    "cdo": {
        "advisor": "Maria Santos",
        "queue": 36,
        "ready": 21,
        "needs_review": 9,
        "at_risk": 6,
        "insight": "Most students have project evidence but weak quantified impact statements.",
    },
    "advisor_demo": {
        "student_id": "demo-student",
        "target_role": "Full-Stack Development Internship",
        "achievements": [
            {
                "id": "ach-1",
                "title": "Campus event platform",
                "source": "GitHub repository",
                "text": (
                    "Built a React and FastAPI campus event platform with PostgreSQL, "
                    "admin analytics, and registration workflow."
                ),
                "url": "https://github.com/demo/campus-event-platform",
            },
            {
                "id": "ach-2",
                "title": "Hackathon finalist",
                "source": "LinkedIn post",
                "text": (
                    "Reached hackathon finals by delivering a working student services "
                    "prototype with a four-person team."
                ),
            },
            {
                "id": "ach-3",
                "title": "Student organization workflow pilot",
                "source": "Facebook event post",
                "text": (
                    "Led a student organization workflow tool pilot and posted deployment "
                    "screenshots from the event operations team."
                ),
            },
        ],
        "mcq_answers": {},
    },
}
