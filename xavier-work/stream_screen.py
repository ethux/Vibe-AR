#!/usr/bin/env python3
"""
stream_screen.py — Pure Python Screen Capture → WebSocket JPEG Server

Captures the Mac screen using mss (no FFmpeg, no browser needed) and
streams JPEG frames over WebSocket to Quest viewers.

Usage:
    pip install websockets mss Pillow
    python stream_screen.py
"""

import asyncio
import argparse
import io
import json
import os
import ssl
import sys
import time

try:
    import websockets
except ImportError:
    print("pip install websockets")
    sys.exit(1)

try:
    import mss
except ImportError:
    print("pip install mss")
    sys.exit(1)

try:
    from PIL import Image
except ImportError:
    print("pip install Pillow")
    sys.exit(1)

try:
    import pyautogui
    pyautogui.FAILSAFE = False  # don't throw if cursor hits corner
    pyautogui.PAUSE = 0         # no delay between actions
except ImportError:
    pyautogui = None
    print("WARNING: pip install pyautogui — remote cursor control disabled")


# ── Globals ──────────────────────────────────────────────────────────
viewers = set()
latest_frame = None
screen_w = 0
screen_h = 0


# ── Screen capture loop (runs in a thread) ───────────────────────────
def capture_loop(fps, scale, quality):
    """Grab screen, resize, compress to JPEG, store as latest_frame."""
    global latest_frame, screen_w, screen_h
    interval = 1.0 / fps

    with mss.mss() as sct:
        monitor = sct.monitors[1]  # primary screen
        screen_w = monitor['width']
        screen_h = monitor['height']
        print(f"Capturing: {screen_w}x{screen_h} → scale {scale}px, "
              f"quality {quality}%, {fps} fps")

        while True:
            t0 = time.monotonic()

            # Grab screen
            shot = sct.grab(monitor)
            img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")

            # Resize if needed
            if scale > 0 and scale < img.width:
                aspect = img.height / img.width
                img = img.resize((scale, int(scale * aspect)), Image.LANCZOS)

            # Compress to JPEG
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality, optimize=True)
            latest_frame = buf.getvalue()

            # Sleep remainder of frame interval
            elapsed = time.monotonic() - t0
            if elapsed < interval:
                time.sleep(interval - elapsed)


# ── Broadcast frames to all viewers ──────────────────────────────────
async def broadcast_loop(fps):
    """Push latest frame to all connected viewers."""
    interval = 1.0 / fps
    last_frame = None

    while True:
        frame = latest_frame
        if frame and frame is not last_frame and viewers:
            last_frame = frame
            dead = set()
            for v in viewers.copy():
                try:
                    await v.send(frame)
                except Exception:
                    dead.add(v)
            viewers.difference_update(dead)
        await asyncio.sleep(interval)


# ── Mouse control from Quest ─────────────────────────────────────────
def handle_mouse_command(msg):
    """Process a JSON mouse command from the Quest viewer."""
    if not pyautogui or screen_w == 0:
        return
    try:
        data = json.loads(msg)
        u = data.get('u', 0)
        v = data.get('v', 0)
        # Convert UV (0-1) to screen pixel coordinates
        px = int(u * screen_w)
        py = int(v * screen_h)
        px = max(0, min(screen_w - 1, px))
        py = max(0, min(screen_h - 1, py))

        cmd = data.get('type')
        if cmd == 'move':
            pyautogui.moveTo(px, py, _pause=False)
        elif cmd == 'click':
            pyautogui.click(px, py, _pause=False)
    except Exception as e:
        print(f"[mouse] error: {e}")


# ── WebSocket handler ────────────────────────────────────────────────
async def handler(ws):
    viewers.add(ws)
    print(f"[+] Viewer connected ({len(viewers)} total)")
    # Send latest frame right away
    if latest_frame:
        try:
            await ws.send(latest_frame)
        except Exception:
            viewers.discard(ws)
            return
    try:
        async for message in ws:
            # Binary = ignore, Text = JSON mouse command
            if isinstance(message, str):
                handle_mouse_command(message)
    except websockets.ConnectionClosed:
        pass
    finally:
        viewers.discard(ws)
        print(f"[-] Viewer disconnected ({len(viewers)} total)")


# ── Main ─────────────────────────────────────────────────────────────
async def main(args):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    cert_path = os.path.join(script_dir, "cert.pem")
    key_path = os.path.join(script_dir, "key.pem")

    ssl_context = None
    scheme = "wss"
    if os.path.exists(cert_path) and os.path.exists(key_path):
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(cert_path, key_path)
    else:
        scheme = "ws"

    # Start screen capture in background thread
    import threading
    capture_thread = threading.Thread(
        target=capture_loop,
        args=(args.fps, args.scale, args.quality),
        daemon=True,
    )
    capture_thread.start()

    # Start broadcast task
    asyncio.create_task(broadcast_loop(args.fps))

    print(f"Screen stream server on {scheme}://0.0.0.0:{args.port}")
    print(f"  --fps {args.fps}  --scale {args.scale}  --quality {args.quality}")
    print()

    async with websockets.serve(
        handler, "0.0.0.0", args.port,
        ssl=ssl_context,
        max_size=2**24,
    ):
        await asyncio.Future()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Python screen capture → WebSocket stream")
    parser.add_argument("--port", type=int, default=9100)
    parser.add_argument("--fps", type=int, default=10, help="Frames per second (default: 10)")
    parser.add_argument("--scale", type=int, default=1280, help="Output width in px, 0=native (default: 1280)")
    parser.add_argument("--quality", type=int, default=85, help="JPEG quality 1-100 (default: 85)")
    args = parser.parse_args()

    try:
        asyncio.run(main(args))
    except KeyboardInterrupt:
        print("\nStopped.")
