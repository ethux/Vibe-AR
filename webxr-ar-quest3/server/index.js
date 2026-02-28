import express from 'express';
import { createServer } from 'https';
import { createServer as createHttpServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { noCache } from './middleware/cache.js';
import { setupTerminalProxy } from './routes/terminal.js';
import chatRoutes from './routes/chat.js';
import transcribeRoutes from './routes/transcribe.js';
import ttsRoutes from './routes/tts.js';
import debugRoutes from './routes/debug.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Load .env
try {
  const env = readFileSync(join(rootDir, '.env'), 'utf8');
  env.split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
} catch {}

const app = express();
const PORT = process.env.PORT || 3000;
const TTYD_URL = process.env.TTYD_URL || 'http://localhost:7681';

app.use(noCache);
app.use(express.static(join(rootDir, 'public')));
app.use(express.json({ limit: '10mb' }));

// Routes
app.use(chatRoutes);
app.use(transcribeRoutes);
app.use(ttsRoutes);
app.use(debugRoutes);

// Catch-all error logging
app.use((err, req, res, next) => {
  console.error(`[SERVER ERROR] ${req.method} ${req.url}:`, err.message);
  res.status(500).json({ error: err.message });
});

// HTTPS server
const sslOptions = {
  key: readFileSync(join(rootDir, 'certs', 'key.pem')),
  cert: readFileSync(join(rootDir, 'certs', 'cert.pem')),
};

const server = createServer(sslOptions, app);
const proxy = setupTerminalProxy(app, server, TTYD_URL);

server.listen(PORT, () => {
  console.log(`HTTPS server running on port ${PORT}`);
  console.log(`ttyd proxied from ${TTYD_URL} → /terminal/`);
});

// HTTP server for ngrok (port 3001)
const httpServer = createHttpServer(app);
httpServer.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/terminal')) {
    req.url = req.url.replace(/^\/terminal/, '');
    proxy.ws(req, socket, head);
  }
});
httpServer.listen(3001, () => {
  console.log(`HTTP server running on port 3001 (for ngrok)`);
});
