"""
Vibe AR — Git tools.

Query the repository: log, branches, diff, blame, status, etc.
"""

from __future__ import annotations

from vibe_ar import mcp
from vibe_ar.helpers import run_git


@mcp.tool()
def git_log(count: int = 30, branch: str = "") -> str:
    """Get recent git commit history. Returns commit hash, short hash, message, author, date, and decorations."""
    br = f" {branch}" if branch else " --all"
    fmt = "--format=%H|%h|%s|%an|%ar|%D"
    r = run_git(f"log{br} --oneline --graph --decorate {fmt} -{count}")
    if r["returncode"] != 0:
        return f"Error: {r['stderr']}"
    return r["stdout"]


@mcp.tool()
def git_branches() -> str:
    """List all branches with current branch marked."""
    r = run_git("branch -a -v")
    if r["returncode"] != 0:
        return f"Error: {r['stderr']}"
    return r["stdout"]


@mcp.tool()
def git_current_branch() -> str:
    """Get the name of the current branch."""
    r = run_git("branch --show-current")
    return r["stdout"] or "detached HEAD"


@mcp.tool()
def git_diff(commit: str = "HEAD", stat_only: bool = True) -> str:
    """Show diff for a commit. Use stat_only=True for summary, False for full diff."""
    flag = "--stat" if stat_only else ""
    r = run_git(f"diff {commit}~1 {commit} {flag}")
    if r["returncode"] != 0:
        # Maybe first commit
        r = run_git(f"show {commit} {flag}")
    return r["stdout"] if r["returncode"] == 0 else f"Error: {r['stderr']}"


@mcp.tool()
def git_show_commit(commit: str) -> str:
    """Show full details of a specific commit (message, author, date, files changed)."""
    r = run_git(f"show {commit} --stat --format=full")
    return r["stdout"] if r["returncode"] == 0 else f"Error: {r['stderr']}"


@mcp.tool()
def git_blame(file_path: str, start_line: int = 1, end_line: int = 50) -> str:
    """Show git blame for a file (who changed each line)."""
    r = run_git(f"blame -L {start_line},{end_line} -- {file_path}")
    return r["stdout"] if r["returncode"] == 0 else f"Error: {r['stderr']}"


@mcp.tool()
def git_file_history(file_path: str, count: int = 10) -> str:
    """Show commit history for a specific file."""
    r = run_git(f"log --oneline --follow -{count} -- {file_path}")
    return r["stdout"] if r["returncode"] == 0 else f"Error: {r['stderr']}"


@mcp.tool()
def git_status() -> str:
    """Show current git status (staged, modified, untracked files)."""
    r = run_git("status --short")
    return r["stdout"] if r["returncode"] == 0 else f"Error: {r['stderr']}"
