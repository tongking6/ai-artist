from __future__ import annotations


class DomainError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.retryable = retryable


def task_not_found() -> DomainError:
    return DomainError(404, "task_not_found", "Task not found.")
