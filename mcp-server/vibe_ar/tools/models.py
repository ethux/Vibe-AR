"""
Vibe AR — Model switching tools.

Switch between LLM models (local Devstral vs cloud Mistral Large).
Edits the Vibe config.toml directly since MCP runs in the same container.
"""

from __future__ import annotations

import json
import re

from vibe_ar import mcp
from vibe_ar.config import WORKSPACE

CONFIG_PATH = WORKSPACE / ".vibe" / "config.toml"

AVAILABLE_MODELS = {
    "local": {
        "name": "Devstral-Small",
        "alias": "devstral",
        "description": "Local Devstral Small (24B) via vLLM — fast, free, on your own GPU",
    },
    "cloud": {
        "name": "mistral-large-latest",
        "alias": "large",
        "description": "Mistral Large (cloud) — most capable, paid API",
    },
}


@mcp.tool()
def scene_switch_model(model: str) -> str:
    """Switch the active LLM model.

    Available models:
    - "local": Devstral Small (24B) via vLLM — fast, free (default)
    - "cloud": Mistral Large — most capable, paid API

    Note: Takes effect on the NEXT message. Current response uses the old model.
    """
    model = model.lower().strip()
    if model not in AVAILABLE_MODELS:
        return json.dumps({
            "ok": False,
            "error": f"Unknown model '{model}'. Available: {', '.join(AVAILABLE_MODELS.keys())}",
        })

    info = AVAILABLE_MODELS[model]
    try:
        config = CONFIG_PATH.read_text()
        # Replace active_model line — Vibe matches by ALIAS, not name
        new_config = re.sub(
            r'^active_model\s*=\s*"[^"]*"',
            f'active_model = "{info["alias"]}"',
            config,
            flags=re.MULTILINE,
        )
        CONFIG_PATH.write_text(new_config)
        return json.dumps({
            "ok": True,
            "model": info["name"],
            "alias": info["alias"],
            "description": info["description"],
            "note": "Takes effect on next message",
        })
    except Exception as e:
        return json.dumps({"ok": False, "error": str(e)})


@mcp.tool()
def scene_list_models() -> str:
    """List available LLM models and which one is currently active."""
    try:
        config = CONFIG_PATH.read_text()
        match = re.search(r'^active_model\s*=\s*"([^"]*)"', config, re.MULTILINE)
        active = match.group(1) if match else "unknown"
    except Exception:
        active = "unknown"

    models = []
    for key, info in AVAILABLE_MODELS.items():
        models.append({
            "key": key,
            "name": info["name"],
            "description": info["description"],
            "active": info["alias"] == active,
        })

    return json.dumps({"models": models, "active": active})
