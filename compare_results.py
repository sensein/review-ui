"""
compare_results.py — Compare CLLM eval_llm outputs across runs.

Operates at two levels:
  1. Result-level  — how similar are the grouped result descriptions?
  2. Claim-set-level — within each matched result pair, how similar are
                       the underlying claims attached to each result?

Usage:
    python compare_results.py \
        --runs papers/2018.01.003/20260407_pymupdf4llm_anthropic \
               papers/2018.01.003/20260407_segmented_anthropic \
               papers/2018.01.003/20260407_unsegmented_anthropic \
        --labels "pymupdf4llm" "segmented" "unsegmented"

    python compare_results.py --runs dir_a dir_b   # labels auto-generated

Each --runs entry is a run directory that contains eval_llm*.json and
claims*.json (naming varies; the script auto-discovers them via glob).

Outputs:
    compare_results_report.json — structured data + human-readable summary
                                  for each pairwise comparison

Dependencies:
    pip install scikit-learn
    Optional (better similarity): pip install sentence-transformers
"""

import json
import argparse
import itertools
from pathlib import Path
from collections import Counter
from dataclasses import dataclass, field

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# ── Optional: sentence-transformers for better semantic similarity ─────────────
def _load_st_model():
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer("all-MiniLM-L6-v2")

try:
    _ST_MODEL = _load_st_model()
    USE_SEMANTIC = True
except Exception:
    _ST_MODEL = None
    USE_SEMANTIC = False


# ── Data models ───────────────────────────────────────────────────────────────

@dataclass
class Result:
    result_id: str
    result: str                 # grouped result description text
    claim_ids: list[str]
    claim_texts: list[str]      # resolved from claims.json
    evaluation_type: str        # SUPPORTED | UNSUPPORTED
    result_type: str            # MAJOR | MINOR
    evaluation: str             # reviewer commentary


@dataclass
class MatchedClaimPair:
    claim_a: str
    claim_b: str
    similarity: float


@dataclass
class MatchedResultPair:
    id_a: str
    id_b: str
    result_a: str
    result_b: str
    result_similarity: float
    evaluation_type_match: bool
    result_type_match: bool
    # claim-set comparison within this matched result pair
    n_claims_a: int
    n_claims_b: int
    n_matched_claims: int
    claim_set_jaccard: float        # matched / union of claim counts
    avg_claim_similarity: float     # mean similarity of matched claim pairs
    matched_claim_pairs: list[MatchedClaimPair] = field(default_factory=list)


@dataclass
class PairwiseReport:
    label_a: str
    label_b: str
    n_results_a: int
    n_results_b: int
    matched_pairs: list[MatchedResultPair] = field(default_factory=list)
    unmatched_a: list[str] = field(default_factory=list)  # result texts
    unmatched_b: list[str] = field(default_factory=list)
    # result-level aggregate metrics
    avg_result_similarity: float = 0.0
    result_match_rate: float = 0.0
    evaluation_type_agreement: float = 0.0
    result_type_agreement: float = 0.0
    # claim-set aggregate metrics
    avg_claim_set_jaccard: float = 0.0
    avg_claim_similarity: float = 0.0
    # distributions
    distribution_a: dict = field(default_factory=dict)
    distribution_b: dict = field(default_factory=dict)


# ── File discovery ─────────────────────────────────────────────────────────────

def find_json(run_dir: Path, prefix: str) -> Path:
    """Find the first JSON file in run_dir whose name starts with prefix."""
    matches = sorted(run_dir.glob(f"{prefix}*.json"))
    if not matches:
        raise FileNotFoundError(
            f"No file matching '{prefix}*.json' found in {run_dir}"
        )
    return matches[0]


# ── Loaders ───────────────────────────────────────────────────────────────────

def load_claims_map(run_dir: Path) -> dict[str, str]:
    """Return {claim_id: claim_text} from claims*.json in run_dir."""
    path = find_json(run_dir, "claims")
    with open(path) as f:
        raw = json.load(f)
    return {item["claim_id"]: item.get("claim", "") for item in raw}


