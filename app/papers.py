from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from pathlib import Path

PAPERS_DIR = Path(__file__).resolve().parent.parent / "papers"
TEI_NS = "http://www.tei-c.org/ns/1.0"


def _find_json(directory: Path, prefix: str) -> Path | None:
    """Find a JSON file matching a prefix pattern (e.g. 'claims' or 'eval_llm')."""
    for p in sorted(directory.glob(f"{prefix}*.json")):
        return p
    return None


def _extract_title(paper_dir: Path) -> str:
    """Extract paper title from TEI or JATS XML. Falls back to directory name."""
    for xml_path in sorted(paper_dir.glob("*.xml")):
        try:
            tree = ET.parse(xml_path)
            root = tree.getroot()
            # GROBID TEI format
            title_el = root.find(f".//{{{TEI_NS}}}title[@level='a'][@type='main']")
            if title_el is not None and title_el.text:
                return title_el.text.strip()
            # JATS XML format (front/article-meta/title-group/article-title)
            title_el = root.find(".//article-title")
            if title_el is not None and title_el.text:
                return title_el.text.strip()
        except ET.ParseError:
            continue
    return paper_dir.name


def discover_papers() -> list[dict]:
    """Walk papers/ and find all paper/run combos with both claims and eval data."""
    results = []
    if not PAPERS_DIR.exists():
        return results

    for paper_dir in sorted(PAPERS_DIR.iterdir()):
        if not paper_dir.is_dir():
            continue
        paper_id = paper_dir.name
        title = _extract_title(paper_dir)

        # Check root level
        claims_file = _find_json(paper_dir, "claims")
        eval_file = _find_json(paper_dir, "eval_llm")
        if claims_file and eval_file:
            results.append({
                "paper_id": paper_id,
                "run_id": "root",
                "title": title,
                "claims_path": claims_file,
                "eval_path": eval_file,
            })

        # Check subdirectories
        for sub in sorted(paper_dir.iterdir()):
            if not sub.is_dir():
                continue
            claims_file = _find_json(sub, "claim")
            eval_file = _find_json(sub, "eval_llm")
            if claims_file and eval_file:
                results.append({
                    "paper_id": paper_id,
                    "run_id": sub.name,
                    "title": title,
                    "claims_path": claims_file,
                    "eval_path": eval_file,
                })

    return results


def load_claims(path: Path) -> list[dict]:
    return json.loads(path.read_text())


def load_eval(path: Path) -> list[dict]:
    return json.loads(path.read_text())


def review_path(paper_id: str, run_id: str) -> Path:
    if run_id == "root":
        return PAPERS_DIR / paper_id / "review.json"
    return PAPERS_DIR / paper_id / run_id / "review.json"


def load_review(paper_id: str, run_id: str) -> dict | None:
    p = review_path(paper_id, run_id)
    if p.exists():
        return json.loads(p.read_text())
    return None


def save_review(paper_id: str, run_id: str, data: dict) -> None:
    p = review_path(paper_id, run_id)
    p.write_text(json.dumps(data, indent=2))
