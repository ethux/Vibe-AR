"""
Vibe AR — Scene control tools.

Manipulate the 3D AR visualization: highlight commits, navigate
the git tree, open floating windows, send notifications, etc.
"""

from __future__ import annotations

import json

from vibe_ar import mcp
from vibe_ar.helpers import send_scene_command
from vibe_ar.tools.git import git_diff


# ── Git tree controls ──

@mcp.tool()
def scene_load_git_tree() -> str:
    """Load and display the 3D git tree visualization in AR space."""
    return json.dumps(send_scene_command("load_git_tree"))


@mcp.tool()
def scene_toggle_git_tree() -> str:
    """Toggle the 3D git tree visualization on/off in AR space."""
    return json.dumps(send_scene_command("toggle_git_tree"))


@mcp.tool()
def scene_show_git_tree() -> str:
    """Show the 3D git tree visualization in AR space."""
    return json.dumps(send_scene_command("show_git_tree"))


@mcp.tool()
def scene_hide_git_tree() -> str:
    """Hide the 3D git tree visualization from AR space."""
    return json.dumps(send_scene_command("hide_git_tree"))


@mcp.tool()
def scene_highlight_commit(commit_hash: str, color: str = "#FF7000") -> str:
    """Highlight a specific commit in the 3D git tree. Color in hex (e.g. #FF7000 for orange, #EF4444 for red, #28c840 for green)."""
    return json.dumps(send_scene_command("highlight_commit", {
        "commit": commit_hash,
        "color": color,
    }))


@mcp.tool()
def scene_highlight_branch(branch_name: str, color: str = "#00CED1") -> str:
    """Highlight all commits on a specific branch in the 3D tree."""
    return json.dumps(send_scene_command("highlight_branch", {
        "branch": branch_name,
        "color": color,
    }))


@mcp.tool()
def scene_navigate_to_commit(commit_hash: str) -> str:
    """Pan the 3D git tree view to center on a specific commit."""
    return json.dumps(send_scene_command("navigate_to_commit", {
        "commit": commit_hash,
    }))


@mcp.tool()
def scene_clear_highlights() -> str:
    """Remove all highlights from the 3D git tree."""
    return json.dumps(send_scene_command("clear_highlights"))


# ── Floating windows ──

@mcp.tool()
def scene_show_commit_details(commit_hash: str) -> str:
    """Open a floating window in AR showing detailed info for a commit."""
    return json.dumps(send_scene_command("show_commit_details", {
        "commit": commit_hash,
    }))


@mcp.tool()
def scene_show_diff_window(commit_hash: str) -> str:
    """Open a floating window in AR showing the diff for a commit."""
    diff = git_diff(commit_hash, stat_only=False)
    return json.dumps(send_scene_command("show_window", {
        "title": f"DIFF: {commit_hash[:8]}",
        "content": diff[:2000],  # Truncate for display
        "position": [0.5, 1.5, -0.6],
    }))


@mcp.tool()
def scene_open_file(file_path: str) -> str:
    """Open a file in a floating AR window (triggers file bubble open)."""
    return json.dumps(send_scene_command("open_file", {
        "path": file_path,
    }))


@mcp.tool()
def scene_show_window(
    title: str,
    content: str,
    position_x: float = 0.4,
    position_y: float = 1.4,
) -> str:
    """Open a custom floating window in AR with arbitrary content."""
    return json.dumps(send_scene_command("show_window", {
        "title": title,
        "content": content,
        "position": [position_x, position_y, -0.7],
    }))


# ── Notifications & terminal ──

@mcp.tool()
def scene_show_notification(
    message: str,
    duration: float = 3.0,
    color: str = "#FF7000",
) -> str:
    """Show a brief floating notification in AR space."""
    return json.dumps(send_scene_command("notification", {
        "message": message,
        "duration": duration,
        "color": color,
    }))


