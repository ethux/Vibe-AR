import { Router } from 'express';
import httpProxy from 'http-proxy';

const router = Router();
const CODECITY_URL = process.env.CODECITY_URL || 'http://code-city-server:5001';
const proxy = httpProxy.createProxyServer({ target: CODECITY_URL, changeOrigin: true });

router.all('/api/codecity/*', (req, res) => {
  req.url = req.url.replace('/api/codecity', '');
  proxy.web(req, res);
});

proxy.on('error', (err, req, res) => {
  console.error('[CODECITY PROXY]', err.message);
  if (!res.headersSent) res.status(502).json({ error: 'Code City service unavailable' });
});

export default router;
