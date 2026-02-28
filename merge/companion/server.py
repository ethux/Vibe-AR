"""
Vibe AR Companion — Desktop file & terminal bridge.

Runs on the dev machine and exposes a REST + WebSocket API
that the AR headset can call to interact with the local filesystem
and spawn / control terminal sessions.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Vibe AR Companion")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Config ───────────────────────────────────
WORKSPACE = Path(os.environ.get("VIBE_WORKSPACE", Path.home() / "Desktop"))


# ── Models ───────────────────────────────────
class FileRequest(BaseModel):
    path: str

class WriteRequest(BaseModel):
    path: str
    content: str

class MoveRequest(BaseModel):
    src: str
    dst: str

class TerminalInput(BaseModel):
    session_id: str
    command: str


# ── Helpers ──────────────────────────────────
def resolve(rel: str) -> Path:
    p = (WORKSPACE / rel).resolve()
    if not str(p).startswith(str(WORKSPACE.resolve())):
        raise HTTPException(403, "path escape")
    return p


# ── File operations ──────────────────────────

@app.get("/api/files/list")
def list_files(path: str = "."):
    """List files and folders in a directory."""
    target = resolve(path)
    if not target.is_dir():
        raise HTTPException(404, "not a directory")
    entries = []
    for entry in sorted(target.iterdir()):
        entries.append({
            "name": entry.name,
            "type": "folder" if entry.is_dir() else "file",
            "size": entry.stat().st_size if entry.is_file() else None,
            "ext": entry.suffix.lstrip(".") if entry.is_file() else None,
        })
    return {"path": str(target.relative_to(WORKSPACE)), "entries": entries}


@app.post("/api/files/read")
def read_file(req: FileRequest):
    """Read a file's content."""
    target = resolve(req.path)
    if not target.is_file():
        raise HTTPException(404, "file not found")
    try:
        content = target.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"path": req.path, "content": content, "size": len(content)}


@app.post("/api/files/write")
def write_file(req: WriteRequest):
    """Write content to a file (create or overwrite)."""
    target = resolve(req.path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(req.content, encoding="utf-8")
    return {"path": req.path, "size": len(req.content), "ok": True}


@app.post("/api/files/create")
def create_file(req: FileRequest):
    """Create an empty file."""
    target = resolve(req.path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.touch()
    return {"path": req.path, "ok": True}


@app.post("/api/files/mkdir")
def make_dir(req: FileRequest):
    """Create a directory (recursive)."""
    target = resolve(req.path)
    target.mkdir(parents=True, exist_ok=True)
    return {"path": req.path, "ok": True}


@app.post("/api/files/remove")
def remove_file(req: FileRequest):
    """Remove a file or directory."""
    target = resolve(req.path)
    if not target.exists():
        raise HTTPException(404, "not found")
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    return {"path": req.path, "ok": True}


@app.post("/api/files/move")
def move_file(req: MoveRequest):
    """Move / rename a file or directory."""
    src = resolve(req.src)
    dst = resolve(req.dst)
    if not src.exists():
        raise HTTPException(404, "source not found")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))
    return {"src": req.src, "dst": req.dst, "ok": True}


@app.post("/api/files/copy")
def copy_file(req: MoveRequest):
    """Copy a file or directory."""
    src = resolve(req.src)
    dst = resolve(req.dst)
    if not src.exists():
        raise HTTPException(404, "source not found")
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        shutil.copytree(str(src), str(dst))
    else:
        shutil.copy2(str(src), str(dst))
    return {"src": req.src, "dst": req.dst, "ok": True}


# ── Terminal sessions ────────────────────────
terminals: dict[str, subprocess.Popen] = {}


