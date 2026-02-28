import { Router } from 'express';
import httpProxy from 'http-proxy';

const router = Router();
const COMPANION_URL = process.env.COMPANION_URL || 'http://companion:8000';
const proxy = httpProxy.createProxyServer({ target: COMPANION_URL, changeOrigin: true, ws: true });

router.all('/api/companion/*', (req, res) => {
  req.url = req.url.replace('/api/companion', '/api');
  proxy.web(req, res);
});

proxy.on('error', (err, req, res) => {
  console.error('[COMPANION PROXY]', err.message);
  if (!res.headersSent && res.status) res.status(502).json({ error: 'Companion service unavailable' });
});

// Export proxy for WebSocket upgrade handling in server/index.js
export { proxy as companionProxy };
export default router;