def load_results(run_dir: Path) -> list[Result]:
    """Load eval_llm*.json from run_dir, resolving claim IDs to claim texts."""
    path = find_json(run_dir, "eval_llm")
    with open(path) as f:
        raw = json.load(f)

    claims_map = load_claims_map(run_dir)

    results = []
    for item in raw:
        claim_ids = item.get("claim_ids", [])
        results.append(Result(
            result_id=item.get("result_id", ""),
            result=item.get("result", ""),
            claim_ids=claim_ids,
            claim_texts=[claims_map.get(cid, "") for cid in claim_ids],
            evaluation_type=item.get("evaluation_type", ""),
            result_type=item.get("result_type", ""),
            evaluation=item.get("evaluation", ""),
        ))
    return results


# ── Embedding ─────────────────────────────────────────────────────────────────

def embed(texts: list[str]) -> np.ndarray:
    """Return embedding matrix (n_texts × dim)."""
    if not texts:
        return np.empty((0, 1))
    if USE_SEMANTIC:
        return _ST_MODEL.encode(texts, show_progress_bar=False)
    vec = TfidfVectorizer(ngram_range=(1, 2), min_df=1)
    try:
        return vec.fit_transform(texts).toarray()
    except ValueError:
        # Empty vocabulary (all texts are empty or contain only stop words)
        return np.zeros((len(texts), 1))


# ── Greedy matching ───────────────────────────────────────────────────────────

def greedy_match_texts(
    texts_a: list[str],
    texts_b: list[str],
    threshold: float,
) -> tuple[list[tuple[int, int, float]], set[int], set[int]]:
    """
    Greedy bipartite matching by cosine similarity.
    Returns (matched_index_pairs_with_sim, matched_a_indices, matched_b_indices).
    """
    if not texts_a or not texts_b:
        return [], set(), set()

    all_texts = texts_a + texts_b
    embeddings = embed(all_texts)
    emb_a = embeddings[:len(texts_a)]
    emb_b = embeddings[len(texts_a):]

    sim_matrix = cosine_similarity(emb_a, emb_b)

    flat = [
        (sim_matrix[i, j], i, j)
        for i in range(len(texts_a))
        for j in range(len(texts_b))
    ]
    flat.sort(reverse=True)

    matched_a: set[int] = set()
    matched_b: set[int] = set()
    pairs: list[tuple[int, int, float]] = []

    for sim, i, j in flat:
        if sim < threshold:
            break
        if i in matched_a or j in matched_b:
            continue
        matched_a.add(i)
        matched_b.add(j)
        pairs.append((i, j, float(sim)))

    return pairs, matched_a, matched_b


# ── Claim-set comparison for a matched result pair ────────────────────────────

def compare_claim_sets(
    claims_a: list[str],
    claims_b: list[str],
    threshold: float,
) -> tuple[float, float, list[MatchedClaimPair]]:
    """
    Compare the claims attached to two matched results.

    Returns:
        claim_set_jaccard  — matched_count / union_count
        avg_claim_sim      — mean similarity of matched claim pairs
        matched_pairs      — list of MatchedClaimPair
    """
    if not claims_a and not claims_b:
        return 1.0, 1.0, []
    if not claims_a or not claims_b:
        return 0.0, 0.0, []

    pairs, matched_a, matched_b = greedy_match_texts(claims_a, claims_b, threshold)

    n_matched = len(pairs)
    union = len(claims_a) + len(claims_b) - n_matched
    jaccard = n_matched / union if union > 0 else 0.0
    avg_sim = float(np.mean([s for _, _, s in pairs])) if pairs else 0.0

    matched_pairs = [
        MatchedClaimPair(
            claim_a=claims_a[i],
            claim_b=claims_b[j],
            similarity=round(s, 4),
        )
        for i, j, s in pairs
    ]

    return round(jaccard, 4), round(avg_sim, 4), matched_pairs


# ── Distributions ─────────────────────────────────────────────────────────────

def distributions(results: list[Result]) -> dict:
    return {
        "evaluation_type": dict(Counter(r.evaluation_type for r in results)),
        "result_type": dict(Counter(r.result_type for r in results)),
    }


# ── Pairwise comparison ───────────────────────────────────────────────────────

