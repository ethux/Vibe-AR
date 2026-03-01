// ─── TTS (ElevenLabs) — speak terminal responses ───
// Streams sentence chunks from Mistral proxy and speaks them via ElevenLabs
// as they arrive, using previous_request_ids for smooth stitching.
import { log } from './core/logging.js';

let ttsSpeaking = false;
let lastSeenTs = 0;
let currentAudioCtx = null;
let currentReader = null;
let stopRequested = false;

export function isTtsSpeaking() { return ttsSpeaking; }

export function stopTTS() {
  if (!ttsSpeaking) return;
  log('[TTS] Stopping playback');
  stopRequested = true;
  if (currentReader) { try { currentReader.cancel(); } catch (_) {} currentReader = null; }
  if (currentAudioCtx) { try { currentAudioCtx.close(); } catch (_) {} currentAudioCtx = null; }
  ttsSpeaking = false;
}

const PCM_RATE = 24000;
const PCM_CHUNK_SAMPLES = 4800;

/**
 * Poll /api/response-chunks for sentence chunks as they stream from Mistral.
 * Speaks each chunk immediately via ElevenLabs with request stitching.
 */
export async function speakReply() {
  if (ttsSpeaking) {
    log('[TTS] Interrupting current speech for new reply');
    stopTTS();
    await new Promise(r => setTimeout(r, 50));
  }

  const startTs = Date.now();
  log('[TTS] Waiting for Vibe response...');

  // Initialize baseline ts on first ever call so we don't speak stale data
  if (lastSeenTs === 0) {
    try {
      const res = await fetch('/api/response-chunks?since=0');
      const data = await res.json();
      if (data.ts > 0) lastSeenTs = data.ts;
    } catch (_) {}
  }

  ttsSpeaking = true;
  stopRequested = false;

  // AudioContext created lazily when first TTS audio is ready
  let audioCtx = null;
  let gainNode = null;
  let nextTime = 0;

  const requestIds = [];
  let consumed = 0;
  let responseTs = 0;
  let spoken = 0;

  try {
    while (true) {
      if (stopRequested) break;
      if (Date.now() - startTs > 30000) { log('[TTS] Timeout'); break; }

      await new Promise(r => setTimeout(r, 300));

      let data;
      try {
        const res = await fetch(`/api/response-chunks?since=${consumed}`);
        data = await res.json();
      } catch (e) {
        log(`[TTS] Poll error: ${e.message}`);
        continue;
      }

      // Wait for a NEW response to start streaming
      if (responseTs === 0) {
        if (data.ts > lastSeenTs) {
          responseTs = data.ts;
          lastSeenTs = responseTs;
          consumed = 0;
          log(`[TTS] Response streaming (${((Date.now() - startTs) / 1000).toFixed(1)}s)`);
          // Re-fetch from index 0 since this is a new response
          try {
            const res2 = await fetch('/api/response-chunks?since=0');
            data = await res2.json();
          } catch (_) { continue; }
        } else {
          continue;
        }
      }

      // If a different response started (shouldn't happen normally), bail
      if (data.ts !== responseTs) break;

      // Speak each new chunk as it arrives
      for (const chunkText of data.chunks) {
        if (stopRequested) break;
        consumed++;

        const cleaned = chunkText.trim();
        if (cleaned.length < 3) continue;

        const ttsBody = { text: cleaned };
        if (requestIds.length > 0) {
          ttsBody.previous_request_ids = requestIds.slice(-3);
        }

        log(`[TTS] Chunk ${spoken + 1}: "${cleaned.substring(0, 60)}"`);

        const ttsRes = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ttsBody),
        });

        if (!ttsRes.ok) {
          log(`[TTS] TTS error: ${await ttsRes.text()}`);
          continue;
        }

        const reqId = ttsRes.headers.get('X-Request-Id');
        if (reqId) requestIds.push(reqId);

        // Create AudioContext just-in-time so currentTime starts fresh
        if (!audioCtx) {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: PCM_RATE });
          currentAudioCtx = audioCtx;
          gainNode = audioCtx.createGain();
          gainNode.gain.value = 3.0;
          gainNode.connect(audioCtx.destination);
          nextTime = audioCtx.currentTime;
        } else if (nextTime < audioCtx.currentTime) {
          nextTime = audioCtx.currentTime;
        }

        const reader = ttsRes.body.getReader();
        currentReader = reader;
        let leftover = new Uint8Array(0);

        while (true) {
          if (stopRequested) { reader.cancel(); break; }
          const { done, value } = await reader.read();
          if (done) break;

          const merged = new Uint8Array(leftover.length + value.length);
          merged.set(leftover);
          merged.set(value, leftover.length);

          const chunkBytes = PCM_CHUNK_SAMPLES * 2;
          let offset = 0;
          while (offset + chunkBytes <= merged.length) {
            scheduleChunk(audioCtx, gainNode, merged.slice(offset, offset + chunkBytes), nextTime);
            nextTime += PCM_CHUNK_SAMPLES / PCM_RATE;
            offset += chunkBytes;
          }
          leftover = merged.slice(offset);
        }

        if (leftover.length >= 2) {
          const samples = Math.floor(leftover.length / 2);
          scheduleChunk(audioCtx, gainNode, leftover.slice(0, samples * 2), nextTime);
          nextTime += samples / PCM_RATE;
        }
        currentReader = null;
        spoken++;
      }

      // Done when server says streaming finished and no more chunks
      if (data.done && data.chunks.length === 0 && responseTs > 0) break;
    }

    if (audioCtx) {
      const remaining = nextTime - audioCtx.currentTime;
      if (remaining > 0 && spoken > 0) await new Promise(r => setTimeout(r, remaining * 1000 + 200));
    }
    log(`[TTS] Done — spoke ${spoken} chunks`);
  } catch (e) {
    log(`[TTS] Error: ${e.message}`);
  } finally {
    ttsSpeaking = false;
    currentReader = null;
    if (currentAudioCtx === audioCtx) {
      currentAudioCtx = null;
      try { audioCtx.close(); } catch (_) {}
    }
  }
}

function scheduleChunk(audioCtx, gainNode, pcmBytes, startTime) {
  const samples = pcmBytes.length / 2;
  const float32 = new Float32Array(samples);
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  for (let i = 0; i < samples; i++) float32[i] = view.getInt16(i * 2, true) / 32768;
  const buf = audioCtx.createBuffer(1, samples, PCM_RATE);
  buf.getChannelData(0).set(float32);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(gainNode);
  if (startTime < audioCtx.currentTime) startTime = audioCtx.currentTime;
  src.start(startTime);
}

export function enableTtsCollecting() {}
export function onTermOutput() {}
