from __future__ import annotations

from ai_artist.models import Base


def test_m1_uses_exactly_four_application_tables() -> None:
    assert set(Base.metadata.tables) == {"tasks", "assets", "attempts", "artifacts"}


def test_attempts_table_contains_queue_and_lease_constraints() -> None:
    attempts = Base.metadata.tables["attempts"]
    assert {index.name for index in attempts.indexes} >= {
        "attempts_one_active_per_task_idx",
        "attempts_queue_idx",
        "attempts_expired_lease_idx",
        "attempts_task_history_idx",
    }
    assert {constraint.name for constraint in attempts.constraints} >= {
        "attempts_status_fields_ck",
        "attempts_provider_ck",
        "attempts_refinement_ck",
    }


def test_task_current_attempt_reference_is_deferred() -> None:
    tasks = Base.metadata.tables["tasks"]
    constraint = next(
        constraint
        for constraint in tasks.foreign_key_constraints
        if constraint.name == "tasks_current_attempt_fk"
    )
    assert constraint.deferrable is True
    assert constraint.initially == "DEFERRED"
