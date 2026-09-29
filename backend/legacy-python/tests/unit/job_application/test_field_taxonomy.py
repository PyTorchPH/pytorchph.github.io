from __future__ import annotations
from resume_builder.job_application.field_taxonomy import normalize_label, is_judgment_field

def test_mobile_no_maps_to_phone():
    assert normalize_label("Mobile no.") == "phone"

def test_contact_hash_maps_to_phone():
    assert normalize_label("Contact #") == "phone"

def test_cell_maps_to_phone():
    assert normalize_label("Cell") == "phone"

def test_linkedin_url_maps_to_linkedin():
    assert normalize_label("LinkedIn URL") == "linkedin"

def test_unknown_label_returns_none():
    assert normalize_label("gibberish xyz 999") is None

def test_is_judgment_field_salary():
    assert is_judgment_field("salary") is True

def test_is_judgment_field_email():
    assert is_judgment_field("email") is False

def test_email_address_maps_to_email():
    assert normalize_label("Email address") == "email"

def test_expected_salary_maps_to_salary():
    assert normalize_label("Expected salary") == "salary"

def test_work_authorization_maps():
    assert normalize_label("Work authorization") == "work_authorization"
