from pathlib import Path
import hashlib
import os
import uvicorn

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.api import router as api_router

app = FastAPI(title="OpenEval Review UI")

app.include_router(api_router)

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "app" / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


def _static_hash(filename: str) -> str:
    """Return the first 8 chars of the MD5 hash of a static file's contents."""
    try:
        content = (STATIC_DIR / filename).read_bytes()
        return hashlib.md5(content).hexdigest()[:8]
    except OSError:
        return "0"


templates.env.globals["static_hash"] = _static_hash


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


if __name__ == "__main__":
    #port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)