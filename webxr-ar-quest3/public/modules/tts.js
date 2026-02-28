// ─── TTS (ElevenLabs) — speak terminal responses ───
import { getTerm } from './state.js';
import { log } from './logging.js';

let ttsCollecting = false;
let ttsStartLine = 0;
let ttsTimeout = null;
let ttsSpeaking = false;

export function enableTtsCollecting() {
  const term = getTerm();
  ttsStartLine = term ? term.buffer.active.baseY + term.buffer.active.cursorY : 0;
  ttsCollecting = true;
}

export function onTermOutput() {
  if (!ttsCollecting) return;
  clearTimeout(ttsTimeout);
  ttsTimeout = setTimeout(() => finishTtsCollect(), 2000);
}

function finishTtsCollect() {
  clearTimeout(ttsTimeout);
  ttsCollecting = false;
  const term = getTerm();
  if (!term) return;

  const buf = term.buffer.active;
  const endLine = buf.baseY + buf.cursorY;
  const lines = [];
  for (let i = ttsStartLine + 1; i < endLine; i++) {
    const line = buf.getLine(i);
    if (!line) continue;
    const text = line.translateToString(true).trim();
    if (text) lines.push(text);
  }

  const filtered = lines.filter(l => {
    if (/^(root@|vibe>|\$|#|>>>)\s*/i.test(l)) return false;
    if (/^\[.*\]\s*$/.test(l)) return false;
    return true;
  });

  const responseText = filtered.join(' ').trim();
  if (responseText.length < 10) { log('[TTS] Response too short, skipping'); return; }

  const ttsText = responseText.length > 500 ? responseText.substring(0, 500) + '...' : responseText;
  log(`[TTS] Speaking ${ttsText.length} chars: "${ttsText.substring(0, 80)}..."`);
  speakTTS(ttsText);
}

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
