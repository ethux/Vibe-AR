#!/usr/bin/env python3
"""
stream_screen.py — Browser-based Screen Capture → WebSocket Relay

Single port serves both the capture webpage AND the WebSocket relay.
Open https://localhost:9100 on Mac, click Share Screen, Quest sees it.

Usage:
    pip install websockets
    python stream_screen.py
"""

import asyncio
import argparse
import os
import ssl
import sys

try:
    import websockets
    from websockets.http11 import Response
except ImportError:
    print("Missing dependency: pip install websockets")
    sys.exit(1)


# ── Globals ──────────────────────────────────────────────────────────
viewers = set()
latest_frame = None
page_bytes = b""


# ── Capture page HTML ────────────────────────────────────────────────
CAPTURE_PAGE_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Screen Capture Sender</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #1a1a2e; color: #eee;
    font-family: system-ui, sans-serif;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    height: 100vh; gap: 16px;
  }
  #status { font-size: 14px; color: #888; }
  #status.live { color: #0f0; }
  #stats { font-size: 12px; color: #666; font-family: monospace; }
  .controls {
    display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
    justify-content: center;
  }
  select {
    padding: 8px 12px; font-size: 14px; border-radius: 6px;
    border: 1px solid #444; background: #2a2a3e; color: #eee;
    cursor: pointer;
  }
  button {
    padding: 12px 32px; font-size: 18px; cursor: pointer;
    border: none; border-radius: 8px;
    background: #4a9eff; color: #fff; font-weight: 600;
  }
  button:hover { background: #3a8eef; }
  button:disabled { background: #555; cursor: default; }
  label { font-size: 13px; color: #aaa; }
  video { display: none; }
  canvas { border: 1px solid #333; border-radius: 4px; max-width: 90vw; max-height: 50vh; }
</style>
</head>
<body>
  <h2>Screen Stream Sender</h2>
  <p id="status">Not sharing</p>

  <div class="controls">
    <div>
      <label>Resolution</label><br>
      <select id="resolution">
        <option value="640">640p (Fast)</option>
        <option value="960">960p</option>
        <option value="1280" selected>1280p (Balanced)</option>
        <option value="1600">1600p</option>
        <option value="1920">1920p (Full HD)</option>
        <option value="0">Native (no resize)</option>
      </select>
    </div>
    <div>
      <label>Quality</label><br>
      <select id="quality">
        <option value="0.5">Low (small files)</option>
        <option value="0.7">Medium</option>
        <option value="0.85" selected>High</option>
        <option value="0.95">Max</option>
      </select>
    </div>
    <div>
      <label>FPS</label><br>
      <select id="fps">
        <option value="5">5 fps (Smooth quality)</option>
        <option value="10" selected>10 fps (Balanced)</option>
        <option value="15">15 fps</option>
        <option value="24">24 fps</option>
        <option value="30">30 fps (Fast)</option>
      </select>
    </div>
  </div>

  <button id="btn" onclick="startCapture()">Share Screen</button>
  <canvas id="preview"></canvas>
  <p id="stats"></p>
  <video id="vid" autoplay muted></video>
<script>
let ws, stream, timer, sending = false;
let framesSent = 0, bytesSent = 0, fpsActual = 0;
let fpsCount = 0, fpsTimer = performance.now();

function getSettings() {
  return {
    scale: parseInt(document.getElementById('resolution').value),
    quality: parseFloat(document.getElementById('quality').value),
    fps: parseInt(document.getElementById('fps').value),
  };
}

async function startCapture() {
  const btn = document.getElementById('btn');
  const status = document.getElementById('status');
  const s = getSettings();

  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: s.fps, max: 30 } }
    });
  } catch(e) {
    status.textContent = 'Screen share cancelled';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sharing...';

  const vid = document.getElementById('vid');
  vid.srcObject = stream;
  await vid.play();

  const canvas = document.getElementById('preview');
  const ctx = canvas.getContext('2d');

  function resizeCanvas() {
    const set = getSettings();
    const aspect = vid.videoWidth / vid.videoHeight;
    if (set.scale === 0 || set.scale >= vid.videoWidth) {
      canvas.width = vid.videoWidth;
      canvas.height = vid.videoHeight;
    } else {
      canvas.width = set.scale;
      canvas.height = Math.round(set.scale / aspect);
    }
  }
  resizeCanvas();

  // Live-update resolution without restarting
  document.getElementById('resolution').onchange = resizeCanvas;

  // Connect WebSocket
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(proto + '://' + location.host + '/sender');
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    status.textContent = 'LIVE — streaming to viewers';
    status.className = 'live';
    startSendLoop(vid, canvas, ctx);
  };

  ws.onerror = (e) => {
    console.error('WebSocket error', e);
    status.textContent = 'WebSocket error — check console';
    status.className = '';
  };

  ws.onclose = () => {
    status.textContent = 'Disconnected — refresh to retry';
    status.className = '';
    cleanup();
  };

  stream.getVideoTracks()[0].onended = () => {
    status.textContent = 'Share ended';
    status.className = '';
    cleanup();
    btn.disabled = false;
    btn.textContent = 'Share Screen';
  };

  // Live-update FPS without restarting
  document.getElementById('fps').onchange = () => {
    if (sending) {
      stopSendLoop();
      startSendLoop(vid, canvas, ctx);
    }
  };
}

