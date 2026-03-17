from __future__ import annotations

from pydantic import BaseModel


class Claim(BaseModel):
    claim_id: str
    claim: str
    claim_type: str
    source: str
    source_type: list[str]
    evidence: str
    evidence_type: list[str]
    section: str | None = None


class Result(BaseModel):
    result_id: str
    claim_ids: list[str]
    result: str
    reviewer_id: str | None = None
    reviewer_name: str | None = None
    evaluation_type: str
    evaluation: str
    result_type: str
    claims: list[Claim] = []


class PaperSummary(BaseModel):
    paper_id: str
    run_id: str
    title: str
    claims_count: int
    results_count: int
    review_status: str  # "not_started" | "in_progress" | "complete"


class ResultReview(BaseModel):
    agreement: str | None = None
    override_evaluation_type: str | None = None
    override_result_type: str | None = None
    comment: str = ""
    flagged: bool = False


class Review(BaseModel):
    reviewer: str = ""
    started_at: str | None = None
    updated_at: str | None = None
    status: str = "not_started"
    results: dict[str, ResultReview] = {}