def compare_pair(
    label_a: str, results_a: list[Result],
    label_b: str, results_b: list[Result],
    result_threshold: float = 0.5,
    claim_threshold: float = 0.4,
) -> PairwiseReport:
    texts_a = [r.result for r in results_a]
    texts_b = [r.result for r in results_b]

    idx_pairs, matched_a_idx, matched_b_idx = greedy_match_texts(
        texts_a, texts_b, result_threshold
    )

    matched_pairs: list[MatchedResultPair] = []
    for i, j, sim in idx_pairs:
        ra, rb = results_a[i], results_b[j]

        jaccard, avg_csim, claim_pairs = compare_claim_sets(
            ra.claim_texts, rb.claim_texts, claim_threshold
        )

        matched_pairs.append(MatchedResultPair(
            id_a=ra.result_id,
            id_b=rb.result_id,
            result_a=ra.result,
            result_b=rb.result,
            result_similarity=round(sim, 4),
            evaluation_type_match=(ra.evaluation_type == rb.evaluation_type),
            result_type_match=(ra.result_type == rb.result_type),
            n_claims_a=len(ra.claim_texts),
            n_claims_b=len(rb.claim_texts),
            n_matched_claims=len(claim_pairs),
            claim_set_jaccard=jaccard,
            avg_claim_similarity=avg_csim,
            matched_claim_pairs=claim_pairs,
        ))

    unmatched_a = [results_a[i].result for i in range(len(results_a)) if i not in matched_a_idx]
    unmatched_b = [results_b[j].result for j in range(len(results_b)) if j not in matched_b_idx]

    report = PairwiseReport(
        label_a=label_a,
        label_b=label_b,
        n_results_a=len(results_a),
        n_results_b=len(results_b),
        matched_pairs=matched_pairs,
        unmatched_a=unmatched_a,
        unmatched_b=unmatched_b,
        distribution_a=distributions(results_a),
        distribution_b=distributions(results_b),
    )

    if matched_pairs:
        report.avg_result_similarity = round(
            float(np.mean([p.result_similarity for p in matched_pairs])), 4
        )
        report.result_match_rate = round(
            len(matched_pairs) / max(len(results_a), len(results_b)), 4
        )
        report.evaluation_type_agreement = round(
            sum(p.evaluation_type_match for p in matched_pairs) / len(matched_pairs), 4
        )
        report.result_type_agreement = round(
            sum(p.result_type_match for p in matched_pairs) / len(matched_pairs), 4
        )
        report.avg_claim_set_jaccard = round(
            float(np.mean([p.claim_set_jaccard for p in matched_pairs])), 4
        )
        report.avg_claim_similarity = round(
            float(np.mean([p.avg_claim_similarity for p in matched_pairs])), 4
        )

    return report


# ── Human-readable summary (stored in JSON for UI rendering) ──────────────────

def build_summary(report: PairwiseReport) -> dict:
    """
    Build a human-readable summary dict for a pairwise report.
    All metric values are pre-formatted as percentage strings so the UI
    can render them directly without further computation.
    """
    metrics = {
        "results": f"{report.n_results_a} vs {report.n_results_b}",
        "matched_pairs": len(report.matched_pairs),
        "unmatched_a": len(report.unmatched_a),
        "unmatched_b": len(report.unmatched_b),
        "result_level": {
            "avg_result_similarity": f"{report.avg_result_similarity:.1%}",
            "result_match_rate": f"{report.result_match_rate:.1%}",
            "evaluation_type_agreement": f"{report.evaluation_type_agreement:.1%}",
            "result_type_agreement": f"{report.result_type_agreement:.1%}",
        },
        "claim_set_level": {
            "avg_claim_set_jaccard": f"{report.avg_claim_set_jaccard:.1%}",
            "avg_claim_similarity": f"{report.avg_claim_similarity:.1%}",
        },
    }

    all_eval = (
        set(report.distribution_a["evaluation_type"])
        | set(report.distribution_b["evaluation_type"])
    )
    eval_dist = {
        t: {report.label_a: report.distribution_a["evaluation_type"].get(t, 0),
            report.label_b: report.distribution_b["evaluation_type"].get(t, 0)}
        for t in sorted(all_eval)
    }

    all_res = (
        set(report.distribution_a["result_type"])
        | set(report.distribution_b["result_type"])
    )
    result_type_dist = {
        t: {report.label_a: report.distribution_a["result_type"].get(t, 0),
            report.label_b: report.distribution_b["result_type"].get(t, 0)}
        for t in sorted(all_res)
    }

    matched_pairs_summary = [
        {
            "ids": f"{p.id_a} ↔ {p.id_b}",
            "result_similarity": f"{p.result_similarity:.2f}",
            "evaluation_type_match": p.evaluation_type_match,
            "result_type_match": p.result_type_match,
            "claims": f"{p.n_claims_a} (A) / {p.n_claims_b} (B)",
            "n_matched_claims": p.n_matched_claims,
            "claim_set_jaccard": f"{p.claim_set_jaccard:.2f}",
            "avg_claim_similarity": f"{p.avg_claim_similarity:.2f}",
            "result_a": p.result_a,
            "result_b": p.result_b,
            "matched_claim_pairs": [
                {
                    "claim_a": cp.claim_a,
                    "claim_b": cp.claim_b,
                    "similarity": f"{cp.similarity:.2f}",
                }
                for cp in p.matched_claim_pairs
            ],
        }
        for p in sorted(report.matched_pairs, key=lambda p: p.result_similarity, reverse=True)
    ]

    return {
        "pair": f"{report.label_a} ↔ {report.label_b}",
        "metrics": metrics,
        "evaluation_type_distribution": eval_dist,
        "result_type_distribution": result_type_dist,
        "matched_pairs": matched_pairs_summary,
        "unmatched_a": report.unmatched_a,
        "unmatched_b": report.unmatched_b,
    }


