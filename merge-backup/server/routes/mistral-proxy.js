// ─── Mistral API Proxy (MITM) ───
// Transparent proxy for ALL Vibe→Mistral API calls.
// Captures assistant chat responses for TTS.
// Pushes <speak> chunks to clients via WebSocket in real time.
import { Router } from 'express';
import { WebSocketServer } from 'ws';

const router = Router();
const MISTRAL_API = 'https://api.mistral.ai';

// In-memory store for the latest assistant response
let latestResponse = { text: '', ts: 0 };

// Sentence chunks for real-time TTS polling (kept as fallback)
let responseChunks = { chunks: [], done: true, ts: 0 };

// ── WebSocket clients for real-time TTS push ──
const ttsClients = new Set();
let responseGen = 0;

function pushToTtsClients(msg) {
  const data = JSON.stringify(msg);
  for (const ws of ttsClients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

export function setupTtsPushWs(server) {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => {
    ttsClients.add(ws);
    console.log(`[TTS-WS] Client connected (${ttsClients.size} total)`);
    ws.on('close', () => {
      ttsClients.delete(ws);
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
      const gen = ++responseGen;
      responseChunks = { chunks: [], done: false, ts: Date.now() };
      pushToTtsClients({ type: 'start', gen });

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
                      pushToTtsClients({ type: 'chunk', text: sentence, gen });
                    }
                  }
                  if (remainder.trim().length >= 3) {
                    console.log(`[PROXY] Speak chunk ${responseChunks.chunks.length}: "${remainder.trim().substring(0, 80)}"`);
                    responseChunks.chunks.push(remainder.trim());
                    pushToTtsClients({ type: 'chunk', text: remainder.trim(), gen });
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
          pushToTtsClients({ type: 'chunk', text: cleaned, gen });
        }
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
