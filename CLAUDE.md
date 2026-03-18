# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

An automated scientific paper reviewer tool that extracts claims from research papers and evaluates them using LLMs. The `cllm` CLI tool processes papers from bioRxiv/medRxiv preprint sources, stored as TEI XML (GROBID-parsed), and produces structured JSON outputs. The review web app ("CLLM Review") lets human scientists review and validate the LLM's output.

## Setup

- Python 3.12, managed with uv (see `pyproject.toml`)
- Install deps: `uv sync`
- Run: `uv run python main.py` → starts FastAPI server at http://127.0.0.1:8000

## Architecture

The pipeline has three stages, each producing a JSON artifact per paper:

1. **Claim extraction** (`claims.json`) — LLM parses the TEI XML source and extracts individual claims with metadata (claim type, source text, evidence type, section)
2. **LLM evaluation** (`eval_llm.json`) — Groups related claims into results and evaluates each as SUPPORTED/UNSUPPORTED with reviewer commentary and significance (MAJOR/MINOR)
3. **Metrics** (`metrics_extract.json`, `metrics_eval_openeval.json`) — Token usage, cost, and timing metrics for each LLM call

## Data Layout

Papers live under `papers/`, organized by bioRxiv DOI suffix or custom name. Each paper directory contains:
- `*.source.xml` — TEI or JATS XML from GROBID parsing of the PDF
- Dated subdirectories (e.g., `20260206/`) for versioned runs, each containing:
  - `claims*.json` — Extracted claims (naming varies: `claims.json`, `claims_20260206.json`, `claim_updates.json`)
  - `eval_llm*.json` — LLM evaluation results
  - `metrics_*.json` — Cost/token tracking
  - `reviews/` — Per-reviewer review files (`review_{name}.json`), created automatically

The CLI tool used is `cllm` (e.g., `cllm extract <xml> -o claims.json`). Models used include Claude Sonnet.

## Review Web App

### Tech Stack
- **Backend**: FastAPI + Jinja2 templates + uvicorn
- **Frontend**: Vanilla HTML/CSS/JS (no build step)
- **Storage**: Per-reviewer JSON files in `reviews/` subdirectories

### File Structure
```
app/
├── __init__.py
├── api.py          # API router — all REST endpoints
├── models.py       # Pydantic models (Claim, Result, Review, ClaimReview, etc.)
├── papers.py       # Paper discovery, XML title extraction, text extraction, data I/O
└── static/
    ├── style.css
    └── app.js      # All frontend logic (SPA, two views)
templates/
└── index.html      # Single-page HTML shell with instructions
main.py             # FastAPI app entry point + uvicorn
```

### API Endpoints
```
GET  /                                              → Serve index.html
GET  /api/papers?reviewer=                          → List all reviewable paper/run combos
GET  /api/papers/{paper_id}/{run_id}/results        → eval_llm.json with claims inlined
GET  /api/papers/{paper_id}/text                    → Paper text extracted from XML
GET  /api/papers/{paper_id}/{run_id}/review?reviewer= → Load reviewer's review (404 if none)
POST /api/papers/{paper_id}/{run_id}/review         → Save/merge review (reviewer name required)
POST /api/papers/refresh                            → Clear paper cache
```

### Key Details
- **Paper discovery**: Walks `papers/` for directories containing both `claims*.json` and `eval_llm*.json`. Uses glob prefix matching to handle varied file naming.
- **XML title extraction**: Handles both GROBID TEI (`<title level="a" type="main">`) and JATS (`<article-title>`) formats.
- **Per-reviewer reviews**: Reviews save as `reviews/review_{name}.json`. Reviewer name is collected via a modal when entering a paper, with the option to continue a previous review or start new. Status auto-transitions to "in_progress" on first save.
- **Paper text panel**: Extracts readable text from TEI/JATS XML for a "View in paper" side panel with source highlighting.
- **Reference sidebar**: Key definitions and review actions are displayed in a sticky sidebar on the review page.