def build_overall_summary(reports: list[PairwiseReport]) -> list[dict]:
    """Cross-pair summary table — one row per pair."""
    return [
        {
            "pair": f"{r.label_a} ↔ {r.label_b}",
            "avg_result_similarity": f"{r.avg_result_similarity:.1%}",
            "result_match_rate": f"{r.result_match_rate:.1%}",
            "evaluation_type_agreement": f"{r.evaluation_type_agreement:.1%}",
            "result_type_agreement": f"{r.result_type_agreement:.1%}",
            "avg_claim_set_jaccard": f"{r.avg_claim_set_jaccard:.1%}",
            "avg_claim_similarity": f"{r.avg_claim_similarity:.1%}",
        }
        for r in reports
    ]


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Compare CLLM eval_llm results across runs at result and claim-set level."
    )
    parser.add_argument(
        "--runs", nargs="+", required=True,
        help="Run directories (each must contain eval_llm*.json and claims*.json)",
    )
    parser.add_argument(
        "--labels", nargs="+",
        help="Labels for each run directory (default: directory name)",
    )
    parser.add_argument(
        "--result-threshold", type=float, default=0.5,
        help="Min cosine similarity to count as a matched result pair (default: 0.5)",
    )
    parser.add_argument(
        "--claim-threshold", type=float, default=0.4,
        help="Min cosine similarity to match claims within a result pair (default: 0.4)",
    )
    parser.add_argument(
        "--output", default="compare_results_report.json",
        help="Output JSON report path (default: compare_results_report.json)",
    )
    args = parser.parse_args()

    run_dirs = [Path(r) for r in args.runs]
    labels = args.labels or [d.name for d in run_dirs]

    if len(labels) != len(run_dirs):
        parser.error("Number of --labels must match number of --runs")

    all_results: dict[str, list[Result]] = {}
    for label, run_dir in zip(labels, run_dirs):
        all_results[label] = load_results(run_dir)

    reports: list[PairwiseReport] = []
    for (la, ra), (lb, rb) in itertools.combinations(all_results.items(), 2):
        reports.append(compare_pair(
            la, ra, lb, rb,
            result_threshold=args.result_threshold,
            claim_threshold=args.claim_threshold,
        ))

    out = {
        "config": {
            "runs": dict(zip(labels, args.runs)),
            "result_threshold": args.result_threshold,
            "claim_threshold": args.claim_threshold,
            "similarity_backend": "sentence-transformers" if USE_SEMANTIC else "tfidf",
        },
        # Cross-pair summary table (one row per pair)
        "overall_summary": build_overall_summary(reports),
        # Per-pair: raw metrics + human-readable summary for UI rendering
        "pairwise": [
            {
                "label_a": r.label_a,
                "label_b": r.label_b,
                "n_results_a": r.n_results_a,
                "n_results_b": r.n_results_b,
                "avg_result_similarity": r.avg_result_similarity,
                "result_match_rate": r.result_match_rate,
                "evaluation_type_agreement": r.evaluation_type_agreement,
                "result_type_agreement": r.result_type_agreement,
                "avg_claim_set_jaccard": r.avg_claim_set_jaccard,
                "avg_claim_similarity": r.avg_claim_similarity,
                "distribution_a": r.distribution_a,
                "distribution_b": r.distribution_b,
                "summary": build_summary(r),
            }
            for r in reports
        ],
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
