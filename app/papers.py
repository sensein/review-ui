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


def extract_paper_text(paper_id: str) -> list[dict]:
    """Extract readable text sections from paper XML. Returns list of {section, text} dicts."""
    paper_dir = PAPERS_DIR / paper_id
    if not paper_dir.exists():
        return []

    for xml_path in sorted(paper_dir.glob("*.xml")):
        try:
            tree = ET.parse(xml_path)
            root = tree.getroot()
        except ET.ParseError:
            continue

        # Detect format
        if root.tag == f"{{{TEI_NS}}}TEI" or TEI_NS in root.tag:
            return _extract_tei_text(root)
        elif root.tag == "article":
            return _extract_jats_text(root)

    return []


def _extract_tei_text(root: ET.Element) -> list[dict]:
    sections = []
    body = root.find(f".//{{{TEI_NS}}}body")
    if body is None:
        return sections
    # Also get abstract
    abstract = root.find(f".//{{{TEI_NS}}}abstract")
    if abstract is not None:
        paras = []
        for p in abstract.iter(f"{{{TEI_NS}}}p"):
            text = "".join(p.itertext()).strip()
            if text:
                paras.append(text)
        if paras:
            sections.append({"section": "Abstract", "paragraphs": paras})
    # Body divs
    for div in body.findall(f"{{{TEI_NS}}}div"):
        head = div.find(f"{{{TEI_NS}}}head")
        section_name = head.text.strip() if head is not None and head.text else "Untitled"
        paras = []
        for p in div.findall(f"{{{TEI_NS}}}p"):
            text = "".join(p.itertext()).strip()
            if text:
                paras.append(text)
        if paras:
            sections.append({"section": section_name, "paragraphs": paras})
    return sections


def _extract_jats_text(root: ET.Element) -> list[dict]:
    sections = []
    # Abstract
    abstract = root.find(".//abstract")
    if abstract is not None:
        paras = []
        for p in abstract.iter("p"):
            text = "".join(p.itertext()).strip()
            if text:
                paras.append(text)
        if paras:
            sections.append({"section": "Abstract", "paragraphs": paras})
    # Body sections
    body = root.find(".//body")
    if body is None:
        return sections
    for sec in body.findall(".//sec"):
        title_el = sec.find("title")
        section_name = title_el.text.strip() if title_el is not None and title_el.text else "Untitled"
        paras = []
        for p in sec.findall("p"):
            text = "".join(p.itertext()).strip()
            if text:
                paras.append(text)
        if paras:
            sections.append({"section": section_name, "paragraphs": paras})
    return sections


def load_claims(path: Path) -> list[dict]:
    return json.loads(path.read_text())


def load_eval(path: Path) -> list[dict]:
    return json.loads(path.read_text())


def _sanitize_reviewer(name: str) -> str:
    """Sanitize reviewer name for use in filenames."""
    return "".join(c if c.isalnum() or c in "-_ " else "" for c in name).strip().replace(" ", "_")


def _review_dir(paper_id: str, run_id: str) -> Path:
    if run_id == "root":
        return PAPERS_DIR / paper_id / "reviews"
    return PAPERS_DIR / paper_id / run_id / "reviews"


def review_path(paper_id: str, run_id: str, reviewer: str) -> Path:
    safe_name = _sanitize_reviewer(reviewer)
    return _review_dir(paper_id, run_id) / f"review_{safe_name}.json"


def load_review(paper_id: str, run_id: str, reviewer: str) -> dict | None:
    if not reviewer:
        return None
    p = review_path(paper_id, run_id, reviewer)
    if p.exists():
        return json.loads(p.read_text())
    return None


def save_review(paper_id: str, run_id: str, reviewer: str, data: dict) -> None:
    p = review_path(paper_id, run_id, reviewer)
    p.parent.mkdir(exist_ok=True)
    p.write_text(json.dumps(data, indent=2))


def list_reviews(paper_id: str, run_id: str) -> list[dict]:
    """List all review files for a paper/run."""
    d = _review_dir(paper_id, run_id)
    reviews = []
    for p in sorted(d.glob("review_*.json")):
        try:
            data = json.loads(p.read_text())
            reviews.append(data)
        except (json.JSONDecodeError, OSError):
            continue
    return reviews
