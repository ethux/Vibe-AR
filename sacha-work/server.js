const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const PORT = 8443;
const COMPANION = 'http://localhost:8080';

const options = {
  key:  fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

const server = https.createServer(options, (req, res) => {
  // Proxy /api/* → companion server
  if (req.url.startsWith('/api/')) {
    const target = COMPANION + req.url;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const parsed = new URL(target);
      const proxyReq = http.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: req.method,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': proxyRes.headers['content-type'] || 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        proxyRes.pipe(res);
      });
      proxyReq.on('error', (err) => {
        res.writeHead(502);
        res.end(JSON.stringify({ error: 'companion not reachable', detail: err.message }));
      });
      if (body) proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // Static files
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  let lanIP = 'localhost';
  for (const iface of Object.values(nets)) {
    for (const cfg of iface) {
      if (cfg.family === 'IPv4' && !cfg.internal) { lanIP = cfg.address; break; }
    }
  }
  console.log(`\n  HTTPS server running!\n`);
  console.log(`  Local:   https://localhost:${PORT}`);
  console.log(`  Network: https://${lanIP}:${PORT}`);
  console.log(`  Companion proxy: ${COMPANION}/api/*\n`);
});