@app.post("/api/terminal/open")
def open_terminal(session_id: Optional[str] = None, cwd: str = "."):
    """Spawn a new shell session."""
    sid = session_id or f"term-{len(terminals)}"
    if sid in terminals and terminals[sid].poll() is None:
        return {"session_id": sid, "status": "already_running"}
    work = resolve(cwd)
    proc = subprocess.Popen(
        [os.environ.get("SHELL", "/bin/zsh")],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=str(work),
    )
    terminals[sid] = proc
    return {"session_id": sid, "pid": proc.pid, "status": "started"}


@app.post("/api/terminal/exec")
def exec_command(req: TerminalInput):
    """Send a command to an existing terminal session and return output."""
    proc = terminals.get(req.session_id)
    if not proc or proc.poll() is not None:
        raise HTTPException(404, "session not found or dead")
    try:
        proc.stdin.write((req.command + "\n").encode())
        proc.stdin.flush()
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"session_id": req.session_id, "sent": req.command, "ok": True}


@app.post("/api/terminal/run")
def run_command(command: str = "echo hello", cwd: str = "."):
    """Run a one-shot command and return stdout."""
    work = resolve(cwd)
    result = subprocess.run(
        command, shell=True, capture_output=True, text=True,
        cwd=str(work), timeout=30,
    )
    return {
        "command": command,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "returncode": result.returncode,
    }


@app.post("/api/terminal/close")
def close_terminal(session_id: str):
    """Kill a terminal session."""
    proc = terminals.pop(session_id, None)
    if not proc:
        raise HTTPException(404, "session not found")
    proc.terminate()
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()
    return {"session_id": session_id, "status": "closed"}


@app.get("/api/terminal/list")
def list_terminals():
    """List active terminal sessions."""
    result = []
    for sid, proc in list(terminals.items()):
        alive = proc.poll() is None
        if not alive:
            terminals.pop(sid, None)
        result.append({"session_id": sid, "pid": proc.pid, "alive": alive})
    return {"sessions": result}


# ── WebSocket for live terminal ──────────────
@app.websocket("/ws/terminal/{session_id}")
async def ws_terminal(ws: WebSocket, session_id: str):
    """Interactive terminal over WebSocket."""
    await ws.accept()

    work = WORKSPACE
    proc = await asyncio.create_subprocess_shell(
        os.environ.get("SHELL", "/bin/zsh"),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=str(work),
    )

    async def read_output():
        while True:
            data = await proc.stdout.read(4096)
            if not data:
                break
            await ws.send_text(data.decode(errors="replace"))

    reader_task = asyncio.create_task(read_output())

    try:
        while True:
            msg = await ws.receive_text()
            proc.stdin.write((msg + "\n").encode())
            await proc.stdin.drain()
    except WebSocketDisconnect:
        pass
    finally:
        reader_task.cancel()
        proc.terminate()


# ── WebSocket for file watching ──────────────
@app.websocket("/ws/files/watch")
async def ws_file_watch(ws: WebSocket, path: str = "."):
    """Push file-system changes to the client in real time."""
    await ws.accept()
    target = resolve(path)
    if not target.is_dir():
        await ws.close(code=1008, reason="not a directory")
        return

    def snapshot():
        entries = []
        try:
            for entry in sorted(target.iterdir()):
                entries.append({
                    "name": entry.name,
                    "type": "folder" if entry.is_dir() else "file",
                    "size": entry.stat().st_size if entry.is_file() else None,
                    "ext": entry.suffix.lstrip(".") if entry.is_file() else None,
                })
        except Exception:
            pass
        return entries

    prev = snapshot()
    try:
        while True:
            await asyncio.sleep(1)
            curr = snapshot()
            if curr != prev:
                prev_names = {e["name"] for e in prev}
                curr_names = {e["name"] for e in curr}
                added = [e for e in curr if e["name"] not in prev_names]
                removed = [e for e in prev if e["name"] not in curr_names]
                await ws.send_json({
                    "event": "change",
                    "path": path,
                    "entries": curr,
                    "added": added,
                    "removed": removed,
                })
                prev = curr
    except WebSocketDisconnect:
        pass


# ── Health ───────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "workspace": str(WORKSPACE)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
