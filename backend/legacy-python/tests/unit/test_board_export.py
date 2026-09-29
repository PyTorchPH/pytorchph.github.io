from __future__ import annotations

from tools.board_export import tasks_to_csv


def test_tasks_to_csv_header_and_rows():
    tasks = [{"title": "A,b", "stage": "Todo", "role": "AI"},
             {"title": "B", "stage": "Done", "role": "QA"}]
    csv = tasks_to_csv(tasks, fields=["title", "stage", "role"])
    lines = csv.splitlines()
    assert lines[0] == "title,stage,role"
    assert '"A,b",Todo,AI' in lines[1]   # comma-containing field is quoted
    assert "B,Done,QA" in lines[2]


def test_tasks_to_csv_missing_field_is_blank():
    csv = tasks_to_csv([{"title": "X"}], fields=["title", "stage"])
    assert csv.splitlines()[1] == "X,"
