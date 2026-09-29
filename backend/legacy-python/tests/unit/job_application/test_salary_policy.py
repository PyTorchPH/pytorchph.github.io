from resume_builder.job_application import (
    JobLevel,
    SalaryBand,
    allocate_salary_targets,
    classify_job_level,
    parse_salary_signal,
)


def test_twenty_application_mix_allocates_exact_slots():
    assert allocate_salary_targets(20) == {
        SalaryBand.BELOW_20K: 7,
        SalaryBand.PHP_20K_40K: 10,
        SalaryBand.PHP_40K_80K: 2,
        SalaryBand.PHP_80K_PLUS: 1,
    }


def test_salary_parser_uses_disclosed_minimum_and_exact_boundaries():
    range_value = parse_salary_signal("PHP 20,000 - PHP 40,000 a month")
    high = parse_salary_signal("₱80k monthly")

    assert range_value.monthly_min_php == 20_000
    assert range_value.monthly_max_php == 40_000
    assert range_value.band == SalaryBand.PHP_20K_40K
    assert high.band == SalaryBand.PHP_80K_PLUS


def test_salary_parser_normalizes_annual_but_not_unsupported_periods():
    annual = parse_salary_signal("PHP 480,000 per year")
    hourly = parse_salary_signal("PHP 250 per hour")
    foreign = parse_salary_signal("USD 1,000 monthly")

    assert annual.monthly_min_php == 40_000
    assert annual.band == SalaryBand.PHP_40K_80K
    assert hourly.band == SalaryBand.UNKNOWN
    assert foreign.band == SalaryBand.UNKNOWN


def test_job_level_requires_explicit_early_career_evidence():
    assert classify_job_level("Software Engineering Intern") == JobLevel.INTERN
    assert classify_job_level("Junior Python Developer") == JobLevel.JUNIOR
    assert classify_job_level("Python Developer") == JobLevel.UNKNOWN
