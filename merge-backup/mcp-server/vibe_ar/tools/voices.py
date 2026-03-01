"""
Vibe AR — Voice management tools.

Switch TTS voice/personality and list available voices.
"""

from __future__ import annotations

import json

import httpx

from vibe_ar import mcp
from vibe_ar.config import WEB_URL


@mcp.tool()
def scene_set_voice(voice: str) -> str:
    """Switch the TTS voice/personality.

    Available voices:
    - "coder": Chris — chill vibe coder, casual and relaxed (default)
    - "architect": Daniel — senior architect, deep and authoritative
    - "creative": Charlotte — creative designer, warm and enthusiastic
    - "hacker": Clyde — hacker, gruff and no-nonsense
    """
    try:
        resp = httpx.post(f"{WEB_URL}/api/voice", json={"voice": voice}, timeout=5)
        return json.dumps(resp.json())
    except Exception as e:
        return json.dumps({"ok": False, "error": str(e)})


@mcp.tool()
def scene_list_voices() -> str:
    """List all available TTS voices/personalities and which one is active."""
    try:
        resp = httpx.get(f"{WEB_URL}/api/voices", timeout=5)
        return json.dumps(resp.json())
    except Exception as e:
        return json.dumps({"ok": False, "error": str(e)})
