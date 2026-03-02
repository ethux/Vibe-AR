// ─── Mistral API Proxy (MITM) ───
// Transparent proxy for ALL Vibe→Mistral API calls.
// Captures assistant chat responses for TTS.
// Pushes <speak> chunks to clients via WebSocket in real time.
import { Router } from 'express';
import { WebSocketServer } from 'ws';

const router = Router();
const DEFAULT_API = process.env.MISTRAL_API_URL || 'https://api.mistral.ai';

// Model → backend routing (auto-detect local vs cloud per request)
const VLLM_URL = process.env.VLLM_URL || 'https://vllm.aptget.nl';
const MISTRAL_URL = 'https://api.mistral.ai';
const LOCAL_MODELS = new Set((process.env.LOCAL_MODELS || 'Devstral-Small').split(','));

function getBackend(model) {
  // Local models → vLLM server
  if (model && LOCAL_MODELS.has(model)) {
    return { url: VLLM_URL, key: process.env.VLLM_API_KEY || process.env.MISTRAL_API_KEY };
  }
  // Cloud models → always Mistral API (ignore MISTRAL_API_URL override)
  return { url: MISTRAL_URL, key: process.env.MISTRAL_API_KEY };
}

console.log(`[PROXY] Default backend: ${DEFAULT_API}`);

// In-memory store for the latest assistant response
let latestResponse = { text: '', ts: 0 };

// Sentence chunks for real-time TTS polling (kept as fallback)
let responseChunks = { chunks: [], done: true, ts: 0 };

// ── WebSocket clients for real-time TTS push ──
// Only the latest client is active — prevents double TTS on page reload
let activeTtsClient = null;
const ttsClients = new Set();
let responseGen = 0;

function pushToTtsClients(msg) {
  if (activeTtsClient && activeTtsClient.readyState === 1) {
    activeTtsClient.send(JSON.stringify(msg));
  }
}

export function setupTtsPushWs(server) {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => {
    if (activeTtsClient && activeTtsClient !== ws && activeTtsClient.readyState === 1) {
      console.log('[TTS-WS] Closing stale client');
      activeTtsClient.close();
    }
    activeTtsClient = ws;
    ttsClients.add(ws);
    console.log(`[TTS-WS] Client connected (active), ${ttsClients.size} total`);
    ws.on('close', () => {
      ttsClients.delete(ws);
      if (activeTtsClient === ws) activeTtsClient = null;
      console.log(`[TTS-WS] Client disconnected (${ttsClients.size} total)`);
    });
  });
  return {
    upgrade: (req, socket, head) =>
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req)),
  };
}

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
      const gen = ++responseGen;
      responseChunks = { chunks: [], done: false, ts: Date.now() };
      pushToTtsClients({ type: 'start', gen });

      let accumulated = '';
      let rawBuffer = '';     // Raw LLM output for tag detection
      let inSpeak = false;    // Currently inside a <speak> block
      let sentenceBuf = '';   // Accumulates text inside <speak> for sentence splitting
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();

      function flushSentences(force) {
        const cleaned = cleanForSpeech(sentenceBuf);
        const { sentences, remainder } = extractSentences(cleaned);
        for (const sentence of sentences) {
          if (sentence.length >= 3) {
            console.log(`[PROXY] Speak chunk ${responseChunks.chunks.length}: "${sentence.substring(0, 80)}"`);
            responseChunks.chunks.push(sentence);
            pushToTtsClients({ type: 'chunk', text: sentence, gen });
          }
        }
        // Keep only the un-sentenced remainder for next round
        sentenceBuf = remainder;
        if (force && sentenceBuf.trim().length >= 3) {
          const final = cleanForSpeech(sentenceBuf).trim();
          if (final.length >= 3) {
            console.log(`[PROXY] Speak chunk ${responseChunks.chunks.length}: "${final.substring(0, 80)}"`);
            responseChunks.chunks.push(final);
            pushToTtsClients({ type: 'chunk', text: final, gen });
          }
          sentenceBuf = '';
        }
      }

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
                rawBuffer += delta;

                // Process the raw buffer for <speak> / </speak> transitions
                while (rawBuffer.length > 0) {
                  if (!inSpeak) {
                    const openIdx = rawBuffer.indexOf('<speak>');
                    if (openIdx === -1) {
                      // No <speak> tag yet — might be partial, keep last 7 chars
                      if (rawBuffer.length > 7) rawBuffer = rawBuffer.slice(-7);
                      break;
                    }
                    // Enter speak mode
                    inSpeak = true;
                    rawBuffer = rawBuffer.slice(openIdx + 7);
                  }

                  if (inSpeak) {
                    const closeIdx = rawBuffer.indexOf('</speak>');
                    if (closeIdx === -1) {
                      // Still inside <speak> — accumulate all available text
                      // But keep last 8 chars in rawBuffer in case of partial </speak>
                      const safe = rawBuffer.length > 8 ? rawBuffer.slice(0, -8) : '';
                      if (safe) {
                        sentenceBuf += safe;
                        rawBuffer = rawBuffer.slice(safe.length);
                        flushSentences(false);
                      }
                      break;
                    }
                    // Found </speak> — flush everything before it
                    sentenceBuf += rawBuffer.slice(0, closeIdx);
                    flushSentences(true);
                    inSpeak = false;
                    rawBuffer = rawBuffer.slice(closeIdx + 8);
                  }
                }
              }
            } catch {}
          }
        }
      } catch (e) {
        console.error('[PROXY] Stream error:', e.message);
      }

      // Flush any remaining content inside an unclosed <speak> tag
      if (inSpeak && sentenceBuf.trim().length >= 3) {
        flushSentences(true);
      }
      responseChunks.done = true;
      pushToTtsClients({ type: 'done', gen });

      if (accumulated.trim()) {
        latestResponse = { text: accumulated.trim(), ts: Date.now() };
        console.log(`[PROXY] Captured ${accumulated.length} chars, ${responseChunks.chunks.length} chunks`);
      }
      res.end();

    } else if (isPost && isChatCompletions) {
      // ── Non-streaming chat: capture full response ──
      const nonStreamGen = ++responseGen;
      const data = await upstream.json();
      const content = data.choices?.[0]?.message?.content;
      if (content?.trim()) {
        latestResponse = { text: content.trim(), ts: Date.now() };
        console.log(`[PROXY] Captured ${content.length} chars`);

        responseChunks = { chunks: [], done: false, ts: Date.now() };
        pushToTtsClients({ type: 'start', gen: nonStreamGen });
        const spokenText = extractSpeakContent(content);
        if (spokenText.length >= 3) {
          const cleaned = cleanForSpeech(spokenText);
          const { sentences, remainder } = extractSentences(cleaned);
          for (const s of sentences) {
            if (s.length >= 3) {
              responseChunks.chunks.push(s);
              pushToTtsClients({ type: 'chunk', text: s, gen: nonStreamGen });
            }
          }
          if (remainder.trim().length >= 3) {
            responseChunks.chunks.push(remainder.trim());
            pushToTtsClients({ type: 'chunk', text: remainder.trim(), gen: nonStreamGen });
          }
        }
        responseChunks.done = true;
        pushToTtsClients({ type: 'done', gen: nonStreamGen });
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
