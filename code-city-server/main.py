"""
Code City Server — Analyzes source code via Mistral AI and returns a 3D city layout.
"""

import json
import os

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Code City Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MISTRAL_API_KEY = os.environ.get(
    "MISTRAL_API_KEY", "gipO8YkyX9BgGrnStEfIhZLcoDhSfbox"
)
MISTRAL_MODEL = "mistral-large-latest"
MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions"

SYSTEM_PROMPT = """You are a code architecture analyzer. Given source code, produce a JSON object representing a "Code City" — a 3D city layout where code structures become buildings.

Return ONLY a valid JSON object with this exact structure:

{
  "cityName": "short descriptive name",
  "districts": [
    {
      "id": "district_0",
      "name": "module/package name",
      "color": "#rrggbb",
      "x": 0, "z": 0,
      "width": 2, "depth": 2
    }
  ],
  "buildings": [
    {
      "id": "bldg_0",
      "name": "identifier name",
      "type": "class|function|variable|import",
      "districtId": "district_0",
      "x": 0, "y": 0, "z": 0,
      "width": 0.3, "height": 0.5, "depth": 0.3,
      "color": "#rrggbb",
      "codePreview": "first 3 lines of code...",
      "explanation": "one-sentence explanation of what this does",
      "metrics": { "loc": 10, "complexity": 2, "params": 1 }
    }
  ],
  "connections": [
    {
      "from": "bldg_0",
      "to": "bldg_1",
      "type": "calls|extends|imports",
      "color": "#rrggbb"
    }
  ],
  "outputs": [
    {
      "id": "out_0",
      "name": "return value or export name",
      "linkedBuilding": "bldg_0",
      "x": 0, "y": 0, "z": 0,
      "color": "#rrggbb"
    }
  ],
  "hotspots": ["bldg_0"],
  "stats": {
    "totalLOC": 42,
    "numClasses": 1,
    "numFunctions": 2,
    "numVariables": 3,
    "numImports": 1
  }
}

Rules:
- Color coding: orange (#F97316) = class, blue (#3B82F6) = function, green (#22C55E) = variable, purple (#A855F7) = import
- Building height is proportional to lines of code (LOC). Min 0.15, max 1.5.
- Building width/depth proportional to complexity. Min 0.15, max 0.6.
- Place buildings within their district bounds, spaced so they don't overlap.
- Districts should tile next to each other starting near origin.
- Connections represent function calls, class inheritance, or imports between buildings.
- Outputs (return values, console.log, exports) are placed outside the city boundary.
- Hotspots flag the most complex buildings (top 20% by complexity).
- codePreview: first 3 lines of the code element, max 120 chars total.
- explanation: one clear sentence about what the element does."""


class AnalyzeRequest(BaseModel):
    code: str
    language: str = "python"
    filename: str = "untitled"


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(req: AnalyzeRequest):
    user_msg = f"Language: {req.language}\nFilename: {req.filename}\n\n```{req.language}\n{req.code}\n```"

    payload = {
        "model": MISTRAL_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
        "max_tokens": 4096,
    }

    headers = {
        "Authorization": f"Bearer {MISTRAL_API_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            resp = await client.post(MISTRAL_URL, json=payload, headers=headers)
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Mistral API error: {e.response.status_code} — {e.response.text}",
            )
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Mistral API request failed: {e}")

    data = resp.json()
    content = data["choices"][0]["message"]["content"]

    try:
        city_layout = json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Mistral returned invalid JSON")

    return city_layout
