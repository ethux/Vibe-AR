// ─── Voxtral Realtime Transcription WebSocket Relay ───
// Browser → /ws/transcribe → Mistral RealtimeTranscription → text deltas → browser
//
// Protocol (browser → server):
//   Text: { sampleRate: number }  (control frame, sent first)
//   Text: { stop: true }         (signal end of audio, keep WS open for results)
//   Binary: ArrayBuffer           (PCM S16LE chunks)
//
// Protocol (server → browser):
//   { type: 'delta', text: string, accumulated: string }
//   { type: 'done',  text: string }
//   { type: 'error', message: string }

import { WebSocketServer } from 'ws';

const MODEL = 'voxtral-mini-transcribe-realtime-2602';

export function setupTranscribeRealtimeWs(server) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', async (ws) => {
    console.log('[TRANSCRIBE-RT] Client connected');

    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      ws.send(JSON.stringify({ type: 'error', message: 'MISTRAL_API_KEY not set' }));
      ws.close();
      return;
    }

    let sampleRate = 48000;
    let done = false;
    const audioQueue = [];
    let resolveNext = null;

    // Async generator that yields PCM chunks as they arrive from the browser
    async function* audioGenerator() {
      while (true) {
        if (audioQueue.length > 0) {
          yield audioQueue.shift();
          continue;
        }
        if (done) return;
        await new Promise((r) => { resolveNext = r; });
        resolveNext = null;
      }
    }

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.sampleRate) {
            sampleRate = msg.sampleRate;
            console.log(`[TRANSCRIBE-RT] Sample rate: ${sampleRate}`);
          }
          if (msg.stop) {
            // User stopped recording — end the audio generator
            // but keep the WS open to receive final transcription
            console.log('[TRANSCRIBE-RT] Stop signal received, flushing audio...');
            done = true;
            if (resolveNext) resolveNext();
          }
        } catch {}
        return;
      }
      audioQueue.push(Buffer.from(data));
      if (resolveNext) resolveNext();
    });

    ws.on('close', () => {
      console.log('[TRANSCRIBE-RT] Client disconnected');
      done = true;
      if (resolveNext) resolveNext();
    });

    ws.on('error', (err) => {
      console.error('[TRANSCRIBE-RT] WS error:', err.message);
      done = true;
      if (resolveNext) resolveNext();
    });

    // Connect to Mistral Realtime via SDK
    try {
      const { RealtimeTranscription } = await import('@mistralai/mistralai/extra/realtime/index.js');

      const client = new RealtimeTranscription({
        apiKey,
        serverURL: 'wss://api.mistral.ai',
      });

      let accumulated = '';

      console.log('[TRANSCRIBE-RT] Connecting to Mistral...');
      for await (const event of client.transcribeStream(
        audioGenerator(),
        MODEL,
        { audioFormat: { encoding: 'pcm_s16le', sampleRate } }
      )) {
        if (ws.readyState !== ws.OPEN) break;

        console.log(`[TRANSCRIBE-RT] Event: ${event.type}`);

        if (event.type === 'transcription.text.delta') {
          const delta = event.text ?? event.delta ?? '';
          accumulated += delta;
          ws.send(JSON.stringify({ type: 'delta', text: delta, accumulated }));
        } else if (event.type === 'transcription.done') {
          const final = event.text ?? accumulated;
          console.log(`[TRANSCRIBE-RT] Final transcript: "${final}"`);
          ws.send(JSON.stringify({ type: 'done', text: final }));
          accumulated = '';
        } else if (event.type === 'error') {
          console.error('[TRANSCRIBE-RT] Mistral error:', JSON.stringify(event));
          ws.send(JSON.stringify({ type: 'error', message: event.error?.message ?? 'Transcription error' }));
        } else if (event.type === 'session.created') {
          console.log('[TRANSCRIBE-RT] Mistral session created');
        }
      }
      console.log('[TRANSCRIBE-RT] Stream ended');
    } catch (err) {
      console.error('[TRANSCRIBE-RT] Fatal:', err.message);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    }
  });

  return {
    upgrade: (req, socket, head) =>
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req)),
  };
}
