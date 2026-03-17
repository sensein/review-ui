from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from . import papers as paper_svc
from .models import Review

router = APIRouter(prefix="/api")

# Cache discovered papers (refreshed on restart)
_papers_cache: list[dict] | None = None


def _get_papers() -> list[dict]:
    global _papers_cache
    if _papers_cache is None:
        _papers_cache = paper_svc.discover_papers()
    return _papers_cache


def _find_paper(paper_id: str, run_id: str) -> dict:
    for p in _get_papers():
        if p["paper_id"] == paper_id and p["run_id"] == run_id:
            return p
    raise HTTPException(404, "Paper/run not found")


@router.get("/papers")
def list_papers():
    results = []
    for p in _get_papers():
        claims = paper_svc.load_claims(p["claims_path"])
        evals = paper_svc.load_eval(p["eval_path"])
        review = paper_svc.load_review(p["paper_id"], p["run_id"])
        results.append({
            "paper_id": p["paper_id"],
            "run_id": p["run_id"],
            "title": p["title"],
            "claims_count": len(claims),
            "results_count": len(evals),
            "review_status": review.get("status", "not_started") if review else "not_started",
        })
    return results


@router.get("/papers/{paper_id}/{run_id}/results")
def get_results(paper_id: str, run_id: str):
    p = _find_paper(paper_id, run_id)
    claims = paper_svc.load_claims(p["claims_path"])
    evals = paper_svc.load_eval(p["eval_path"])

    claims_by_id = {c["claim_id"]: c for c in claims}
    for ev in evals:
        ev["claims"] = [claims_by_id[cid] for cid in ev.get("claim_ids", []) if cid in claims_by_id]

    return evals


@router.get("/papers/{paper_id}/text")
def get_paper_text(paper_id: str):
    sections = paper_svc.extract_paper_text(paper_id)
    if not sections:
        raise HTTPException(404, "Paper text not found")
    return sections


@router.get("/papers/{paper_id}/{run_id}/review")
def get_review(paper_id: str, run_id: str):
    _find_paper(paper_id, run_id)  # validate exists
    review = paper_svc.load_review(paper_id, run_id)
    if review is None:
        raise HTTPException(404, "No review found")
    return review


@router.post("/papers/{paper_id}/{run_id}/review")
def save_review(paper_id: str, run_id: str, review: Review):
    _find_paper(paper_id, run_id)  # validate exists

    now = datetime.now(timezone.utc).isoformat()
    existing = paper_svc.load_review(paper_id, run_id)

    if existing:
        # Merge: update only provided result/claim reviews
        for rid, rr in review.results.items():
            existing.setdefault("results", {})[rid] = rr.model_dump()
        for cid, cr in review.claims.items():
            existing.setdefault("claims", {})[cid] = cr.model_dump()
        existing["updated_at"] = now
        if review.reviewer:
            existing["reviewer"] = review.reviewer
        if review.status:
            existing["status"] = review.status
        paper_svc.save_review(paper_id, run_id, existing)
        return existing
    else:
        data = review.model_dump()
        data["started_at"] = now
        data["updated_at"] = now
        if not data["status"] or data["status"] == "not_started":
            data["status"] = "in_progress"
        paper_svc.save_review(paper_id, run_id, data)
        return data


@router.post("/papers/refresh")
def refresh_papers():
    global _papers_cache
    _papers_cache = None
    return {"status": "ok", "count": len(_get_papers())}
