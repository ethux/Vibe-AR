"""
Vibe AR — MCP Server for 3D Git Tree & Scene Control.

Exposes tools that let an AI agent (Claude, etc.) interact with:
1. Git repository (log, diff, branches, blame)
2. 3D scene in the AR headset (highlight commits, navigate tree, open windows)

The server communicates with the AR frontend via a WebSocket control
channel on the web server (/ws/scene-control).

Usage with Claude Code:
  Add to .claude/settings.json:
  {
    "mcpServers": {
      "vibe-ar": {
        "command": "python",
        "args": ["mcp-server/server.py"],
        "env": { "VIBE_WEB_URL": "http://localhost:3001" }
      }
    }
  }
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import httpx
from mcp.server.fastmcp import FastMCP

# ── Config ──
WORKSPACE = Path(os.environ.get("VIBE_WORKSPACE", Path.home() / "Desktop"))
WEB_URL = os.environ.get("VIBE_WEB_URL", "http://localhost:3001")
COMPANION_URL = os.environ.get("COMPANION_URL", f"{WEB_URL}/api/companion")

mcp = FastMCP(
    "Vibe AR — 3D Git & Scene",
    json_response=True,
)


# ── Helpers ──

def _run_git(cmd: str, cwd: str | None = None) -> dict:
    """Run a git command in the workspace and return output."""
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


def _send_scene_command(action: str, payload: dict | None = None) -> dict:
    """Send a command to the AR frontend via the web server's scene-control API."""
    data = {"action": action, **(payload or {})}
    try:
        resp = httpx.post(
            f"{WEB_URL}/api/scene-control",
            json=data,
            timeout=5,
        )
        return resp.json()
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════
#  Git Tools — query repository state
# ═══════════════════════════════════════════════════════════

@mcp.tool()
def git_log(count: int = 30, branch: str = "") -> str:
    """Get recent git commit history. Returns commit hash, short hash, message, author, date, and decorations."""
    br = f" {branch}" if branch else " --all"
    fmt = "--format=%H|%h|%s|%an|%ar|%D"
    r = _run_git(f"log{br} --oneline --graph --decorate {fmt} -{count}")
    if r["returncode"] != 0:
        return f"Error: {r['stderr']}"
    return r["stdout"]


@mcp.tool()
def git_branches() -> str:
    """List all branches with current branch marked."""
    r = _run_git("branch -a -v")
    if r["returncode"] != 0:
        return f"Error: {r['stderr']}"
    return r["stdout"]


@mcp.tool()
def git_current_branch() -> str:
    """Get the name of the current branch."""
    r = _run_git("branch --show-current")
    return r["stdout"] or "detached HEAD"


@mcp.tool()
def git_diff(commit: str = "HEAD", stat_only: bool = True) -> str:
    """Show diff for a commit. Use stat_only=True for summary, False for full diff."""
    flag = "--stat" if stat_only else ""
    r = _run_git(f"diff {commit}~1 {commit} {flag}")
    if r["returncode"] != 0:
        # Maybe first commit
        r = _run_git(f"show {commit} {flag}")
    return r["stdout"] if r["returncode"] == 0 else f"Error: {r['stderr']}"


@mcp.tool()
def git_show_commit(commit: str) -> str:
    """Show full details of a specific commit (message, author, date, files changed)."""
    r = _run_git(f"show {commit} --stat --format=full")
    return r["stdout"] if r["returncode"] == 0 else f"Error: {r['stderr']}"


@mcp.tool()
def git_blame(file_path: str, start_line: int = 1, end_line: int = 50) -> str:
    """Show git blame for a file (who changed each line)."""
    r = _run_git(f"blame -L {start_line},{end_line} -- {file_path}")
    return r["stdout"] if r["returncode"] == 0 else f"Error: {r['stderr']}"


@mcp.tool()
def git_file_history(file_path: str, count: int = 10) -> str:
    """Show commit history for a specific file."""
    r = _run_git(f"log --oneline --follow -{count} -- {file_path}")
    return r["stdout"] if r["returncode"] == 0 else f"Error: {r['stderr']}"


@mcp.tool()
def git_status() -> str:
    """Show current git status (staged, modified, untracked files)."""
    r = _run_git("status --short")
    return r["stdout"] if r["returncode"] == 0 else f"Error: {r['stderr']}"


# ═══════════════════════════════════════════════════════════
#  3D Scene Control — manipulate the AR visualization
# ═══════════════════════════════════════════════════════════

@mcp.tool()
def scene_load_git_tree() -> str:
    """Load and display the 3D git tree visualization in AR space."""
    result = _send_scene_command("load_git_tree")
    return json.dumps(result)


