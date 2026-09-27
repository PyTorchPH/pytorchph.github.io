from __future__ import annotations
from resume_builder.job_application.field_mapping import (
    total_years_experience, degree_to_enum, build_detected_field,
)
from resume_builder.job_application.models import DetectedField, MissingInformation

def test_total_years_normal():
    assert total_years_experience([(0, 2.5), (3, 5)]) == 4.5

def test_total_years_negative_clamped():
    assert total_years_experience([(5, 3)]) == 0.0

def test_total_years_empty():
    assert total_years_experience([]) == 0.0

def test_total_years_merges_overlapping_jobs():
    assert total_years_experience([(0, 3), (2, 4)]) == 4.0

def test_degree_to_enum_bachelor():
    result = degree_to_enum("BS Computer Science", ["High School", "Bachelor's", "Master's"])
    assert result == "Bachelor's"

def test_degree_to_enum_master():
    result = degree_to_enum("Master of Science", ["High School", "Bachelor's", "Master's"])
    assert result == "Master's"

def test_degree_to_enum_no_match():
    result = degree_to_enum("Alien Degree", ["High School", "Bachelor's"])
    assert result is None

def test_build_detected_field_salary_judgment():
    result = build_detected_field("salary", "Expected salary", "text", True, None)
    assert isinstance(result, MissingInformation)
    assert result.reason == "judgment field"

def test_build_detected_field_email_not_in_ncd():
    result = build_detected_field("email", "Email", "email", True, None)
    assert isinstance(result, MissingInformation)
    assert result.reason == "not in NCD"

def test_build_detected_field_email_valid():
    result = build_detected_field("email", "Email", "email", True, "john@example.com")
    assert isinstance(result, DetectedField)
    assert result.mapped_value == "john@example.com"
    assert result.confidence == 0.95

def test_build_detected_field_visa_judgment():
    result = build_detected_field("visa_sponsorship", "Visa Sponsorship", "radio", False, "no")
    assert isinstance(result, MissingInformation)
    assert result.reason == "judgment field"
