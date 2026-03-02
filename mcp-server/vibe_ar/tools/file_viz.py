"""
Vibe AR — File visualization tools.

Control how files appear in the AR bubble view: browse folders,
highlight files, show change indicators, move bubbles.
"""

from __future__ import annotations

import json

from vibe_ar import mcp
from vibe_ar.helpers import send_scene_command


@mcp.tool()
def scene_browse_folder(folder_path: str = ".") -> str:
    """Navigate the AR file bubble view to show a specific folder's contents. The user will see the folder's files as floating bubbles."""
    return json.dumps(send_scene_command("browse_folder", {
        "path": folder_path,
    }))


@mcp.tool()
def scene_highlight_file(
    file_path: str,
    color: str = "#FF7000",
    pulse: bool = True,
) -> str:
    """Highlight a file bubble in the AR view to draw the user's attention.
    Use when reading, editing, or creating a file so the user can see what you're working on.
    Colors: #FF7000 orange, #22C55E green (created/success), #EF4444 red (error/deleted),
    #3B82F6 blue (reading), #A855F7 purple."""
    return json.dumps(send_scene_command("highlight_file", {
        "path": file_path,
        "color": color,
        "pulse": pulse,
    }))


@mcp.tool()
def scene_show_file_change(
    file_path: str,
    action: str = "edit",
    summary: str = "",
) -> str:
    """Show a visual indicator in AR when a file is created, edited, moved, or deleted.
    action: 'create', 'edit', 'move', 'delete'.
    summary: brief description of the change."""
    return json.dumps(send_scene_command("file_change", {
        "path": file_path,
        "action": action,
        "summary": summary,
    }))


@mcp.tool()
def scene_arrange_files(
    layout: str = "arc",
    group_by: str = "type",
) -> str:
    """Rearrange file bubbles in the AR view using a spatial layout.
    layout: 'arc' (default semicircle), 'grid' (flat grid), 'cluster' (grouped clusters).
    group_by: 'type' (folders/code/config/docs), 'extension' (by file extension), 'name' (alphabetical).
    Use this when the user wants to organize or reorganize their file view."""
    return json.dumps(send_scene_command("arrange_files", {
        "layout": layout,
        "groupBy": group_by,
    }))


@mcp.tool()
def scene_move_file_bubble(
    file_path: str,
    x: float = 0.0,
    y: float = 1.4,
    z: float = -0.5,
) -> str:
    """Move a file bubble to a specific 3D position in the AR scene.
    Useful for organizing files visually or bringing important files closer to the user."""
    return json.dumps(send_scene_command("move_file_bubble", {
        "path": file_path,
        "position": [x, y, z],
    }))
