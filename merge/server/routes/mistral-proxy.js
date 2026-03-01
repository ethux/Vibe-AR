// ─── Mistral API Proxy (MITM) ───
// Transparent proxy for ALL Vibe→Mistral API calls.
// Captures assistant chat responses for TTS.
// Stores sentence chunks for real-time polling by client.
import { Router } from 'express';

const router = Router();
const MISTRAL_API = 'https://api.mistral.ai';

// In-memory store for the latest assistant response
let latestResponse = { text: '', ts: 0 };

// Sentence chunks for real-time TTS polling
let responseChunks = { chunks: [], done: true, ts: 0 };

// GET the latest captured response (legacy, still used as fallback)
router.get('/api/latest-response', (req, res) => {
  res.json(latestResponse);
});

// Polling endpoint: returns new sentence chunks since index `since`
router.get('/api/response-chunks', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const newChunks = responseChunks.chunks.slice(since);
  res.json({
    chunks: newChunks,
    done: responseChunks.done,
    total: responseChunks.chunks.length,
    ts: responseChunks.ts,
  });
});

// Extract complete sentences from a buffer, return { sentences[], remainder }
function extractSentences(buffer) {
  const sentences = [];
  const regex = /[^.!?\n]*[.!?]+(?:\s|$)/g;
  let match;
  let lastIndex = 0;
  while ((match = regex.exec(buffer)) !== null) {
    const s = match[0].trim();
    if (s.length > 0) sentences.push(s);
    lastIndex = regex.lastIndex;
  }
  return { sentences, remainder: buffer.slice(lastIndex) };
}

// Clean text for speech (remove code blocks, markdown, etc.)
function cleanForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(?:^|\s)[.\/][\w\/.-]+\.\w+/g, '')
    .replace(/^(Reading|Writing|Searching|Running|Executing|Created|Modified|Deleted)\s.*$/gm, '')
    .replace(/\n{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Transparent MITM for ALL methods and paths under /mistral-proxy/
router.all('/mistral-proxy/*', async (req, res) => {
  const path = req.params[0];
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
      // ── Streaming chat: tee the stream, capture + chunk for TTS ──
      // Reset chunks for this new response
      responseChunks = { chunks: [], done: false, ts: Date.now() };

      let accumulated = '';
      let sentenceBuffer = '';
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);

          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                accumulated += delta;
                sentenceBuffer += delta;

                // Check for complete sentences
                const cleaned = cleanForSpeech(sentenceBuffer);
                const { sentences, remainder } = extractSentences(cleaned);
                if (sentences.length > 0) {
                  sentenceBuffer = remainder;
                  for (const sentence of sentences) {
                    if (sentence.length >= 3) {
                      console.log(`[PROXY] Chunk ${responseChunks.chunks.length}: "${sentence.substring(0, 80)}"`);
                      responseChunks.chunks.push(sentence);
                    }
                  }
                }
              }
            } catch {}
          }
        }
      } catch (e) {
        console.error('[PROXY] Stream error:', e.message);
      }

      // Flush remaining text as final chunk
      const finalCleaned = cleanForSpeech(sentenceBuffer);
      if (finalCleaned.length >= 3) {
        console.log(`[PROXY] Final chunk: "${finalCleaned.substring(0, 80)}"`);
        responseChunks.chunks.push(finalCleaned);
      }
      responseChunks.done = true;

      if (accumulated.trim()) {
        latestResponse = { text: accumulated.trim(), ts: Date.now() };
        console.log(`[PROXY] Captured ${accumulated.length} chars, ${responseChunks.chunks.length} chunks`);
      }
      res.end();

    } else if (isPost && isChatCompletions) {
      // ── Non-streaming chat: capture full response ──
      const data = await upstream.json();
      const content = data.choices?.[0]?.message?.content;
      if (content?.trim()) {
        latestResponse = { text: content.trim(), ts: Date.now() };
        console.log(`[PROXY] Captured ${content.length} chars`);

        responseChunks = { chunks: [], done: false, ts: Date.now() };
        const cleaned = cleanForSpeech(content);
        const { sentences, remainder } = extractSentences(cleaned);
        for (const s of sentences) {
          if (s.length >= 3) responseChunks.chunks.push(s);
        }
        if (remainder.trim().length >= 3) {
          responseChunks.chunks.push(remainder.trim());
        }
        responseChunks.done = true;
      }
      res.json(data);

    } else {
      // ── Everything else: transparent pass-through ──
      const body = await upstream.arrayBuffer();
      res.send(Buffer.from(body));
    }
  } catch (err) {
    console.error(`[PROXY] Error: ${req.method} /${path}:`, err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: err.message });
    } else {
      res.end();
    }
  }
});

export default router;
