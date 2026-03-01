// Proxy requests to dev servers running inside vibe-terminal container.
// /api/devserver/:port/* → http://vibe-terminal:{port}/*
import { Router } from 'express';
import httpProxy from 'http-proxy';
import http from 'node:http';

const router = Router();

// One proxy per port (reuse connections)
const proxies = new Map();

function getProxy(port) {
  if (!proxies.has(port)) {
    const p = httpProxy.createProxyServer({
      target: `http://vibe-terminal:${port}`,
      changeOrigin: true,
      ws: true,
    });
    p.on('error', (err, req, res) => {
      if (res && !res.headersSent && typeof res.status === 'function') {
        res.status(502).json({ error: `Dev server on port ${port} not reachable` });
      }
    });
    proxies.set(port, p);
  }
  return proxies.get(port);
}

// Health check endpoint
router.get('/api/devserver/:port/health', (req, res) => {
  const port = parseInt(req.params.port, 10);
  if (!port || port < 1 || port > 65535) return res.status(400).json({ error: 'Invalid port' });

  let replied = false;
  const reply = (data) => { if (!replied) { replied = true; res.json(data); } };

  const hreq = http.get(`http://vibe-terminal:${port}/`, { timeout: 3000 }, (hres) => {
    hres.resume(); // drain response body
    reply({ status: 'up', httpStatus: hres.statusCode });
  });
  hreq.on('error', () => reply({ status: 'down' }));
  hreq.on('timeout', () => { hreq.destroy(); reply({ status: 'down' }); });
});

// Proxy all other requests
router.all('/api/devserver/:port/*', (req, res) => {
  const port = parseInt(req.params.port, 10);
  if (!port || port < 1 || port > 65535) return res.status(400).json({ error: 'Invalid port' });

  // Strip /api/devserver/:port prefix
  req.url = req.url.replace(`/api/devserver/${port}`, '') || '/';
  getProxy(port).web(req, res);
});

export default router;
