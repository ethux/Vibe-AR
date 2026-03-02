"""
Vibe AR — MCP Server for 3D Git Tree & Scene Control.

Exposes tools that let an AI agent interact with:
1. Git repository (log, diff, branches, blame)
2. 3D scene in the AR headset (highlight commits, navigate tree, open windows)

The server communicates with the AR frontend via a WebSocket control
channel on the web server (/ws/scene-control).

Usage:
  Run as an MCP server with stdio transport:
    python mcp-server/server.py

Project layout:
  server.py          ← this file (entry point)
  vibe_ar/
  ├── __init__.py    ← creates the FastMCP instance & imports all modules
  ├── config.py      ← env vars, paths, constants
  ├── helpers.py     ← run_git(), send_scene_command()
  ├── resources.py   ← MCP resources & prompt templates
  └── tools/
      ├── git.py     ← git_log, git_diff, git_blame, …
      ├── scene.py   ← scene_highlight_commit, scene_show_window, …
      └── file_viz.py← scene_browse_folder, scene_highlight_file, …
"""

from vibe_ar import mcp  # importing registers all tools/resources

if __name__ == "__main__":
    mcp.run()  # stdio transport
