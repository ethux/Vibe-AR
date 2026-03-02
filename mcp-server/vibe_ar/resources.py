"""
Vibe AR — MCP Resources & Prompts.

Resources give the AI agent read-only context about the repo.
Prompts are reusable interaction templates.
"""

from __future__ import annotations

from vibe_ar import mcp
from vibe_ar.tools.git import git_log, git_branches, git_status


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

After review, use scene_highlight_commit to highlight any commits that need attention \
(red for issues, green for good)."""


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