@mcp.tool()
def scene_run_terminal_command(command: str) -> str:
    """Execute a command in the terminal. Runs directly in the vibe-terminal container."""
    import logging
    import subprocess

    log = logging.getLogger("vibe_ar.terminal")
    log.info(f"[TERMINAL] Running command: {command}")

    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd="/workspace",
            capture_output=True,
            text=True,
            timeout=30,
        )
        log.info(f"[TERMINAL] Exit code: {result.returncode}")
        if result.stdout:
            log.info(f"[TERMINAL] stdout: {result.stdout[:500]}")
        if result.stderr:
            log.info(f"[TERMINAL] stderr: {result.stderr[:500]}")
        return json.dumps({
            "exit_code": result.returncode,
            "stdout": result.stdout[:2000],
            "stderr": result.stderr[:2000],
        })
    except subprocess.TimeoutExpired:
        log.info("[TERMINAL] Command still running after 30s (likely a server)")
        return json.dumps({"status": "running", "note": "Command still running (timeout is normal for servers)"})
    except Exception as e:
        log.error(f"[TERMINAL] Failed: {e}")
        return json.dumps({"error": str(e)})


@mcp.tool()
def scene_show_current_terminal(
    title: str = "Terminal Output",
    position_x: float = 0.5,
    position_y: float = 1.3,
) -> str:
    """Show the current terminal window in AR so the user can see live output.
    Use this when you run a command and the user needs to see its output."""
    return json.dumps(send_scene_command("show_terminal", {
        "title": title,
        "position": [position_x, position_y, -0.6],
    }))


# ── Window management ──

@mcp.tool()
def scene_list_windows() -> str:
    """List all currently open windows in the AR scene.
    Returns window titles, IDs, and whether they were opened by the agent."""
    return json.dumps(send_scene_command("list_windows"))


@mcp.tool()
def scene_hide_window(window_id: int) -> str:
    """Hide (close) a window in the AR scene.
    Only auto-hides windows that were opened by the agent.
    If the window was opened by the user, it will NOT be hidden —
    a UI prompt will be shown to the user instead."""
    return json.dumps(send_scene_command("hide_window", {
        "windowId": window_id,
    }))


# ── Preview controls ──

@mcp.tool()
def scene_run_and_preview(command: str, port: int = 5173) -> str:
    """Run a dev server command in the AR terminal AND open a live preview.
    Use this whenever you need to start a dev server and show it to the user.
    This is the preferred tool for "run my app" / "start the server" / "show me the app".

    IMPORTANT: The dev server runs in a Docker container.
    For the preview to work, the server MUST bind to 0.0.0.0 (not localhost).
    This tool auto-fixes common commands, but if you write the command yourself,
    always include --host 0.0.0.0 for Vite, -H 0.0.0.0 for Next.js, etc.

    Examples:
      scene_run_and_preview("npm run dev", 5173)
      scene_run_and_preview("python -m http.server 8080", 8080)
      scene_run_and_preview("npx vite", 5173)
      scene_run_and_preview("npm start", 3000)

    command: the shell command to start the dev server.
    port: the port the server will listen on."""
    import logging
    import subprocess

    log = logging.getLogger("vibe_ar.preview")
    log.info(f"[RUN+PREVIEW] command={command!r}, port={port}")

    # Auto-fix: dev servers must bind to 0.0.0.0 to be accessible across containers
    fixed_command = _fix_host_binding(command)
    if fixed_command != command:
        log.info(f"[RUN+PREVIEW] Fixed host binding: {fixed_command!r}")
    command = fixed_command

    # 1. Run the command directly in THIS container (vibe-terminal)
    #    Use Popen so it runs in background (dev servers don't exit)
    log.info(f"[RUN+PREVIEW] Starting dev server in /workspace: {command}")
    try:
        proc = subprocess.Popen(
            command,
            shell=True,
            cwd="/workspace",
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            start_new_session=True,  # detach from parent
        )
        log.info(f"[RUN+PREVIEW] Dev server process launched, pid={proc.pid}")

        # Read first 3 seconds of output for logging
        import time
        import threading

        output_lines = []

        def _read_output():
            for line in proc.stdout:
                decoded = line.decode("utf-8", errors="replace").rstrip()
                output_lines.append(decoded)
                log.info(f"[DEV-SERVER pid={proc.pid}] {decoded}")
                if len(output_lines) > 50:
                    break

        reader = threading.Thread(target=_read_output, daemon=True)
        reader.start()

        # Wait briefly to check it didn't crash immediately
        time.sleep(2)
        if proc.poll() is not None:
            log.error(f"[RUN+PREVIEW] Dev server DIED immediately! exit={proc.returncode}")
            log.error(f"[RUN+PREVIEW] Output: {''.join(output_lines[:20])}")
            return json.dumps({"error": f"Dev server exited with code {proc.returncode}", "output": "\n".join(output_lines[:20])})

        log.info(f"[RUN+PREVIEW] Dev server still running after 2s (pid={proc.pid}), output so far: {len(output_lines)} lines")
        for line in output_lines[:10]:
            log.info(f"[RUN+PREVIEW] > {line}")

    except Exception as e:
        log.error(f"[RUN+PREVIEW] Failed to start dev server: {e}")
        return json.dumps({"error": str(e)})

    # 2. Tell the AR frontend to open the live preview window
    log.info(f"[RUN+PREVIEW] Sending open_live_preview for port {port}")
    result = send_scene_command("open_live_preview", {"port": port})
    log.info(f"[RUN+PREVIEW] Done: {result}")
    return json.dumps(result)


