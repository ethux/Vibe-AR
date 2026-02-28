// ─── Mistral API Proxy (MITM) ───
// Transparent proxy for ALL Vibe→Mistral API calls.
// Captures assistant chat responses for TTS.
import { Router } from 'express';

const router = Router();
const MISTRAL_API = 'https://api.mistral.ai';

// In-memory store for the latest assistant response
let latestResponse = { text: '', ts: 0 };

// GET the latest captured response (called by client for TTS)
router.get('/api/latest-response', (req, res) => {
  res.json(latestResponse);
});

// Transparent MITM for ALL methods and paths under /mistral-proxy/
router.all('/mistral-proxy/*', async (req, res) => {
  const path = req.params[0]; // e.g. "v1/chat/completions" or "v1/models"
  const targetUrl = `${MISTRAL_API}/${path}`;
  const apiKey = process.env.MISTRAL_API_KEY;

  const isPost = req.method === 'POST';
  const isStreaming = isPost && req.body?.stream === true;
  const isChatCompletions = path.endsWith('chat/completions');

  console.log(`[PROXY] ${req.method} /${path}${isStreaming ? ' (stream)' : ''}`);

  try {
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
    };
    // Forward content-type for requests with body
    if (req.headers['content-type']) {
      headers['Content-Type'] = req.headers['content-type'];
    }
    if (req.headers['accept']) {
      headers['Accept'] = req.headers['accept'];
    }

    const fetchOpts = { method: req.method, headers };
    if (isPost) {
      fetchOpts.body = JSON.stringify(req.body);
    }

    const upstream = await fetch(targetUrl, fetchOpts);

    // Forward status + all safe headers
    res.status(upstream.status);
    for (const [key, value] of upstream.headers.entries()) {
      const k = key.toLowerCase();
      if (!['transfer-encoding', 'connection', 'keep-alive'].includes(k)) {
        res.setHeader(key, value);
      }
    }

    if (isStreaming && isChatCompletions) {
      // ── Streaming chat: tee the stream, capture content deltas ──
      let accumulated = '';
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);

          // Extract content deltas from SSE
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) accumulated += delta;
            } catch {}
          }
        }
      } catch (e) {
        console.error('[PROXY] Stream error:', e.message);
      }

      if (accumulated.trim()) {
        latestResponse = { text: accumulated.trim(), ts: Date.now() };
        console.log(`[PROXY] Captured ${accumulated.length} chars`);
      }
      res.end();

    } else if (isPost && isChatCompletions) {
      // ── Non-streaming chat: capture full response ──
      const data = await upstream.json();
      const content = data.choices?.[0]?.message?.content;
      if (content?.trim()) {
        latestResponse = { text: content.trim(), ts: Date.now() };
        console.log(`[PROXY] Captured ${content.length} chars`);
      }
      res.json(data);

    } else {
      // ── Everything else: transparent pass-through ──
      const body = await upstream.arrayBuffer();
      res.send(Buffer.from(body));
    }
  } catch (err) {
    console.error(`[PROXY] Error: ${req.method} /${path}:`, err.message);
    res.status(502).json({ error: err.message });
  }
});

export default router;
