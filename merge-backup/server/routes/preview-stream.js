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

  if (browser && streamUrl === targetUrl) {
    return res.json({ status: 'already-running', url: streamUrl });
  }

  // Stop existing stream
  await stopStream();

  const puppeteer = await getPuppeteer();
  if (!puppeteer) {
    return res.status(500).json({ error: 'puppeteer not available' });
  }

  try {
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

    page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT });

    console.log(`[PREVIEW-STREAM] Navigating to ${targetUrl}...`);
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (e) {
      console.log(`[PREVIEW-STREAM] Initial nav: ${e.message}, will retry on next frame`);
    }

    streamUrl = targetUrl;

    // Start capture loop
    const interval = 1000 / FPS;
    captureInterval = setInterval(async () => {
      if (!page || page.isClosed()) return;
      try {
        const screenshot = await page.screenshot({
          type: 'jpeg',
          quality: QUALITY,
          fullPage: false,
        });
        latestFrame = screenshot;

        // Broadcast to all connected viewers
        const dead = [];
        for (const ws of viewers) {
          if (ws.readyState === 1) {
            try { ws.send(screenshot); } catch { dead.push(ws); }
          } else {
            dead.push(ws);
          }
        }
        dead.forEach(ws => viewers.delete(ws));
      } catch (e) {
        // Page might have navigated, try to recover
        try {
          if (page && !page.isClosed()) {
            await page.goto(streamUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
          }
        } catch {}
      }
    }, interval);

    console.log(`[PREVIEW-STREAM] Started Puppeteer capture for ${targetUrl}`);
    res.json({ status: 'started', url: targetUrl });
  } catch (err) {
    console.error('[PREVIEW-STREAM] Failed to start:', err.message);
    await stopStream();
    res.status(500).json({ error: err.message });
  }
});

// Stop page capture stream
router.post('/api/devserver/stop-stream', async (req, res) => {
  await stopStream();
  res.json({ status: 'stopped' });
});

// Refresh the preview page (reload in Puppeteer)
router.post('/api/devserver/refresh-preview', async (req, res) => {
  if (!page || page.isClosed()) {
    return res.status(404).json({ error: 'No active preview stream' });
  }
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
    console.log('[PREVIEW-STREAM] Page refreshed');
    res.json({ status: 'refreshed', url: streamUrl });
  } catch (e) {
    console.error('[PREVIEW-STREAM] Refresh failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get stream status
router.get('/api/devserver/stream-status', (req, res) => {
  res.json({
    running: !!browser,
    url: streamUrl,
    viewers: viewers.size,
  });
});

async function stopStream() {
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }
  if (page) {
    try { await page.close(); } catch {}
    page = null;
  }
  if (browser) {
    try { await browser.close(); } catch {}
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