def _fix_host_binding(command: str) -> str:
    """Ensure dev server commands bind to 0.0.0.0 so they're accessible across Docker containers."""
    # Already has --host flag? Don't modify.
    if "--host" in command or "-H 0" in command or "HOST=" in command:
        return command

    # Vite: npm run dev, npx vite, yarn dev, pnpm dev
    # Add -- --host 0.0.0.0 after the dev command
    if "npm run dev" in command:
        return command.replace("npm run dev", "npm run dev -- --host 0.0.0.0")
    if "yarn dev" in command:
        return command.replace("yarn dev", "yarn dev --host 0.0.0.0")
    if "pnpm dev" in command:
        return command.replace("pnpm dev", "pnpm dev --host 0.0.0.0")
    if "npx vite" in command:
        return command.replace("npx vite", "npx vite --host 0.0.0.0")

    # Next.js: npm run dev (already handled), next dev
    if "next dev" in command:
        return command.replace("next dev", "next dev -H 0.0.0.0")

    # Create React App / react-scripts
    if "react-scripts start" in command:
        return f"HOST=0.0.0.0 {command}"
    if "npm start" in command and "react" in command.lower():
        return f"HOST=0.0.0.0 {command}"

    # Python http.server: already binds to 0.0.0.0 by default
    # Angular CLI: ng serve — add --host
    if "ng serve" in command:
        return command.replace("ng serve", "ng serve --host 0.0.0.0")

    return command


@mcp.tool()
def scene_open_preview(port: int = 5173) -> str:
    """Open a live preview of a running web app in the AR scene.
    Use when the dev server is already running and you just need to show the preview.

    port: the port the dev server is running on (e.g. 5173 for Vite, 3000 for Next.js, 8080 for generic).
    Common ports: 5173 (Vite), 8080 (generic), 8000 (Python), 4200 (Angular), 3000 (React/Next)."""
    import logging

    log = logging.getLogger("vibe_ar.preview")

    # Tell the AR frontend to open the live preview window
    # (the client handles starting the capture stream itself)
    log.info(f"[PREVIEW-MCP] Sending open_live_preview for port {port}")
    result = send_scene_command("open_live_preview", {"port": port})
    log.info(f"[PREVIEW-MCP] result: {result}")
    return json.dumps(result)


@mcp.tool()
def scene_refresh_preview() -> str:
    """Refresh the live web preview window.
    Reloads the page being captured so the user sees the latest changes."""
    return json.dumps(send_scene_command("refresh_preview"))


@mcp.tool()
def scene_close_preview() -> str:
    """Close the live web preview window and stop the capture stream."""
    import httpx
    from vibe_ar.config import WEB_URL

    try:
        httpx.post(f"{WEB_URL}/api/devserver/stop-stream", timeout=5)
    except Exception:
        pass
    return json.dumps({"ok": True, "action": "close_preview"})
