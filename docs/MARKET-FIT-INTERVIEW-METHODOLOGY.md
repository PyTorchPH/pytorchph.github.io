# Market Fit and Interview Methodology

## Purpose and boundary

The market-fit workspace is a personal decision-support and learning system. It does not claim to
predict an employer's decision from a resume, diagnose a candidate, or provide a universal fit
score. It records a falsifiable pre-application fit profile, then compares that profile with the
candidate's observed recruiter, HR-interview, technical-interview, and offer outcomes.

The system is deliberately separate from submission confirmation. The existing application
history remains the source of truth for whether an application was observably submitted and for
30-day duplicate prevention. Market-fit records may import that confirmed event, but they do not
change application permissions, browser gates, or submission status.

## Research constructs used

### Person-job fit

Cable and DeRue distinguish demands-abilities fit from needs-supplies fit and provide evidence that
people perceive them as separate constructs. The workspace preserves that separation:

- **Demands-abilities:** employer-stated skills, responsibilities, experience, education, and
  portfolio demands compared with bounded, cited Resume/NCD evidence.
- **Needs-supplies:** observed salary, work mode, geography, and employment type compared with the
  user's explicit campaign preferences.
- **Eligibility:** explicit access constraints are shown independently so an average cannot hide a
  degree, authorization, country, or work-mode conflict.

The broader fit literature associates person-job fit with applicant and work outcomes, but does
not establish one universal resume-to-callback formula. The implementation therefore returns
`pass/conflict/unknown`, `complete/partial/unsubstantiated/unknown`, and
`aligned/mixed/conflict/unknown` rather than a synthetic 0–100 score.

References:

- Cable, D. M., & DeRue, D. S. (2002). *The convergent and discriminant validity of subjective fit
  perceptions*. Journal of Applied Psychology, 87(5), 875–884.
  <https://doi.org/10.1037/0021-9010.87.5.875>
- Kristof-Brown, A. L., Zimmerman, R. D., & Johnson, E. C. (2005). *Consequences of individuals'
  fit at work: A meta-analysis of person-job, person-organization, person-group, and
  person-supervisor fit*. Personnel Psychology, 58(2), 281–342.
  <https://doi.org/10.1111/j.1744-6570.2005.00672.x>

### Job-search quality

Van Hooft, Van Hoye, and van den Hee validated a four-dimensional Job Search Quality Scale:
goal establishment and planning, preparation and alignment, emotion regulation and persistence,
and learning and improvement. The workspace operationalizes the portions appropriate for a local
software tool:

- an editable time-bounded campaign and track allocation;
- verified alignment between each job and candidate evidence;
- a persistent funnel rather than application-volume-only metrics;
- weekly bottleneck feedback based on observed outcomes;
- cited interview preparation and reviewable gaps.

The software does not reproduce or administer the published 20-item psychometric scale.

Reference: van Hooft, E. A. J., Van Hoye, G., & van den Hee, S. M. (2022). *How to optimize the job
search process: Development and validation of the Job Search Quality Scale*. Journal of Career
Assessment, 30(3), 474–505. <https://doi.org/10.1177/10690727211052812>

### Degree requirements and skills-based language

Degree requirements are treated as observed market-access constraints, not evidence that a
candidate lacks technical ability. Conversely, the phrase "skills-based hiring" is not treated as
proof that an employer actually hires candidates without degrees. Employer-level research reports
a gap between removing degree language and changing hiring outcomes, so the personal funnel must
measure the candidate's actual response rate rather than assume the posting language is decisive.

Reference: Fuller, J. B., Raman, M., et al. (2024). *Skills-Based Hiring: The Long Road from
Pronouncements to Practice*. Burning Glass Institute and Harvard Business School.
<https://www.hbs.edu/managing-the-future-of-work/Documents/research/Skills-Based%20Hiring.pdf>

## Measurement rules

1. A provider-neutral model may draft structured demands from sanitized posting text, but a human
   must approve the demand profile before fit is assessed.
2. Evidence matches cite IDs from the selected generated Resume/NCD context. Missing, unknown, and
   conflicting facts stay visible; metrics and outcomes are never invented or estimated.
3. Funnel milestones are append-only. A direct technical invitation counts as a recruiter response
   for conversion analysis but does not create an HR-interview event.
4. No response becomes `ghosted` after the campaign's configured window (21 days by default). A
   later response reactivates the current status while retaining the ghosting event for audit.
5. Conversion rates show successes, resolved observations, pending observations, and a 95% Wilson
   interval. Strategy recommendations remain suppressed until the configured resolved-sample floor
   is reached.
6. Segment comparisons by track, automated/manual-tailored handling, or fit profile are descriptive.
   Applications are not randomized, so differences must not be described as causal effects.

## Interview preparation safety

Interview preparation receives only the verified demands and bounded career evidence relevant to
those demands. Every generated STAR candidate must cite accepted evidence IDs. Unsupported fields
remain blank with an explicit preparation gap. The validator rejects unknown citations and language
that presents estimated metrics as facts. The user reviews and approves the plan; approval never
authorizes an application action or final submission.
