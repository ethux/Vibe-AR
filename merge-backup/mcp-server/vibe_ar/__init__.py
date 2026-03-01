"""
Vibe AR — MCP Server package.

Creates the shared FastMCP instance used by all tool modules.
"""

from mcp.server.fastmcp import FastMCP

mcp = FastMCP(
    "Vibe AR — 3D Git & Scene",
    json_response=True,
)

# Import all tool/resource modules so they register with `mcp`.
# Order doesn't matter — each module just decorates functions.
from vibe_ar.tools import git, scene, file_viz, voices, models  # noqa: E402, F401
from vibe_ar import resources  # noqa: E402, F401
