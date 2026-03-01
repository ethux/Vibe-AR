#!/usr/bin/env python3
"""
stream_page.py — Headless Browser Page Capture → WebSocket JPEG Server

Captures a specific web page using Playwright and streams JPEG screenshots
over WebSocket to Quest viewers. Used by LivePreview to show dev server
output in a 3D window.

Usage:
    pip install websockets playwright
    playwright install chromium
    python stream_page.py --url http://localhost:3000 --port 9200
"""

import asyncio
import argparse
import io
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
    from playwright.async_api import async_playwright
except ImportError:
    print("pip install playwright && playwright install chromium")
    sys.exit(1)


# ── Globals ──────────────────────────────────────────────────────────
viewers = set()
latest_frame = None
page_url = None
browser_page = None


# ── Page capture loop ────────────────────────────────────────────────
async def capture_loop(url, fps, width, height, quality):
    """Open headless browser, navigate to URL, screenshot in loop."""
    global latest_frame, browser_page, page_url

    page_url = url
    interval = 1.0 / fps

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": width, "height": height},
            device_scale_factor=1,
        )
        page = await context.new_page()
        browser_page = page

        print(f"Navigating to {url}...")
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        except Exception as e:
            print(f"Initial navigation failed: {e}, will retry...")

        print(f"Capturing: {width}x{height}, quality {quality}%, {fps} fps")

        while True:
            t0 = time.monotonic()

            try:
                # Check if page is still valid
                if page.is_closed():
                    page = await context.new_page()
                    browser_page = page
                    await page.goto(url, wait_until="domcontentloaded", timeout=10000)

                # Screenshot as JPEG bytes
                screenshot = await page.screenshot(
                    type="jpeg",
                    quality=quality,
                    full_page=False,
                )
                latest_frame = screenshot

            except Exception as e:
                # Page might have navigated or crashed, try to recover
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=10000)
                except Exception:
                    pass

            # Sleep remainder of frame interval
            elapsed = time.monotonic() - t0
            if elapsed < interval:
                await asyncio.sleep(interval - elapsed)
            else:
                await asyncio.sleep(0.01)  # yield


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
        async for msg in ws:
            # Handle control messages
            if isinstance(msg, str):
                if msg.startswith("navigate:"):
                    new_url = msg[9:].strip()
                    if browser_page and not browser_page.is_closed():
                        try:
                            await browser_page.goto(new_url, wait_until="domcontentloaded", timeout=10000)
                            print(f"Navigated to {new_url}")
                        except Exception as e:
                            print(f"Navigation failed: {e}")
                elif msg == "reload":
                    if browser_page and not browser_page.is_closed():
                        try:
                            await browser_page.reload(wait_until="domcontentloaded", timeout=10000)
                            print("Page reloaded")
                        except Exception as e:
                            print(f"Reload failed: {e}")
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

    # Start page capture
    asyncio.create_task(capture_loop(args.url, args.fps, args.width, args.height, args.quality))

    # Start broadcast task
    asyncio.create_task(broadcast_loop(args.fps))

    print(f"Page stream server on {scheme}://0.0.0.0:{args.port}")
    print(f"  --url {args.url}")
    print(f"  --fps {args.fps}  --width {args.width}  --height {args.height}  --quality {args.quality}")
    print()

    async with websockets.serve(
        handler, "0.0.0.0", args.port,
        ssl=ssl_context,
        max_size=2**24,
    ):
        await asyncio.Future()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Headless browser page capture → WebSocket stream")
    parser.add_argument("--url", type=str, required=True, help="URL to capture (e.g., http://localhost:3000)")
    parser.add_argument("--port", type=int, default=9200, help="WebSocket server port (default: 9200)")
    parser.add_argument("--fps", type=int, default=5, help="Frames per second (default: 5)")
    parser.add_argument("--width", type=int, default=1280, help="Browser viewport width (default: 1280)")
    parser.add_argument("--height", type=int, default=960, help="Browser viewport height (default: 960)")
    parser.add_argument("--quality", type=int, default=80, help="JPEG quality 1-100 (default: 80)")
    args = parser.parse_args()

    try:
        asyncio.run(main(args))
    except KeyboardInterrupt:
        print("\nStopped.")
