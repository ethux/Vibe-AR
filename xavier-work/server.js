const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT = 8443;

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
  console.log(`\n  🔒 HTTPS server running!\n`);
  console.log(`  Local:   https://localhost:${PORT}`);
  console.log(`  Network: https://${lanIP}:${PORT}`);
  console.log(`\n  Open the Network URL on your Meta Quest browser.`);
  console.log(`  You'll need to accept the self-signed certificate warning.\n`);
});
