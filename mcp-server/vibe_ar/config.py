"""
Vibe AR — Configuration.

All environment variables, paths, and constants live here.
"""

from __future__ import annotations

import os
from pathlib import Path

# Path to the workspace that contains the git repo the user is exploring.
WORKSPACE = Path(os.environ.get("VIBE_WORKSPACE", Path.home() / "Desktop"))

# Base URL of the Vibe web server (serves the AR frontend).
WEB_URL = os.environ.get("VIBE_WEB_URL", "http://localhost:3001")

# Companion service URL (used for AI/TTS features).
COMPANION_URL = os.environ.get("COMPANION_URL", f"{WEB_URL}/api/companion")

# Scene-control API endpoint on the web server.
SCENE_CONTROL_URL = f"{WEB_URL}/api/scene-control"
