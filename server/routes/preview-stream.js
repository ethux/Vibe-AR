// ─── Preview Stream (Puppeteer-based page capture + WebSocket broadcast) ───
// Takes screenshots of the dev server page using Puppeteer (headless Chromium)
// and broadcasts JPEG frames over WebSocket to Quest viewers.
// No Python required — runs entirely in Node.js.
import { Router } from 'express';
import { WebSocketServer } from 'ws';

let browser = null;
let page = null;
let captureInterval = null;
let streamUrl = null;
let viewers = new Set();
let wss = null;
let latestFrame = null;

const FPS = 5;
const WIDTH = 1280;
const HEIGHT = 960;
const QUALITY = 70;

const router = Router();

// Lazy-load puppeteer to avoid crashes if not installed
async function getPuppeteer() {
  try {
    return await import('puppeteer');
  } catch {
    console.error('[PREVIEW-STREAM] puppeteer not available');
    return null;
  }
}

// Start page capture for a dev server port
router.post('/api/devserver/start-stream', async (req, res) => {
  const { port, url } = req.body;
  const targetUrl = url || `http://vibe-terminal:${port}/`;
  console.log(`[PREVIEW-STREAM] start-stream request: port=${port} url=${targetUrl}`);

  if (browser && streamUrl === targetUrl) {
    console.log(`[PREVIEW-STREAM] Stream already running for ${targetUrl}`);
    return res.json({ status: 'already-running', url: streamUrl });
  }

  // Stop existing stream
  console.log('[PREVIEW-STREAM] Stopping existing stream (if any)...');
  await stopStream();

  const puppeteer = await getPuppeteer();
  if (!puppeteer) {
    console.error('[PREVIEW-STREAM] puppeteer import failed — not installed');
    return res.status(500).json({ error: 'puppeteer not available' });
  }

  try {
    console.log('[PREVIEW-STREAM] Launching Puppeteer browser...');
    const t0 = Date.now();
    browser = await puppeteer.default.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
      ],
    });
    console.log(`[PREVIEW-STREAM] Browser launched in ${Date.now() - t0}ms`);

    page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT });
    console.log(`[PREVIEW-STREAM] Page created, viewport set to ${WIDTH}x${HEIGHT}`);

    console.log(`[PREVIEW-STREAM] Navigating to ${targetUrl}...`);
    const t1 = Date.now();
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      console.log(`[PREVIEW-STREAM] Navigation complete in ${Date.now() - t1}ms`);
    } catch (e) {
      console.log(`[PREVIEW-STREAM] Initial nav failed after ${Date.now() - t1}ms: ${e.message}, will retry on next frame`);
    }

    streamUrl = targetUrl;

    // Start capture loop
    const interval = 1000 / FPS;
    let frameCount = 0;
    let lastLogTime = Date.now();
    captureInterval = setInterval(async () => {
      if (!page || page.isClosed()) return;
      try {
        const screenshot = await page.screenshot({
          type: 'jpeg',
          quality: QUALITY,
          fullPage: false,
        });
        latestFrame = screenshot;
        frameCount++;

        // Log every 30 seconds
        if (Date.now() - lastLogTime > 30000) {
          console.log(`[PREVIEW-STREAM] Capture running: ${frameCount} frames, ${viewers.size} viewers, frame=${(screenshot.length / 1024).toFixed(1)}KB`);
          lastLogTime = Date.now();
        }

        // Broadcast to all connected viewers
        const dead = [];
        for (const ws of viewers) {
          if (ws.readyState === 1) {
            try { ws.send(screenshot); } catch { dead.push(ws); }
          } else {
            dead.push(ws);
          }
        }
        if (dead.length > 0) {
          dead.forEach(ws => viewers.delete(ws));
          console.log(`[PREVIEW-STREAM] Removed ${dead.length} dead viewer(s), ${viewers.size} remaining`);
        }
      } catch (e) {
        console.warn(`[PREVIEW-STREAM] Screenshot failed: ${e.message}`);
        // Page might have navigated, try to recover
        try {
          if (page && !page.isClosed()) {
            console.log(`[PREVIEW-STREAM] Attempting page recovery → ${streamUrl}`);
            await page.goto(streamUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
            console.log('[PREVIEW-STREAM] Page recovered');
          }
        } catch (re) {
          console.error(`[PREVIEW-STREAM] Recovery failed: ${re.message}`);
        }
      }
    }, interval);

    console.log(`[PREVIEW-STREAM] Started capture loop at ${FPS}fps for ${targetUrl}, ${viewers.size} viewer(s) waiting`);
    res.json({ status: 'started', url: targetUrl });
  } catch (err) {
    console.error('[PREVIEW-STREAM] Failed to start:', err.message, err.stack);
    await stopStream();
    res.status(500).json({ error: err.message });
  }
});

// Stop page capture stream
router.post('/api/devserver/stop-stream', async (req, res) => {
  console.log('[PREVIEW-STREAM] stop-stream request received');
  await stopStream();
  res.json({ status: 'stopped' });
});

// Refresh the preview page (reload in Puppeteer)
router.post('/api/devserver/refresh-preview', async (req, res) => {
  console.log('[PREVIEW-STREAM] refresh-preview request received');
  if (!page || page.isClosed()) {
    console.warn('[PREVIEW-STREAM] No active page to refresh');
    return res.status(404).json({ error: 'No active preview stream' });
  }
  try {
    const t0 = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
    console.log(`[PREVIEW-STREAM] Page refreshed in ${Date.now() - t0}ms`);
    res.json({ status: 'refreshed', url: streamUrl });
  } catch (e) {
    console.error('[PREVIEW-STREAM] Refresh failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get stream status
router.get('/api/devserver/stream-status', (req, res) => {
  const status = {
    running: !!browser,
    url: streamUrl,
    viewers: viewers.size,
    hasLatestFrame: !!latestFrame,
    frameSize: latestFrame ? latestFrame.length : 0,
  };
  console.log(`[PREVIEW-STREAM] stream-status: ${JSON.stringify(status)}`);
  res.json(status);
});

async function stopStream() {
  console.log(`[PREVIEW-STREAM] Stopping stream... (browser=${!!browser}, page=${!!page}, interval=${!!captureInterval})`);
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }
  if (page) {
    try { await page.close(); } catch (e) { console.warn(`[PREVIEW-STREAM] page.close error: ${e.message}`); }
    page = null;
  }
  if (browser) {
    try { await browser.close(); } catch (e) { console.warn(`[PREVIEW-STREAM] browser.close error: ${e.message}`); }
    browser = null;
  }
  streamUrl = null;
  latestFrame = null;
  console.log('[PREVIEW-STREAM] Stopped');
}

// Set up WebSocket server for preview stream (called from index.js)
export function setupPreviewStreamWs(server) {
  wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    viewers.add(ws);
    console.log(`[PREVIEW-STREAM] Viewer connected (${viewers.size} total)`);

    // Send latest frame immediately so viewer sees something right away
    if (latestFrame) {
      try { ws.send(latestFrame); } catch {}
    }

    ws.on('close', () => {
      viewers.delete(ws);
      console.log(`[PREVIEW-STREAM] Viewer disconnected (${viewers.size} total)`);
    });

    ws.on('error', () => {
      viewers.delete(ws);
    });
  });

  return {
    upgrade: (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    },
  };
}

export default router;
