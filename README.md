# CLLM Review

A web app for scientists to review LLM-extracted claims and evaluations from research papers. The `cllm` tool produces `claims.json` and `eval_llm.json` per paper — this UI lets a reviewer browse results, agree/disagree, override judgments, add comments, and save reviews as per-reviewer JSON files alongside existing paper data.

## Setup

Requires Python 3.12+ and [uv](https://docs.astral.sh/uv/).

1. Clone the repository and `cd` into it.

2. Install dependencies:
   ```bash
   uv sync
   ```

3. Start the server:
   ```bash
   uv run python main.py
   ```

4. Open http://127.0.0.1:8000 in your browser.

The `papers/` directory should contain paper data (XML source files, `claims.json`, `eval_llm.json`) for the UI to display. See the directory structure below for the expected layout.

## How It Works

Papers live under `papers/`, organized by bioRxiv DOI suffix (e.g., `papers/2025.12.02.691876/`). Each paper directory contains GROBID-parsed XML, extracted claims (`claims.json`), and LLM evaluations (`eval_llm.json`). Dated subdirectories (e.g., `20260206/`) hold versioned runs.

The review UI provides two views:

1. **Paper list** — Browse all reviewable papers with claim/result counts and review status. Includes instructions for reviewers.
2. **Paper review** — Scrollable result cards showing the LLM's grouped evaluation with:
   - Agree/Disagree on each result, with override dropdowns on disagree
   - Accept/Oppose on individual claims
   - "View in paper" side panel that highlights the source passage in the original text
   - Per-claim and per-result comments
   - Auto-save with debounce

Reviews are saved to a `reviews/` subdirectory within each paper (or run) directory as `review_{reviewer_name}.json`, so multiple reviewers can work on the same paper independently.

```
papers/
├── 2025.12.02.691876/              # Paper directory (bioRxiv DOI suffix)
│   ├── 2025.12.02.691876.source.xml  # GROBID-parsed TEI/JATS XML
│   └── 20260206/                     # Run directory (dated)
│       ├── claims.json               # Extracted claims
│       ├── eval_llm.json             # LLM evaluation results
│       ├── metrics_extract.json      # Extraction metrics
│       ├── metrics_eval_openeval.json # Evaluation metrics
│       └── reviews/                  # Created automatically on first save
│           ├── review_Dr_Smith.json
│           └── review_Jane_Doe.json
└── nikbakht_diamond/               # Paper directory (custom name)
    ├── elife-66429-v2.pdf.tei.xml
    └── 20260316_anthropic/
        ├── claims.json
        ├── eval_llm.json
        └── reviews/
```

## Tech Stack

- **Backend**: FastAPI + Jinja2 + uvicorn
- **Frontend**: Vanilla HTML/CSS/JS (no build step)
- **Storage**: JSON files in `reviews/` subdirectories per paper

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serve the review UI |
| `GET` | `/api/papers` | List all reviewable paper/run combos |
| `GET` | `/api/papers/{paper_id}/{run_id}/results` | Eval results with claims inlined |
| `GET` | `/api/papers/{paper_id}/text` | Paper text extracted from XML |
| `GET` | `/api/papers/{paper_id}/{run_id}/review?reviewer=` | Load a reviewer's review |
| `POST` | `/api/papers/{paper_id}/{run_id}/review` | Save/merge a review |
| `POST` | `/api/papers/refresh` | Clear paper discovery cache |