function startSendLoop(vid, canvas, ctx) {
  sending = true;
  const stats = document.getElementById('stats');

  function sendFrame() {
    if (!sending) return;
    const s = getSettings();

    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(blob => {
      if (!sending) return;
      if (blob && ws && ws.readyState === 1) {
        // Only send if previous send is done (backpressure)
        if (ws.bufferedAmount < 512 * 1024) {
          blob.arrayBuffer().then(buf => {
            if (ws && ws.readyState === 1) ws.send(buf);
            framesSent++;
            bytesSent += buf.byteLength;
            fpsCount++;
          });
        }
      }

      // Update stats
      const now = performance.now();
      if (now - fpsTimer >= 1000) {
        fpsActual = fpsCount;
        fpsCount = 0;
        fpsTimer = now;
        stats.textContent = canvas.width + 'x' + canvas.height
          + '  |  ' + fpsActual + ' fps'
          + '  |  ' + (bytesSent / 1048576).toFixed(1) + ' MB sent'
          + '  |  ~' + (blob ? (blob.size / 1024).toFixed(0) : '?') + ' KB/frame';
      }

      // Schedule next frame
      if (sending) timer = setTimeout(sendFrame, 1000 / s.fps);
    }, 'image/jpeg', s.quality);
  }

  sendFrame();
}

function stopSendLoop() {
  sending = false;
  if (timer) { clearTimeout(timer); timer = null; }
}

function cleanup() {
  stopSendLoop();
  if (ws) { ws.close(); ws = null; }
}
</script>
</body>
</html>
"""


# ── Intercept HTTP to serve capture page, else upgrade to WS ─────────
async def process_request(connection, request):
    """
    websockets v13+ process_request: return a Response to serve HTTP,
    or None to continue with WebSocket upgrade.
    """
    # If it's NOT a WebSocket upgrade request, serve the HTML page
    if request.headers.get("Upgrade", "").lower() != "websocket":
        return Response(200, "OK", websockets.Headers([
            ("Content-Type", "text/html; charset=utf-8"),
            ("Content-Length", str(len(page_bytes))),
        ]), page_bytes)
    # Otherwise let the WebSocket handshake proceed
    return None


# ── WebSocket handler ────────────────────────────────────────────────
async def handler(ws):
    global latest_frame

    # Determine sender vs viewer from the path
    is_sender = False
    try:
        is_sender = '/sender' in ws.request.path
    except Exception:
        pass

    if is_sender:
        print("[+] Sender connected")
        try:
            async for message in ws:
                if isinstance(message, bytes):
                    latest_frame = message
                    for v in viewers.copy():
                        try:
                            await v.send(message)
                        except Exception:
                            viewers.discard(v)
        except websockets.ConnectionClosed:
            pass
        finally:
            print("[-] Sender disconnected")
    else:
        viewers.add(ws)
        print(f"[+] Viewer connected ({len(viewers)} total)")
        if latest_frame:
            try:
                await ws.send(latest_frame)
            except Exception:
                viewers.discard(ws)
                return
        try:
            async for _ in ws:
                pass
        except websockets.ConnectionClosed:
            pass
        finally:
            viewers.discard(ws)
            print(f"[-] Viewer disconnected ({len(viewers)} total)")


# ── Main ─────────────────────────────────────────────────────────────
async def main(args):
    global page_bytes

    script_dir = os.path.dirname(os.path.abspath(__file__))
    cert_path = os.path.join(script_dir, "cert.pem")
    key_path = os.path.join(script_dir, "key.pem")

    page_bytes = CAPTURE_PAGE_TEMPLATE.encode('utf-8')

    ssl_context = None
    scheme = "https"
    if os.path.exists(cert_path) and os.path.exists(key_path):
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(cert_path, key_path)
    else:
        scheme = "http"

    print(f"Screen stream relay running on port {args.port}")
    print(f"")
    print(f"  1. Open {scheme}://localhost:{args.port} on Mac browser")
    print(f"     Click 'Share Screen' to start capturing")
    print(f"")
    print(f"  2. Quest auto-connects to wss://<your-ip>:{args.port}")
    print(f"")

    async with websockets.serve(
        handler, "0.0.0.0", args.port,
        ssl=ssl_context,
        process_request=process_request,
        max_size=2**24,  # 16MB max frame for high-res
    ):
        await asyncio.Future()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Browser screen capture relay server")
    parser.add_argument("--port", type=int, default=9100)
    args = parser.parse_args()

    try:
        asyncio.run(main(args))
    except KeyboardInterrupt:
        print("\nStopped.")
