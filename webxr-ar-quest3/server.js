import express from 'express';
import { createServer } from 'https';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import httpProxy from 'http-proxy';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
try {
  const env = readFileSync(join(__dirname, '.env'), 'utf8');
  env.split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
} catch {}

const app = express();
const PORT = process.env.PORT || 3000;
const TTYD_URL = process.env.TTYD_URL || 'http://localhost:7681';

app.use(express.static(join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

// ─── Proxy ttyd HTTP requests (/terminal/*) ───
const proxy = httpProxy.createProxyServer({ target: TTYD_URL, ws: true });
proxy.on('error', (err) => console.error('Proxy error:', err.message));

app.all('/terminal/*', (req, res) => {
  req.url = req.url.replace(/^\/terminal/, '');
  proxy.web(req, res);
});

// Expose config to frontend — ttyd is now at /terminal/ on the same origin
app.get('/api/config', (req, res) => {
  res.json({ ttydUrl: '/terminal/' });
});

// ─── API Proxies (voice pipeline) ───
app.post('/api/chat', async (req, res) => {
  try {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: req.body.model || 'mistral-small-latest',
        messages: req.body.messages,
        max_tokens: req.body.max_tokens || 200,
        temperature: req.body.temperature || 0.7,
      }),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Chat API error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transcribe', async (req, res) => {
  try {
    const { audio, mimeType } = req.body;
    const audioBuffer = Buffer.from(audio, 'base64');
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: mimeType || 'audio/webm' }), 'recording.webm');
    formData.append('model', 'voxtral-mini-latest');
    formData.append('language', 'en');
    const response = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}` },
      body: formData,
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Transcribe API error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tts', async (req, res) => {
  if (!process.env.ELEVENLABS_API_KEY) {
    return res.status(501).json({ error: 'ElevenLabs not configured' });
  }
  try {
    const { text, voice_id } = req.body;
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice_id || '21m00Tcm4TlvDq8ikWAM'}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );
    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }
    res.set('Content-Type', 'audio/mpeg');
    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('TTS API error:', err);
    res.status(500).json({ error: err.message });
  }
});

const sslOptions = {
  key: readFileSync(join(__dirname, 'certs', 'key.pem')),
  cert: readFileSync(join(__dirname, 'certs', 'cert.pem')),
};

const server = createServer(sslOptions, app);

// Proxy WebSocket upgrades for ttyd
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/terminal')) {
    req.url = req.url.replace(/^\/terminal/, '');
    proxy.ws(req, socket, head);
  }
});

server.listen(PORT, () => {
  console.log(`Server running at https://192.0.0.2:${PORT}`);
  console.log(`ttyd proxied from ${TTYD_URL} → /terminal/`);
});
