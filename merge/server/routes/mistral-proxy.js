// ─── Mistral API Proxy (MITM) ───
// Transparent proxy for ALL Vibe→Mistral API calls.
// Captures assistant chat responses for TTS.
// Stores sentence chunks for real-time polling by client.
import { Router } from 'express';

const router = Router();
const DEFAULT_API = process.env.MISTRAL_API_URL || 'https://api.mistral.ai';

// Model → backend routing (auto-detect local vs cloud per request)
const VLLM_URL = process.env.VLLM_URL || 'https://vllm.aptget.nl';
const MISTRAL_URL = 'https://api.mistral.ai';
const LOCAL_MODELS = new Set((process.env.LOCAL_MODELS || 'Devstral-Small').split(','));

function getBackend(model) {
  if (model && LOCAL_MODELS.has(model)) {
    return { url: VLLM_URL, key: process.env.VLLM_API_KEY || process.env.MISTRAL_API_KEY };
  }
  if (DEFAULT_API !== MISTRAL_URL) {
    return { url: DEFAULT_API, key: process.env.VLLM_API_KEY || process.env.MISTRAL_API_KEY };
  }
  return { url: MISTRAL_URL, key: process.env.MISTRAL_API_KEY };
}

console.log(`[PROXY] Default backend: ${DEFAULT_API}`);

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

// Extract only content within <speak> tags for TTS.
// Returns the spoken text; everything outside <speak> tags is ignored.
function extractSpeakContent(text) {
  const matches = [];
  const regex = /<speak>([\s\S]*?)<\/speak>/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const content = match[1].trim();
    if (content.length > 0) matches.push(content);
  }
  return matches.join(' ');
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
  const model = req.body?.model;
  const backend = getBackend(model);
  const targetUrl = `${backend.url}/${path}`;
  const apiKey = backend.key;

  const isPost = req.method === 'POST';
  const isStreaming = isPost && req.body?.stream === true;
  const isChatCompletions = path.endsWith('chat/completions');

  console.log(`[PROXY] ${req.method} /${path}${isStreaming ? ' (stream)' : ''} → ${backend.url}${model ? ` [${model}]` : ''}`);

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
      let speakBuffer = '';  // Accumulates text to detect <speak> tags
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
                speakBuffer += delta;

                // Extract completed <speak>...</speak> blocks as they stream in
                const speakRegex = /<speak>([\s\S]*?)<\/speak>/gi;
                let speakMatch;
                let lastSpeakEnd = 0;
                while ((speakMatch = speakRegex.exec(speakBuffer)) !== null) {
                  const spokenText = cleanForSpeech(speakMatch[1].trim());
                  lastSpeakEnd = speakRegex.lastIndex;

                  // Split spoken text into sentences for streaming TTS
                  const { sentences, remainder } = extractSentences(spokenText);
                  for (const sentence of sentences) {
                    if (sentence.length >= 3) {
                      console.log(`[PROXY] Speak chunk ${responseChunks.chunks.length}: "${sentence.substring(0, 80)}"`);
                      responseChunks.chunks.push(sentence);
                    }
                  }
                  // If there's leftover text that didn't end in punctuation, push it too
                  if (remainder.trim().length >= 3) {
                    console.log(`[PROXY] Speak chunk ${responseChunks.chunks.length}: "${remainder.trim().substring(0, 80)}"`);
                    responseChunks.chunks.push(remainder.trim());
                  }
                }
                // Keep only unmatched tail (potential partial <speak> tag)
                if (lastSpeakEnd > 0) {
                  speakBuffer = speakBuffer.slice(lastSpeakEnd);
                }
              }
            } catch {}
          }
        }
      } catch (e) {
        console.error('[PROXY] Stream error:', e.message);
      }

      // Flush any remaining <speak> content
      const finalSpoken = extractSpeakContent(speakBuffer);
      if (finalSpoken.length >= 3) {
        const cleaned = cleanForSpeech(finalSpoken);
        if (cleaned.length >= 3) {
          console.log(`[PROXY] Final speak chunk: "${cleaned.substring(0, 80)}"`);
          responseChunks.chunks.push(cleaned);
        }
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
        // Only speak content within <speak> tags
        const spokenText = extractSpeakContent(content);
        if (spokenText.length >= 3) {
          const cleaned = cleanForSpeech(spokenText);
          const { sentences, remainder } = extractSentences(cleaned);
          for (const s of sentences) {
            if (s.length >= 3) responseChunks.chunks.push(s);
          }
          if (remainder.trim().length >= 3) {
            responseChunks.chunks.push(remainder.trim());
          }
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
