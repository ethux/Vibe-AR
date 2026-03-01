import { Router } from 'express';
import httpProxy from 'http-proxy';
import { Readable } from 'node:stream';

function streamFromString(str) {
  const s = new Readable();
  s.push(str);
  s.push(null);
  return s;
}

const router = Router();
const COMPANION_URL = process.env.COMPANION_URL || 'http://companion:8000';
const proxy = httpProxy.createProxyServer({ target: COMPANION_URL, changeOrigin: true, ws: true });

router.all('/api/companion/*', (req, res) => {
  req.url = req.url.replace('/api/companion', '/api');
  // express.json() consumes the body stream — re-serialize it for the proxy
  if (req.body && Object.keys(req.body).length > 0) {
    const bodyStr = JSON.stringify(req.body);
    req.headers['content-length'] = Buffer.byteLength(bodyStr);
    proxy.web(req, res, { buffer: streamFromString(bodyStr) });
  } else {
    proxy.web(req, res);
  }
});

proxy.on('error', (err, req, res) => {
  console.error('[COMPANION PROXY]', err.message);
  if (!res.headersSent && res.status) res.status(502).json({ error: 'Companion service unavailable' });
});

// Export proxy for WebSocket upgrade handling in server/index.js
export { proxy as companionProxy };
export default router;