@mcp.tool()
def scene_highlight_commit(commit_hash: str, color: str = "#FF7000") -> str:
    """Highlight a specific commit in the 3D git tree. Color in hex (e.g. #FF7000 for orange, #EF4444 for red, #28c840 for green)."""
    result = _send_scene_command("highlight_commit", {
        "commit": commit_hash,
        "color": color,
    })
    return json.dumps(result)


@mcp.tool()
def scene_highlight_branch(branch_name: str, color: str = "#00CED1") -> str:
    """Highlight all commits on a specific branch in the 3D tree."""
    result = _send_scene_command("highlight_branch", {
        "branch": branch_name,
        "color": color,
    })
    return json.dumps(result)


@mcp.tool()
def scene_show_commit_details(commit_hash: str) -> str:
    """Open a floating window in AR showing detailed info for a commit."""
    result = _send_scene_command("show_commit_details", {
        "commit": commit_hash,
    })
    return json.dumps(result)


@mcp.tool()
def scene_show_diff_window(commit_hash: str) -> str:
    """Open a floating window in AR showing the diff for a commit."""
    diff = git_diff(commit_hash, stat_only=False)
    result = _send_scene_command("show_window", {
        "title": f"DIFF: {commit_hash[:8]}",
        "content": diff[:2000],  # Truncate for display
        "position": [0.5, 1.5, -0.6],
    })
    return json.dumps(result)


@mcp.tool()
def scene_navigate_to_commit(commit_hash: str) -> str:
    """Pan the 3D git tree view to center on a specific commit."""
    result = _send_scene_command("navigate_to_commit", {
        "commit": commit_hash,
    })
    return json.dumps(result)


@mcp.tool()
def scene_clear_highlights() -> str:
    """Remove all highlights from the 3D git tree."""
    result = _send_scene_command("clear_highlights")
    return json.dumps(result)


@mcp.tool()
def scene_open_file(file_path: str) -> str:
    """Open a file in a floating AR window (triggers file bubble open)."""
    result = _send_scene_command("open_file", {
        "path": file_path,
    })
    return json.dumps(result)


@mcp.tool()
def scene_show_window(title: str, content: str, position_x: float = 0.4, position_y: float = 1.4) -> str:
    """Open a custom floating window in AR with arbitrary content."""
    result = _send_scene_command("show_window", {
        "title": title,
        "content": content,
        "position": [position_x, position_y, -0.7],
    })
    return json.dumps(result)


@mcp.tool()
def scene_show_notification(message: str, duration: float = 3.0, color: str = "#FF7000") -> str:
    """Show a brief floating notification in AR space."""
    result = _send_scene_command("notification", {
        "message": message,
        "duration": duration,
        "color": color,
    })
    return json.dumps(result)


@mcp.tool()
def scene_run_terminal_command(command: str) -> str:
    """Execute a command in the AR terminal. The user will see it running live."""
    result = _send_scene_command("terminal_command", {
        "command": command,
    })
    return json.dumps(result)


# ═══════════════════════════════════════════════════════════
#  Resources — provide context about the repo
# ═══════════════════════════════════════════════════════════

@mcp.resource("git://status")
def resource_git_status() -> str:
    """Current git status."""
    return git_status()


@mcp.resource("git://branches")
def resource_git_branches() -> str:
    """All branches."""
    return git_branches()


@mcp.resource("git://log")
def resource_git_log() -> str:
    """Recent commit history."""
    return git_log(count=20)


# ═══════════════════════════════════════════════════════════
#  Prompts — reusable AI interaction templates
# ═══════════════════════════════════════════════════════════

@mcp.prompt()
def review_recent_commits(count: int = 5) -> str:
    """Review the most recent commits and suggest improvements."""
    log = git_log(count=count)
    return f"""Review these recent git commits and provide feedback:

{log}

For each commit:
1. Is the commit message clear and descriptive?
2. Does the diff look reasonable for the described change?
3. Any suggestions for improvement?

After review, use scene_highlight_commit to highlight any commits that need attention (red for issues, green for good)."""


@mcp.prompt()
def explore_codebase() -> str:
    """Explore the codebase structure via the 3D git tree."""
    status = git_status()
    branches = git_branches()
    return f"""You have access to a 3D AR visualization of this git repository.

Current status:
{status}

Branches:
{branches}

Available actions:
- Use scene_load_git_tree to display the 3D commit tree
- Use scene_highlight_commit/branch to draw attention to specific commits
- Use scene_show_commit_details to open floating detail windows
- Use scene_show_diff_window to show code changes
- Use scene_navigate_to_commit to focus on specific areas

Start by loading the git tree, then explore the history and highlight interesting patterns."""


if __name__ == "__main__":
    mcp.run()  # stdio transport (default for Claude Code)
