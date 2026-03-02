"""
Vibe AR — Shared helpers.

Low-level utilities used across multiple tool modules:
  • _run_git   — execute a git CLI command in the workspace
  • _send_scene_command — POST an action to the AR frontend
"""

from __future__ import annotations

import subprocess

import httpx

from vibe_ar.config import WORKSPACE, SCENE_CONTROL_URL


def run_git(cmd: str, cwd: str | None = None) -> dict:
    """Run a git command in the workspace and return stdout/stderr/returncode."""
    work = cwd or str(WORKSPACE)
    try:
        result = subprocess.run(
            f"git {cmd}",
            shell=True,
            capture_output=True,
            text=True,
            cwd=work,
            timeout=15,
        )
        return {
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "returncode": result.returncode,
        }
    except Exception as e:
        return {"stdout": "", "stderr": str(e), "returncode": -1}


def send_scene_command(action: str, payload: dict | None = None) -> dict:
    """Send a command to the AR frontend via the web server's scene-control API."""
    data = {"action": action, **(payload or {})}
    try:
        resp = httpx.post(SCENE_CONTROL_URL, json=data, timeout=5)
        return resp.json()
    except Exception as e:
        return {"ok": False, "error": str(e)}
