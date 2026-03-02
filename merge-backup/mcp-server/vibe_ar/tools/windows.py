"""
Vibe AR — Window management tools.

Control floating AR windows: close, close all, list, arrange.
"""

from __future__ import annotations

import json

from vibe_ar import mcp
from vibe_ar.helpers import send_scene_command


@mcp.tool()
def scene_close_window(title: str) -> str:
    """Close a specific floating window by its title."""
    return json.dumps(send_scene_command("close_window", {
        "title": title,
    }))


@mcp.tool()
def scene_close_all_windows() -> str:
    """Close all floating windows (except the main terminal)."""
    return json.dumps(send_scene_command("close_all_windows"))


@mcp.tool()
def scene_list_windows() -> str:
    """List all currently open floating windows with their titles and positions."""
    return json.dumps(send_scene_command("list_windows"))


@mcp.tool()
def scene_arrange_windows(layout: str = "cascade") -> str:
    """Arrange all open windows in a structured layout.

    layout options:
    - "cascade": Stack windows in a cascading pattern to the side
    - "grid": Arrange windows in an even grid
    - "stack": Stack all windows in the same spot (tabbed)
    - "spread": Spread windows in an arc around the user
    """
    return json.dumps(send_scene_command("arrange_windows", {
        "layout": layout,
    }))


@mcp.tool()
def scene_focus_window(title: str) -> str:
    """Bring a specific window to the front and highlight it."""
    return json.dumps(send_scene_command("focus_window", {
        "title": title,
    }))
