// ─── TTS (ElevenLabs) — speak terminal responses ───
// Captures Vibe's responses via API proxy, then speaks via ElevenLabs
import { log } from './logging.js';

let ttsSpeaking = false;
let lastSeenTs = 0;  // timestamp of last response we already spoke

/**
 * Poll /api/latest-response until Vibe's response appears, then speak it.
 * The web server's Mistral API proxy captures responses as Vibe streams them.
 */
export async function speakReply() {
  if (ttsSpeaking) { log('[TTS] Already speaking, skip'); return; }
  const startTs = Date.now();
  log('[TTS] Waiting for Vibe response via proxy...');

  // Poll for up to 30s, checking every 2s
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await fetch('/api/latest-response');
      const data = await res.json();
      // New response arrived (timestamp is newer than what we last saw)
      if (data.ts > lastSeenTs && data.text) {
        lastSeenTs = data.ts;
        const cleaned = cleanForSpeech(data.text);
        if (cleaned.length < 3) { log(`[TTS] Only code/tools, skipping speech`); return; }
        const ttsText = cleaned.length > 500 ? cleaned.substring(0, 500) + '...' : cleaned;
        log(`[TTS] Got Vibe response (${data.text.length}→${cleaned.length} chars, ${((Date.now() - startTs) / 1000).toFixed(1)}s): "${ttsText.substring(0, 120)}"`);
        speakTTS(ttsText);
        return;
      }
    } catch (e) {
      log(`[TTS] Poll error: ${e.message}`);
    }
  }
  log('[TTS] Timeout waiting for Vibe response');
}

/** Strip code blocks, tool calls, and markdown — keep only spoken text */
function cleanForSpeech(text) {
  return text
    // Remove fenced code blocks (```...```)
    .replace(/```[\s\S]*?```/g, '')
    // Remove inline code (`...`)
    .replace(/`[^`]+`/g, '')
    // Remove markdown headers (# ## ###)
    .replace(/^#{1,6}\s+/gm, '')
    // Remove markdown bold/italic
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    // Remove markdown links [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove file paths (/foo/bar.js, ./src/thing.ts)
    .replace(/(?:^|\s)[.\/][\w\/.-]+\.\w+/g, '')
    // Remove tool call patterns (common in coding agents)
    .replace(/^(Reading|Writing|Searching|Running|Executing|Created|Modified|Deleted)\s.*$/gm, '')
    // Collapse whitespace
    .replace(/\n{2,}/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

// Keep these as no-ops so terminal.js import doesn't break
export function enableTtsCollecting() {}
export function onTermOutput() {}

// Streaming PCM playback
const PCM_RATE = 24000;
const PCM_CHUNK_SAMPLES = 4800;

async function speakTTS(text) {
  if (ttsSpeaking) return;
  ttsSpeaking = true;
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const err = await res.text();
      log(`[TTS] Error: ${err}`);
      ttsSpeaking = false;
      return;
    }

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: PCM_RATE });
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 3.0;
    gainNode.connect(audioCtx.destination);
    const reader = res.body.getReader();
    let nextTime = audioCtx.currentTime;
    let leftover = new Uint8Array(0);

    log('[TTS] Streaming audio...');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const merged = new Uint8Array(leftover.length + value.length);
      merged.set(leftover);
      merged.set(value, leftover.length);

      const chunkBytes = PCM_CHUNK_SAMPLES * 2;
      let offset = 0;
      while (offset + chunkBytes <= merged.length) {
        const slice = merged.slice(offset, offset + chunkBytes);
        scheduleChunk(audioCtx, gainNode, slice, nextTime);
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

    const remaining = nextTime - audioCtx.currentTime;
    setTimeout(() => { ttsSpeaking = false; audioCtx.close(); }, Math.max(0, remaining * 1000) + 200);
  } catch (e) {
    log(`[TTS] ${e.message}`);
    ttsSpeaking = false;
  }
}

function scheduleChunk(audioCtx, gainNode, pcmBytes, startTime) {
  const samples = pcmBytes.length / 2;
  const float32 = new Float32Array(samples);
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  for (let i = 0; i < samples; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  const buf = audioCtx.createBuffer(1, samples, PCM_RATE);
  buf.getChannelData(0).set(float32);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(gainNode);
  if (startTime < audioCtx.currentTime) startTime = audioCtx.currentTime;
  src.start(startTime);
}
